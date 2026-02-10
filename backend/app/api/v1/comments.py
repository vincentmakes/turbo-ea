from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.database import get_db
from app.models.comment import Comment
from app.models.user import User
from app.schemas.common import CommentCreate, CommentUpdate
from app.services.event_bus import event_bus

router = APIRouter(tags=["comments"])


@router.get("/fact-sheets/{fs_id}/comments")
async def list_comments(fs_id: str, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(Comment)
        .where(Comment.fact_sheet_id == uuid.UUID(fs_id), Comment.parent_id.is_(None))
        .order_by(Comment.created_at.desc())
    )
    comments = result.scalars().all()
    return [_comment_to_dict(c) for c in comments]


def _comment_to_dict(c: Comment) -> dict:
    return {
        "id": str(c.id),
        "fact_sheet_id": str(c.fact_sheet_id),
        "user_id": str(c.user_id),
        "user_display_name": c.user.display_name if c.user else None,
        "content": c.content,
        "parent_id": str(c.parent_id) if c.parent_id else None,
        "created_at": c.created_at.isoformat() if c.created_at else None,
        "updated_at": c.updated_at.isoformat() if c.updated_at else None,
        "replies": [_comment_to_dict(r) for r in (c.replies or [])],
    }


@router.post("/fact-sheets/{fs_id}/comments", status_code=201)
async def create_comment(
    fs_id: str,
    body: CommentCreate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    comment = Comment(
        fact_sheet_id=uuid.UUID(fs_id),
        user_id=user.id,
        content=body.content,
        parent_id=uuid.UUID(body.parent_id) if body.parent_id else None,
    )
    db.add(comment)
    await db.flush()
    await event_bus.publish(
        "comment.created",
        {"id": str(comment.id), "content": comment.content[:100]},
        db=db, fact_sheet_id=uuid.UUID(fs_id), user_id=user.id,
    )
    await db.commit()
    await db.refresh(comment)
    return _comment_to_dict(comment)


@router.patch("/comments/{comment_id}")
async def update_comment(
    comment_id: str,
    body: CommentUpdate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    result = await db.execute(select(Comment).where(Comment.id == uuid.UUID(comment_id)))
    comment = result.scalar_one_or_none()
    if not comment:
        raise HTTPException(404, "Comment not found")
    comment.content = body.content
    await db.commit()
    await db.refresh(comment)
    return _comment_to_dict(comment)


@router.delete("/comments/{comment_id}", status_code=204)
async def delete_comment(
    comment_id: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    result = await db.execute(select(Comment).where(Comment.id == uuid.UUID(comment_id)))
    comment = result.scalar_one_or_none()
    if not comment:
        raise HTTPException(404, "Comment not found")
    await db.delete(comment)
    await db.commit()
