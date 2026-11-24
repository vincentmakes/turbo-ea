"""Administration of the Initiative Timeline date mapping."""

from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.database import get_db
from app.models.user import User
from app.schemas.ppm_timeline import PmlTimelineMapping, PmlTimelineUpdate
from app.services.permission_service import PermissionService
from app.services.ppm_timeline import (
    load_timeline_mapping,
    save_timeline_mapping,
)

router = APIRouter(prefix="/pml/timeline", tags=["settings"])


@router.get("", response_model=PmlTimelineMapping)
async def get_timeline(
    db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)
) -> PmlTimelineMapping:
    await PermissionService.require_permission(db, user, "admin.settings")
    return await load_timeline_mapping(db)


@router.put("", response_model=PmlTimelineMapping)
async def put_timeline(
    body: PmlTimelineUpdate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> PmlTimelineMapping:
    await PermissionService.require_permission(db, user, "admin.settings")
    if body.create_defaults:
        await PermissionService.require_permission(db, user, "admin.metamodel")
    candidate = await save_timeline_mapping(db, body)
    await db.commit()
    return candidate
