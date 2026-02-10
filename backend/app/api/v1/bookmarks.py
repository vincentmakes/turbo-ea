from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.database import get_db
from app.models.bookmark import Bookmark
from app.models.user import User
from app.schemas.common import BookmarkCreate

router = APIRouter(prefix="/bookmarks", tags=["bookmarks"])


@router.get("")
async def list_bookmarks(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    result = await db.execute(
        select(Bookmark).where(Bookmark.user_id == user.id).order_by(Bookmark.created_at.desc())
    )
    return [
        {
            "id": str(b.id),
            "name": b.name,
            "fact_sheet_type": b.fact_sheet_type,
            "filters": b.filters,
            "columns": b.columns,
            "sort": b.sort,
            "is_default": b.is_default,
            "created_at": b.created_at.isoformat() if b.created_at else None,
        }
        for b in result.scalars().all()
    ]


@router.post("", status_code=201)
async def create_bookmark(
    body: BookmarkCreate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    bm = Bookmark(
        user_id=user.id,
        name=body.name,
        fact_sheet_type=body.fact_sheet_type,
        filters=body.filters,
        columns=body.columns,
        sort=body.sort,
        is_default=body.is_default,
    )
    db.add(bm)
    await db.commit()
    await db.refresh(bm)
    return {"id": str(bm.id), "name": bm.name}


@router.delete("/{bm_id}", status_code=204)
async def delete_bookmark(
    bm_id: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    result = await db.execute(
        select(Bookmark).where(Bookmark.id == uuid.UUID(bm_id), Bookmark.user_id == user.id)
    )
    bm = result.scalar_one_or_none()
    if not bm:
        raise HTTPException(404, "Bookmark not found")
    await db.delete(bm)
    await db.commit()
