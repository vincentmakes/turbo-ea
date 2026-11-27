"""The review outcome of a decision or a SoAW: the one definition of *closed*.

A document's ``status`` keeps its three sign-off values (draft, in review,
signed). Beside it, ``outcome`` records how a review ended when it did not end
in a signature, with who, when and why (discussion #1433):

* ``changes_requested`` — a signatory sent it back to be worked on: an
  editable draft, the flag clears when signatures are requested again;
* ``rejected`` — a signatory rejected it: the document is *closed*;
* ``withdrawn`` — the author side withdrew it: the document is *closed*.

A document with an outcome is always a draft. A closed document is locked
like one in review (only the filing fields change), cannot be sent for
signature, recorded, restored or (a SoAW) deleted until it is reopened, which
clears the outcome. Nothing else decides what *closed* means: both document
routes and their services ask :func:`is_closed`.

Pure: no database, no commit.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from fastapi import HTTPException

CHANGES_REQUESTED = "changes_requested"
REJECTED = "rejected"
WITHDRAWN = "withdrawn"

#: Every outcome, in the order a filter lists them.
OUTCOMES: tuple[str, ...] = (CHANGES_REQUESTED, REJECTED, WITHDRAWN)
#: The outcomes that close a document.
CLOSED_OUTCOMES: frozenset[str] = frozenset({REJECTED, WITHDRAWN})

#: The longest reason an outcome keeps (the request bodies' own limit).
NOTE_MAX = 4000


def is_closed_kind(kind: str | None) -> bool:
    """Whether an outcome ``kind`` closes the document."""
    return kind in CLOSED_OUTCOMES


def is_closed(doc: Any) -> bool:
    """Whether ``doc`` (a decision or a SoAW, or any object with ``outcome``)
    is closed: rejected or withdrawn."""
    return is_closed_kind(getattr(doc, "outcome", None))


def set_outcome(
    doc: Any,
    outcome: str,
    *,
    user: Any,
    note: str | None,
    now: datetime | None = None,
) -> None:
    """Record ``outcome`` on ``doc``, by ``user`` (a ``User``, or ``None`` for
    the system), with ``note`` as the reason (blank → none). Unknown outcome →
    ``ValueError``."""
    if outcome not in OUTCOMES:
        raise ValueError(f"Unknown review outcome {outcome!r}")
    text = (note or "").strip()
    doc.outcome = outcome
    doc.outcome_at = now or datetime.now(timezone.utc)
    doc.outcome_by = getattr(user, "id", None)
    doc.outcome_by_name = getattr(user, "display_name", None)
    doc.outcome_note = text[:NOTE_MAX] or None


def clear_outcome(doc: Any) -> None:
    """Remove the outcome from ``doc``: a plain draft again."""
    doc.outcome = None
    doc.outcome_at = None
    doc.outcome_by = None
    doc.outcome_by_name = None
    doc.outcome_note = None


def outcome_payload(doc: Any) -> dict[str, Any] | None:
    """``{"kind", "at", "by", "note"}`` for ``doc``'s outcome, or ``None``.

    ``by`` is ``{"id", "display_name"}``: the id is ``None`` once the user was
    deleted (the name snapshot stays); ``by`` itself is ``None`` when neither
    is known.
    """
    kind = getattr(doc, "outcome", None)
    if not kind:
        return None
    at = getattr(doc, "outcome_at", None)
    by_id = getattr(doc, "outcome_by", None)
    by_name = getattr(doc, "outcome_by_name", None)
    by = None
    if by_id is not None or by_name:
        by = {"id": str(by_id) if by_id is not None else None, "display_name": by_name}
    return {
        "kind": kind,
        "at": at.isoformat() if at is not None else None,
        "by": by,
        "note": getattr(doc, "outcome_note", None),
    }


def parse_outcome_filter(value: str | None) -> frozenset[str] | None:
    """``outcome=`` as a set (comma-separated allowed); ``None`` when not filtering.

    An unknown value is a 400 ``unknown_outcome`` naming it.
    """
    if value is None:
        return None
    wanted = [part.strip() for part in value.split(",") if part.strip()]
    if not wanted:
        return None
    unknown = [part for part in wanted if part not in OUTCOMES]
    if unknown:
        raise HTTPException(400, {"error": "unknown_outcome", "values": unknown})
    return frozenset(wanted)


def keep_in_list(
    kind: str | None, *, include_closed: bool, outcomes: frozenset[str] | None
) -> bool:
    """Whether a list row with outcome ``kind`` survives ``include_closed`` and
    ``outcome=``."""
    if not include_closed and is_closed_kind(kind):
        return False
    return outcomes is None or kind in outcomes


def closed_refusal(doc: Any) -> tuple[int, dict[str, Any]] | None:
    """``(409, {"error": "closed", "outcome": kind})`` when ``doc`` is closed,
    else ``None``."""
    if not is_closed(doc):
        return None
    return 409, {"error": "closed", "outcome": doc.outcome}


def withdraw_refusal(doc: Any) -> tuple[int, Any] | None:
    """Why ``doc`` may not be withdrawn now, as ``(status_code, detail)``, or
    ``None``: a draft that is not closed and a document in review may be."""
    if doc.status == "signed":
        return 400, "A signed document cannot be withdrawn"
    refusal = closed_refusal(doc)
    if refusal is not None:
        return refusal
    if doc.status not in ("draft", "in_review"):
        return 400, "Only a draft or a document in review can be withdrawn"
    return None


def reopen_refusal(doc: Any) -> tuple[int, Any] | None:
    """``(409, {"error": "not_closed"})`` unless ``doc`` is closed."""
    if not is_closed(doc):
        return 409, {"error": "not_closed"}
    return None


def closed_message(noun: str, kind: str | None) -> str:
    """The 403 a PATCH of a closed document's content answers: ``noun`` is
    ``"decision"`` or ``"document"``."""
    verb = "rejected" if kind == REJECTED else "withdrawn"
    return f"This {noun} was {verb} and is closed. Reopen it to edit it."
