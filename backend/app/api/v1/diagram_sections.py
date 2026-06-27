from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.database import get_db
from app.models.diagram_section import DiagramSection, diagram_section_members
from app.models.user import User
from app.services.permission_service import PermissionService

router = APIRouter(prefix="/diagram-sections", tags=["diagrams"])


class SectionCreate(BaseModel):
    name: str
    color: str | None = None
    sort_order: int | None = None


class SectionUpdate(BaseModel):
    name: str | None = None
    color: str | None = None
    sort_order: int | None = None


def _to_dict(s: DiagramSection, count: int) -> dict:
    return {
        "id": str(s.id),
        "name": s.name,
        "color": s.color,
        "sort_order": s.sort_order,
        "diagram_count": count,
        "created_at": s.created_at.isoformat() if s.created_at else None,
        "updated_at": s.updated_at.isoformat() if s.updated_at else None,
    }


@router.get("")
async def list_sections(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    await PermissionService.require_permission(db, user, "diagrams.view")
    result = await db.execute(
        select(DiagramSection).order_by(DiagramSection.sort_order, DiagramSection.name)
    )
    sections = list(result.scalars().all())

    # Per-section diagram counts in one query.
    count_rows = await db.execute(
        select(
            diagram_section_members.c.section_id,
            func.count(diagram_section_members.c.diagram_id),
        ).group_by(diagram_section_members.c.section_id)
    )
    counts = {str(sid): cnt for sid, cnt in count_rows.all()}

    return [_to_dict(s, counts.get(str(s.id), 0)) for s in sections]


@router.post("", status_code=201)
async def create_section(
    body: SectionCreate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    await PermissionService.require_permission(db, user, "diagrams.manage")
    if not body.name.strip():
        raise HTTPException(400, "name is required")
    s = DiagramSection(
        name=body.name.strip(),
        color=body.color,
        sort_order=body.sort_order or 0,
        created_by=user.id,
    )
    db.add(s)
    await db.commit()
    await db.refresh(s)
    return _to_dict(s, 0)


@router.patch("/{section_id}")
async def update_section(
    section_id: str,
    body: SectionUpdate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    await PermissionService.require_permission(db, user, "diagrams.manage")
    result = await db.execute(
        select(DiagramSection).where(DiagramSection.id == uuid.UUID(section_id))
    )
    s = result.scalar_one_or_none()
    if not s:
        raise HTTPException(404, "Section not found")
    if body.name is not None:
        if not body.name.strip():
            raise HTTPException(400, "name cannot be empty")
        s.name = body.name.strip()
    if body.color is not None:
        s.color = body.color
    if body.sort_order is not None:
        s.sort_order = body.sort_order
    await db.commit()
    await db.refresh(s)

    count = await db.scalar(
        select(func.count(diagram_section_members.c.diagram_id)).where(
            diagram_section_members.c.section_id == s.id
        )
    )
    return _to_dict(s, count or 0)


@router.delete("/{section_id}", status_code=204)
async def delete_section(
    section_id: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    await PermissionService.require_permission(db, user, "diagrams.manage")
    result = await db.execute(
        select(DiagramSection).where(DiagramSection.id == uuid.UUID(section_id))
    )
    s = result.scalar_one_or_none()
    if not s:
        raise HTTPException(404, "Section not found")
    # Membership rows cascade via FK ondelete=CASCADE.
    await db.delete(s)
    await db.commit()
