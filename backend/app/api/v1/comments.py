from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.database import get_db
from app.models.comment import Comment
from app.models.card import Card
from app.models.user import User
from app.schemas.common import CommentCreate, CommentUpdate
from app.services import notification_service
from app.services.event_bus import event_bus
from app.services.permission_service import PermissionService

router = APIRouter(tags=["comments"])


@router.get("/cards/{card_id}/comments")
async def list_comments(
    card_id: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    await PermissionService.require_permission(db, user, "comments.view")
    result = await db.execute(
        select(Comment)
        .where(Comment.card_id == uuid.UUID(card_id), Comment.parent_id.is_(None))
        .order_by(Comment.created_at.desc())
    )
    return [_comment_to_dict(c) for c in result.scalars().all()]


def _comment_to_dict(c: Comment) -> dict:
    return {
        "id": str(c.id),
        "card_id": str(c.card_id),
        "user_id": str(c.user_id),
        "user_display_name": c.user.display_name if c.user else None,
        "content": c.content,
        "parent_id": str(c.parent_id) if c.parent_id else None,
        "created_at": c.created_at.isoformat() if c.created_at else None,
        "updated_at": c.updated_at.isoformat() if c.updated_at else None,
        "replies": [_comment_to_dict(r) for r in (c.replies or [])],
    }


@router.post("/cards/{card_id}/comments", status_code=201)
async def create_comment(
    card_id: str,
    body: CommentCreate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    card_uuid = uuid.UUID(card_id)
    if not await PermissionService.check_permission(
        db, user, "comments.create", card_uuid, "card.create_comments"
    ):
        raise HTTPException(403, "Not enough permissions")
    comment = Comment(
        card_id=card_uuid,
        user_id=user.id,
        content=body.content,
        parent_id=uuid.UUID(body.parent_id) if body.parent_id else None,
    )
    db.add(comment)
    await db.flush()
    await event_bus.publish(
        "comment.created",
        {"id": str(comment.id), "content": comment.content[:100]},
        db=db, card_id=uuid.UUID(card_id), user_id=user.id,
    )

    # Notify subscribers of the card
    card_result = await db.execute(select(Card).where(Card.id == uuid.UUID(card_id)))
    card = card_result.scalar_one_or_none()
    card_name = card.name if card else "Unknown"
    await notification_service.create_notifications_for_subscribers(
        db,
        card_id=uuid.UUID(card_id),
        notif_type="comment_added",
        title="New Comment",
        message=f'{user.display_name} commented on "{card_name}": {comment.content[:80]}',
        link=f"/cards/{card_id}",
        data={"comment_id": str(comment.id)},
        actor_id=user.id,
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
    # Allow own comment edit, or require manage permission
    if comment.user_id != user.id:
        if not await PermissionService.check_permission(
            db, user, "comments.manage", comment.card_id, "card.manage_comments"
        ):
            raise HTTPException(403, "Not enough permissions")
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
    # Allow own comment delete, or require manage permission
    if comment.user_id != user.id:
        if not await PermissionService.check_permission(
            db, user, "comments.manage", comment.card_id, "card.manage_comments"
        ):
            raise HTTPException(403, "Not enough permissions")
    await db.delete(comment)
    await db.commit()
