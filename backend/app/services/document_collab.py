"""The collaboration hooks of decisions and SoAWs: one surface every writer calls.

Decisions (``adr``) and Statements of Architecture Work (``soaw``) gain a
discussion, mentions in their rich text and a history. Every path that writes
or serves one of them calls these four hooks, so the features land behind them
without touching the call sites again:

* :func:`before_save` — the incoming text fields of a create or an update,
  before they reach the row (pictures and mentions are checked and
  canonicalised here);
* :func:`after_save` — after an update has been applied (a version is
  recorded here);
* :func:`on_workflow` — a step of the document's life: it writes the
  timeline row (``document_history``) in the caller's transaction, before
  the caller commits;
* :func:`render_doc` — the response payloads of one request, as one batch
  (mentions are resolved for the reader here).

Every helper flushes and never commits: the caller owns the transaction.
"""

from __future__ import annotations

import uuid
from collections.abc import Callable, Iterable, Mapping
from typing import Any

from fastapi import HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.architecture_decision import ArchitectureDecision
from app.models.document_history import DocumentHistoryEntry
from app.models.soaw import SoAW
from app.models.user import User
from app.services import decision_standing as ds
from app.services import document_image_service, mention_service
from app.services.card_read_scope import CardReadScope
from app.services.document_image_markup import image_ids_of, normalise_images
from app.services.mention_markup import MAX_PASSES, text_of

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

#: Workflow steps that open a timeline and carry the document's first content.
CONTENT_STEPS: frozenset[str] = frozenset({"created", "revised"})

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


def _map_texts(doc_kind: str, values: dict[str, Any], fn: Callable[[str], str]) -> dict[str, Any]:
    """``values`` with ``fn`` applied to every rich-text string of its text
    fields; ``values`` itself when that changes nothing."""
    out = dict(values)
    for field in mention_service.text_fields_of(doc_kind):
        if field in out:
            out[field] = mention_service.map_field(doc_kind, out[field], fn)
    return values if out == values else out


def _texts(doc_kind: str, values: Mapping[str, Any]) -> list[str]:
    return [
        text
        for field in mention_service.text_fields_of(doc_kind)
        if field in values
        for text in mention_service.field_texts(doc_kind, field, values[field])
    ]


def images_of(doc_kind: str, values: Mapping[str, Any]) -> set[str]:
    """The ids of every stored picture in the text fields of ``values``."""
    return {image_id for text in _texts(doc_kind, values) for image_id in image_ids_of(text)}


def stored_images(doc_kind: str, doc: Any) -> set[str]:
    """The pictures stored on ``doc`` (a decision or SoAW row; ``None`` → none)."""
    if doc is None:
        return set()
    return images_of(
        doc_kind, {f: getattr(doc, f, None) for f in mention_service.text_fields_of(doc_kind)}
    )


def settle_markup(text: str, doc_kind: str, keep: Callable[[str], bool] | None = None) -> str:
    """``text`` (mentions already canonical) with its pictures normalised, the
    mention pass re-run whenever that changed anything, until both are stable.

    Removing a picture tag can splice its neighbours into a new mention span,
    and removing a mention span can splice a new picture tag: each pass is
    repeated after the other, at most ``MAX_PASSES`` times; markup built to
    keep assembling either is reduced to its text. ``keep`` also removes a
    picture whose id it refuses."""
    for _ in range(MAX_PASSES):
        pictured = normalise_images(text, doc_kind, keep)
        if pictured == text:
            return text
        text = mention_service.canonicalise(pictured, mention_service.DOCUMENT_KINDS)
    return text_of(text)


async def _drop_unknown_images(
    db: AsyncSession, doc_kind: str, values: dict[str, Any], known: set[str]
) -> dict[str, Any]:
    """``values`` without the pictures that are neither in ``known`` (already
    stored on the document) nor pictures of ``doc_kind`` in the store. An
    unknown picture is removed silently, never refused: a picture id names
    nothing a 404 would protect, and a stale editor must still save."""
    allowed = set(known)
    for _ in range(MAX_PASSES):
        new = images_of(doc_kind, values) - allowed
        if not new:
            return values
        allowed |= await document_image_service.existing(db, doc_kind, new)
        values = _map_texts(
            doc_kind, values, lambda text: settle_markup(text, doc_kind, allowed.__contains__)
        )
    if images_of(doc_kind, values) - allowed:
        # Removals that keep splicing new pictures together: keep the text only.
        values = _map_texts(doc_kind, values, text_of)
    return values


async def before_save(
    db: AsyncSession,
    doc_kind: str,
    doc: Document | None,
    incoming: dict[str, Any],
    *,
    user: User | None,
    read_scope: CardReadScope | None,
    copy: bool = False,
    kept: Iterable[mention_service.Mention] = (),
    kept_images: Iterable[str] = (),
) -> dict[str, Any]:
    """The text fields to store for a create (``doc`` is ``None``) or an
    update of ``doc``: pictures and mentions checked and canonicalised.

    Pictures first (``document_image_markup.normalise_images``: a picture
    that is not this kind's stored form is removed, its attributes reduced to
    the kept ones), then mentions
    (:func:`mention_service.normalise_for_write`), then pictures again with
    the mention pass re-run until both are stable (:func:`settle_markup`).

    Three kinds of writer: a USER (``user`` set; ``read_scope`` is theirs, or
    loaded when needed) — every new mention must be readable by them; a
    SYSTEM writer (``user`` ``None``: the extension bridge, the TurboLens
    commit) — existence only; a COPY (``copy=True``: a revision, a duplicate)
    — canonicalised only. ``kept`` (a restore) are mentions already stored on
    ``doc`` once, never re-checked. 404 on a refused mention.

    A picture new to the document (not in its stored text, nor in
    ``kept_images`` — a restored version's) must be a picture of this kind in
    the store, for a user and a system writer alike; an unknown one is
    removed silently. A copy is never checked. Every picture a user or
    system save stores is stamped used (``document_image_service.mark_used``),
    so the purge of never-used uploads leaves it alone."""
    pictured = _map_texts(doc_kind, incoming, lambda text: normalise_images(text, doc_kind))
    mentioned = await mention_service.normalise_for_write(
        db,
        doc_kind=doc_kind,
        doc=doc,
        incoming=pictured,
        user=user,
        read_scope=read_scope,
        system=user is None and not copy,
        copy=copy,
        kept=kept,
    )
    out = _map_texts(doc_kind, mentioned, lambda text: settle_markup(text, doc_kind))
    if copy:
        return out
    if images_of(doc_kind, out):
        known = stored_images(doc_kind, doc) | set(kept_images)
        out = await _drop_unknown_images(db, doc_kind, out, known)
    if out != mentioned:
        # A mention the picture passes spliced together was never checked.
        stored = mention_service.stored_mentions(doc_kind, doc) | set(kept)
        spliced = (
            mention_service.mentions_of(doc_kind, out)
            - mention_service.mentions_of(doc_kind, mentioned)
            - stored
        )
        if spliced:
            await mention_service.check_new_mentions(
                db, spliced, user=user, read_scope=read_scope, system=user is None
            )
    await document_image_service.mark_used(db, images_of(doc_kind, out))
    return out


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
    ``was_draft`` is whether the document's content could be edited before
    the update (a draft; for a SoAW ``soaw_service.content_editable``, which
    also admits a legacy ``approved`` one);
    ``before`` its content snapshot taken BEFORE the update touched the row
    (``document_history_service.current_snapshot``; the caller captures it
    for a draft). A draft's save is recorded as a version when its content
    changed (``document_history_service.record_save``); a save in review
    (filing only) records nothing."""
    if not was_draft:
        return None
    # Imported here: the history service builds on this module.
    from app.services import document_history_service as history

    await history.record_save(db, doc_kind, doc, user=user, before=before)
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

    A ``created`` or ``revised`` row carries the document's content as it is
    now (the shared writers call this once the content, people included, is
    in place). ``signatories`` is kept (as ``[{user_id, display_name}]``) on a
    ``sent_for_review`` row only; ``note`` is the reason of a rejection or the
    signer's note. A ``rejected`` step by a person also opens a ``rejection``
    thread in the discussion (an empty reason gives an empty body), and a
    ``signature`` with a note adds a ``sign_note`` comment, so neither is lost
    on a recall.
    """
    check_step(doc_kind, step)
    if note is not None and not note.strip():
        # A note of nothing but whitespace is no note: no blank ``sign_note``
        # comment, no note of spaces on the timeline row.
        note = None
    actor_id, actor_name = await _actor(db, user)
    content: dict[str, Any] = {}
    if step in CONTENT_STEPS:
        # Imported here: the history service builds on this module.
        from app.services import document_history_service as history

        content["content"] = await history.current_snapshot(db, doc_kind, doc)
    entry = DocumentHistoryEntry(
        **owner_fields(doc_kind, doc.id),
        kind=step,
        actor_id=actor_id,
        actor_name=actor_name,
        note=note or None,
        signatories=history_signatories(signatories) if step == "sent_for_review" else None,
        **content,
    )
    db.add(entry)
    await db.flush()
    if isinstance(user, User) and (step == "rejected" or (step == "signature" and note)):
        # A rejection opens a thread carrying the reason; a signing note becomes
        # a comment. Imported here: the discussion service builds on this module.
        from app.services import document_discussion_service as discussion

        await discussion.add_system_comment(
            db,
            doc_kind,
            doc,
            kind=discussion.REJECTION if step == "rejected" else discussion.SIGN_NOTE,
            user=user,
            text=note,
        )
    return entry


async def render_doc(
    db: AsyncSession,
    doc_kind: str,
    payloads: list[dict[str, Any]],
    *,
    user: User,
    read_scope: CardReadScope | None,
    register: ds.Register | None = None,
) -> list[dict[str, Any]]:
    """The response payloads of one request as ``user`` reads them, in one
    batch: every mention in their text resolved for the reader
    (:func:`mention_service.resolve_for_reader`). ``read_scope`` and
    ``register`` when the caller already holds them, loaded on demand
    otherwise; no mention anywhere means no query and ``payloads`` itself."""
    return await mention_service.resolve_for_reader(
        db,
        doc_kind=doc_kind,
        payloads=payloads,
        user=user,
        read_scope=read_scope,
        register=register,
    )


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


def history_entry_payload(
    entry: Any, actor_display_name: str | None, *, has_content: bool | None = None
) -> dict:
    """One timeline row as the History tab reads it. ``actor`` is the user as
    they are named now (``None`` once deleted); ``actor_name`` the snapshot.

    ``entry`` is a row or any object with its columns. ``has_content`` is
    given by a caller that did not load the snapshot (the timeline selects
    whether there is one, never the content itself); otherwise it is read
    from ``entry.content``."""
    if has_content is None:
        has_content = entry.content is not None
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
        "has_content": bool(has_content),
    }
