from __future__ import annotations

import uuid
from datetime import date, datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, UploadFile
from fastapi.responses import Response
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm.attributes import flag_modified

from app.api.deps import get_current_user
from app.database import get_db
from app.models.architecture_decision import ArchitectureDecision
from app.models.architecture_decision_card import ArchitectureDecisionCard
from app.models.card import Card
from app.models.todo import Todo
from app.models.user import User
from app.schemas.adr import (
    ADRCardLink,
    ADRCreate,
    ADRImportRequest,
    ADRImportResponse,
    ADRImportResult,
    ADRRecordRequest,
    ADRRejectRequest,
    ADRReviseRequest,
    ADRSignatureRequest,
    ADRSignRequest,
    ADRUpdate,
)
from app.services import (
    adr_file_service,
    adr_import_service,
    adr_service,
    audit_log,
    decision_link_service,
    decision_people_service,
    document_collab,
    mention_service,
    notification_service,
)
from app.services import decision_standing as ds
from app.services import document_discussion_service as discussion
from app.services import document_history_service as history
from app.services.attachment_upload import (
    content_disposition,
    read_validated_upload,
    require_uploads_enabled,
)
from app.services.card_read_scope import CardReadScope, require_card_readable
from app.services.event_bus import event_bus
from app.services.permission_service import PermissionService
from app.services.search_rank import search_filter, search_rank

router = APIRouter(prefix="/adr", tags=["adr"])


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


async def _publish_adr_card_event(
    db: AsyncSession,
    adr: ArchitectureDecision,
    event_type: str,
    card_id: uuid.UUID,
    *,
    actor_id: uuid.UUID,
) -> None:
    """Fan an ADR link/unlink out to the affected card so the decision shows up
    in that card's history timeline (and drives the ADRs tab activity dot)."""
    await event_bus.publish(
        event_type,
        {
            "adr_id": str(adr.id),
            "reference_number": adr.reference_number,
            "revision_number": adr.revision_number,
            "title": adr.title,
            "status": adr.status,
            "link": adr_service.decision_link(adr.id),
        },
        db=db,
        card_id=card_id,
        user_id=actor_id,
    )


async def _get_adr(db: AsyncSession, adr_id: str) -> ArchitectureDecision:
    result = await db.execute(
        select(ArchitectureDecision).where(ArchitectureDecision.id == uuid.UUID(adr_id))
    )
    adr = result.scalar_one_or_none()
    if not adr:
        raise HTTPException(404, "Architecture decision not found")
    return adr


async def _adr_to_dict(
    db: AsyncSession,
    adr: ArchitectureDecision,
    register: ds.Register,
    user: User,
    read_scope: CardReadScope | None = None,
) -> dict:
    """Convert an ADR model to a response dict, including linked cards and names.

    ``read_scope`` leaves out linked cards hidden from the reader. Standing,
    links and revisions come from ``register``. The payload goes through
    :func:`document_collab.render_doc` for ``user``.
    """
    # Get creator name
    creator_name = None
    if adr.created_by:
        result = await db.execute(select(User).where(User.id == adr.created_by))
        creator = result.scalar_one_or_none()
        if creator:
            creator_name = creator.display_name

    # Get linked cards
    result = await db.execute(
        select(Card.id, Card.name, Card.type)
        .join(
            ArchitectureDecisionCard,
            ArchitectureDecisionCard.card_id == Card.id,
        )
        .where(ArchitectureDecisionCard.architecture_decision_id == adr.id)
        .where(*(read_scope.where(Card, mode="module") if read_scope is not None else ()))
    )
    linked_cards = [{"id": str(row.id), "name": row.name, "type": row.type} for row in result.all()]

    people = (await decision_people_service.people_payload(db, [adr.id]))[adr.id]

    recorded_by = None
    if adr.recorded_by:
        recorder = await db.get(User, adr.recorded_by)
        recorded_by = {
            "user_id": str(adr.recorded_by),
            "display_name": recorder.display_name if recorder else None,
        }

    payload = {
        "id": str(adr.id),
        "reference_number": adr.reference_number,
        "title": adr.title,
        "status": adr.status,
        "context": adr.context,
        "decision": adr.decision,
        "consequences": adr.consequences,
        "alternatives_considered": adr.alternatives_considered,
        "related_decisions": [
            str(target) for target in adr_service.outgoing_targets(register, adr.id, ds.RELATES)
        ],
        "attributes": adr.attributes or {},
        "created_by": str(adr.created_by) if adr.created_by else None,
        "creator_name": creator_name,
        "created_via": adr.created_via,
        "updated_via": adr.updated_via,
        "signatories": adr.signatories or [],
        "signed_at": adr.signed_at.isoformat() if adr.signed_at else None,
        "revision_number": adr.revision_number,
        "parent_id": str(adr.parent_id) if adr.parent_id else None,
        "linked_cards": linked_cards,
        "created_at": adr.created_at.isoformat() if adr.created_at else None,
        "updated_at": adr.updated_at.isoformat() if adr.updated_at else None,
        **adr_service.standing_fields(register, adr.id),
        **adr_service.date_fields(adr),
        "decision_makers": people["decision_makers"],
        "participants": people["participants"],
        "links": decision_link_service.links_payload(register, adr.id),
        "revisions": adr_service.revisions_payload(register, adr.id),
        "change_summary": adr.change_summary,
        "recorded_by": recorded_by,
        "files": await adr_file_service.list_files(db, adr.id),
        "open_thread_count": await discussion.open_thread_count(db, document_collab.ADR, adr.id),
    }
    (rendered,) = await document_collab.render_doc(
        db, document_collab.ADR, [payload], user=user, read_scope=read_scope, register=register
    )
    return rendered


async def _detail(
    db: AsyncSession,
    adr: ArchitectureDecision,
    user: User,
    read_scope: CardReadScope | None = None,
) -> dict:
    """The detail response for ``adr`` as ``user`` reads it (``read_scope``
    when the route already loaded it)."""
    register = await ds.load_register(db)
    if read_scope is None:
        read_scope = await CardReadScope.load(db, user)
    return await _adr_to_dict(db, adr, register, user, read_scope)


def _adr_to_summary(
    adr: ArchitectureDecision,
    linked_cards: list[dict] | None = None,
    creator_name: str | None = None,
    *,
    register: ds.Register,
    people: dict[uuid.UUID, dict[str, list[dict]]],
    with_participants: bool = False,
) -> dict:
    """Lightweight dict for list endpoints.

    ``with_participants`` adds the participants (the spreadsheet export reads
    them); the plain list carries the decision makers only.
    """
    row = {
        "id": str(adr.id),
        "reference_number": adr.reference_number,
        "title": adr.title,
        "status": adr.status,
        "decision": adr.decision,
        "attributes": adr.attributes or {},
        "created_by": str(adr.created_by) if adr.created_by else None,
        "creator_name": creator_name,
        "created_via": adr.created_via,
        "updated_via": adr.updated_via,
        "signatories": adr.signatories or [],
        "signed_at": adr.signed_at.isoformat() if adr.signed_at else None,
        "revision_number": adr.revision_number,
        "parent_id": str(adr.parent_id) if adr.parent_id else None,
        "linked_cards": linked_cards or [],
        "created_at": adr.created_at.isoformat() if adr.created_at else None,
        "updated_at": adr.updated_at.isoformat() if adr.updated_at else None,
        **adr_service.standing_fields(register, adr.id),
        **adr_service.date_fields(adr),
        "decision_makers": people.get(adr.id, {}).get("decision_makers", []),
    }
    if with_participants:
        row["participants"] = people.get(adr.id, {}).get("participants", [])
    return row


async def _summaries(
    db: AsyncSession,
    rows: list[ArchitectureDecision],
    register: ds.Register,
    user: User,
    *,
    with_creators: bool = True,
    with_participants: bool = False,
    with_content: bool = False,
) -> list[dict]:
    """List rows for ``rows``: linked cards, creators and people in one query each.

    ``with_content`` adds every section's text and the related references
    (the spreadsheet export). The rows go through
    :func:`document_collab.render_doc` as one batch.
    """
    adr_ids = [adr.id for adr in rows]
    cards_map: dict[uuid.UUID, list[dict]] = {aid: [] for aid in adr_ids}
    read_scope: CardReadScope | None = None
    if adr_ids:
        read_scope = await CardReadScope.load(db, user)
        cards_result = await db.execute(
            select(
                ArchitectureDecisionCard.architecture_decision_id,
                Card.id,
                Card.name,
                Card.type,
            )
            .join(Card, ArchitectureDecisionCard.card_id == Card.id)
            .where(ArchitectureDecisionCard.architecture_decision_id.in_(adr_ids))
            .where(*read_scope.where(Card, mode="module"))
        )
        for row in cards_result.all():
            cards_map[row[0]].append({"id": str(row[1]), "name": row[2], "type": row[3]})

    creator_names: dict[uuid.UUID, str] = {}
    creator_ids = {adr.created_by for adr in rows if adr.created_by}
    if with_creators and creator_ids:
        users_result = await db.execute(
            select(User.id, User.display_name).where(User.id.in_(creator_ids))
        )
        for uid, dname in users_result.all():
            creator_names[uid] = dname

    people = await decision_people_service.people_payload(db, adr_ids)
    summaries = [
        _adr_to_summary(
            adr,
            cards_map.get(adr.id),
            creator_names.get(adr.created_by) if adr.created_by else None,
            register=register,
            people=people,
            with_participants=with_participants,
        )
        for adr in rows
    ]
    if with_content:
        for adr, summary in zip(rows, summaries, strict=True):
            summary["context"] = adr.context
            summary["consequences"] = adr.consequences
            summary["alternatives_considered"] = adr.alternatives_considered
            summary["related_references"] = adr_import_service.related_reference_labels(
                register, adr.id
            )
            summary["link_references"] = adr_service.link_references(register, adr.id)
    return await document_collab.render_doc(
        db, document_collab.ADR, summaries, user=user, read_scope=read_scope, register=register
    )


# ---------------------------------------------------------------------------
# CRUD Endpoints
# ---------------------------------------------------------------------------


@router.get("")
async def list_adrs(
    initiative_id: str | None = Query(None),
    status: str | None = Query(None),
    search: str | None = Query(None),
    card_id: str | None = Query(None),
    card_type: str | None = Query(None),
    date_from: str | None = Query(None),
    date_to: str | None = Query(None),
    modified_from: str | None = Query(None),
    modified_to: str | None = Query(None),
    signed_from: str | None = Query(None),
    signed_to: str | None = Query(None),
    decided_from: date | None = Query(
        None, description="Only decisions decided on or after this date (signed or recorded)"
    ),
    decided_to: date | None = Query(
        None, description="Only decisions decided on or before this date (signed or recorded)"
    ),
    include_content: bool = Query(
        False,
        description="Also return every section's text and related decision references "
        "(the spreadsheet export)",
    ),
    include_earlier: bool = Query(
        True, description="Also list earlier revisions superseded inside their own chain"
    ),
    standing: str | None = Query(
        None, description="Only decisions with this standing (comma-separated allowed)"
    ),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    await PermissionService.require_permission(db, user, "adr.view")
    standings = adr_service.parse_standing_filter(standing)
    stmt = select(ArchitectureDecision).order_by(ArchitectureDecision.updated_at.desc())

    # Track whether we already joined the junction table
    joined_junction = False

    if initiative_id:
        # Filter by linked initiative card via junction table
        stmt = stmt.join(
            ArchitectureDecisionCard,
            ArchitectureDecisionCard.architecture_decision_id == ArchitectureDecision.id,
        ).where(ArchitectureDecisionCard.card_id == uuid.UUID(initiative_id))
        joined_junction = True
    if status:
        stmt = stmt.where(ArchitectureDecision.status == status)
    if search:
        stmt = stmt.where(
            search_filter(ArchitectureDecision.title, search)
            | search_filter(ArchitectureDecision.reference_number, search)
        )
        # Typing a query means "best match first" — the recency order below is
        # what you want when browsing, not when searching (#918).
        stmt = stmt.order_by(None).order_by(
            search_rank(ArchitectureDecision.title, search).asc(),
            ArchitectureDecision.updated_at.desc(),
        )
    if card_id and not initiative_id:
        if not joined_junction:
            stmt = stmt.join(
                ArchitectureDecisionCard,
                ArchitectureDecisionCard.architecture_decision_id == ArchitectureDecision.id,
            )
            joined_junction = True
        stmt = stmt.where(ArchitectureDecisionCard.card_id == uuid.UUID(card_id))
    if card_type:
        if not joined_junction:
            stmt = stmt.join(
                ArchitectureDecisionCard,
                ArchitectureDecisionCard.architecture_decision_id == ArchitectureDecision.id,
            )
            joined_junction = True
        # Filtering by a type must not surface decisions through hidden cards.
        stmt = stmt.join(Card, ArchitectureDecisionCard.card_id == Card.id).where(
            Card.type == card_type, *(await CardReadScope.load(db, user)).where(Card, mode="module")
        )

    # Date range filters
    if date_from:
        stmt = stmt.where(
            ArchitectureDecision.created_at
            >= datetime.fromisoformat(date_from).replace(tzinfo=timezone.utc)
        )
    if date_to:
        stmt = stmt.where(
            ArchitectureDecision.created_at
            <= datetime.fromisoformat(date_to).replace(
                hour=23, minute=59, second=59, tzinfo=timezone.utc
            )
        )
    if modified_from:
        stmt = stmt.where(
            ArchitectureDecision.updated_at
            >= datetime.fromisoformat(modified_from).replace(tzinfo=timezone.utc)
        )
    if modified_to:
        stmt = stmt.where(
            ArchitectureDecision.updated_at
            <= datetime.fromisoformat(modified_to).replace(
                hour=23, minute=59, second=59, tzinfo=timezone.utc
            )
        )
    if signed_from:
        stmt = stmt.where(
            ArchitectureDecision.signed_at
            >= datetime.fromisoformat(signed_from).replace(tzinfo=timezone.utc)
        )
    if signed_to:
        stmt = stmt.where(
            ArchitectureDecision.signed_at
            <= datetime.fromisoformat(signed_to).replace(
                hour=23, minute=59, second=59, tzinfo=timezone.utc
            )
        )

    if decided_from:
        stmt = stmt.where(ArchitectureDecision.decided_on >= decided_from)
    if decided_to:
        stmt = stmt.where(ArchitectureDecision.decided_on <= decided_to)

    if joined_junction:
        stmt = stmt.distinct()

    result = await db.execute(stmt)
    register = await ds.load_register(db)
    rows = [
        adr
        for adr in result.scalars().all()
        if adr_service.keep_in_list(
            register, adr.id, include_earlier=include_earlier, standings=standings
        )
    ]

    return await _summaries(
        db,
        rows,
        register,
        user,
        with_participants=include_content,
        with_content=include_content,
    )


@router.post("", status_code=201)
async def create_adr(
    body: ADRCreate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    await PermissionService.require_permission(db, user, "adr.manage")
    read_scope = await CardReadScope.load(db, user)
    card_ids = await adr_service.resolve_card_ids(db, body.linked_card_ids or [])
    register = await ds.load_register(db)
    adr_service.check_dates(
        body.decided_on, body.effective_from, body.valid_until, today=register.today
    )
    wanted = decision_link_service.wanted_links(
        register, None, links=body.links or [], related=body.related_decisions or []
    )
    # The shared writer (also behind the analysis commit flow and the
    # extension decisions bridge) — one reference-number sequence for all.
    adr = await adr_service.create_decision(
        db,
        title=body.title,
        context=body.context,
        decision=body.decision,
        consequences=body.consequences,
        alternatives_considered=body.alternatives_considered,
        linked_card_ids=card_ids,
        created_by=user.id,
        decided_on=body.decided_on,
        effective_from=body.effective_from,
        valid_until=body.valid_until,
        change_summary=body.change_summary,
        user=user,
        read_scope=read_scope,
        decision_makers=body.decision_makers or [],
        participants=body.participants or [],
    )
    await decision_link_service.replace_links(db, adr, wanted, register=register)
    await db.commit()
    await db.refresh(adr)
    return await _detail(db, adr, user, read_scope)


@router.post("/bulk-import", response_model=ADRImportResponse)
async def bulk_import_adrs(
    body: ADRImportRequest,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> ADRImportResponse:
    """Spreadsheet importer for decision records — create-only.

    A row whose ``reference_number`` already exists is skipped, so
    re-importing an exported register is a no-op; every other row creates a
    **draft** with a fresh ``ADR-NNN`` reference (status and signatories are
    never imported). Cards are linked by exact name among those the caller
    may read; related decisions resolve against existing references and the
    file's own rows. ``dry_run=True`` runs everything, publishes nothing and
    rolls back, so the dialog previews exactly what applying will do.
    """
    await PermissionService.require_permission(db, user, "adr.manage")
    read_scope = await CardReadScope.load(db, user)
    dry_run_savepoint = await db.begin_nested() if body.dry_run else None

    outcomes = await adr_import_service.import_decision_rows(
        db,
        [adr_import_service.DecisionImportRow(**item.model_dump()) for item in body.items],
        created_by=user.id,
        readable_cards=read_scope.where(Card, mode="module"),
        publish=not body.dry_run,
        user=user,
        read_scope=read_scope,
    )
    counts = {
        status: sum(1 for o in outcomes if o.status == status)
        for status in ("created", "skipped", "failed")
    }

    if dry_run_savepoint is not None:
        await dry_run_savepoint.rollback()
    elif counts["created"]:
        await db.commit()
    else:
        await db.rollback()

    return ADRImportResponse(
        results=[ADRImportResult(**vars(o)) for o in outcomes],
        dry_run=body.dry_run,
        **counts,
    )


@router.get("/{adr_id}")
async def get_adr(
    adr_id: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    await PermissionService.require_permission(db, user, "adr.view")
    adr = await _get_adr(db, adr_id)
    return await _detail(db, adr, user)


@router.patch("/{adr_id}")
async def update_adr(
    adr_id: str,
    body: ADRUpdate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    await PermissionService.require_permission(db, user, "adr.manage")
    adr = await _get_adr(db, adr_id)
    adr_service.check_editable(adr.status, body.status, body.model_fields_set)
    read_scope = await CardReadScope.load(db, user)
    was_draft = adr.status == "draft"
    # The content before this save touches the row: a draft's first recorded
    # save keeps it as the baseline version.
    before = await history.current_snapshot(db, document_collab.ADR, adr) if was_draft else None

    if body.title is not None:
        adr.title = body.title
    text = await document_collab.before_save(
        db,
        document_collab.ADR,
        adr,
        {
            field: getattr(body, field)
            for field in mention_service.text_fields_of(document_collab.ADR)
            if getattr(body, field) is not None
        },
        user=user,
        read_scope=read_scope,
    )
    for field, value in text.items():
        setattr(adr, field, value)
    if body.links is not None and body.related_decisions is not None:
        raise HTTPException(
            400,
            {
                "error": "links_and_related_decisions",
                "message": "Send either links or related_decisions, not both",
            },
        )
    if body.links is not None or body.related_decisions is not None:
        register = await ds.load_register(db)
        wanted = decision_link_service.wanted_links(
            register, adr.id, links=body.links, related=body.related_decisions or []
        )
        await decision_link_service.replace_links(db, adr, wanted, register=register)
    for field in ("decided_on", "effective_from", "valid_until", "change_summary"):
        if field in body.model_fields_set:
            setattr(adr, field, getattr(body, field))
    adr_service.check_dates(
        adr.decided_on,
        adr.effective_from,
        adr.valid_until,
        today=datetime.now(timezone.utc).date(),
    )
    await decision_people_service.replace_people(
        db, adr, decision_makers=body.decision_makers, participants=body.participants
    )
    if body.attributes is not None:
        # Extension attributes bag: shallow-merge namespaced ``ext.*`` keys.
        # A key set to null is removed. Core owns no native ADR attributes, so
        # non-namespaced keys are rejected to keep extension data self-contained
        # and collision-free. Signed ADRs never reach here (blocked above).
        merged = dict(adr.attributes or {})
        for key, value in body.attributes.items():
            if not key.startswith("ext."):
                raise HTTPException(
                    400, f"ADR attribute keys must be namespaced 'ext.*' (got {key!r})"
                )
            if value is None:
                merged.pop(key, None)
            else:
                merged[key] = value
        adr.attributes = merged
        flag_modified(adr, "attributes")
    if body.status is not None:
        adr.status = body.status

    if body.linked_card_ids is not None:
        desired = set(await adr_service.resolve_card_ids(db, body.linked_card_ids))
        if await read_scope.hidden_card_ids(db, desired, mode="module"):
            raise HTTPException(404, "Card not found")
        result = await db.execute(
            select(ArchitectureDecisionCard).where(
                ArchitectureDecisionCard.architecture_decision_id == adr.id
            )
        )
        existing_links = {link.card_id: link for link in result.scalars().all()}
        # The client was only shown the readable links — keep the hidden ones.
        desired |= await read_scope.hidden_card_ids(db, existing_links.keys(), mode="module")
        for card_id, link in existing_links.items():
            if card_id not in desired:
                await db.delete(link)
        for card_id in desired - existing_links.keys():
            db.add(
                ArchitectureDecisionCard(
                    architecture_decision_id=adr.id,
                    card_id=card_id,
                )
            )

    await document_collab.after_save(
        db, document_collab.ADR, adr, user=user, was_draft=was_draft, before=before
    )
    await db.commit()
    await db.refresh(adr)
    return await _detail(db, adr, user, read_scope)


@router.delete("/{adr_id}", status_code=204)
async def delete_adr(
    adr_id: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    adr = await _get_adr(db, adr_id)

    if adr.status != "draft":
        raise HTTPException(400, "Only draft decisions can be deleted")

    # Admin (adr.delete) can delete any draft; author needs adr.manage
    has_delete = await PermissionService.check_permission(db, user, "adr.delete")
    if not has_delete:
        if adr.created_by != user.id:
            raise HTTPException(403, "Only the author or an admin can delete a draft decision")
        await PermissionService.require_permission(db, user, "adr.manage")

    await adr_service.delete_draft(db, adr)
    await db.commit()


# ---------------------------------------------------------------------------
# Duplicate
# ---------------------------------------------------------------------------


@router.post("/{adr_id}/duplicate", status_code=201)
async def duplicate_adr(
    adr_id: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Duplicate an ADR as a new draft with a new reference number."""
    await PermissionService.require_permission(db, user, "adr.manage")
    original = await _get_adr(db, adr_id)
    dup = await adr_service.duplicate_decision(db, original, created_by=user.id)
    await db.commit()
    await db.refresh(dup)
    return await _detail(db, dup, user)


# ---------------------------------------------------------------------------
# Signing workflow
# ---------------------------------------------------------------------------


@router.post("/{adr_id}/request-signatures")
async def request_signatures(
    adr_id: str,
    body: ADRSignatureRequest,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Request signatures from specified users."""
    await PermissionService.require_permission(db, user, "adr.manage")
    adr = await _get_adr(db, adr_id)

    if adr.status == "signed":
        raise HTTPException(400, "Decision is already signed")
    if adr.status != "draft":
        # A second request during review would reset the signatures already
        # given and send everyone a second to-do.
        raise HTTPException(409, {"error": "not_draft"})

    refusal = adr_service.lock_refusal(await ds.load_register(db), adr)
    if refusal is not None:
        raise HTTPException(409, refusal)

    signatories = []
    for uid_str in body.user_ids:
        uid = uuid.UUID(uid_str)
        result = await db.execute(select(User).where(User.id == uid))
        u = result.scalar_one_or_none()
        if not u:
            raise HTTPException(404, f"User {uid_str} not found")
        signatories.append(
            {
                "user_id": str(uid),
                "display_name": u.display_name,
                "email": u.email,
                "status": "pending",
                "signed_at": None,
            }
        )

    adr.signatories = signatories
    flag_modified(adr, "signatories")
    adr.status = "in_review"
    await document_collab.on_workflow(
        db, document_collab.ADR, adr, "sent_for_review", user=user, signatories=signatories
    )

    label = adr_service.decision_label(adr)
    for sig in signatories:
        todo = Todo(
            description=f'Sign ADR: "{label}"',
            assigned_to=uuid.UUID(sig["user_id"]),
            created_by=user.id,
            link=adr_service.decision_link(adr.id),
            is_system=True,
        )
        db.add(todo)

        await notification_service.create_notification(
            db,
            user_id=uuid.UUID(sig["user_id"]),
            actor_id=user.id,
            notif_type="adr_sign_requested",
            title="ADR Signature Requested",
            message=f'{user.display_name} requested your signature on "{label}"',
            link=f"/ea-delivery/adr/{adr_id}",
            data={"adr_id": adr_id, "adr_title": adr.title},
        )

    await event_bus.publish(
        "adr.signatures_requested",
        {
            "id": adr_id,
            "reference_number": adr.reference_number,
            "revision_number": adr.revision_number,
            "title": adr.title,
            "signatory_count": len(signatories),
        },
        db=db,
        user_id=user.id,
    )
    await db.commit()
    await db.refresh(adr)

    return await _detail(db, adr, user)


@router.post("/{adr_id}/sign")
async def sign_adr(
    adr_id: str,
    body: ADRSignRequest | None = None,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Sign the ADR as the current user."""
    await PermissionService.require_permission(db, user, "adr.sign")
    adr = await _get_adr(db, adr_id)

    if adr.status == "signed":
        raise HTTPException(400, "Decision is already signed")

    signatories = list(adr.signatories or [])
    if not signatories:
        raise HTTPException(400, "No signatures have been requested for this decision")

    mine = next((sig for sig in signatories if sig["user_id"] == str(user.id)), None)
    if mine is None:
        raise HTTPException(403, "You are not a signatory of this decision")
    if mine["status"] == "signed":
        raise HTTPException(400, "You have already signed this decision")

    register: ds.Register | None = None
    if adr_service.completes_signatures(signatories, str(user.id)):
        # The final signature locks the decision: the chain may have been
        # revoked or replaced since the request, and the dates must still hold
        # with the signing day as the default. Refused before anything is
        # recorded, so the author can recall, fix and send again.
        register = await ds.load_register(db)
        refusal = adr_service.lock_refusal(register, adr)
        if refusal is not None:
            raise HTTPException(409, refusal)

    mine["status"] = "signed"
    mine["signed_at"] = datetime.now(timezone.utc).isoformat()

    # Auto-close system todos
    sign_todos = await db.execute(
        select(Todo).where(
            Todo.assigned_to == user.id,
            Todo.is_system == True,  # noqa: E712
            Todo.status == "open",
            Todo.link == adr_service.decision_link(adr.id),
        )
    )
    for t in sign_todos.scalars().all():
        t.status = "done"

    adr.signatories = signatories
    flag_modified(adr, "signatories")
    # The note becomes a ``sign_note`` comment and the timeline row's note; it
    # is no longer written into the signatory entry (where a recall wiped it).
    await document_collab.on_workflow(
        db, document_collab.ADR, adr, "signature", user=user, note=body.comment if body else None
    )

    all_signed = all(sig["status"] == "signed" for sig in signatories)
    label = adr_service.decision_label(adr)
    if all_signed and register is not None:
        adr.status = "signed"
        adr.signed_at = datetime.now(timezone.utc)
        await document_collab.on_workflow(db, document_collab.ADR, adr, "signed", user=user)
        adr_service.apply_lock_dates(adr, adr.signed_at.date())
        await adr_service.notify_standing_changed(db, adr, register, actor_id=user.id)

        if adr.created_by:
            await notification_service.create_notification(
                db,
                user_id=adr.created_by,
                actor_id=user.id,
                notif_type="adr_signed",
                title="ADR Fully Signed",
                message=f'All signatories have signed "{label}"',
                link=f"/ea-delivery/adr/{adr_id}/preview",
                data={"adr_id": adr_id, "adr_title": adr.title},
            )
    else:
        if adr.created_by:
            signed_count = sum(1 for sig in signatories if sig["status"] == "signed")
            await notification_service.create_notification(
                db,
                user_id=adr.created_by,
                actor_id=user.id,
                notif_type="adr_signed",
                title="ADR Signature Received",
                message=(
                    f'{user.display_name} signed "{label}" ({signed_count}/{len(signatories)})'
                ),
                link=f"/ea-delivery/adr/{adr_id}",
                data={"adr_id": adr_id, "adr_title": adr.title},
            )

    await event_bus.publish(
        "adr.signed",
        {
            "id": adr_id,
            "reference_number": adr.reference_number,
            "revision_number": adr.revision_number,
            "title": adr.title,
            "signer": user.display_name,
            "all_signed": all_signed,
        },
        db=db,
        user_id=user.id,
    )
    await db.commit()
    await db.refresh(adr)

    return await _detail(db, adr, user)


@router.post("/{adr_id}/recall-signatures")
async def recall_adr_signatures(
    adr_id: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Recall all pending signature requests. Resets status to draft and
    clears signatories."""
    await PermissionService.require_permission(db, user, "adr.manage")
    adr = await _get_adr(db, adr_id)

    if adr.status != "in_review":
        raise HTTPException(400, "Only decisions in review can have signatures recalled")

    # Close pending sign-request todos
    sign_todos = await db.execute(
        select(Todo).where(
            Todo.is_system == True,  # noqa: E712
            Todo.status == "open",
            Todo.link == adr_service.decision_link(adr.id),
        )
    )
    for t in sign_todos.scalars().all():
        t.status = "done"

    # Notify pending signatories
    for sig in adr.signatories or []:
        if sig["status"] == "pending":
            await notification_service.create_notification(
                db,
                user_id=uuid.UUID(sig["user_id"]),
                actor_id=user.id,
                notif_type="adr_sign_recalled",
                title="ADR Signature Request Recalled",
                message=(
                    f"{user.display_name} recalled the signature request "
                    f'for "{adr_service.decision_label(adr)}"'
                ),
                link=f"/ea-delivery/adr/{adr_id}",
                data={"adr_id": adr_id, "adr_title": adr.title},
            )

    adr.signatories = []
    flag_modified(adr, "signatories")
    adr.status = "draft"
    await document_collab.on_workflow(db, document_collab.ADR, adr, "recalled", user=user)

    await event_bus.publish(
        "adr.signatures_recalled",
        {
            "id": adr_id,
            "reference_number": adr.reference_number,
            "revision_number": adr.revision_number,
            "title": adr.title,
        },
        db=db,
        user_id=user.id,
    )
    await db.commit()
    await db.refresh(adr)

    return await _detail(db, adr, user)


@router.post("/{adr_id}/reject")
async def reject_adr(
    adr_id: str,
    body: ADRRejectRequest,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Reject the ADR as a signatory. Resets to draft (the revision number
    stays: revisions count signed versions), clears all signatories, and
    notifies the creator."""
    await PermissionService.require_permission(db, user, "adr.sign")
    adr = await _get_adr(db, adr_id)

    if adr.status != "in_review":
        raise HTTPException(400, "Only decisions in review can be rejected")

    signatories = list(adr.signatories or [])
    if not any(sig["user_id"] == str(user.id) for sig in signatories):
        raise HTTPException(403, "You are not a signatory of this decision")

    # Close all pending sign-request todos
    sign_todos = await db.execute(
        select(Todo).where(
            Todo.is_system == True,  # noqa: E712
            Todo.status == "open",
            Todo.link == adr_service.decision_link(adr.id),
        )
    )
    for t in sign_todos.scalars().all():
        t.status = "done"

    # Notify the creator
    if adr.created_by:
        await notification_service.create_notification(
            db,
            user_id=adr.created_by,
            actor_id=user.id,
            notif_type="adr_rejected",
            title="ADR Rejected",
            message=(
                f'{user.display_name} rejected "{adr_service.decision_label(adr)}": {body.comment}'
            ),
            link=f"/ea-delivery/adr/{adr_id}",
            data={
                "adr_id": adr_id,
                "adr_title": adr.title,
                "comment": body.comment,
            },
        )

    # Notify other signatories
    for sig in signatories:
        if sig["user_id"] != str(user.id):
            await notification_service.create_notification(
                db,
                user_id=uuid.UUID(sig["user_id"]),
                actor_id=user.id,
                notif_type="adr_rejected",
                title="ADR Rejected",
                message=(
                    f"{user.display_name} rejected "
                    f'"{adr_service.decision_label(adr)}": {body.comment}'
                ),
                link=f"/ea-delivery/adr/{adr_id}",
                data={
                    "adr_id": adr_id,
                    "adr_title": adr.title,
                    "comment": body.comment,
                },
            )

    adr.signatories = []
    flag_modified(adr, "signatories")
    adr.status = "draft"
    await document_collab.on_workflow(
        db, document_collab.ADR, adr, "rejected", user=user, note=body.comment
    )

    await event_bus.publish(
        "adr.rejected",
        {
            "id": adr_id,
            "reference_number": adr.reference_number,
            "revision_number": adr.revision_number,
            "title": adr.title,
            "rejector": user.display_name,
        },
        db=db,
        user_id=user.id,
    )
    await db.commit()
    await db.refresh(adr)

    return await _detail(db, adr, user)


# ---------------------------------------------------------------------------
# Record as decided
# ---------------------------------------------------------------------------


async def _audit_recorded(
    db: AsyncSession, user: User, adr: ArchitectureDecision, decision_makers: list[str]
) -> None:
    """The Security & admin log entry for recording a decision as decided."""
    await audit_log.record(
        db,
        action="admin.adr.recorded",
        category="admin",
        actor=user,
        target=("architecture_decision", str(adr.id), adr_service.decision_label(adr)),
        context={
            "decided_on": adr.decided_on,
            "effective_from": adr.effective_from,
            "decision_makers": decision_makers,
        },
    )


@router.post("/{adr_id}/record")
async def record_adr(
    adr_id: str,
    body: ADRRecordRequest,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Record a draft as a decision already taken outside Turbo EA.

    The decision locks like a signed one (``status`` ``signed``) with
    ``recorded_at`` / ``recorded_by`` set instead of signatures. Draft only
    (409 ``not_draft``); at least one decision maker, ``decided_on`` not in
    the future and, on a revision, not before the revised decision's date
    (400 ``invalid_record``); then the same lock checks as a request for
    signatures (409).
    """
    await PermissionService.require_permission(db, user, "adr.record")
    adr = await _get_adr(db, adr_id)
    if adr.status != "draft":
        raise HTTPException(409, {"error": "not_draft"})

    register = await ds.load_register(db)
    makers = (await decision_people_service.people_payload(db, [adr.id]))[adr.id]["decision_makers"]
    problems = adr_service.record_problems(
        decided_on=body.decided_on,
        today=register.today,
        decision_maker_count=len(makers),
        parent_decided=adr_service.parent_decided_on(register, adr),
    )
    if problems:
        raise HTTPException(400, {"error": "invalid_record", "problems": problems})

    refusal = adr_service.lock_refusal(
        register,
        adr,
        decided_on=body.decided_on,
        effective_from=body.effective_from or body.decided_on,
    )
    if refusal is not None:
        raise HTTPException(409, refusal)
    adr_service.record_decision(
        adr,
        decided_on=body.decided_on,
        effective_from=body.effective_from,
        recorded_by=user.id,
        now=datetime.now(timezone.utc),
    )
    await document_collab.on_workflow(db, document_collab.ADR, adr, "recorded", user=user)

    await adr_service.notify_standing_changed(db, adr, register, actor_id=user.id)
    await _audit_recorded(db, user, adr, [m["display_name"] or "" for m in makers])
    await event_bus.publish(
        "adr.recorded",
        {
            "id": adr_id,
            "reference_number": adr.reference_number,
            "revision_number": adr.revision_number,
            "title": adr.title,
            "decided_on": adr.decided_on.isoformat(),
            "effective_from": adr.effective_from.isoformat(),
        },
        db=db,
        user_id=user.id,
    )
    await db.commit()
    await db.refresh(adr)
    return await _detail(db, adr, user)


# ---------------------------------------------------------------------------
# Revisions
# ---------------------------------------------------------------------------


@router.post("/{adr_id}/revise")
async def revise_adr(
    adr_id: str,
    body: ADRReviseRequest | None = None,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Create the next revision of a signed ADR: same reference, next number.

    409 when the chain already has a revision being drafted, when a later
    revision is signed, or when another decision revoked or replaced it.
    """
    await PermissionService.require_permission(db, user, "adr.manage")
    adr = await _get_adr(db, adr_id)

    if adr.status != "signed":
        raise HTTPException(400, "Only signed decisions can be revised")
    register = await ds.load_register(db)
    refusal = adr_service.revise_refusal_detail(register, adr)
    if refusal is not None:
        raise HTTPException(409, refusal)

    body = body or ADRReviseRequest()
    new_revision = await adr_service.create_revision(
        db,
        adr,
        created_by=user.id,
        register=register,
        consolidates=body.consolidates,
        change_summary=body.change_summary,
    )
    await db.commit()
    await db.refresh(new_revision)
    return await _detail(db, new_revision, user)


@router.get("/{adr_id}/revisions")
async def list_revisions(
    adr_id: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """List all revisions in the chain for this ADR, in chain order."""
    await PermissionService.require_permission(db, user, "adr.view")
    adr = await _get_adr(db, adr_id)

    register = await ds.load_register(db)
    ids = [node.id for node in register.chain(adr.id).nodes]
    rows = await db.execute(select(ArchitectureDecision).where(ArchitectureDecision.id.in_(ids)))
    by_id = {r.id: r for r in rows.scalars().all()}
    chain = [by_id[i] for i in ids if i in by_id]
    people = await decision_people_service.people_payload(db, ids)
    return await document_collab.render_doc(
        db,
        document_collab.ADR,
        [_adr_to_summary(r, register=register, people=people) for r in chain],
        user=user,
        read_scope=None,
        register=register,
    )


# ---------------------------------------------------------------------------
# Files
# ---------------------------------------------------------------------------


async def _get_adr_for_files(db: AsyncSession, adr_id: str) -> ArchitectureDecision:
    """The decision whose files are changed: 404 when missing, 403 unless it is
    a draft (a decision in review or signed is locked, its files with it)."""
    adr = await _get_adr(db, adr_id)
    adr_service.check_editable(adr.status, None, {"files"})
    return adr


def _file_id(attachment_id: str) -> uuid.UUID:
    try:
        return uuid.UUID(attachment_id)
    except ValueError as exc:
        raise HTTPException(404, "File not found") from exc


@router.get("/{adr_id}/files")
async def list_adr_files(
    adr_id: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """The files on a decision, oldest first."""
    await PermissionService.require_permission(db, user, "adr.view")
    adr = await _get_adr(db, adr_id)
    return await adr_file_service.list_files(db, adr.id)


@router.post("/{adr_id}/files", status_code=201)
async def upload_adr_file(
    adr_id: str,
    file: UploadFile,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Attach a file to a draft decision. Same checks as a card attachment."""
    await PermissionService.require_permission(db, user, "adr.manage")
    adr = await _get_adr_for_files(db, adr_id)
    await require_uploads_enabled(db)
    fmt, data = await read_validated_upload(file)
    stored = await adr_file_service.add_file(
        db,
        adr,
        name=file.filename or "untitled",
        mime_type=fmt.mime,
        data=data,
        created_by=user.id,
    )
    await db.commit()
    return adr_file_service.file_row(stored, user.display_name)


@router.get("/{adr_id}/files/{attachment_id}/download")
async def download_adr_file(
    adr_id: str,
    attachment_id: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """One file of a decision, as a download."""
    await PermissionService.require_permission(db, user, "adr.view")
    adr = await _get_adr(db, adr_id)
    found = await adr_file_service.load_for_download(db, adr.id, _file_id(attachment_id))
    if found is None:
        raise HTTPException(404, "File not found")
    return Response(
        content=found.data,
        media_type=found.mime_type,
        headers={"Content-Disposition": content_disposition(found.name)},
    )


@router.delete("/{adr_id}/files/{attachment_id}", status_code=204)
async def delete_adr_file(
    adr_id: str,
    attachment_id: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Remove a file from a draft decision; its bytes go once no decision shares them.

    Allowed while file uploads are switched off, like a card attachment's
    delete: otherwise a file could not leave a draft and would be signed with it.
    """
    await PermissionService.require_permission(db, user, "adr.manage")
    adr = await _get_adr_for_files(db, adr_id)
    if not await adr_file_service.remove_file(db, adr.id, _file_id(attachment_id)):
        raise HTTPException(404, "File not found")
    await db.commit()


# ---------------------------------------------------------------------------
# Card linking
# ---------------------------------------------------------------------------


@router.post("/{adr_id}/cards", status_code=201)
async def link_card(
    adr_id: str,
    body: ADRCardLink,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Link an ADR to a card."""
    await PermissionService.require_permission(db, user, "adr.manage")
    adr = await _get_adr(db, adr_id)

    # Verify the card exists and is visible to the caller
    await require_card_readable(db, user, uuid.UUID(body.card_id), mode="module")

    # Check if link already exists
    result = await db.execute(
        select(ArchitectureDecisionCard).where(
            ArchitectureDecisionCard.architecture_decision_id == adr.id,
            ArchitectureDecisionCard.card_id == uuid.UUID(body.card_id),
        )
    )
    if result.scalar_one_or_none():
        raise HTTPException(409, "ADR is already linked to this card")

    link = ArchitectureDecisionCard(
        architecture_decision_id=adr.id,
        card_id=uuid.UUID(body.card_id),
    )
    db.add(link)
    await _publish_adr_card_event(db, adr, "adr.linked", uuid.UUID(body.card_id), actor_id=user.id)
    await db.commit()
    return await _detail(db, adr, user)


@router.delete("/{adr_id}/cards/{card_id}", status_code=204)
async def unlink_card(
    adr_id: str,
    card_id: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Unlink an ADR from a card."""
    await PermissionService.require_permission(db, user, "adr.manage")
    # Read the ADR up front: its reference and title go into the card-history
    # event, published before the commit like every decision event.
    adr = await _get_adr(db, adr_id)
    # A link to a card hidden from the caller does not exist for them.
    await require_card_readable(db, user, uuid.UUID(card_id), mode="module")
    result = await db.execute(
        select(ArchitectureDecisionCard).where(
            ArchitectureDecisionCard.architecture_decision_id == adr.id,
            ArchitectureDecisionCard.card_id == uuid.UUID(card_id),
        )
    )
    link = result.scalar_one_or_none()
    if not link:
        raise HTTPException(404, "Link not found")
    await db.delete(link)
    await _publish_adr_card_event(db, adr, "adr.unlinked", uuid.UUID(card_id), actor_id=user.id)
    await db.commit()


# ---------------------------------------------------------------------------
# Cards → ADR lookup (for Resources tab)
# ---------------------------------------------------------------------------


@router.get("/by-card/{card_id}")
async def list_adrs_for_card(
    card_id: str,
    include_earlier: bool = Query(
        True, description="Also list earlier revisions superseded inside their own chain"
    ),
    standing: str | None = Query(
        None, description="Only decisions with this standing (comma-separated allowed)"
    ),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Get all ADRs linked to a specific card."""
    await PermissionService.require_permission(db, user, "adr.view")
    standings = adr_service.parse_standing_filter(standing)
    try:
        cid = uuid.UUID(card_id)
    except ValueError as exc:
        raise HTTPException(400, "Invalid card id") from exc
    await require_card_readable(db, user, cid, mode="module")
    stmt = (
        select(ArchitectureDecision)
        .join(
            ArchitectureDecisionCard,
            ArchitectureDecisionCard.architecture_decision_id == ArchitectureDecision.id,
        )
        .where(ArchitectureDecisionCard.card_id == cid)
        .order_by(ArchitectureDecision.reference_number)
    )
    result = await db.execute(stmt)
    register = await ds.load_register(db)
    rows = [
        adr
        for adr in result.scalars().all()
        if adr_service.keep_in_list(
            register, adr.id, include_earlier=include_earlier, standings=standings
        )
    ]
    return await _summaries(db, rows, register, user, with_creators=False)
