from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.api.deps import get_current_user
from app.database import get_db
from app.models.tag import CardTag, Tag, TagGroup
from app.models.user import User
from app.schemas.common import TagCreate, TagGroupCreate
from app.services.permission_service import PermissionService

router = APIRouter(tags=["tags"])


@router.get("/tag-groups")
async def list_tag_groups(db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(TagGroup).options(selectinload(TagGroup.tags)))
    groups = result.scalars().all()
    return [
        {
            "id": str(g.id),
            "name": g.name,
            "description": g.description,
            "mode": g.mode,
            "mandatory": g.mandatory,
            "tags": [
                {
                    "id": str(t.id),
                    "name": t.name,
                    "color": t.color,
                    "tag_group_id": str(t.tag_group_id),
                }
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
    await PermissionService.require_permission(db, user, "tags.manage")
    group = TagGroup(
        name=body.name, description=body.description, mode=body.mode, mandatory=body.mandatory
    )
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
    await PermissionService.require_permission(db, user, "tags.manage")
    tag = Tag(tag_group_id=uuid.UUID(group_id), name=body.name, color=body.color)
    db.add(tag)
    await db.commit()
    await db.refresh(tag)
    return {"id": str(tag.id), "name": tag.name, "color": tag.color}


@router.post("/cards/{card_id}/tags", status_code=201)
async def assign_tags(
    card_id: str,
    tag_ids: list[str],
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    await PermissionService.require_permission(db, user, "tags.manage")
    for tid in tag_ids:
        existing = await db.execute(
            select(CardTag).where(
                CardTag.card_id == uuid.UUID(card_id),
                CardTag.tag_id == uuid.UUID(tid),
            )
        )
        if not existing.scalar_one_or_none():
            db.add(CardTag(card_id=uuid.UUID(card_id), tag_id=uuid.UUID(tid)))
    await db.commit()
    return {"status": "ok"}


@router.delete("/cards/{card_id}/tags/{tag_id}", status_code=204)
async def remove_tag(
    card_id: str,
    tag_id: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    await PermissionService.require_permission(db, user, "tags.manage")
    result = await db.execute(
        select(CardTag).where(
            CardTag.card_id == uuid.UUID(card_id),
            CardTag.tag_id == uuid.UUID(tag_id),
        )
    )
    fst = result.scalar_one_or_none()
    if fst:
        await db.delete(fst)
        await db.commit()
