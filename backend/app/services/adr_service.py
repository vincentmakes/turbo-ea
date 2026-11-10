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
from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass
from datetime import date, datetime
from typing import Any

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm.attributes import flag_modified

from app.models.architecture_decision import ArchitectureDecision
from app.models.architecture_decision_card import ArchitectureDecisionCard
from app.models.architecture_decision_file import ArchitectureDecisionFile
from app.models.architecture_decision_link import ArchitectureDecisionLink
from app.models.card import Card
from app.models.user import User
from app.services import (
    adr_file_service,
    decision_link_service,
    decision_people_service,
    document_collab,
    notification_service,
)
from app.services import decision_standing as ds
from app.services import revision_chain as rc
from app.services.card_read_scope import CardReadScope
from app.services.event_bus import event_bus

_REFERENCE_RE = re.compile(r"^ADR-(\d+)$", re.IGNORECASE)


async def next_reference_number(db: AsyncSession) -> str:
    """The next ``ADR-NNN`` reference (``ADR-001`` on an empty table).

    The highest number is found numerically — a string ``max()`` answers
    ``ADR-999`` forever once ``ADR-1000`` exists, and every create after that
    collides on the unique constraint. A reference in another format is
    ignored. Revisions share their decision's reference, so a reference held
    by several rows counts once.
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
    user: User | None = None,
    read_scope: CardReadScope | None = None,
    copy: bool = False,
    decision_makers: Sequence[Mapping[str, Any] | Any] | None = None,
    participants: Sequence[Mapping[str, Any] | Any] | None = None,
    record_created: bool = True,
) -> ArchitectureDecision:
    """Insert a draft decision, its card links and its people; flush, never commit.

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

    The text goes through :func:`document_collab.before_save`: ``user`` /
    ``read_scope`` are a user writer's (the route, the importer); without a
    user the writer is a system one (the extension bridge, the TurboLens
    commit: mentioned targets must exist); ``copy=True`` (a duplicate) carries
    the mentions as they are. A refused mention raises
    :class:`mention_service.MentionRefused` (404) before anything is written.
    ``decision_makers`` / ``participants`` are
    :func:`decision_people_service.replace_people` lists (``None``: none).
    The decision's timeline starts with a ``created`` row carrying its
    content, people included, so every path that creates a decision — the
    route, the importer, the extension bridge, the TurboLens commit, a
    duplicate — gets one; ``record_created=False`` leaves it to a caller that
    adds content first (:func:`duplicate_decision` copies the people).
    """
    text = await document_collab.before_save(
        db,
        document_collab.ADR,
        None,
        {
            "context": context,
            "decision": decision,
            "consequences": consequences,
            "alternatives_considered": alternatives_considered,
        },
        user=user,
        read_scope=read_scope,
        copy=copy,
    )
    adr = ArchitectureDecision(
        reference_number=await next_reference_number(db),
        title=title,
        context=text["context"],
        decision=text["decision"],
        consequences=text["consequences"],
        alternatives_considered=text["alternatives_considered"],
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
    await decision_people_service.replace_people(
        db, adr, decision_makers=decision_makers, participants=participants
    )
    if record_created:
        await document_collab.on_workflow(
            db, document_collab.ADR, adr, "created", user=user if user is not None else created_by
        )
    if any(isinstance(entry, str) for entry in related_decisions or ()):
        await decision_link_service.add_relates_links(
            db, adr, related_decisions or (), register=await ds.load_register(db)
        )
    if not publish:
        return adr
    await _publish_created(db, adr, list(seen), user_id=created_by)
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


def lock_refusal(
    register: ds.Register,
    adr: ArchitectureDecision,
    *,
    decided_on: date | None = None,
    effective_from: date | None = None,
) -> dict[str, Any] | None:
    """Why the decision may not be sent for signature now, as a 409 detail, or ``None``.

    Asked at the request for signatures, at record as decided and again at
    the final signature (the dates may have aged in review, and the signing
    day becomes the default ``effective_from``), each refusing with this
    detail as a 409. Every link target must be signed and the decision's own
    chain must not be revoked or replaced
    (:func:`decision_standing.validate_lock`); its dates must hold once the
    signing date fills an empty ``effective_from``: ``valid_until`` not past
    nor before ``effective_from``, ``decided_on`` not in the future (with the
    one-day timezone allowance of :func:`decision_standing.validate_dates`).
    ``decided_on`` / ``effective_from`` check the dates a lock
    is about to write (record as decided) instead of the stored ones.
    """
    today = register.today
    problems = ds.validate_lock(register, adr.id) + ds.validate_dates(
        decided_on or adr.decided_on,
        effective_from or adr.effective_from or today,
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


#: What a PATCH may still change while a decision is in review: card links are
#: filing, not content.
EDITABLE_IN_REVIEW: frozenset[str] = frozenset({"linked_card_ids"})


def check_editable(current_status: str, new_status: str | None, fields: Iterable[str]) -> None:
    """Refuse a PATCH the decision's status does not allow.

    A signed decision is never edited (403). A ``status`` value that names a
    workflow step is a 400 pointing at its endpoint. In review, only
    :data:`EDITABLE_IN_REVIEW` may change: anything else is a 403 telling the
    caller to recall the signatures first.
    """
    if current_status == ds.LOCKED_STATUS:
        raise HTTPException(403, "Cannot edit a signed decision. Create a new revision instead.")
    if new_status == ds.LOCKED_STATUS:
        raise HTTPException(400, "Use the sign endpoint to sign a decision")
    if new_status == "in_review":
        raise HTTPException(400, "Use the request-signatures endpoint to send for review")
    if new_status == "draft" and current_status == "in_review":
        raise HTTPException(400, "Use the recall-signatures endpoint to reset to draft")
    if current_status == "in_review" and set(fields) - EDITABLE_IN_REVIEW:
        raise HTTPException(
            403,
            "Cannot edit a decision in review. Recall the signatures to edit it.",
        )


def completes_signatures(signatories: Sequence[dict[str, Any]], user_id: str) -> bool:
    """Whether ``user_id``'s signature is the last one missing.

    Every other signatory has signed and ``user_id`` is one who has not: the
    signature that locks the decision, so the lock checks run before it.
    """
    mine = [sig for sig in signatories if sig.get("user_id") == user_id]
    others = [sig for sig in signatories if sig.get("user_id") != user_id]
    return (
        len(mine) == 1
        and mine[0].get("status") != "signed"
        and all(sig.get("status") == "signed" for sig in others)
    )


def apply_lock_dates(adr: ArchitectureDecision, signed_on: date) -> None:
    """Fill an empty ``decided_on`` / ``effective_from`` with the signing date."""
    if adr.decided_on is None:
        adr.decided_on = signed_on
    if adr.effective_from is None:
        adr.effective_from = signed_on


# --- record as decided --------------------------------------------------------

#: Record-as-decided problems besides ``decision_standing.DECIDED_ON_FUTURE``.
NO_DECISION_MAKER = "no_decision_maker"
DECIDED_BEFORE_PARENT = "decided_before_parent"


def parent_decided_on(register: ds.Register, adr: ArchitectureDecision) -> date | None:
    """The decided date of the revision ``adr`` was made from, when it has one."""
    if adr.parent_id is None or adr.parent_id not in register:
        return None
    return register.row(adr.parent_id).decided_on


def record_problems(
    *,
    decided_on: date,
    today: date,
    decision_maker_count: int,
    parent_decided: date | None,
) -> list[str]:
    """Why a draft may not be recorded as decided on ``decided_on``, in order.

    At least one decision maker must be named, the decision cannot have been
    taken after today (with the timezone allowance of
    :data:`decision_standing.LOCK_DATE_TOLERANCE`: ``today + 1`` passes), and a
    revision cannot have been decided before the revision it revises.
    """
    problems: list[str] = []
    if decision_maker_count < 1:
        problems.append(NO_DECISION_MAKER)
    if decided_on > today + ds.LOCK_DATE_TOLERANCE:
        problems.append(ds.DECIDED_ON_FUTURE)
    if parent_decided is not None and decided_on < parent_decided:
        problems.append(DECIDED_BEFORE_PARENT)
    return problems


def record_decision(
    adr: ArchitectureDecision,
    *,
    decided_on: date,
    effective_from: date | None,
    recorded_by: uuid.UUID,
    now: datetime,
) -> None:
    """Lock a draft as recorded rather than signed (in memory; the caller flushes).

    ``status`` becomes ``signed`` so every lock check holds, but ``signed_at``
    stays empty and there are no signatories: ``recorded_at`` /
    ``recorded_by`` say who recorded it and when. ``effective_from`` defaults
    to ``decided_on``.
    """
    adr.status = ds.LOCKED_STATUS
    adr.decided_on = decided_on
    adr.effective_from = effective_from if effective_from is not None else decided_on
    adr.recorded_by = recorded_by
    adr.recorded_at = now
    adr.signed_at = None
    adr.signatories = []
    flag_modified(adr, "signatories")


# --- standing-changed notifications ---------------------------------------------

#: The link kinds that change the standing of their target when the source locks.
STANDING_NOTICE_KINDS: tuple[str, ...] = (ds.REPLACES, ds.AMENDS, ds.REVOKES)

#: How a notification says each kind.
STANDING_NOTICE_VERBS: Mapping[str, str] = {
    ds.REPLACES: "replaces",
    ds.AMENDS: "amends",
    ds.REVOKES: "revokes",
}


@dataclass(frozen=True)
class StandingNotice:
    """Tell ``recipient_id`` that the locking decision ``kind``s ``target_id``."""

    recipient_id: uuid.UUID
    target_id: Any
    kind: str


def standing_notices(
    links: Iterable[ds.LinkRow],
    authors: Mapping[Any, uuid.UUID | None],
    *,
    actor_id: uuid.UUID | None,
) -> list[StandingNotice]:
    """Who to tell when a decision with outgoing ``links`` locks.

    The author of each decision it replaces, amends or revokes, once per
    author and target, never the person who locked it. ``authors`` maps a
    target id to its ``created_by``; a target with no author is skipped.
    """
    notices: list[StandingNotice] = []
    seen: set[tuple[uuid.UUID, Any]] = set()
    for lk in links:
        if lk.kind not in STANDING_NOTICE_KINDS:
            continue
        author = authors.get(lk.target_id)
        if author is None or author == actor_id:
            continue
        key = (author, lk.target_id)
        if key in seen:
            continue
        seen.add(key)
        notices.append(StandingNotice(recipient_id=author, target_id=lk.target_id, kind=lk.kind))
    return notices


def standing_notice_message(source_label: str, kind: str, target_label: str) -> str:
    """``'"ADR-051 — New" replaces "ADR-012 — Old"'``."""
    return f'"{source_label}" {STANDING_NOTICE_VERBS[kind]} "{target_label}"'


async def notify_standing_changed(
    db: AsyncSession,
    adr: ArchitectureDecision,
    register: ds.Register,
    *,
    actor_id: uuid.UUID | None,
) -> int:
    """Notify the authors of the decisions ``adr`` replaces, amends or revokes.

    Called once, when ``adr`` locks (its final signature, or recording it as
    decided). Returns the number of notices sent.
    """
    links = [lk for lk in register.outgoing(adr.id) if lk.kind in STANDING_NOTICE_KINDS]
    if not links:
        return 0
    targets = {
        row.id: row
        for row in (
            await db.execute(
                select(ArchitectureDecision).where(
                    ArchitectureDecision.id.in_({lk.target_id for lk in links})
                )
            )
        )
        .scalars()
        .all()
    }
    authors = {tid: target.created_by for tid, target in targets.items()}
    notices = standing_notices(links, authors, actor_id=actor_id)
    source_label = decision_label(adr)
    for notice in notices:
        target = targets[notice.target_id]
        await notification_service.create_notification(
            db,
            user_id=notice.recipient_id,
            actor_id=actor_id,
            notif_type="adr_standing_changed",
            title="ADR Standing Changed",
            message=standing_notice_message(source_label, notice.kind, decision_label(target)),
            link=f"{decision_link(target.id)}/preview",
            data={
                "adr_id": str(target.id),
                "adr_title": target.title,
                "by_adr_id": str(adr.id),
                "by_adr_title": adr.title,
                "kind": notice.kind,
            },
        )
    return len(notices)


# --- revise and duplicate -----------------------------------------------------


async def copy_decision_extras(
    db: AsyncSession, source_id: uuid.UUID, new_id: uuid.UUID
) -> list[uuid.UUID]:
    """Carry what a revision or a duplicate inherits from ``source_id`` onto
    ``new_id``: the ``relates`` links, the people, the card links and the file
    pointers (the bytes are shared, never copied); flush. Returns the linked
    card ids."""
    await decision_link_service.copy_relates_links(db, source_id, new_id)
    await decision_people_service.copy_people(db, source_id, new_id)
    card_ids = await copy_card_links(db, source_id, new_id)
    await copy_file_pointers(db, source_id, new_id)
    return card_ids


async def copy_card_links(
    db: AsyncSession, source_id: uuid.UUID, new_id: uuid.UUID
) -> list[uuid.UUID]:
    """Link ``new_id`` to every card ``source_id`` is linked to; flush. Returns the card ids."""
    card_ids = list(
        (
            await db.execute(
                select(ArchitectureDecisionCard.card_id)
                .where(ArchitectureDecisionCard.architecture_decision_id == source_id)
                .order_by(ArchitectureDecisionCard.card_id)
            )
        )
        .scalars()
        .all()
    )
    for card_id in card_ids:
        db.add(ArchitectureDecisionCard(architecture_decision_id=new_id, card_id=card_id))
    await db.flush()
    return card_ids


async def copy_file_pointers(db: AsyncSession, source_id: uuid.UUID, new_id: uuid.UUID) -> int:
    """Give ``new_id`` a file row for each file of ``source_id``, pointing at the
    same bytes (``content_id``), never copying them; flush. Returns the count."""
    files = (
        (
            await db.execute(
                select(ArchitectureDecisionFile)
                .where(ArchitectureDecisionFile.architecture_decision_id == source_id)
                .order_by(ArchitectureDecisionFile.created_at, ArchitectureDecisionFile.id)
            )
        )
        .scalars()
        .all()
    )
    for f in files:
        db.add(
            ArchitectureDecisionFile(
                architecture_decision_id=new_id,
                content_id=f.content_id,
                name=f.name,
                mime_type=f.mime_type,
                size=f.size,
                created_by=f.created_by,
            )
        )
    await db.flush()
    return len(files)


async def delete_draft(db: AsyncSession, adr: ArchitectureDecision) -> None:
    """Delete a draft decision; flush, never commit.

    Its file rows, links, people and card links go with it by database
    cascade; the bytes of its files go too unless another decision (the
    revision it was made from, a duplicate) still points at them. The caller
    has checked that ``adr`` is a draft and that the user may delete it.
    """
    content_ids = await adr_file_service.content_ids_of(db, adr.id)
    await db.delete(adr)
    await db.flush()
    await adr_file_service.delete_orphan_contents(db, content_ids)


async def _publish_created(
    db: AsyncSession,
    adr: ArchitectureDecision,
    card_ids: Sequence[uuid.UUID],
    *,
    user_id: uuid.UUID | None,
    extra: dict[str, Any] | None = None,
) -> None:
    await event_bus.publish(
        "adr.created",
        {
            "adr_id": str(adr.id),
            "reference_number": adr.reference_number,
            "revision_number": adr.revision_number,
            "title": adr.title,
            "status": adr.status,
            "linked_card_ids": [str(cid) for cid in card_ids],
            **(extra or {}),
        },
        db=db,
        user_id=user_id,
    )


def revise_refusal_detail(
    register: ds.Register, source: ArchitectureDecision
) -> dict[str, Any] | None:
    """Why ``source`` may not be revised now, as a 409 detail, or ``None``.

    An unsigned decision is not answered here (the route keeps its 400). A
    chain that already holds an unsigned revision names it
    (``open_revision_exists``); a signed revision ordered after ``source``
    makes it ``not_latest``; a chain revoked or replaced by another decision
    is not revisable ``by`` that decision. Expired and amended decisions stay
    revisable.
    """
    chain = register.chain(source.id)
    reason = rc.revise_refusal(chain, source.id)
    if reason == "open_revision_exists":
        open_nodes = [n for n in chain.nodes if not rc.is_locked(n) and n.id != source.id]
        return {"error": "open_revision_exists", "revision_id": str(open_nodes[-1].id)}
    if reason == "not_latest":
        return {"error": "not_revisable", "reason": "not_latest"}
    closed_by = ds.chain_closed_by(register, source.id)
    if closed_by is not None:
        return {"error": "not_revisable", "by": ref_payload(closed_by)}
    return None


async def create_revision(
    db: AsyncSession,
    source: ArchitectureDecision,
    *,
    created_by: uuid.UUID | None,
    register: ds.Register,
    consolidates: Sequence[Any] = (),
    change_summary: str | None = None,
) -> ArchitectureDecision:
    """Insert the next revision of ``source`` as a draft; flush, never commit.

    The revision keeps ``source``'s reference, takes the chain's highest
    revision number + 1 and points back at ``source``. It carries the text,
    the extension attributes, the card links, the ``relates`` links, the people,
    the file pointers and ``valid_until``; it does not carry ``decided_on``,
    ``effective_from``, the signatories, the recorded stamp, the hard links nor
    the change summary (``change_summary`` is the new revision's own). Each
    entry of ``consolidates`` (a decision id or a reference) becomes a
    ``consolidates`` link, validated like any link (400 on a problem, 404 for
    an unknown entry). Publishes ``adr.created`` with ``revision_of``, so a
    mutation batch that revised can be rolled back.

    The caller has checked that ``source`` may be revised
    (:func:`revise_refusal_detail`).
    """
    wanted = [
        decision_link_service.WantedLink(
            decision_link_service.resolve_or_404(register, value), ds.CONSOLIDATES
        )
        for value in consolidates
    ]
    seen: set[uuid.UUID] = set()
    for link in wanted:
        if link.target_id in seen:
            raise decision_link_service.link_error(
                [decision_link_service.DUPLICATE_TARGET], link.target_id
            )
        seen.add(link.target_id)
        problems = ds.validate_link_draft(
            register, None, link.target_id, ds.CONSOLIDATES, source_parent_id=source.id
        )
        if problems:
            raise decision_link_service.link_error(problems, link.target_id)

    # A copy: its mentions are carried as they are, never re-checked.
    text = await document_collab.before_save(
        db,
        document_collab.ADR,
        None,
        {
            "context": source.context,
            "decision": source.decision,
            "consequences": source.consequences,
            "alternatives_considered": source.alternatives_considered,
        },
        user=None,
        read_scope=None,
        copy=True,
    )
    revision = ArchitectureDecision(
        reference_number=source.reference_number,
        revision_number=rc.next_revision_number(register.chain(source.id)),
        parent_id=source.id,
        title=source.title,
        context=text["context"],
        decision=text["decision"],
        consequences=text["consequences"],
        alternatives_considered=text["alternatives_considered"],
        attributes=dict(source.attributes or {}),
        valid_until=source.valid_until,
        change_summary=change_summary,
        created_by=created_by,
    )
    db.add(revision)
    await db.flush()
    card_ids = await copy_decision_extras(db, source.id, revision.id)
    # Once the people are copied: the ``revised`` row carries the content.
    await document_collab.on_workflow(db, document_collab.ADR, revision, "revised", user=created_by)
    carried = {
        lk.target_id: lk
        for lk in (
            await db.execute(
                select(ArchitectureDecisionLink).where(
                    ArchitectureDecisionLink.source_id == revision.id
                )
            )
        )
        .scalars()
        .all()
    }
    for link in wanted:
        held = carried.get(link.target_id)
        if held is not None:
            # A carried ``relates`` to the amender becomes the consolidation.
            held.kind = ds.CONSOLIDATES
        else:
            db.add(
                ArchitectureDecisionLink(
                    source_id=revision.id, target_id=link.target_id, kind=ds.CONSOLIDATES
                )
            )
    await db.flush()
    await _publish_created(
        db, revision, card_ids, user_id=created_by, extra={"revision_of": str(source.id)}
    )
    return revision


async def duplicate_decision(
    db: AsyncSession, original: ArchitectureDecision, *, created_by: uuid.UUID | None
) -> ArchitectureDecision:
    """A new draft decision copied from ``original``; flush, never commit.

    A new reference, revision 1, no parent. Carries the text, the extension
    attributes, ``valid_until``, the card links, the ``relates`` links, the
    people and the file pointers; not the dates, the signatories nor the hard
    links. Publishes one ``adr.created``.
    """
    dup = await create_decision(
        db,
        title=f"{original.title} (copy)",
        context=original.context,
        decision=original.decision,
        consequences=original.consequences,
        alternatives_considered=original.alternatives_considered,
        attributes=dict(original.attributes or {}),
        valid_until=original.valid_until,
        created_by=created_by,
        publish=False,
        copy=True,
        record_created=False,
    )
    card_ids = await copy_decision_extras(db, original.id, dup.id)
    # Once the people are copied: the ``created`` row carries the content.
    await document_collab.on_workflow(db, document_collab.ADR, dup, "created", user=created_by)
    await _publish_created(db, dup, card_ids, user_id=created_by)
    return dup
