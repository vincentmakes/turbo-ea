from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.database import get_db
from app.models.notification import Notification
from app.models.user import User
from app.services import notification_service

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
        "fact_sheet_id": str(n.fact_sheet_id) if n.fact_sheet_id else None,
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
    q = (
        select(Notification)
        .where(Notification.user_id == user.id)
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
    count = await notification_service.get_unread_count(db, user.id)
    return {"count": count}


@router.patch("/{notification_id}/read")
async def mark_read(
    notification_id: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
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
    count = await notification_service.mark_all_as_read(db, user.id)
    await db.commit()
    return {"marked": count}
