from __future__ import annotations

import csv
import io
import uuid

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from sqlalchemy import func, select, or_
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.database import get_db
from app.models.fact_sheet import FactSheet
from app.models.event import Event
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
from app.services.event_bus import event_bus

router = APIRouter(prefix="/fact-sheets", tags=["fact-sheets"])


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


@router.get("", response_model=FactSheetListResponse)
async def list_fact_sheets(
    db: AsyncSession = Depends(get_db),
    type: str | None = Query(None),
    status: str | None = Query(None, alias="status"),
    search: str | None = Query(None),
    parent_id: str | None = Query(None),
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=500),
    sort_by: str = Query("name"),
    sort_dir: str = Query("asc"),
):
    q = select(FactSheet)
    count_q = select(func.count(FactSheet.id))

    if type:
        q = q.where(FactSheet.type == type)
        count_q = count_q.where(FactSheet.type == type)
    if status:
        q = q.where(FactSheet.status == status)
        count_q = count_q.where(FactSheet.status == status)
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

    # Sorting
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
    fs = FactSheet(
        type=body.type,
        name=body.name,
        description=body.description,
        parent_id=uuid.UUID(body.parent_id) if body.parent_id else None,
        lifecycle=body.lifecycle or {},
        attributes=body.attributes or {},
        external_id=body.external_id,
        alias=body.alias,
        created_by=user.id,
        updated_by=user.id,
    )
    db.add(fs)
    await db.flush()

    await event_bus.publish(
        "fact_sheet.created",
        {"id": str(fs.id), "type": fs.type, "name": fs.name},
        db=db, fact_sheet_id=fs.id, user_id=user.id,
    )
    await db.commit()
    await db.refresh(fs)
    return _fs_to_response(fs)


@router.get("/{fs_id}", response_model=FactSheetResponse)
async def get_fact_sheet(fs_id: str, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(FactSheet).where(FactSheet.id == uuid.UUID(fs_id)))
    fs = result.scalar_one_or_none()
    if not fs:
        raise HTTPException(404, "Fact sheet not found")
    return _fs_to_response(fs)


@router.patch("/{fs_id}", response_model=FactSheetResponse)
async def update_fact_sheet(
    fs_id: str,
    body: FactSheetUpdate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    result = await db.execute(select(FactSheet).where(FactSheet.id == uuid.UUID(fs_id)))
    fs = result.scalar_one_or_none()
    if not fs:
        raise HTTPException(404, "Fact sheet not found")

    changes = {}
    for field, value in body.model_dump(exclude_unset=True).items():
        if field == "parent_id" and value is not None:
            value = uuid.UUID(value)
        old = getattr(fs, field)
        if old != value:
            changes[field] = {"old": old, "new": value}
            setattr(fs, field, value)

    if changes:
        fs.updated_by = user.id
        # Break quality seal on edit (unless user is subscriber)
        if fs.quality_seal == "APPROVED":
            fs.quality_seal = "BROKEN"

        await event_bus.publish(
            "fact_sheet.updated",
            {"id": str(fs.id), "changes": {k: str(v) for k, v in changes.items()}},
            db=db, fact_sheet_id=fs.id, user_id=user.id,
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
    result = await db.execute(select(FactSheet).where(FactSheet.id == uuid.UUID(fs_id)))
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


@router.get("/{fs_id}/history")
async def get_history(
    fs_id: str,
    db: AsyncSession = Depends(get_db),
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
    action: str = Query(..., regex="^(approve|break)$"),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    result = await db.execute(select(FactSheet).where(FactSheet.id == uuid.UUID(fs_id)))
    fs = result.scalar_one_or_none()
    if not fs:
        raise HTTPException(404, "Fact sheet not found")
    fs.quality_seal = "APPROVED" if action == "approve" else "BROKEN"
    await event_bus.publish(
        f"fact_sheet.quality_seal.{action}",
        {"id": str(fs.id), "seal": fs.quality_seal},
        db=db, fact_sheet_id=fs.id, user_id=user.id,
    )
    await db.commit()
    return {"quality_seal": fs.quality_seal}


@router.get("/export/csv")
async def export_csv(
    db: AsyncSession = Depends(get_db),
    type: str | None = Query(None),
):
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
