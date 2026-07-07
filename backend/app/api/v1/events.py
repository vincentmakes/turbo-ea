from __future__ import annotations

import json
import uuid
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import StreamingResponse
from sqlalchemy import select, union
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.api.deps import get_current_user
from app.core.security import decode_access_token
from app.database import get_db
from app.models.card import Card
from app.models.event import Event
from app.models.stakeholder import Stakeholder
from app.models.user import User
from app.models.user_favorite import UserFavorite
from app.services.event_bus import event_bus
from app.services.permission_service import PermissionService

router = APIRouter(prefix="/events", tags=["events"])


def _event_visible_to(is_events_admin: bool, message: dict[str, Any], user_id: str) -> bool:
    """Decide whether an event-bus message may be sent to a given subscriber.

    The event bus is a single global stream carrying every event, including
    audit-sensitive ones — card/relation writes, and `ops.*` break-glass events
    whose payload holds operator emails. The `GET /events` history read is
    gated by `admin.events`, so the live SSE stream must not be a wider hole:

    - `admin.events` holders get the full stream (they can read the same data
      via the history endpoint anyway).
    - Everyone else gets only *user-directed* events — those whose payload
      carries their own `user_id`. In practice that is `notification.created`
      (the driver behind the notification bell and badge refresh), which stamps
      `data.user_id` = recipient. Card / relation / risk / ops events carry no
      matching `user_id` and are therefore withheld from non-admins.
    """
    if is_events_admin:
        return True
    data = message.get("data")
    if not isinstance(data, dict):
        return False
    return str(data.get("user_id")) == str(user_id)


@router.get("/stream")
async def event_stream(
    request: Request, token: str = Query(""), db: AsyncSession = Depends(get_db)
):
    """SSE endpoint. Accepts token via query parameter or httpOnly cookie.

    Events are filtered per subscriber: `admin.events` holders receive the full
    audit stream, everyone else only their own user-directed events (see
    `_event_visible_to`).
    """
    effective_token = token or request.cookies.get("access_token", "")
    if not effective_token:
        raise HTTPException(status_code=401, detail="Not authenticated")
    payload = decode_access_token(effective_token)
    if payload is None:
        raise HTTPException(status_code=401, detail="Invalid or expired token")

    # Resolve the real user so inactive / time-boxed (rescue) accounts are
    # rejected on the live stream too, mirroring get_current_user.
    result = await db.execute(select(User).where(User.id == uuid.UUID(payload.get("sub"))))
    user = result.scalar_one_or_none()
    if user is None or not user.is_active:
        raise HTTPException(status_code=401, detail="User not found or inactive")
    if user.access_expires_at is not None and user.access_expires_at < datetime.now(timezone.utc):
        raise HTTPException(status_code=401, detail="Account access has expired")

    is_events_admin = await PermissionService.has_app_permission(db, user, "admin.events")
    user_id = str(user.id)

    async def generate():
        async for message in event_bus.subscribe():
            if await request.is_disconnected():
                break
            if _event_visible_to(is_events_admin, message, user_id):
                yield f"data: {json.dumps(message, default=str)}\n\n"

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@router.get("/my-cards")
async def list_my_card_events(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
    limit: int = Query(20, ge=1, le=50),
):
    """Recent events on cards the current user is a stakeholder on or has favorited.

    Used by the Dashboard → My Workspace tab. The shape mirrors
    ``/reports/dashboard``'s ``recent_events`` so the frontend can reuse
    the existing ``RecentActivity`` component verbatim.
    """
    favorite_cards = select(UserFavorite.card_id).where(UserFavorite.user_id == user.id)
    stakeholder_cards = select(Stakeholder.card_id).where(Stakeholder.user_id == user.id).distinct()
    relevant_card_ids = union(favorite_cards, stakeholder_cards).subquery()

    q = (
        select(Event)
        .options(selectinload(Event.user))
        .where(Event.card_id.in_(select(relevant_card_ids.c.card_id)))
        .order_by(Event.created_at.desc())
        .limit(limit)
    )
    events_list = list((await db.execute(q)).scalars().all())

    referenced_card_ids = {e.card_id for e in events_list if e.card_id is not None}
    name_by_card_id: dict = {}
    if referenced_card_ids:
        card_rows = await db.execute(
            select(Card.id, Card.name).where(Card.id.in_(referenced_card_ids))
        )
        name_by_card_id = {cid: name for cid, name in card_rows.all()}

    def _resolve_name(e: Event) -> str | None:
        data_name = (e.data or {}).get("name") if isinstance(e.data, dict) else None
        if isinstance(data_name, str) and data_name:
            return data_name
        if e.card_id is not None:
            return name_by_card_id.get(e.card_id)
        return None

    return [
        {
            "id": str(e.id),
            "card_id": str(e.card_id) if e.card_id else None,
            "card_name": _resolve_name(e),
            "event_type": e.event_type,
            "data": e.data,
            "user_display_name": e.user.display_name if e.user else None,
            "created_at": e.created_at.isoformat() if e.created_at else None,
        }
        for e in events_list
    ]


@router.get("")
async def list_events(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
    card_id: str | None = Query(None),
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
):
    await PermissionService.require_permission(db, user, "admin.events")
    q = select(Event).options(selectinload(Event.user)).order_by(Event.created_at.desc())
    if card_id:
        import uuid as _uuid

        q = q.where(Event.card_id == _uuid.UUID(card_id))
    q = q.offset((page - 1) * page_size).limit(page_size)
    result = await db.execute(q)
    return [
        {
            "id": str(e.id),
            "card_id": str(e.card_id) if e.card_id else None,
            "event_type": e.event_type,
            "data": e.data,
            "user_id": str(e.user_id) if e.user_id else None,
            "user_display_name": e.user.display_name if e.user else None,
            "created_at": e.created_at.isoformat() if e.created_at else None,
        }
        for e in result.scalars().all()
    ]
