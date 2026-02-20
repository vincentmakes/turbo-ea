from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import StreamingResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.core.security import decode_access_token
from app.database import get_db
from app.models.event import Event
from app.models.user import User
from app.services.event_bus import event_bus
from app.services.permission_service import PermissionService

router = APIRouter(prefix="/events", tags=["events"])


@router.get("/stream")
async def event_stream(request: Request, token: str = Query(...)):
    """SSE endpoint. Accepts token via query parameter because EventSource cannot set headers."""
    payload = decode_access_token(token)
    if payload is None:
        raise HTTPException(status_code=401, detail="Invalid or expired token")
    async def generate():
        async for data in event_bus.subscribe():
            if await request.is_disconnected():
                break
            yield data

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@router.get("")
async def list_events(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
    card_id: str | None = Query(None),
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
):
    await PermissionService.require_permission(db, user, "admin.events")
    q = select(Event).order_by(Event.created_at.desc())
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
