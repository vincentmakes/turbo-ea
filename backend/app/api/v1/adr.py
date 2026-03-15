from __future__ import annotations

import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, select
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
    ADRRejectRequest,
    ADRSignatureRequest,
    ADRUpdate,
)
from app.services import notification_service
from app.services.event_bus import event_bus
from app.services.permission_service import PermissionService

router = APIRouter(prefix="/adr", tags=["adr"])


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


async def _next_reference_number(db: AsyncSession) -> str:
    """Generate the next ADR reference number (ADR-001, ADR-002, etc.)."""
    result = await db.execute(select(func.max(ArchitectureDecision.reference_number)))
    max_ref = result.scalar_one_or_none()
    if max_ref:
        num = int(max_ref.replace("ADR-", "")) + 1
    else:
        num = 1
    return f"ADR-{num:03d}"


async def _get_adr(db: AsyncSession, adr_id: str) -> ArchitectureDecision:
    result = await db.execute(
        select(ArchitectureDecision).where(ArchitectureDecision.id == uuid.UUID(adr_id))
    )
    adr = result.scalar_one_or_none()
    if not adr:
        raise HTTPException(404, "Architecture decision not found")
    return adr


async def _adr_to_dict(db: AsyncSession, adr: ArchitectureDecision) -> dict:
    """Convert an ADR model to a response dict, including linked cards and names."""
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
    )
    linked_cards = [{"id": str(row.id), "name": row.name, "type": row.type} for row in result.all()]

    return {
        "id": str(adr.id),
        "reference_number": adr.reference_number,
        "title": adr.title,
        "status": adr.status,
        "context": adr.context,
        "decision": adr.decision,
        "consequences": adr.consequences,
        "alternatives_considered": adr.alternatives_considered,
        "related_decisions": adr.related_decisions or [],
        "created_by": str(adr.created_by) if adr.created_by else None,
        "creator_name": creator_name,
        "signatories": adr.signatories or [],
        "signed_at": adr.signed_at.isoformat() if adr.signed_at else None,
        "revision_number": adr.revision_number,
        "parent_id": str(adr.parent_id) if adr.parent_id else None,
        "linked_cards": linked_cards,
        "created_at": adr.created_at.isoformat() if adr.created_at else None,
        "updated_at": adr.updated_at.isoformat() if adr.updated_at else None,
    }


def _adr_to_summary(
    adr: ArchitectureDecision,
    linked_cards: list[dict] | None = None,
    creator_name: str | None = None,
) -> dict:
    """Lightweight dict for list endpoints."""
    return {
        "id": str(adr.id),
        "reference_number": adr.reference_number,
        "title": adr.title,
        "status": adr.status,
        "decision": adr.decision,
        "created_by": str(adr.created_by) if adr.created_by else None,
        "creator_name": creator_name,
        "signatories": adr.signatories or [],
        "signed_at": adr.signed_at.isoformat() if adr.signed_at else None,
        "revision_number": adr.revision_number,
        "parent_id": str(adr.parent_id) if adr.parent_id else None,
        "linked_cards": linked_cards or [],
        "created_at": adr.created_at.isoformat() if adr.created_at else None,
        "updated_at": adr.updated_at.isoformat() if adr.updated_at else None,
    }


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
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    await PermissionService.require_permission(db, user, "adr.view")
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
        pattern = f"%{search}%"
        stmt = stmt.where(
            ArchitectureDecision.title.ilike(pattern)
            | ArchitectureDecision.reference_number.ilike(pattern)
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
        stmt = stmt.join(Card, ArchitectureDecisionCard.card_id == Card.id).where(
            Card.type == card_type
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

    if joined_junction:
        stmt = stmt.distinct()

    result = await db.execute(stmt)
    rows = result.scalars().all()

    # Bulk-fetch linked cards for all ADRs
    adr_ids = [adr.id for adr in rows]
    cards_map: dict[uuid.UUID, list[dict]] = {aid: [] for aid in adr_ids}
    if adr_ids:
        cards_result = await db.execute(
            select(
                ArchitectureDecisionCard.architecture_decision_id,
                Card.id,
                Card.name,
                Card.type,
            )
            .join(Card, ArchitectureDecisionCard.card_id == Card.id)
            .where(ArchitectureDecisionCard.architecture_decision_id.in_(adr_ids))
        )
        for row in cards_result.all():
            cards_map[row[0]].append({"id": str(row[1]), "name": row[2], "type": row[3]})

    # Bulk-fetch creator display names
    creator_ids = {adr.created_by for adr in rows if adr.created_by}
    creator_names: dict[uuid.UUID, str] = {}
    if creator_ids:
        users_result = await db.execute(
            select(User.id, User.display_name).where(User.id.in_(creator_ids))
        )
        for uid, dname in users_result.all():
            creator_names[uid] = dname

    return [
        _adr_to_summary(
            adr,
            cards_map.get(adr.id),
            creator_names.get(adr.created_by) if adr.created_by else None,
        )
        for adr in rows
    ]


@router.post("", status_code=201)
async def create_adr(
    body: ADRCreate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    await PermissionService.require_permission(db, user, "adr.manage")
    ref_num = await _next_reference_number(db)
    adr = ArchitectureDecision(
        reference_number=ref_num,
        title=body.title,
        context=body.context,
        decision=body.decision,
        consequences=body.consequences,
        alternatives_considered=body.alternatives_considered,
        related_decisions=body.related_decisions or [],
        created_by=user.id,
    )
    db.add(adr)
    await db.commit()
    await db.refresh(adr)
    return await _adr_to_dict(db, adr)


@router.get("/{adr_id}")
async def get_adr(
    adr_id: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    await PermissionService.require_permission(db, user, "adr.view")
    adr = await _get_adr(db, adr_id)
    return await _adr_to_dict(db, adr)


@router.patch("/{adr_id}")
async def update_adr(
    adr_id: str,
    body: ADRUpdate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    await PermissionService.require_permission(db, user, "adr.manage")
    adr = await _get_adr(db, adr_id)

    if adr.status == "signed":
        raise HTTPException(403, "Cannot edit a signed decision. Create a new revision instead.")

    if body.title is not None:
        adr.title = body.title
    if body.context is not None:
        adr.context = body.context
    if body.decision is not None:
        adr.decision = body.decision
    if body.consequences is not None:
        adr.consequences = body.consequences
    if body.alternatives_considered is not None:
        adr.alternatives_considered = body.alternatives_considered
    if body.related_decisions is not None:
        adr.related_decisions = body.related_decisions
        flag_modified(adr, "related_decisions")
    if body.status is not None:
        if body.status == "signed":
            raise HTTPException(400, "Use the sign endpoint to sign a decision")
        if body.status == "in_review":
            raise HTTPException(
                400,
                "Use the request-signatures endpoint to send for review",
            )
        if body.status == "draft" and adr.status == "in_review":
            raise HTTPException(
                400,
                "Use the recall-signatures endpoint to reset to draft",
            )
        adr.status = body.status

    await db.commit()
    await db.refresh(adr)
    return await _adr_to_dict(db, adr)


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

    await db.delete(adr)
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
    ref_num = await _next_reference_number(db)
    dup = ArchitectureDecision(
        reference_number=ref_num,
        title=f"{original.title} (copy)",
        context=original.context,
        decision=original.decision,
        consequences=original.consequences,
        alternatives_considered=original.alternatives_considered,
        related_decisions=original.related_decisions or [],
        created_by=user.id,
    )
    db.add(dup)
    await db.commit()
    await db.refresh(dup)

    # Copy card links
    result = await db.execute(
        select(ArchitectureDecisionCard).where(
            ArchitectureDecisionCard.architecture_decision_id == original.id
        )
    )
    for link in result.scalars().all():
        db.add(
            ArchitectureDecisionCard(
                architecture_decision_id=dup.id,
                card_id=link.card_id,
            )
        )
    await db.commit()
    await db.refresh(dup)
    return await _adr_to_dict(db, dup)


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

    for sig in signatories:
        todo = Todo(
            description=f'Sign ADR: "{adr.reference_number} — {adr.title}"',
            assigned_to=uuid.UUID(sig["user_id"]),
            created_by=user.id,
            link=f"/ea-delivery/adr/{adr_id}",
            is_system=True,
        )
        db.add(todo)

        await notification_service.create_notification(
            db,
            user_id=uuid.UUID(sig["user_id"]),
            notif_type="adr_sign_requested",
            title="ADR Signature Requested",
            message=(
                f"{user.display_name} requested your signature on "
                f'"{adr.reference_number} — {adr.title}"'
            ),
            link=f"/ea-delivery/adr/{adr_id}",
            data={"adr_id": adr_id, "adr_title": adr.title},
        )

    await db.commit()
    await db.refresh(adr)

    await event_bus.publish(
        "adr.signatures_requested",
        {
            "id": adr_id,
            "reference_number": adr.reference_number,
            "title": adr.title,
            "signatory_count": len(signatories),
        },
        db=db,
        user_id=user.id,
    )

    return await _adr_to_dict(db, adr)


@router.post("/{adr_id}/sign")
async def sign_adr(
    adr_id: str,
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

    found = False
    for sig in signatories:
        if sig["user_id"] == str(user.id):
            if sig["status"] == "signed":
                raise HTTPException(400, "You have already signed this decision")
            sig["status"] = "signed"
            sig["signed_at"] = datetime.now(timezone.utc).isoformat()
            found = True
            break

    if not found:
        raise HTTPException(403, "You are not a signatory of this decision")

    # Auto-close system todos
    sign_todos = await db.execute(
        select(Todo).where(
            Todo.assigned_to == user.id,
            Todo.is_system == True,  # noqa: E712
            Todo.status == "open",
            Todo.description.ilike(f"%Sign ADR%{adr.reference_number}%"),
        )
    )
    for t in sign_todos.scalars().all():
        t.status = "done"

    adr.signatories = signatories
    flag_modified(adr, "signatories")

    all_signed = all(sig["status"] == "signed" for sig in signatories)
    if all_signed:
        adr.status = "signed"
        adr.signed_at = datetime.now(timezone.utc)

        if adr.created_by:
            await notification_service.create_notification(
                db,
                user_id=adr.created_by,
                notif_type="adr_signed",
                title="ADR Fully Signed",
                message=(f'All signatories have signed "{adr.reference_number} — {adr.title}"'),
                link=f"/ea-delivery/adr/{adr_id}/preview",
                data={"adr_id": adr_id, "adr_title": adr.title},
            )
    else:
        if adr.created_by:
            signed_count = sum(1 for sig in signatories if sig["status"] == "signed")
            await notification_service.create_notification(
                db,
                user_id=adr.created_by,
                notif_type="adr_signed",
                title="ADR Signature Received",
                message=(
                    f"{user.display_name} signed "
                    f'"{adr.reference_number} — {adr.title}" '
                    f"({signed_count}/{len(signatories)})"
                ),
                link=f"/ea-delivery/adr/{adr_id}",
                data={"adr_id": adr_id, "adr_title": adr.title},
            )

    await db.commit()
    await db.refresh(adr)

    await event_bus.publish(
        "adr.signed",
        {
            "id": adr_id,
            "reference_number": adr.reference_number,
            "title": adr.title,
            "signer": user.display_name,
            "all_signed": all_signed,
        },
        db=db,
        user_id=user.id,
    )

    return await _adr_to_dict(db, adr)


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
            Todo.description.ilike(f"%Sign ADR%{adr.reference_number}%"),
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
                notif_type="adr_sign_recalled",
                title="ADR Signature Request Recalled",
                message=(
                    f"{user.display_name} recalled the signature request "
                    f'for "{adr.reference_number} — {adr.title}"'
                ),
                link=f"/ea-delivery/adr/{adr_id}",
                data={"adr_id": adr_id, "adr_title": adr.title},
            )

    adr.signatories = []
    flag_modified(adr, "signatories")
    adr.status = "draft"

    await db.commit()
    await db.refresh(adr)

    await event_bus.publish(
        "adr.signatures_recalled",
        {
            "id": adr_id,
            "reference_number": adr.reference_number,
            "title": adr.title,
        },
        db=db,
        user_id=user.id,
    )

    return await _adr_to_dict(db, adr)


@router.post("/{adr_id}/reject")
async def reject_adr(
    adr_id: str,
    body: ADRRejectRequest,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Reject the ADR as a signatory. Resets to draft, increments revision
    number, clears all signatories, and notifies the creator."""
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
            Todo.description.ilike(f"%Sign ADR%{adr.reference_number}%"),
        )
    )
    for t in sign_todos.scalars().all():
        t.status = "done"

    # Notify the creator
    if adr.created_by:
        await notification_service.create_notification(
            db,
            user_id=adr.created_by,
            notif_type="adr_rejected",
            title="ADR Rejected",
            message=(
                f"{user.display_name} rejected "
                f'"{adr.reference_number} — {adr.title}": {body.comment}'
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
                notif_type="adr_rejected",
                title="ADR Rejected",
                message=(
                    f"{user.display_name} rejected "
                    f'"{adr.reference_number} — {adr.title}": '
                    f"{body.comment}"
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
    adr.revision_number += 1

    await db.commit()
    await db.refresh(adr)

    await event_bus.publish(
        "adr.rejected",
        {
            "id": adr_id,
            "reference_number": adr.reference_number,
            "title": adr.title,
            "rejector": user.display_name,
            "comment": body.comment,
        },
        db=db,
        user_id=user.id,
    )

    return await _adr_to_dict(db, adr)


# ---------------------------------------------------------------------------
# Revisions
# ---------------------------------------------------------------------------


@router.post("/{adr_id}/revise")
async def revise_adr(
    adr_id: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Create a new revision of a signed ADR."""
    await PermissionService.require_permission(db, user, "adr.manage")
    adr = await _get_adr(db, adr_id)

    if adr.status != "signed":
        raise HTTPException(400, "Only signed decisions can be revised")

    ref_num = await _next_reference_number(db)
    new_revision = ArchitectureDecision(
        reference_number=ref_num,
        title=adr.title,
        context=adr.context,
        decision=adr.decision,
        consequences=adr.consequences,
        alternatives_considered=adr.alternatives_considered,
        related_decisions=adr.related_decisions or [],
        created_by=user.id,
        revision_number=adr.revision_number + 1,
        parent_id=adr.id,
    )
    db.add(new_revision)
    await db.commit()
    await db.refresh(new_revision)

    # Copy card links from the original
    result = await db.execute(
        select(ArchitectureDecisionCard).where(
            ArchitectureDecisionCard.architecture_decision_id == adr.id
        )
    )
    for link in result.scalars().all():
        db.add(
            ArchitectureDecisionCard(
                architecture_decision_id=new_revision.id,
                card_id=link.card_id,
            )
        )
    await db.commit()
    await db.refresh(new_revision)

    return await _adr_to_dict(db, new_revision)


@router.get("/{adr_id}/revisions")
async def list_revisions(
    adr_id: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """List all revisions in the chain for this ADR."""
    await PermissionService.require_permission(db, user, "adr.view")
    adr = await _get_adr(db, adr_id)

    # Walk up to the root
    root = adr
    while root.parent_id:
        result = await db.execute(
            select(ArchitectureDecision).where(ArchitectureDecision.id == root.parent_id)
        )
        parent = result.scalar_one_or_none()
        if not parent:
            break
        root = parent

    # Collect all revisions from root downward
    revisions = [_adr_to_summary(root)]
    current_id = root.id
    while True:
        result = await db.execute(
            select(ArchitectureDecision).where(ArchitectureDecision.parent_id == current_id)
        )
        child = result.scalar_one_or_none()
        if not child:
            break
        revisions.append(_adr_to_summary(child))
        current_id = child.id

    return revisions


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

    # Verify card exists
    result = await db.execute(select(Card).where(Card.id == uuid.UUID(body.card_id)))
    if not result.scalar_one_or_none():
        raise HTTPException(404, "Card not found")

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
    await db.commit()
    return await _adr_to_dict(db, adr)


@router.delete("/{adr_id}/cards/{card_id}", status_code=204)
async def unlink_card(
    adr_id: str,
    card_id: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Unlink an ADR from a card."""
    await PermissionService.require_permission(db, user, "adr.manage")
    result = await db.execute(
        select(ArchitectureDecisionCard).where(
            ArchitectureDecisionCard.architecture_decision_id == uuid.UUID(adr_id),
            ArchitectureDecisionCard.card_id == uuid.UUID(card_id),
        )
    )
    link = result.scalar_one_or_none()
    if not link:
        raise HTTPException(404, "Link not found")
    await db.delete(link)
    await db.commit()


# ---------------------------------------------------------------------------
# Cards → ADR lookup (for Resources tab)
# ---------------------------------------------------------------------------


@router.get("/by-card/{card_id}")
async def list_adrs_for_card(
    card_id: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Get all ADRs linked to a specific card."""
    await PermissionService.require_permission(db, user, "adr.view")
    stmt = (
        select(ArchitectureDecision)
        .join(
            ArchitectureDecisionCard,
            ArchitectureDecisionCard.architecture_decision_id == ArchitectureDecision.id,
        )
        .where(ArchitectureDecisionCard.card_id == uuid.UUID(card_id))
        .order_by(ArchitectureDecision.reference_number)
    )
    result = await db.execute(stmt)
    rows = result.scalars().all()

    # Bulk-fetch linked cards
    adr_ids = [adr.id for adr in rows]
    cards_map: dict[uuid.UUID, list[dict]] = {aid: [] for aid in adr_ids}
    if adr_ids:
        cards_result = await db.execute(
            select(
                ArchitectureDecisionCard.architecture_decision_id,
                Card.id,
                Card.name,
                Card.type,
            )
            .join(Card, ArchitectureDecisionCard.card_id == Card.id)
            .where(ArchitectureDecisionCard.architecture_decision_id.in_(adr_ids))
        )
        for row in cards_result.all():
            cards_map[row[0]].append({"id": str(row[1]), "name": row[2], "type": row[3]})

    return [_adr_to_summary(adr, cards_map.get(adr.id)) for adr in rows]
