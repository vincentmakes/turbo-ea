from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select, or_, delete
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.api.deps import get_current_user
from app.database import get_db
from app.models.custom_report import SavedReport, saved_report_shares
from app.models.user import User
from app.schemas.common import SavedReportCreate, SavedReportUpdate
from app.services.permission_service import PermissionService

router = APIRouter(prefix="/saved-reports", tags=["saved-reports"])

VALID_REPORT_TYPES = {
    "portfolio", "capability-map", "lifecycle", "dependencies",
    "cost", "matrix", "data-quality", "eol",
}


def _serialize(report: SavedReport, current_user_id: uuid.UUID) -> dict:
    shared_user_ids = [str(u.id) for u in (report.shared_with_users or [])]
    shared_user_names = [
        {"id": str(u.id), "display_name": u.display_name, "email": u.email}
        for u in (report.shared_with_users or [])
    ]
    return {
        "id": str(report.id),
        "owner_id": str(report.owner_id),
        "owner_name": report.owner.display_name if hasattr(report, "owner") and report.owner else None,
        "name": report.name,
        "description": report.description,
        "report_type": report.report_type,
        "config": report.config,
        "thumbnail": report.thumbnail,
        "visibility": report.visibility,
        "shared_with": shared_user_ids,
        "shared_with_users": shared_user_names,
        "is_owner": report.owner_id == current_user_id,
        "created_at": report.created_at.isoformat() if report.created_at else None,
        "updated_at": report.updated_at.isoformat() if report.updated_at else None,
    }


@router.get("")
async def list_saved_reports(
    filter: str = Query("all", regex="^(all|my|shared|public)$"),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """List saved reports visible to the current user."""
    base = select(SavedReport).options(
        selectinload(SavedReport.shared_with_users),
    )

    if filter == "my":
        stmt = base.where(SavedReport.owner_id == user.id)
    elif filter == "public":
        stmt = base.where(SavedReport.visibility == "public")
    elif filter == "shared":
        stmt = base.where(
            SavedReport.id.in_(
                select(saved_report_shares.c.saved_report_id).where(
                    saved_report_shares.c.user_id == user.id
                )
            )
        )
    else:
        # "all" — own + shared with me + public
        stmt = base.where(
            or_(
                SavedReport.owner_id == user.id,
                SavedReport.visibility == "public",
                SavedReport.id.in_(
                    select(saved_report_shares.c.saved_report_id).where(
                        saved_report_shares.c.user_id == user.id
                    )
                ),
            )
        )

    stmt = stmt.order_by(SavedReport.updated_at.desc())
    result = await db.execute(stmt)
    reports = result.scalars().unique().all()

    # Eagerly load owner names
    owner_ids = {r.owner_id for r in reports}
    owners = {}
    if owner_ids:
        owner_result = await db.execute(select(User).where(User.id.in_(owner_ids)))
        for u in owner_result.scalars().all():
            owners[u.id] = u
    for r in reports:
        r.owner = owners.get(r.owner_id)  # type: ignore[attr-defined]

    return [_serialize(r, user.id) for r in reports]


@router.post("", status_code=201)
async def create_saved_report(
    body: SavedReportCreate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    await PermissionService.require_permission(db, user, "saved_reports.create")

    if body.report_type not in VALID_REPORT_TYPES:
        raise HTTPException(400, f"Invalid report_type. Must be one of: {', '.join(sorted(VALID_REPORT_TYPES))}")
    if body.visibility not in ("private", "public", "shared"):
        raise HTTPException(400, "visibility must be private, public, or shared")

    report = SavedReport(
        owner_id=user.id,
        name=body.name,
        description=body.description,
        report_type=body.report_type,
        config=body.config,
        thumbnail=body.thumbnail,
        visibility=body.visibility,
    )
    db.add(report)
    await db.flush()

    # Handle shared users
    if body.shared_with and body.visibility == "shared":
        for uid_str in body.shared_with:
            try:
                uid = uuid.UUID(uid_str)
            except ValueError:
                continue
            await db.execute(
                saved_report_shares.insert().values(
                    saved_report_id=report.id, user_id=uid
                )
            )

    await db.commit()
    await db.refresh(report, ["shared_with_users"])
    report.owner = user  # type: ignore[attr-defined]
    return _serialize(report, user.id)


@router.get("/{report_id}")
async def get_saved_report(
    report_id: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    rid = uuid.UUID(report_id)
    result = await db.execute(
        select(SavedReport)
        .options(selectinload(SavedReport.shared_with_users))
        .where(SavedReport.id == rid)
    )
    report = result.scalar_one_or_none()
    if not report:
        raise HTTPException(404, "Saved report not found")

    # Access check
    is_owner = report.owner_id == user.id
    is_public = report.visibility == "public"
    is_shared = any(u.id == user.id for u in (report.shared_with_users or []))
    if not (is_owner or is_public or is_shared):
        raise HTTPException(403, "Access denied")

    # Load owner
    owner_result = await db.execute(select(User).where(User.id == report.owner_id))
    report.owner = owner_result.scalar_one_or_none()  # type: ignore[attr-defined]

    return _serialize(report, user.id)


@router.patch("/{report_id}")
async def update_saved_report(
    report_id: str,
    body: SavedReportUpdate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    rid = uuid.UUID(report_id)
    result = await db.execute(
        select(SavedReport)
        .options(selectinload(SavedReport.shared_with_users))
        .where(SavedReport.id == rid)
    )
    report = result.scalar_one_or_none()
    if not report:
        raise HTTPException(404, "Saved report not found")
    if report.owner_id != user.id:
        raise HTTPException(403, "Only the owner can update this report")

    data = body.model_dump(exclude_unset=True)

    if "visibility" in data and data["visibility"] not in ("private", "public", "shared"):
        raise HTTPException(400, "visibility must be private, public, or shared")

    shared_with = data.pop("shared_with", None)

    for field, value in data.items():
        setattr(report, field, value)

    # Update shares if provided
    if shared_with is not None:
        await db.execute(
            delete(saved_report_shares).where(
                saved_report_shares.c.saved_report_id == report.id
            )
        )
        if report.visibility == "shared" and shared_with:
            for uid_str in shared_with:
                try:
                    uid = uuid.UUID(uid_str)
                except ValueError:
                    continue
                await db.execute(
                    saved_report_shares.insert().values(
                        saved_report_id=report.id, user_id=uid
                    )
                )

    await db.commit()
    await db.refresh(report, ["shared_with_users"])
    report.owner = user  # type: ignore[attr-defined]
    return _serialize(report, user.id)


@router.delete("/{report_id}", status_code=204)
async def delete_saved_report(
    report_id: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    rid = uuid.UUID(report_id)
    result = await db.execute(
        select(SavedReport).where(SavedReport.id == rid)
    )
    report = result.scalar_one_or_none()
    if not report:
        raise HTTPException(404, "Saved report not found")
    if report.owner_id != user.id:
        raise HTTPException(403, "Only the owner can delete this report")

    await db.delete(report)
    await db.commit()
