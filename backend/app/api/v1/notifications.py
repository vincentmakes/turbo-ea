from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.api.deps import get_current_user
from app.database import get_db
from app.models.notification import Notification
from app.models.survey import SurveyResponse
from app.models.todo import Todo
from app.models.user import User
from app.services import notification_service
from app.services.permission_service import PermissionService

router = APIRouter(prefix="/notifications", tags=["notifications"])


def _notif_to_dict(n: Notification) -> dict:
    return {
        "id": str(n.id),
        "user_id": str(n.user_id),
        "type": n.type,
        "title": n.title,
        "message": n.message,
        "link": n.link,
        "is_read": n.is_read,
        "data": n.data or {},
        "card_id": str(n.card_id) if n.card_id else None,
        "actor_id": str(n.actor_id) if n.actor_id else None,
        "actor_name": n.actor.display_name if n.actor else None,
        "created_at": n.created_at.isoformat() if n.created_at else None,
    }


@router.get("")
async def list_notifications(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
    is_read: bool | None = Query(None),
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
):
    """List notifications for the current user."""
    await PermissionService.require_permission(db, user, "notifications.manage")
    q = (
        select(Notification)
        .where(Notification.user_id == user.id)
        .options(selectinload(Notification.actor))
        .order_by(Notification.created_at.desc())
    )
    if is_read is not None:
        q = q.where(Notification.is_read == is_read)

    # Count
    count_q = select(func.count(Notification.id)).where(Notification.user_id == user.id)
    if is_read is not None:
        count_q = count_q.where(Notification.is_read == is_read)
    total = (await db.execute(count_q)).scalar() or 0

    # Paginate
    q = q.offset((page - 1) * page_size).limit(page_size)
    result = await db.execute(q)
    items = [_notif_to_dict(n) for n in result.scalars().all()]

    return {"items": items, "total": total, "page": page, "page_size": page_size}


@router.get("/unread-count")
async def unread_count(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    await PermissionService.require_permission(db, user, "notifications.manage")
    count = await notification_service.get_unread_count(db, user.id)
    return {"count": count}


@router.get("/badge-counts")
async def badge_counts(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Return counts for nav-bar badge dots: open todos and pending surveys."""
    await PermissionService.require_permission(db, user, "notifications.manage")
    open_todos = (
        await db.execute(
            select(func.count(Todo.id)).where(
                Todo.status == "open",
                (Todo.assigned_to == user.id) | (Todo.created_by == user.id),
            )
        )
    ).scalar() or 0

    pending_surveys = (
        await db.execute(
            select(func.count(SurveyResponse.id)).where(
                SurveyResponse.user_id == user.id,
                SurveyResponse.status == "pending",
            )
        )
    ).scalar() or 0

    return {"open_todos": open_todos, "pending_surveys": pending_surveys}


@router.patch("/{notification_id}/read")
async def mark_read(
    notification_id: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    await PermissionService.require_permission(db, user, "notifications.manage")
    ok = await notification_service.mark_as_read(
        db, uuid.UUID(notification_id), user.id
    )
    if not ok:
        raise HTTPException(404, "Notification not found")
    await db.commit()
    return {"ok": True}


@router.post("/mark-all-read")
async def mark_all_read(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    await PermissionService.require_permission(db, user, "notifications.manage")
    count = await notification_service.mark_all_as_read(db, user.id)
    await db.commit()
    return {"marked": count}
