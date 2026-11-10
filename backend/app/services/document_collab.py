"""The collaboration hooks of decisions and SoAWs: one surface every writer calls.

Decisions (``adr``) and Statements of Architecture Work (``soaw``) gain a
discussion, mentions in their rich text and a history. Every path that writes
or serves one of them calls these four hooks, so the features land behind them
without touching the call sites again:

* :func:`before_save` — the incoming text fields of a create or an update,
  before they reach the row (mentions are checked and canonicalised here);
* :func:`after_save` — after an update has been applied (a version is
  recorded here);
* :func:`on_workflow` — a step of the document's life: it writes the
  timeline row (``document_history``) in the caller's transaction, before
  the caller commits;
* :func:`render_doc` — the response payloads of one request, as one batch
  (mentions are resolved for the reader here).

``before_save``, ``after_save`` and ``render_doc`` change nothing yet. Every
helper flushes and never commits: the caller owns the transaction.
"""

from __future__ import annotations

import uuid
from collections.abc import Iterable, Mapping
from typing import Any

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.architecture_decision import ArchitectureDecision
from app.models.document_history import DocumentHistoryEntry
from app.models.soaw import SoAW
from app.models.user import User
from app.services.card_read_scope import CardReadScope

ADR = "adr"
SOAW = "soaw"
DOC_KINDS: tuple[str, ...] = (ADR, SOAW)

#: The column of each table that names its owner document.
OWNER_COLUMNS: dict[str, str] = {ADR: "architecture_decision_id", SOAW: "soaw_id"}

#: Timeline steps written by :func:`on_workflow`.
WORKFLOW_STEPS: tuple[str, ...] = (
    "created",
    "revised",
    "sent_for_review",
    "signature",
    "signed",
    "rejected",
    "recalled",
    "recorded",
)

#: The text fields :func:`before_save` sees for each kind of document.
TEXT_FIELDS: dict[str, tuple[str, ...]] = {
    ADR: ("context", "decision", "consequences", "alternatives_considered"),
    SOAW: ("sections",),
}

Document = ArchitectureDecision | SoAW


def owner_fields(doc_kind: str, doc_id: uuid.UUID) -> dict[str, uuid.UUID]:
    """``{owner column: doc_id}`` for a row owned by the document."""
    if doc_kind not in OWNER_COLUMNS:
        raise ValueError(f"Unknown document kind {doc_kind!r}")
    return {OWNER_COLUMNS[doc_kind]: doc_id}


def history_signatories(signatories: Iterable[Mapping[str, Any]] | None) -> list[dict[str, Any]]:
    """``[{user_id, display_name}]`` from a document's signatory entries — the
    two keys a timeline keeps; never the e-mail, the status or a note."""
    return [
        {"user_id": entry.get("user_id"), "display_name": entry.get("display_name")}
        for entry in signatories or ()
        if isinstance(entry, Mapping)
    ]


def check_step(doc_kind: str, step: str) -> None:
    if doc_kind not in DOC_KINDS:
        raise ValueError(f"Unknown document kind {doc_kind!r}")
    if step not in WORKFLOW_STEPS:
        raise ValueError(f"Unknown workflow step {step!r}")


async def _actor(
    db: AsyncSession, user: User | uuid.UUID | None
) -> tuple[uuid.UUID | None, str | None]:
    """``(actor_id, actor_name)``: a user object as it is, an id looked up (the
    shared writers know only ``created_by``), nothing for a system step."""
    if user is None:
        return None, None
    if isinstance(user, User):
        return user.id, user.display_name
    found = await db.get(User, user)
    if found is None:
        return None, None
    return found.id, found.display_name


# --- the hooks --------------------------------------------------------------------


async def before_save(
    db: AsyncSession,
    doc_kind: str,
    doc: Document | None,
    incoming: dict[str, Any],
    *,
    user: User | None,
    read_scope: CardReadScope | None,
) -> dict[str, Any]:
    """The text fields to store for a create (``doc`` is ``None``) or an
    update of ``doc``. ``user`` / ``read_scope`` are the writer's; both are
    ``None`` for a system writer or a copy (revision, duplicate). Unchanged
    for now."""
    return incoming


async def after_save(
    db: AsyncSession,
    doc_kind: str,
    doc: Document,
    *,
    user: User,
    was_draft: bool,
    before: dict[str, Any] | None,
) -> None:
    """Called once an update of ``doc`` has been applied (flushed or not).
    ``was_draft`` is whether the document was a draft before the update;
    ``before`` its state before it, when the caller captured one. A no-op for
    now."""
    return None


async def on_workflow(
    db: AsyncSession,
    doc_kind: str,
    doc: Document,
    step: str,
    *,
    user: User | uuid.UUID | None,
    note: str | None = None,
    signatories: Iterable[Mapping[str, Any]] | None = None,
) -> DocumentHistoryEntry:
    """Write the timeline row for ``step`` of ``doc``; flush, never commit.

    ``signatories`` is kept (as ``[{user_id, display_name}]``) on a
    ``sent_for_review`` row only; ``note`` is the reason of a rejection or the
    signer's note.
    """
    check_step(doc_kind, step)
    actor_id, actor_name = await _actor(db, user)
    entry = DocumentHistoryEntry(
        **owner_fields(doc_kind, doc.id),
        kind=step,
        actor_id=actor_id,
        actor_name=actor_name,
        note=note or None,
        signatories=history_signatories(signatories) if step == "sent_for_review" else None,
    )
    db.add(entry)
    await db.flush()
    return entry


async def render_doc(
    db: AsyncSession,
    doc_kind: str,
    payloads: list[dict[str, Any]],
    *,
    user: User,
    read_scope: CardReadScope | None,
) -> list[dict[str, Any]]:
    """The response payloads of one request as ``user`` reads them, in one
    batch (``read_scope`` when the caller has it, loaded on demand otherwise).
    Returned unchanged for now."""
    return payloads


# --- reads behind the discussion, history and mentions routes ---------------------

NOT_FOUND: dict[str, str] = {
    ADR: "Architecture decision not found",
    SOAW: "Statement of Architecture Work not found",
}


async def load_document(db: AsyncSession, doc_kind: str, doc_id: str) -> Document:
    """The document, or 404 — for an unknown id and for a malformed one alike."""
    try:
        parsed = uuid.UUID(doc_id)
    except (ValueError, TypeError):
        raise HTTPException(404, NOT_FOUND[doc_kind]) from None
    doc: Document | None
    if doc_kind == SOAW:
        doc = await db.get(SoAW, parsed)
    else:
        doc = await db.get(ArchitectureDecision, parsed)
    if doc is None:
        raise HTTPException(404, NOT_FOUND[doc_kind])
    return doc


def is_signatory(signatories: Iterable[Any] | None, user_id: uuid.UUID) -> bool:
    """Whether ``user_id`` is among a document's current signatory entries."""
    wanted = str(user_id)
    return any(
        isinstance(entry, Mapping) and entry.get("user_id") == wanted for entry in signatories or ()
    )


def comment_capabilities(*, may_comment: bool, may_moderate: bool, signatory: bool) -> dict:
    """``{comment, moderate}``: a signatory may always comment; moderating is
    the document's edit permission."""
    return {"comment": may_comment or signatory, "moderate": may_moderate}


def discussion_payload(can: dict) -> dict[str, Any]:
    """The discussion of a document: no thread is stored yet."""
    return {"can": can, "open_count": 0, "threads": []}


def history_entry_payload(entry: DocumentHistoryEntry, actor_display_name: str | None) -> dict:
    """One timeline row as the History tab reads it. ``actor`` is the user as
    they are named now (``None`` once deleted); ``actor_name`` the snapshot."""
    actor = None
    if entry.actor_id is not None and actor_display_name is not None:
        actor = {"id": str(entry.actor_id), "display_name": actor_display_name}
    return {
        "id": str(entry.id),
        "kind": entry.kind,
        "actor": actor,
        "actor_name": entry.actor_name,
        "note": entry.note,
        "created_at": entry.created_at.isoformat() if entry.created_at else None,
        "has_content": entry.content is not None,
    }


async def history_entries(db: AsyncSession, doc_kind: str, doc_id: uuid.UUID) -> list[dict]:
    """The document's timeline in ``seq`` order, with each actor's current name
    (one query)."""
    owner = getattr(DocumentHistoryEntry, OWNER_COLUMNS[doc_kind])
    rows = await db.execute(
        select(DocumentHistoryEntry, User.display_name)
        .outerjoin(User, User.id == DocumentHistoryEntry.actor_id)
        .where(owner == doc_id)
        .order_by(DocumentHistoryEntry.seq)
    )
    return [history_entry_payload(entry, name) for entry, name in rows.all()]


def history_payload(entries: list[dict], *, can_view_versions: bool) -> dict[str, Any]:
    return {"can_view_versions": can_view_versions, "entries": entries}


def mentioned_in_payload() -> dict[str, list]:
    """Where a document is mentioned: nothing is searched yet."""
    return {"decisions": [], "soaws": []}
