from __future__ import annotations

import csv
import io
import uuid

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.database import get_db
from app.models.event import Event
from app.models.fact_sheet import FactSheet
from app.models.fact_sheet_type import FactSheetType
from app.models.user import User
from app.schemas.fact_sheet import (
    FactSheetBulkUpdate,
    FactSheetCreate,
    FactSheetListResponse,
    FactSheetResponse,
    FactSheetUpdate,
    SubscriptionRef,
    TagRef,
)
from app.services import notification_service
from app.services.event_bus import event_bus
from app.services.permission_service import PermissionService

router = APIRouter(prefix="/fact-sheets", tags=["fact-sheets"])


async def _calc_completion(db: AsyncSession, fs: FactSheet) -> float:
    """Calculate completion score from fields_schema weights."""
    result = await db.execute(
        select(FactSheetType.fields_schema).where(FactSheetType.key == fs.type)
    )
    schema = result.scalar_one_or_none()
    if not schema:
        return 0.0

    total_weight = 0.0
    filled_weight = 0.0
    attrs = fs.attributes or {}

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
    if fs.description and fs.description.strip():
        filled_weight += 1

    total_weight += 1  # lifecycle
    lc = fs.lifecycle or {}
    if any(lc.get(p) for p in ("plan", "phaseIn", "active", "phaseOut", "endOfLife")):
        filled_weight += 1

    if total_weight == 0:
        return 0.0
    return round((filled_weight / total_weight) * 100, 1)


async def _max_descendant_depth(db: AsyncSession, fs_id: uuid.UUID) -> int:
    """Return the maximum depth of the subtree rooted at fs_id (0 if no children)."""
    children_result = await db.execute(
        select(FactSheet.id).where(FactSheet.parent_id == fs_id, FactSheet.status == "ACTIVE")
    )
    child_ids = [row[0] for row in children_result.all()]
    if not child_ids:
        return 0
    max_depth = 0
    for cid in child_ids:
        d = await _max_descendant_depth(db, cid)
        max_depth = max(max_depth, d + 1)
    return max_depth


async def _check_hierarchy_depth(db: AsyncSession, fs: FactSheet, new_parent_id: uuid.UUID | None) -> None:
    """Raise HTTPException if setting new_parent_id would push any descendant beyond level 5."""
    if fs.type != "BusinessCapability":
        return
    if new_parent_id is None:
        return  # removing parent always safe

    # Compute ancestor depth from new parent
    ancestor_depth = 0
    current_id = new_parent_id
    seen: set[uuid.UUID] = {fs.id}
    while current_id and current_id not in seen:
        seen.add(current_id)
        ancestor_depth += 1
        res = await db.execute(select(FactSheet.parent_id).where(FactSheet.id == current_id))
        row = res.first()
        current_id = row[0] if row else None

    # fs itself would be at level = ancestor_depth + 1
    own_level = ancestor_depth + 1
    # deepest descendant would be at own_level + max_descendant_depth
    desc_depth = await _max_descendant_depth(db, fs.id)
    deepest = own_level + desc_depth

    if deepest > 5:
        raise HTTPException(
            400,
            f"Cannot set parent: hierarchy would exceed maximum depth of 5 levels "
            f"(this item would be L{own_level}, deepest descendant would be L{deepest})",
        )


async def _sync_capability_level(db: AsyncSession, fs: FactSheet) -> None:
    """Auto-compute capabilityLevel for BusinessCapability based on parent depth, then cascade to children."""
    if fs.type != "BusinessCapability":
        return

    # Walk up to compute depth
    depth = 0
    current_id = fs.parent_id
    seen: set[uuid.UUID] = {fs.id}
    while current_id and current_id not in seen:
        seen.add(current_id)
        depth += 1
        res = await db.execute(select(FactSheet.parent_id).where(FactSheet.id == current_id))
        row = res.first()
        current_id = row[0] if row else None

    level_key = f"L{min(depth + 1, 5)}"
    attrs = dict(fs.attributes or {})
    if attrs.get("capabilityLevel") != level_key:
        attrs["capabilityLevel"] = level_key
        fs.attributes = attrs

    # Cascade to direct children
    children_result = await db.execute(
        select(FactSheet).where(FactSheet.parent_id == fs.id, FactSheet.status == "ACTIVE")
    )
    for child in children_result.scalars().all():
        await _sync_capability_level(db, child)


def _fs_to_response(fs: FactSheet) -> FactSheetResponse:
    tags = []
    for t in (fs.tags or []):
        tags.append(TagRef(
            id=str(t.id), name=t.name, color=t.color,
            group_name=t.group.name if t.group else None,
        ))
    subs = []
    for s in (fs.subscriptions or []):
        subs.append(SubscriptionRef(
            id=str(s.id), user_id=str(s.user_id), role=s.role,
            user_display_name=s.user.display_name if s.user else None,
            user_email=s.user.email if s.user else None,
        ))
    return FactSheetResponse(
        id=str(fs.id),
        type=fs.type,
        subtype=fs.subtype,
        name=fs.name,
        description=fs.description,
        parent_id=str(fs.parent_id) if fs.parent_id else None,
        lifecycle=fs.lifecycle,
        attributes=fs.attributes,
        status=fs.status,
        quality_seal=fs.quality_seal,
        completion=fs.completion,
        external_id=fs.external_id,
        alias=fs.alias,
        created_by=str(fs.created_by) if fs.created_by else None,
        updated_by=str(fs.updated_by) if fs.updated_by else None,
        created_at=fs.created_at,
        updated_at=fs.updated_at,
        tags=tags,
        subscriptions=subs,
    )


_ALLOWED_SORT_COLUMNS = {"name", "type", "status", "quality_seal", "completion", "created_at", "updated_at", "subtype"}


@router.get("", response_model=FactSheetListResponse)
async def list_fact_sheets(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
    type: str | None = Query(None),
    status: str | None = Query(None, alias="status"),
    search: str | None = Query(None),
    parent_id: str | None = Query(None),
    quality_seal: str | None = Query(None),
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=500),
    sort_by: str = Query("name"),
    sort_dir: str = Query("asc"),
):
    await PermissionService.require_permission(db, user, "inventory.view")
    q = select(FactSheet)
    count_q = select(func.count(FactSheet.id))

    # Exclude fact sheets whose type is hidden
    hidden_types_sq = select(FactSheetType.key).where(FactSheetType.is_hidden == True)  # noqa: E712
    q = q.where(FactSheet.type.not_in(hidden_types_sq))
    count_q = count_q.where(FactSheet.type.not_in(hidden_types_sq))

    if type:
        q = q.where(FactSheet.type == type)
        count_q = count_q.where(FactSheet.type == type)
    if status:
        statuses = [s.strip() for s in status.split(",") if s.strip()]
        if len(statuses) == 1:
            q = q.where(FactSheet.status == statuses[0])
            count_q = count_q.where(FactSheet.status == statuses[0])
        else:
            q = q.where(FactSheet.status.in_(statuses))
            count_q = count_q.where(FactSheet.status.in_(statuses))
    else:
        q = q.where(FactSheet.status == "ACTIVE")
        count_q = count_q.where(FactSheet.status == "ACTIVE")
    if search:
        like = f"%{search}%"
        q = q.where(or_(FactSheet.name.ilike(like), FactSheet.description.ilike(like)))
        count_q = count_q.where(or_(FactSheet.name.ilike(like), FactSheet.description.ilike(like)))
    if parent_id:
        q = q.where(FactSheet.parent_id == uuid.UUID(parent_id))
        count_q = count_q.where(FactSheet.parent_id == uuid.UUID(parent_id))
    if quality_seal:
        seals = [s.strip() for s in quality_seal.split(",") if s.strip()]
        q = q.where(FactSheet.quality_seal.in_(seals))
        count_q = count_q.where(FactSheet.quality_seal.in_(seals))

    # Sorting — H9: whitelist sort columns
    if sort_by not in _ALLOWED_SORT_COLUMNS:
        sort_by = "name"
    sort_col = getattr(FactSheet, sort_by, FactSheet.name)
    q = q.order_by(sort_col.desc() if sort_dir == "desc" else sort_col.asc())
    q = q.offset((page - 1) * page_size).limit(page_size)

    total_result = await db.execute(count_q)
    total = total_result.scalar() or 0

    result = await db.execute(q)
    items = [_fs_to_response(fs) for fs in result.scalars().all()]

    return FactSheetListResponse(items=items, total=total, page=page, page_size=page_size)


@router.post("", response_model=FactSheetResponse, status_code=201)
async def create_fact_sheet(
    body: FactSheetCreate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    await PermissionService.require_permission(db, user, "inventory.create")
    fs = FactSheet(
        type=body.type,
        subtype=body.subtype,
        name=body.name,
        description=body.description,
        parent_id=uuid.UUID(body.parent_id) if body.parent_id else None,
        lifecycle=body.lifecycle or {},
        attributes=body.attributes or {},
        external_id=body.external_id,
        alias=body.alias,
        quality_seal="DRAFT",
        created_by=user.id,
        updated_by=user.id,
    )
    db.add(fs)
    await db.flush()

    # Guard: hierarchy depth limit for BusinessCapability
    if fs.parent_id:
        await _check_hierarchy_depth(db, fs, fs.parent_id)

    # Auto-set capability level for BusinessCapability
    await _sync_capability_level(db, fs)

    # Compute completion score
    fs.completion = await _calc_completion(db, fs)

    await event_bus.publish(
        "fact_sheet.created",
        {"id": str(fs.id), "type": fs.type, "name": fs.name},
        db=db, fact_sheet_id=fs.id, user_id=user.id,
    )
    await db.commit()
    await db.refresh(fs)
    return _fs_to_response(fs)


@router.get("/{fs_id}", response_model=FactSheetResponse)
async def get_fact_sheet(fs_id: str, db: AsyncSession = Depends(get_db), _user: User = Depends(get_current_user)):
    result = await db.execute(select(FactSheet).where(FactSheet.id == uuid.UUID(fs_id)))
    fs = result.scalar_one_or_none()
    if not fs:
        raise HTTPException(404, "Fact sheet not found")
    return _fs_to_response(fs)


@router.get("/{fs_id}/hierarchy")
async def get_hierarchy(fs_id: str, db: AsyncSession = Depends(get_db), _user: User = Depends(get_current_user)):
    """Return ancestors (root→parent), children, and computed level."""
    uid = uuid.UUID(fs_id)
    result = await db.execute(select(FactSheet).where(FactSheet.id == uid))
    fs = result.scalar_one_or_none()
    if not fs:
        raise HTTPException(404, "Fact sheet not found")

    # Walk up parent chain to collect ancestors
    ancestors: list[dict] = []
    current = fs
    seen: set[uuid.UUID] = {uid}
    while current.parent_id and current.parent_id not in seen:
        seen.add(current.parent_id)
        res = await db.execute(select(FactSheet).where(FactSheet.id == current.parent_id))
        parent = res.scalar_one_or_none()
        if not parent:
            break
        ancestors.append({"id": str(parent.id), "name": parent.name, "type": parent.type})
        current = parent
    ancestors.reverse()  # root first

    # Direct children
    children_result = await db.execute(
        select(FactSheet)
        .where(FactSheet.parent_id == uid, FactSheet.status == "ACTIVE")
        .order_by(FactSheet.name)
    )
    children = [
        {"id": str(c.id), "name": c.name, "type": c.type}
        for c in children_result.scalars().all()
    ]

    return {
        "ancestors": ancestors,
        "children": children,
        "level": len(ancestors) + 1,
    }


@router.patch("/{fs_id}", response_model=FactSheetResponse)
async def update_fact_sheet(
    fs_id: str,
    body: FactSheetUpdate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    fs_uuid = uuid.UUID(fs_id)
    if not await PermissionService.check_permission(db, user, "inventory.edit", fs_uuid, "fs.edit"):
        raise HTTPException(403, "Not enough permissions")
    result = await db.execute(select(FactSheet).where(FactSheet.id == fs_uuid))
    fs = result.scalar_one_or_none()
    if not fs:
        raise HTTPException(404, "Fact sheet not found")

    updates = body.model_dump(exclude_unset=True)

    # Guard: hierarchy depth limit before applying parent change
    if "parent_id" in updates:
        new_pid = uuid.UUID(updates["parent_id"]) if updates["parent_id"] else None
        if new_pid != fs.parent_id:
            await _check_hierarchy_depth(db, fs, new_pid)

    changes = {}
    for field, value in updates.items():
        if field == "parent_id" and value is not None:
            value = uuid.UUID(value)
        old = getattr(fs, field)
        if old != value:
            changes[field] = {"old": old, "new": value}
            setattr(fs, field, value)

    if changes:
        fs.updated_by = user.id
        # Break quality seal on edit (attribute/lifecycle changes break it)
        if fs.quality_seal == "APPROVED":
            seal_breaking = {"name", "description", "lifecycle", "attributes", "subtype", "alias", "parent_id"}
            if seal_breaking & changes.keys():
                fs.quality_seal = "BROKEN"

        # Auto-sync capability level when parent changes or level is missing
        if "parent_id" in changes or (
            fs.type == "BusinessCapability"
            and not (fs.attributes or {}).get("capabilityLevel")
        ):
            await _sync_capability_level(db, fs)

        # Recalculate completion
        fs.completion = await _calc_completion(db, fs)

        await event_bus.publish(
            "fact_sheet.updated",
            {"id": str(fs.id), "changes": {k: str(v) for k, v in changes.items()}},
            db=db, fact_sheet_id=fs.id, user_id=user.id,
        )

        # Notify subscribers about the update
        changed_fields = ", ".join(changes.keys())
        await notification_service.create_notifications_for_subscribers(
            db,
            fact_sheet_id=fs.id,
            notif_type="fact_sheet_updated",
            title=f"{fs.name} Updated",
            message=f'{user.display_name} updated "{fs.name}" ({changed_fields})',
            link=f"/fact-sheets/{fs.id}",
            data={"changes": list(changes.keys())},
        )

        await db.commit()
        await db.refresh(fs)

    return _fs_to_response(fs)


@router.delete("/{fs_id}", status_code=204)
async def archive_fact_sheet(
    fs_id: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    fs_uuid = uuid.UUID(fs_id)
    if not await PermissionService.check_permission(db, user, "inventory.delete", fs_uuid, "fs.delete"):
        raise HTTPException(403, "Not enough permissions")
    result = await db.execute(select(FactSheet).where(FactSheet.id == fs_uuid))
    fs = result.scalar_one_or_none()
    if not fs:
        raise HTTPException(404, "Fact sheet not found")
    fs.status = "ARCHIVED"
    fs.updated_by = user.id
    await event_bus.publish(
        "fact_sheet.archived",
        {"id": str(fs.id), "type": fs.type, "name": fs.name},
        db=db, fact_sheet_id=fs.id, user_id=user.id,
    )
    await db.commit()


@router.patch("/bulk", response_model=list[FactSheetResponse])
async def bulk_update(
    body: FactSheetBulkUpdate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    await PermissionService.require_permission(db, user, "inventory.bulk_edit")
    uuids = [uuid.UUID(i) for i in body.ids]
    result = await db.execute(select(FactSheet).where(FactSheet.id.in_(uuids)))
    sheets = result.scalars().all()
    updates = body.updates.model_dump(exclude_unset=True)
    for fs in sheets:
        for field, value in updates.items():
            if field == "parent_id" and value is not None:
                value = uuid.UUID(value)
            setattr(fs, field, value)
        fs.updated_by = user.id
    await db.commit()
    return [_fs_to_response(fs) for fs in sheets]


@router.post("/fix-hierarchy-names")
async def fix_hierarchy_names(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    await PermissionService.require_permission(db, user, "admin.metamodel")
    """One-time cleanup: strip accumulated hierarchy prefixes from names.

    A UI bug caused hierarchy paths like "Parent / Child" to be persisted as
    the fact sheet name.  This endpoint detects and fixes those entries by
    keeping only the last " / "-separated segment for any fact sheet that has
    a parent_id.
    """
    result = await db.execute(
        select(FactSheet).where(
            FactSheet.parent_id.isnot(None),
            FactSheet.name.contains(" / "),
            FactSheet.status == "ACTIVE",
        )
    )
    fixed: list[dict] = []
    for fs in result.scalars().all():
        leaf_name = fs.name.rsplit(" / ", 1)[-1]
        if leaf_name != fs.name:
            fixed.append({"id": str(fs.id), "old_name": fs.name, "new_name": leaf_name})
            fs.name = leaf_name
    await db.commit()
    return {"fixed": len(fixed), "details": fixed}


@router.get("/{fs_id}/history")
async def get_history(
    fs_id: str,
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(get_current_user),
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
):
    q = (
        select(Event)
        .where(Event.fact_sheet_id == uuid.UUID(fs_id))
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


@router.post("/{fs_id}/quality-seal")
async def update_quality_seal(
    fs_id: str,
    action: str = Query(..., pattern="^(approve|reject|reset)$"),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    fs_uuid = uuid.UUID(fs_id)
    if not await PermissionService.check_permission(db, user, "inventory.quality_seal", fs_uuid, "fs.quality_seal"):
        raise HTTPException(403, "Not enough permissions")
    result = await db.execute(select(FactSheet).where(FactSheet.id == fs_uuid))
    fs = result.scalar_one_or_none()
    if not fs:
        raise HTTPException(404, "Fact sheet not found")
    seal_map = {"approve": "APPROVED", "reject": "REJECTED", "reset": "DRAFT"}
    fs.quality_seal = seal_map[action]
    await event_bus.publish(
        f"fact_sheet.quality_seal.{action}",
        {"id": str(fs.id), "seal": fs.quality_seal},
        db=db, fact_sheet_id=fs.id, user_id=user.id,
    )

    # Notify subscribers about quality seal change
    action_label = {"approve": "approved", "reject": "rejected", "reset": "reset"}
    await notification_service.create_notifications_for_subscribers(
        db,
        fact_sheet_id=fs.id,
        notif_type="quality_seal_changed",
        title=f"Quality Seal {action_label[action].title()}",
        message=f'{user.display_name} {action_label[action]} the quality seal on "{fs.name}"',
        link=f"/fact-sheets/{fs_id}",
        data={"seal": fs.quality_seal, "action": action},
        actor_id=user.id,
    )

    await db.commit()
    return {"quality_seal": fs.quality_seal}


@router.get("/{fs_id}/my-permissions")
async def my_permissions(
    fs_id: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Return the current user's effective permissions on a specific fact sheet."""
    result = await db.execute(select(FactSheet).where(FactSheet.id == uuid.UUID(fs_id)))
    if not result.scalar_one_or_none():
        raise HTTPException(404, "Fact sheet not found")

    return await PermissionService.get_effective_fs_permissions(
        db, user, uuid.UUID(fs_id)
    )


@router.get("/export/csv")
async def export_csv(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
    type: str | None = Query(None),
):
    await PermissionService.require_permission(db, user, "inventory.export")
    q = select(FactSheet).where(FactSheet.status == "ACTIVE")
    if type:
        q = q.where(FactSheet.type == type)
    result = await db.execute(q)
    sheets = result.scalars().all()

    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(["id", "type", "name", "description", "status", "lifecycle", "attributes"])
    for fs in sheets:
        writer.writerow([
            str(fs.id), fs.type, fs.name, fs.description or "",
            fs.status, str(fs.lifecycle), str(fs.attributes),
        ])
    output.seek(0)
    return StreamingResponse(
        iter([output.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=fact_sheets.csv"},
    )
