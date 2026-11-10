"""Shared decision-record (ADR) creation — one writer for every caller.

Three paths create an ``ArchitectureDecision`` row: ``POST /adr``, the
analysis commit flow (``turbolens_commit``) and, since SDK 1.8, the
extension decisions bridge. Until this module existed the first two each
carried their own copy of the reference-number generator, which is exactly
how two writers drift apart. This is the B0-style extraction the card routes
already have in ``card_write_service``: callers own the transaction, helpers
flush and NEVER commit, and HTTP-flavoured errors stay ``HTTPException`` so
the REST route's status codes are byte-identical (non-HTTP callers translate).

Creation publishes one ``adr.created`` event (no ``card_id`` — a decision is
not a card, so it never lands on a card's History tab), carrying the id,
reference and linked cards: that is what lets a mutation batch that filed a
draft be rolled back from the Audit Log. Nothing else about the event is
load-bearing; the ``updated_at`` invariant does not apply to decisions.

The module also holds the small pure helpers the decision routes share — the
"ADR-012 · Rev 2 — title" label, the standing and date fields of a payload,
the list filters and the lock checks — so they carry a mutation score.
"""

from __future__ import annotations

import re
import uuid
from collections.abc import Iterable, Sequence
from datetime import date
from typing import Any

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.architecture_decision import ArchitectureDecision
from app.models.architecture_decision_card import ArchitectureDecisionCard
from app.models.card import Card
from app.services import decision_link_service, decision_people_service
from app.services import decision_standing as ds
from app.services.event_bus import event_bus

_REFERENCE_RE = re.compile(r"^ADR-(\d+)$", re.IGNORECASE)


async def next_reference_number(db: AsyncSession) -> str:
    """The next ``ADR-NNN`` reference (``ADR-001`` on an empty table).

    The highest number is found numerically — a string ``max()`` answers
    ``ADR-999`` forever once ``ADR-1000`` exists, and every create after that
    collides on the unique constraint. A reference in another format is
    ignored.
    """
    result = await db.execute(select(ArchitectureDecision.reference_number))
    highest = 0
    for reference in result.scalars().all():
        match = _REFERENCE_RE.match(reference or "")
        if match:
            highest = max(highest, int(match.group(1)))
    return f"ADR-{highest + 1:03d}"


async def resolve_card_ids(db: AsyncSession, card_ids: Sequence[str]) -> list[uuid.UUID]:
    """Parse and verify a list of card UUIDs, raising 400/404 with the
    offending values so a bad link list never silently no-ops."""
    parsed: list[uuid.UUID] = []
    seen: set[uuid.UUID] = set()
    for cid in card_ids:
        try:
            parsed_id = uuid.UUID(cid)
        except (ValueError, AttributeError, TypeError):
            raise HTTPException(400, f"Invalid card id: {cid!r}") from None
        if parsed_id not in seen:
            seen.add(parsed_id)
            parsed.append(parsed_id)
    if parsed:
        result = await db.execute(select(Card.id).where(Card.id.in_(parsed)))
        found = set(result.scalars().all())
        missing = [str(cid) for cid in parsed if cid not in found]
        if missing:
            raise HTTPException(404, f"Cards not found: {', '.join(missing)}")
    return parsed


async def create_decision(
    db: AsyncSession,
    *,
    title: str,
    context: str | None = None,
    decision: str | None = None,
    consequences: str | None = None,
    alternatives_considered: str | None = None,
    related_decisions: list[Any] | None = None,
    attributes: dict[str, Any] | None = None,
    linked_card_ids: Sequence[uuid.UUID] = (),
    created_by: uuid.UUID | None = None,
    decided_on: date | None = None,
    effective_from: date | None = None,
    valid_until: date | None = None,
    change_summary: str | None = None,
    publish: bool = True,
) -> ArchitectureDecision:
    """Insert a draft decision and its card links; flush, never commit.

    ``status`` is not a parameter on purpose — a new decision is always a
    draft; signing and status transitions have their own routes. Linked
    card ids are expected to be resolved already (``resolve_card_ids`` or
    the caller's own check); duplicates link once. ``publish=False`` skips
    the ``adr.created`` event — for a dry-run preview that will be rolled
    back, whose event would otherwise still reach every open SSE stream.

    ``related_decisions`` is the tolerant legacy path (the extension
    decisions bridge): each entry that is a decision id or a reference
    number becomes a ``relates`` link; anything else is dropped silently
    (:func:`decision_link_service.add_relates_links`). Callers that must
    refuse an unknown entry resolve it themselves and pass typed links.
    """
    adr = ArchitectureDecision(
        reference_number=await next_reference_number(db),
        title=title,
        context=context,
        decision=decision,
        consequences=consequences,
        alternatives_considered=alternatives_considered,
        attributes=dict(attributes or {}),
        created_by=created_by,
        decided_on=decided_on,
        effective_from=effective_from,
        valid_until=valid_until,
        change_summary=change_summary,
    )
    db.add(adr)
    await db.flush()
    seen: set[uuid.UUID] = set()
    for cid in linked_card_ids:
        if cid in seen:
            continue
        seen.add(cid)
        db.add(ArchitectureDecisionCard(architecture_decision_id=adr.id, card_id=cid))
    await db.flush()
    if any(isinstance(entry, str) for entry in related_decisions or ()):
        await decision_link_service.add_relates_links(
            db, adr, related_decisions or (), register=await ds.load_register(db)
        )
    if not publish:
        return adr
    await event_bus.publish(
        "adr.created",
        {
            "adr_id": str(adr.id),
            "reference_number": adr.reference_number,
            "revision_number": adr.revision_number,
            "title": adr.title,
            "status": adr.status,
            "linked_card_ids": [str(cid) for cid in seen],
        },
        db=db,
        user_id=created_by,
    )
    return adr


# --- labels and to-dos --------------------------------------------------------


def reference_label(reference_number: str, revision_number: int | None) -> str:
    """``"ADR-012 · Rev 2"``; the revision is shown only from 2 on."""
    if revision_number is not None and revision_number > 1:
        return f"{reference_number} · Rev {revision_number}"
    return reference_number


def decision_label(adr: ArchitectureDecision) -> str:
    """``"ADR-012 · Rev 2 — title"``: how notifications, to-dos and events name a decision."""
    return f"{reference_label(adr.reference_number, adr.revision_number)} — {adr.title}"


def decision_link(adr_id: uuid.UUID | str) -> str:
    """The in-app path of a decision; also what its sign to-dos link to and are matched by."""
    return f"/ea-delivery/adr/{adr_id}"


# --- serialisation ------------------------------------------------------------


def ref_payload(ref: ds.DecisionRef | None) -> dict[str, Any] | None:
    """A :class:`DecisionRef` on the wire: ``{id, reference_number, revision_number, title}``."""
    if ref is None:
        return None
    return {
        "id": str(ref.id),
        "reference_number": ref.reference_number,
        "revision_number": ref.revision_number,
        "title": ref.title,
    }


def _iso(value: date | None) -> str | None:
    return value.isoformat() if value is not None else None


def standing_fields(register: ds.Register, decision_id: Any) -> dict[str, Any]:
    """The derived fields every decision payload (list row and detail) carries."""
    st = register.get(decision_id)
    if st is None:
        st = ds.Standing(id=decision_id, standing=None, is_current=True, is_earlier_revision=False)
    return {
        "standing": st.standing,
        "is_current": st.is_current,
        "is_earlier_revision": st.is_earlier_revision,
        "superseded_by": ref_payload(st.superseded_by),
        "revoked_by": ref_payload(st.revoked_by),
        "amended_by": [ref_payload(ref) for ref in st.amended_by],
        "open_revision": ref_payload(st.open_revision),
        "upcoming": [
            {
                "kind": change.kind,
                "by": ref_payload(change.by),
                "effective_from": _iso(change.effective_from),
            }
            for change in st.upcoming
        ],
        "consolidated_into": ref_payload(st.consolidated_into),
    }


def date_fields(adr: ArchitectureDecision) -> dict[str, Any]:
    """The decision's own dates, ISO formatted."""
    return {
        "decided_on": _iso(adr.decided_on),
        "effective_from": _iso(adr.effective_from),
        "valid_until": _iso(adr.valid_until),
        "recorded_at": adr.recorded_at.isoformat() if adr.recorded_at else None,
    }


def revisions_payload(register: ds.Register, decision_id: Any) -> list[dict[str, Any]]:
    """The decision's chain in order, each revision with its status and standing."""
    st = register.get(decision_id)
    if st is None:
        return []
    return [
        {
            **(ref_payload(ref) or {}),
            "status": register.row(ref.id).status,
            "standing": register[ref.id].standing,
        }
        for ref in st.chain
    ]


def outgoing_targets(register: ds.Register, decision_id: Any, kind: str) -> list[Any]:
    """The targets of the decision's outgoing links of ``kind``, in register order."""
    return [lk.target_id for lk in register.outgoing(decision_id) if lk.kind == kind]


#: The typed link kinds a spreadsheet row lists, besides ``relates``.
LINK_REFERENCE_KINDS: tuple[str, ...] = (ds.REPLACES, ds.AMENDS, ds.REVOKES, ds.CONSOLIDATES)


def reference_labels(register: ds.Register, targets: Iterable[Any]) -> list[str]:
    """The reference numbers of ``targets`` in reference order, deduplicated,
    unknown ids left out."""
    rows = sorted(
        (register.row(target) for target in targets if target in register),
        key=lambda row: (row.reference_number, row.revision_number),
    )
    out: list[str] = []
    for row in rows:
        if row.reference_number not in out:
            out.append(row.reference_number)
    return out


def link_references(register: ds.Register, decision_id: Any) -> dict[str, list[str]]:
    """``{replaces, amends, revokes, consolidates}``: each kind's targets as references."""
    return {
        kind: reference_labels(register, outgoing_targets(register, decision_id, kind))
        for kind in LINK_REFERENCE_KINDS
    }


# --- list filters -------------------------------------------------------------


def parse_standing_filter(value: str | None) -> frozenset[str] | None:
    """``standing=`` as a set (comma-separated allowed); ``None`` when not filtering.

    An unknown value is a 400 naming it.
    """
    if value is None:
        return None
    wanted = [part.strip() for part in value.split(",") if part.strip()]
    if not wanted:
        return None
    unknown = [part for part in wanted if part not in ds.STANDINGS]
    if unknown:
        raise HTTPException(400, {"error": "unknown_standing", "values": unknown})
    return frozenset(wanted)


def keep_in_list(
    register: ds.Register,
    decision_id: Any,
    *,
    include_earlier: bool,
    standings: frozenset[str] | None,
) -> bool:
    """Whether a list row survives ``include_earlier`` and ``standing=``."""
    st = register.get(decision_id)
    if st is None:
        return include_earlier and standings is None
    if not include_earlier and st.is_earlier_revision:
        return False
    return standings is None or st.standing in standings


# --- dates and locking --------------------------------------------------------


def date_error(problems: Sequence[str]) -> HTTPException:
    """The 400 for dates that cannot be saved."""
    return HTTPException(400, {"error": problems[0], "problems": list(problems)})


def check_dates(
    decided_on: date | None,
    effective_from: date | None,
    valid_until: date | None,
    *,
    today: date,
) -> None:
    """Raise a 400 when a decision's dates are inconsistent (the save-time rules)."""
    problems = ds.validate_dates(
        decided_on, effective_from, valid_until, today=today, at_lock=False
    )
    if problems:
        raise date_error(problems)


def lock_refusal(register: ds.Register, adr: ArchitectureDecision) -> dict[str, Any] | None:
    """Why the decision may not be sent for signature now, as a 409 detail, or ``None``.

    Every link target must be signed and the decision's own chain must not be
    revoked or replaced (:func:`decision_standing.validate_lock`); its dates
    must hold once the signing date fills an empty ``effective_from``:
    ``valid_until`` not past nor before ``effective_from``, ``decided_on`` not
    in the future.
    """
    today = register.today
    problems = ds.validate_lock(register, adr.id) + ds.validate_dates(
        adr.decided_on,
        adr.effective_from or today,
        adr.valid_until,
        today=today,
        at_lock=True,
    )
    if not problems:
        return None
    detail: dict[str, Any] = {"error": problems[0], "problems": problems}
    if ds.LINK_TARGET_NOT_LOCKED in problems:
        detail["target_ids"] = [
            str(lk.target_id)
            for lk in register.outgoing(adr.id)
            if lk.target_id not in register or register.row(lk.target_id).status != ds.LOCKED_STATUS
        ]
    closed_by = ds.chain_closed_by(register, adr.id)
    if closed_by is not None:
        detail["by"] = ref_payload(closed_by)
    return detail


def apply_lock_dates(adr: ArchitectureDecision, signed_on: date) -> None:
    """Fill an empty ``decided_on`` / ``effective_from`` with the signing date."""
    if adr.decided_on is None:
        adr.decided_on = signed_on
    if adr.effective_from is None:
        adr.effective_from = signed_on


# --- revise and duplicate -----------------------------------------------------


async def copy_decision_extras(db: AsyncSession, source_id: uuid.UUID, new_id: uuid.UUID) -> None:
    """Carry ``relates`` links and people from one decision onto a new one; flush."""
    await decision_link_service.copy_relates_links(db, source_id, new_id)
    await decision_people_service.copy_people(db, source_id, new_id)
