from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.database import get_db
from app.models.soaw import SoAW
from app.models.user import User

router = APIRouter(prefix="/soaw", tags=["soaw"])


# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------

class SoAWCreate(BaseModel):
    name: str
    initiative_id: str | None = None
    status: str = "draft"
    document_info: dict | None = None
    version_history: list | None = None
    sections: dict | None = None


class SoAWUpdate(BaseModel):
    name: str | None = None
    initiative_id: str | None = None
    status: str | None = None
    document_info: dict | None = None
    version_history: list | None = None
    sections: dict | None = None


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _row_to_dict(s: SoAW) -> dict:
    return {
        "id": str(s.id),
        "name": s.name,
        "initiative_id": str(s.initiative_id) if s.initiative_id else None,
        "status": s.status,
        "document_info": s.document_info or {},
        "version_history": s.version_history or [],
        "sections": s.sections or {},
        "created_by": str(s.created_by) if s.created_by else None,
        "created_at": s.created_at.isoformat() if s.created_at else None,
        "updated_at": s.updated_at.isoformat() if s.updated_at else None,
    }


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@router.get("")
async def list_soaws(
    initiative_id: str | None = Query(None),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    stmt = select(SoAW).order_by(SoAW.updated_at.desc())
    if initiative_id:
        stmt = stmt.where(SoAW.initiative_id == uuid.UUID(initiative_id))
    result = await db.execute(stmt)
    rows = result.scalars().all()
    return [_row_to_dict(s) for s in rows]


@router.post("", status_code=201)
async def create_soaw(
    body: SoAWCreate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    s = SoAW(
        name=body.name,
        initiative_id=uuid.UUID(body.initiative_id) if body.initiative_id else None,
        status=body.status,
        document_info=body.document_info or {},
        version_history=body.version_history or [],
        sections=body.sections or {},
        created_by=user.id,
    )
    db.add(s)
    await db.commit()
    await db.refresh(s)
    return _row_to_dict(s)


@router.get("/{soaw_id}")
async def get_soaw(
    soaw_id: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    result = await db.execute(select(SoAW).where(SoAW.id == uuid.UUID(soaw_id)))
    s = result.scalar_one_or_none()
    if not s:
        raise HTTPException(404, "Statement of Architecture Work not found")
    return _row_to_dict(s)


@router.patch("/{soaw_id}")
async def update_soaw(
    soaw_id: str,
    body: SoAWUpdate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    result = await db.execute(select(SoAW).where(SoAW.id == uuid.UUID(soaw_id)))
    s = result.scalar_one_or_none()
    if not s:
        raise HTTPException(404, "Statement of Architecture Work not found")
    if body.name is not None:
        s.name = body.name
    if body.initiative_id is not None:
        s.initiative_id = uuid.UUID(body.initiative_id) if body.initiative_id else None
    if body.status is not None:
        s.status = body.status
    if body.document_info is not None:
        s.document_info = body.document_info
    if body.version_history is not None:
        s.version_history = body.version_history
    if body.sections is not None:
        s.sections = body.sections
    await db.commit()
    await db.refresh(s)
    return _row_to_dict(s)


@router.delete("/{soaw_id}", status_code=204)
async def delete_soaw(
    soaw_id: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    result = await db.execute(select(SoAW).where(SoAW.id == uuid.UUID(soaw_id)))
    s = result.scalar_one_or_none()
    if not s:
        raise HTTPException(404, "Statement of Architecture Work not found")
    await db.delete(s)
    await db.commit()
