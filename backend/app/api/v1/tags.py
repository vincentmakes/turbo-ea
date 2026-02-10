from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.database import get_db
from app.models.tag import FactSheetTag, Tag, TagGroup
from app.models.user import User
from app.schemas.common import TagCreate, TagGroupCreate

router = APIRouter(tags=["tags"])


@router.get("/tag-groups")
async def list_tag_groups(db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(TagGroup))
    groups = result.scalars().all()
    return [
        {
            "id": str(g.id),
            "name": g.name,
            "description": g.description,
            "mode": g.mode,
            "mandatory": g.mandatory,
            "tags": [
                {"id": str(t.id), "name": t.name, "color": t.color, "tag_group_id": str(t.tag_group_id)}
                for t in (g.tags or [])
            ],
        }
        for g in groups
    ]


@router.post("/tag-groups", status_code=201)
async def create_tag_group(
    body: TagGroupCreate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    group = TagGroup(name=body.name, description=body.description, mode=body.mode, mandatory=body.mandatory)
    db.add(group)
    await db.commit()
    await db.refresh(group)
    return {"id": str(group.id), "name": group.name}


@router.post("/tag-groups/{group_id}/tags", status_code=201)
async def create_tag(
    group_id: str,
    body: TagCreate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    tag = Tag(tag_group_id=uuid.UUID(group_id), name=body.name, color=body.color)
    db.add(tag)
    await db.commit()
    await db.refresh(tag)
    return {"id": str(tag.id), "name": tag.name, "color": tag.color}


@router.post("/fact-sheets/{fs_id}/tags", status_code=201)
async def assign_tags(
    fs_id: str,
    tag_ids: list[str],
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    for tid in tag_ids:
        existing = await db.execute(
            select(FactSheetTag).where(
                FactSheetTag.fact_sheet_id == uuid.UUID(fs_id),
                FactSheetTag.tag_id == uuid.UUID(tid),
            )
        )
        if not existing.scalar_one_or_none():
            db.add(FactSheetTag(fact_sheet_id=uuid.UUID(fs_id), tag_id=uuid.UUID(tid)))
    await db.commit()
    return {"status": "ok"}


@router.delete("/fact-sheets/{fs_id}/tags/{tag_id}", status_code=204)
async def remove_tag(
    fs_id: str,
    tag_id: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    result = await db.execute(
        select(FactSheetTag).where(
            FactSheetTag.fact_sheet_id == uuid.UUID(fs_id),
            FactSheetTag.tag_id == uuid.UUID(tag_id),
        )
    )
    fst = result.scalar_one_or_none()
    if fst:
        await db.delete(fst)
        await db.commit()
