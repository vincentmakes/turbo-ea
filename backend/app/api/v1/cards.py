from __future__ import annotations

import csv
import io
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.api.deps import get_current_user
from app.database import get_db
from app.models.card import Card
from app.models.card_type import CardType
from app.models.event import Event
from app.models.relation import Relation
from app.models.stakeholder import Stakeholder
from app.models.tag import Tag
from app.models.user import User
from app.schemas.card import (
    CardBulkUpdate,
    CardCreate,
    CardListResponse,
    CardResponse,
    CardUpdate,
    StakeholderRef,
    TagRef,
)
from app.services import notification_service
from app.services.calculation_engine import run_calculations_for_card
from app.services.event_bus import event_bus
from app.services.permission_service import PermissionService

router = APIRouter(prefix="/cards", tags=["cards"])

_ALLOWED_URL_SCHEMES = ("http://", "https://", "mailto:")


async def _validate_url_attributes(db: AsyncSession, card_type: str, attributes: dict) -> None:
    """Validate that any attribute whose field type is 'url' uses an allowed scheme."""
    if not attributes:
        return
    result = await db.execute(select(CardType.fields_schema).where(CardType.key == card_type))
    schema = result.scalar_one_or_none()
    if not schema:
        return
    url_keys: set[str] = set()
    for section in schema:
        for field in section.get("fields", []):
            if field.get("type") == "url":
                url_keys.add(field["key"])
    for key in url_keys:
        val = attributes.get(key)
        if val is not None and val != "":
            if not isinstance(val, str):
                raise HTTPException(422, f"Field '{key}' must be a string URL")
            if not val.strip().startswith(_ALLOWED_URL_SCHEMES):
                raise HTTPException(
                    422,
                    f"Field '{key}' must use http://, https://, or mailto: scheme",
                )


async def _calc_data_quality(db: AsyncSession, card: Card) -> float:
    """Calculate data quality score from fields_schema weights."""
    result = await db.execute(select(CardType.fields_schema).where(CardType.key == card.type))
    schema = result.scalar_one_or_none()
    if not schema:
        return 0.0

    total_weight = 0.0
    filled_weight = 0.0
    attrs = card.attributes or {}

    for section in schema:
        for field in section.get("fields", []):
            weight = field.get("weight", 1)
            if weight <= 0:
                continue
            total_weight += weight
            val = attrs.get(field["key"])
            if val is not None and val != "" and val is not False:
                filled_weight += weight

    # Also count description (weight 1) and lifecycle having at least one date (weight 1)
    total_weight += 1  # description
    if card.description and card.description.strip():
        filled_weight += 1

    total_weight += 1  # lifecycle
    lc = card.lifecycle or {}
    if any(lc.get(p) for p in ("plan", "phaseIn", "active", "phaseOut", "endOfLife")):
        filled_weight += 1

    if total_weight == 0:
        return 0.0
    return round((filled_weight / total_weight) * 100, 1)


async def _max_descendant_depth(db: AsyncSession, card_id: uuid.UUID) -> int:
    """Return the maximum depth of the subtree rooted at card_id (0 if no children)."""
    children_result = await db.execute(
        select(Card.id).where(Card.parent_id == card_id, Card.status == "ACTIVE")
    )
    child_ids = [row[0] for row in children_result.all()]
    if not child_ids:
        return 0
    max_depth = 0
    for cid in child_ids:
        d = await _max_descendant_depth(db, cid)
        max_depth = max(max_depth, d + 1)
    return max_depth


async def _check_hierarchy_depth(
    db: AsyncSession, card: Card, new_parent_id: uuid.UUID | None
) -> None:
    """Raise HTTPException if setting new_parent_id would push any descendant beyond level 5."""
    if card.type != "BusinessCapability":
        return
    if new_parent_id is None:
        return  # removing parent always safe

    # Compute ancestor depth from new parent
    ancestor_depth = 0
    current_id = new_parent_id
    seen: set[uuid.UUID] = {card.id}
    while current_id and current_id not in seen:
        seen.add(current_id)
        ancestor_depth += 1
        res = await db.execute(select(Card.parent_id).where(Card.id == current_id))
        row = res.first()
        current_id = row[0] if row else None

    # card itself would be at level = ancestor_depth + 1
    own_level = ancestor_depth + 1
    # deepest descendant would be at own_level + max_descendant_depth
    desc_depth = await _max_descendant_depth(db, card.id)
    deepest = own_level + desc_depth

    if deepest > 5:
        raise HTTPException(
            400,
            f"Cannot set parent: hierarchy would exceed maximum depth of 5 levels "
            f"(this item would be L{own_level}, deepest descendant would be L{deepest})",
        )


async def _sync_capability_level(db: AsyncSession, card: Card) -> None:
    """Auto-compute capabilityLevel for BusinessCapability based on parent depth.

    Cascades to children recursively.
    """
    if card.type != "BusinessCapability":
        return

    # Walk up to compute depth
    depth = 0
    current_id = card.parent_id
    seen: set[uuid.UUID] = {card.id}
    while current_id and current_id not in seen:
        seen.add(current_id)
        depth += 1
        res = await db.execute(select(Card.parent_id).where(Card.id == current_id))
        row = res.first()
        current_id = row[0] if row else None

    level_key = f"L{min(depth + 1, 5)}"
    attrs = dict(card.attributes or {})
    if attrs.get("capabilityLevel") != level_key:
        attrs["capabilityLevel"] = level_key
        card.attributes = attrs

    # Cascade to direct children
    children_result = await db.execute(
        select(Card).where(Card.parent_id == card.id, Card.status == "ACTIVE")
    )
    for child in children_result.scalars().all():
        await _sync_capability_level(db, child)


def _card_to_response(card: Card) -> CardResponse:
    tags = []
    for t in card.tags or []:
        tags.append(
            TagRef(
                id=str(t.id),
                name=t.name,
                color=t.color,
                group_name=t.group.name if t.group else None,
            )
        )
    stakeholder_refs = []
    for s in card.stakeholders or []:
        stakeholder_refs.append(
            StakeholderRef(
                id=str(s.id),
                user_id=str(s.user_id),
                role=s.role,
                user_display_name=s.user.display_name if s.user else None,
                user_email=s.user.email if s.user else None,
            )
        )
    return CardResponse(
        id=str(card.id),
        type=card.type,
        subtype=card.subtype,
        name=card.name,
        description=card.description,
        parent_id=str(card.parent_id) if card.parent_id else None,
        lifecycle=card.lifecycle,
        attributes=card.attributes,
        status=card.status,
        approval_status=card.approval_status,
        data_quality=card.data_quality,
        external_id=card.external_id,
        alias=card.alias,
        archived_at=card.archived_at,
        created_by=str(card.created_by) if card.created_by else None,
        updated_by=str(card.updated_by) if card.updated_by else None,
        created_at=card.created_at,
        updated_at=card.updated_at,
        tags=tags,
        stakeholders=stakeholder_refs,
    )


_ALLOWED_SORT_COLUMNS = {
    "name",
    "type",
    "status",
    "approval_status",
    "data_quality",
    "created_at",
    "updated_at",
    "subtype",
}


@router.get("", response_model=CardListResponse)
async def list_cards(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
    type: str | None = Query(None),
    status: str | None = Query(None, alias="status"),
    search: str | None = Query(None, max_length=200),
    parent_id: str | None = Query(None),
    approval_status: str | None = Query(None),
    page: int = Query(1, ge=1),
    page_size: int = Query(10000, ge=1, le=10000),
    sort_by: str = Query("name"),
    sort_dir: str = Query("asc"),
):
    await PermissionService.require_permission(db, user, "inventory.view")
    q = select(Card)
    count_q = select(func.count(Card.id))

    # Exclude cards whose type is hidden
    hidden_types_sq = select(CardType.key).where(CardType.is_hidden == True)  # noqa: E712
    q = q.where(Card.type.not_in(hidden_types_sq))
    count_q = count_q.where(Card.type.not_in(hidden_types_sq))

    if type:
        q = q.where(Card.type == type)
        count_q = count_q.where(Card.type == type)
    if status:
        statuses = [s.strip() for s in status.split(",") if s.strip()]
        if len(statuses) == 1:
            q = q.where(Card.status == statuses[0])
            count_q = count_q.where(Card.status == statuses[0])
        else:
            q = q.where(Card.status.in_(statuses))
            count_q = count_q.where(Card.status.in_(statuses))
    else:
        q = q.where(Card.status == "ACTIVE")
        count_q = count_q.where(Card.status == "ACTIVE")
    if search:
        like = f"%{search}%"
        q = q.where(or_(Card.name.ilike(like), Card.description.ilike(like)))
        count_q = count_q.where(or_(Card.name.ilike(like), Card.description.ilike(like)))
    if parent_id:
        q = q.where(Card.parent_id == uuid.UUID(parent_id))
        count_q = count_q.where(Card.parent_id == uuid.UUID(parent_id))
    if approval_status:
        statuses = [s.strip() for s in approval_status.split(",") if s.strip()]
        q = q.where(Card.approval_status.in_(statuses))
        count_q = count_q.where(Card.approval_status.in_(statuses))

    # Sorting — H9: whitelist sort columns
    if sort_by not in _ALLOWED_SORT_COLUMNS:
        sort_by = "name"
    sort_col = getattr(Card, sort_by, Card.name)
    q = q.order_by(sort_col.desc() if sort_dir == "desc" else sort_col.asc())
    q = q.offset((page - 1) * page_size).limit(page_size)

    total_result = await db.execute(count_q)
    total = total_result.scalar() or 0

    q = q.options(
        selectinload(Card.tags).selectinload(Tag.group),
        selectinload(Card.stakeholders).selectinload(Stakeholder.user),
    )
    result = await db.execute(q)
    items = [_card_to_response(card) for card in result.scalars().all()]

    return CardListResponse(items=items, total=total, page=page, page_size=page_size)


@router.post("", response_model=CardResponse, status_code=201)
async def create_card(
    body: CardCreate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    await PermissionService.require_permission(db, user, "inventory.create")
    await _validate_url_attributes(db, body.type, body.attributes or {})
    card = Card(
        type=body.type,
        subtype=body.subtype,
        name=body.name,
        description=body.description,
        parent_id=uuid.UUID(body.parent_id) if body.parent_id else None,
        lifecycle=body.lifecycle or {},
        attributes=body.attributes or {},
        external_id=body.external_id,
        alias=body.alias,
        approval_status="DRAFT",
        created_by=user.id,
        updated_by=user.id,
    )
    db.add(card)
    await db.flush()

    # Guard: hierarchy depth limit for BusinessCapability
    if card.parent_id:
        await _check_hierarchy_depth(db, card, card.parent_id)

    # Auto-set capability level for BusinessCapability
    await _sync_capability_level(db, card)

    # Compute data quality score
    card.data_quality = await _calc_data_quality(db, card)

    # Run calculated fields
    await run_calculations_for_card(db, card)

    await event_bus.publish(
        "card.created",
        {"id": str(card.id), "type": card.type, "name": card.name},
        db=db,
        card_id=card.id,
        user_id=user.id,
    )
    await db.commit()
    result = await db.execute(
        select(Card)
        .where(Card.id == card.id)
        .options(
            selectinload(Card.tags).selectinload(Tag.group),
            selectinload(Card.stakeholders).selectinload(Stakeholder.user),
        )
    )
    card = result.scalar_one()
    return _card_to_response(card)


@router.get("/{card_id}", response_model=CardResponse)
async def get_card(
    card_id: str, db: AsyncSession = Depends(get_db), _user: User = Depends(get_current_user)
):
    result = await db.execute(
        select(Card)
        .where(Card.id == uuid.UUID(card_id))
        .options(
            selectinload(Card.tags).selectinload(Tag.group),
            selectinload(Card.stakeholders).selectinload(Stakeholder.user),
        )
    )
    card = result.scalar_one_or_none()
    if not card:
        raise HTTPException(404, "Card not found")
    return _card_to_response(card)


@router.get("/{card_id}/hierarchy")
async def get_hierarchy(
    card_id: str, db: AsyncSession = Depends(get_db), _user: User = Depends(get_current_user)
):
    """Return ancestors (root→parent), children, and computed level."""
    uid = uuid.UUID(card_id)
    result = await db.execute(select(Card).where(Card.id == uid))
    card = result.scalar_one_or_none()
    if not card:
        raise HTTPException(404, "Card not found")

    # Walk up parent chain to collect ancestors
    ancestors: list[dict] = []
    current = card
    seen: set[uuid.UUID] = {uid}
    while current.parent_id and current.parent_id not in seen:
        seen.add(current.parent_id)
        res = await db.execute(select(Card).where(Card.id == current.parent_id))
        parent = res.scalar_one_or_none()
        if not parent:
            break
        ancestors.append({"id": str(parent.id), "name": parent.name, "type": parent.type})
        current = parent
    ancestors.reverse()  # root first

    # Direct children
    children_result = await db.execute(
        select(Card).where(Card.parent_id == uid, Card.status == "ACTIVE").order_by(Card.name)
    )
    children = [
        {"id": str(c.id), "name": c.name, "type": c.type} for c in children_result.scalars().all()
    ]

    return {
        "ancestors": ancestors,
        "children": children,
        "level": len(ancestors) + 1,
    }


@router.patch("/bulk", response_model=list[CardResponse])
async def bulk_update(
    body: CardBulkUpdate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    await PermissionService.require_permission(db, user, "inventory.bulk_edit")
    uuids = [uuid.UUID(i) for i in body.ids]
    result = await db.execute(select(Card).where(Card.id.in_(uuids)))
    sheets = result.scalars().all()
    updates = body.updates.model_dump(exclude_unset=True)
    if "attributes" in updates and updates["attributes"]:
        for card in sheets:
            await _validate_url_attributes(db, card.type, updates["attributes"])
            break  # schema is per-type; validated once per distinct type
    for card in sheets:
        for field, value in updates.items():
            if field == "parent_id" and value is not None:
                value = uuid.UUID(value)
            setattr(card, field, value)
        card.updated_by = user.id
    await db.commit()
    result = await db.execute(
        select(Card)
        .where(Card.id.in_(uuids))
        .options(
            selectinload(Card.tags).selectinload(Tag.group),
            selectinload(Card.stakeholders).selectinload(Stakeholder.user),
        )
    )
    sheets = result.scalars().all()
    return [_card_to_response(card) for card in sheets]


@router.patch("/{card_id}", response_model=CardResponse)
async def update_card(
    card_id: str,
    body: CardUpdate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    card_uuid = uuid.UUID(card_id)
    if not await PermissionService.check_permission(
        db, user, "inventory.edit", card_uuid, "card.edit"
    ):
        raise HTTPException(403, "Not enough permissions")
    result = await db.execute(
        select(Card)
        .where(Card.id == card_uuid)
        .options(
            selectinload(Card.tags).selectinload(Tag.group),
            selectinload(Card.stakeholders).selectinload(Stakeholder.user),
        )
    )
    card = result.scalar_one_or_none()
    if not card:
        raise HTTPException(404, "Card not found")

    updates = body.model_dump(exclude_unset=True)

    # Validate URL-typed attributes
    if "attributes" in updates and updates["attributes"]:
        await _validate_url_attributes(db, card.type, updates["attributes"])

    # Guard: hierarchy depth limit before applying parent change
    if "parent_id" in updates:
        new_pid = uuid.UUID(updates["parent_id"]) if updates["parent_id"] else None
        if new_pid != card.parent_id:
            await _check_hierarchy_depth(db, card, new_pid)

    changes = {}
    for field, value in updates.items():
        if field == "parent_id" and value is not None:
            value = uuid.UUID(value)
        old = getattr(card, field)
        if old != value:
            changes[field] = {"old": old, "new": value}
            setattr(card, field, value)

    if changes:
        card.updated_by = user.id
        # Break approval status on edit (attribute/lifecycle changes break it)
        if card.approval_status == "APPROVED":
            status_breaking = {
                "name",
                "description",
                "lifecycle",
                "attributes",
                "subtype",
                "alias",
                "parent_id",
            }
            if status_breaking & changes.keys():
                card.approval_status = "BROKEN"

        # Auto-sync capability level when parent changes or level is missing
        if "parent_id" in changes or (
            card.type == "BusinessCapability" and not (card.attributes or {}).get("capabilityLevel")
        ):
            await _sync_capability_level(db, card)

        # Recalculate completion
        card.data_quality = await _calc_data_quality(db, card)

        # Run calculated fields
        await run_calculations_for_card(db, card)

        def _serialize_val(v: object) -> object:
            """Convert a value to something JSON-serialisable."""
            if v is None or isinstance(v, (str, int, float, bool)):
                return v
            if isinstance(v, (dict, list)):
                return v
            if isinstance(v, uuid.UUID):
                return str(v)
            if isinstance(v, datetime):
                return v.isoformat()
            return str(v)

        serialised_changes = {
            k: {"old": _serialize_val(v["old"]), "new": _serialize_val(v["new"])}
            for k, v in changes.items()
        }
        await event_bus.publish(
            "card.updated",
            {"id": str(card.id), "changes": serialised_changes},
            db=db,
            card_id=card.id,
            user_id=user.id,
        )

        # Notify subscribers about the update
        changed_fields = ", ".join(changes.keys())
        await notification_service.create_notifications_for_subscribers(
            db,
            card_id=card.id,
            notif_type="card_updated",
            title=f"{card.name} Updated",
            message=f'{user.display_name} updated "{card.name}" ({changed_fields})',
            link=f"/cards/{card.id}",
            data={"changes": list(changes.keys())},
        )

        await db.commit()
        result = await db.execute(
            select(Card)
            .where(Card.id == card.id)
            .options(
                selectinload(Card.tags).selectinload(Tag.group),
                selectinload(Card.stakeholders).selectinload(Stakeholder.user),
            )
        )
        card = result.scalar_one()

    return _card_to_response(card)


@router.post("/{card_id}/archive", response_model=CardResponse)
async def archive_card(
    card_id: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Archive a card (soft delete). Sets status to ARCHIVED and records archived_at."""
    card_uuid = uuid.UUID(card_id)
    if not await PermissionService.check_permission(
        db, user, "inventory.archive", card_uuid, "card.archive"
    ):
        raise HTTPException(403, "Not enough permissions")
    result = await db.execute(select(Card).where(Card.id == card_uuid))
    card = result.scalar_one_or_none()
    if not card:
        raise HTTPException(404, "Card not found")
    if card.status == "ARCHIVED":
        raise HTTPException(400, "Card is already archived")
    card.status = "ARCHIVED"
    card.archived_at = datetime.now(timezone.utc)
    card.updated_by = user.id
    await event_bus.publish(
        "card.archived",
        {"id": str(card.id), "type": card.type, "name": card.name},
        db=db,
        card_id=card.id,
        user_id=user.id,
    )
    await db.commit()
    result = await db.execute(
        select(Card)
        .where(Card.id == card.id)
        .options(
            selectinload(Card.tags).selectinload(Tag.group),
            selectinload(Card.stakeholders).selectinload(Stakeholder.user),
        )
    )
    card = result.scalar_one()
    return _card_to_response(card)


@router.post("/{card_id}/restore", response_model=CardResponse)
async def restore_card(
    card_id: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Restore an archived card back to ACTIVE status."""
    card_uuid = uuid.UUID(card_id)
    if not await PermissionService.check_permission(
        db, user, "inventory.archive", card_uuid, "card.archive"
    ):
        raise HTTPException(403, "Not enough permissions")
    result = await db.execute(select(Card).where(Card.id == card_uuid))
    card = result.scalar_one_or_none()
    if not card:
        raise HTTPException(404, "Card not found")
    if card.status != "ARCHIVED":
        raise HTTPException(400, "Card is not archived")
    card.status = "ACTIVE"
    card.archived_at = None
    card.updated_by = user.id
    await event_bus.publish(
        "card.restored",
        {"id": str(card.id), "type": card.type, "name": card.name},
        db=db,
        card_id=card.id,
        user_id=user.id,
    )
    await db.commit()
    result = await db.execute(
        select(Card)
        .where(Card.id == card.id)
        .options(
            selectinload(Card.tags).selectinload(Tag.group),
            selectinload(Card.stakeholders).selectinload(Stakeholder.user),
        )
    )
    card = result.scalar_one()
    return _card_to_response(card)


@router.delete("/{card_id}", status_code=204)
async def delete_card(
    card_id: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Permanently delete a card. Admin only."""
    card_uuid = uuid.UUID(card_id)
    if not await PermissionService.check_permission(
        db, user, "inventory.delete", card_uuid, "card.delete"
    ):
        raise HTTPException(
            403, "Not enough permissions — only admins can permanently delete cards"
        )
    result = await db.execute(select(Card).where(Card.id == card_uuid))
    card = result.scalar_one_or_none()
    if not card:
        raise HTTPException(404, "Card not found")

    card_name = card.name
    card_type = card.type

    # Delete related records first
    relations = await db.execute(
        select(Relation).where(
            or_(Relation.source_id == card_uuid, Relation.target_id == card_uuid)
        )
    )
    for rel in relations.scalars().all():
        await db.delete(rel)

    await event_bus.publish(
        "card.deleted",
        {"id": str(card_uuid), "type": card_type, "name": card_name},
        db=db,
        card_id=card_uuid,
        user_id=user.id,
    )

    await db.delete(card)
    await db.commit()


@router.post("/fix-hierarchy-names")
async def fix_hierarchy_names(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    await PermissionService.require_permission(db, user, "admin.metamodel")
    """One-time cleanup: strip accumulated hierarchy prefixes from names.

    A UI bug caused hierarchy paths like "Parent / Child" to be persisted as
    the card name.  This endpoint detects and fixes those entries by
    keeping only the last " / "-separated segment for any card that has
    a parent_id.
    """
    result = await db.execute(
        select(Card).where(
            Card.parent_id.isnot(None),
            Card.name.contains(" / "),
            Card.status == "ACTIVE",
        )
    )
    fixed: list[dict] = []
    for card in result.scalars().all():
        leaf_name = card.name.rsplit(" / ", 1)[-1]
        if leaf_name != card.name:
            fixed.append({"id": str(card.id), "old_name": card.name, "new_name": leaf_name})
            card.name = leaf_name
    await db.commit()
    return {"fixed": len(fixed), "details": fixed}


@router.get("/{card_id}/history")
async def get_history(
    card_id: str,
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(get_current_user),
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
):
    q = (
        select(Event)
        .where(Event.card_id == uuid.UUID(card_id))
        .options(selectinload(Event.user))
        .order_by(Event.created_at.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
    )
    result = await db.execute(q)
    events = result.scalars().all()
    return [
        {
            "id": str(e.id),
            "event_type": e.event_type,
            "data": e.data,
            "user_id": str(e.user_id) if e.user_id else None,
            "user_display_name": e.user.display_name if e.user else None,
            "created_at": e.created_at.isoformat() if e.created_at else None,
        }
        for e in events
    ]


@router.post("/{card_id}/approval-status")
async def update_approval_status(
    card_id: str,
    action: str = Query(..., pattern="^(approve|reject|reset)$"),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    card_uuid = uuid.UUID(card_id)
    if not await PermissionService.check_permission(
        db, user, "inventory.approval_status", card_uuid, "card.approval_status"
    ):
        raise HTTPException(403, "Not enough permissions")
    result = await db.execute(select(Card).where(Card.id == card_uuid))
    card = result.scalar_one_or_none()
    if not card:
        raise HTTPException(404, "Card not found")
    status_map = {"approve": "APPROVED", "reject": "REJECTED", "reset": "DRAFT"}
    card.approval_status = status_map[action]
    await event_bus.publish(
        f"card.approval_status.{action}",
        {"id": str(card.id), "approval_status": card.approval_status},
        db=db,
        card_id=card.id,
        user_id=user.id,
    )

    # Notify stakeholders about approval status change
    action_label = {"approve": "approved", "reject": "rejected", "reset": "reset"}
    await notification_service.create_notifications_for_subscribers(
        db,
        card_id=card.id,
        notif_type="approval_status_changed",
        title=f"Approval Status {action_label[action].title()}",
        message=f'{user.display_name} {action_label[action]} the approval status on "{card.name}"',
        link=f"/cards/{card_id}",
        data={"approval_status": card.approval_status, "action": action},
        actor_id=user.id,
    )

    await db.commit()
    return {"approval_status": card.approval_status}


@router.get("/{card_id}/my-permissions")
async def my_permissions(
    card_id: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Return the current user's effective permissions on a specific card."""
    result = await db.execute(select(Card).where(Card.id == uuid.UUID(card_id)))
    if not result.scalar_one_or_none():
        raise HTTPException(404, "Card not found")

    return await PermissionService.get_effective_card_permissions(db, user, uuid.UUID(card_id))


@router.get("/export/csv")
async def export_csv(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
    type: str | None = Query(None),
):
    await PermissionService.require_permission(db, user, "inventory.export")
    q = select(Card).where(Card.status == "ACTIVE")
    if type:
        q = q.where(Card.type == type)
    result = await db.execute(q)
    sheets = result.scalars().all()

    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(["id", "type", "name", "description", "status", "lifecycle", "attributes"])
    for card in sheets:
        writer.writerow(
            [
                str(card.id),
                card.type,
                card.name,
                card.description or "",
                card.status,
                str(card.lifecycle),
                str(card.attributes),
            ]
        )
    output.seek(0)
    return StreamingResponse(
        iter([output.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=cards.csv"},
    )
