from __future__ import annotations

import asyncio
import json
import uuid
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy import select, union
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.api.deps import get_current_user
from app.core.security import decode_access_token
from app.database import async_session, get_db
from app.models.card import Card
from app.models.event import Event
from app.models.stakeholder import Stakeholder
from app.models.user import User
from app.models.user_favorite import UserFavorite
from app.services import card_watch, mcp_session_service
from app.services.card_read_scope import (
    CardReadScope,
    card_detail_readable_ids,
    event_read_filters,
    scrub_event_payloads,
)
from app.services.document_event_scope import document_event_read_filters
from app.services.event_bus import event_bus
from app.services.event_cost_scrub import scrub_event_costs
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
async def event_stream(request: Request, token: str = Query("")):
    """SSE endpoint. Accepts token via query parameter or httpOnly cookie.

    Events are filtered per subscriber: `admin.events` holders receive the full
    audit stream, everyone else only their own user-directed events (see
    `_event_visible_to`).
    """
    # A streaming endpoint must never hold a request-scoped session. This route
    # deliberately does *not* take `Depends(get_db)`: a yield-dependency is only
    # unwound once the response completes, and an SSE response completes when
    # the browser tab closes. Holding the session across the stream leaves its
    # pooled connection checked out — `idle in transaction` — for the tab's
    # lifetime, so every open tab permanently consumed one of the engine's
    # connections and a few dozen tabs exhausted the pool (and, on a managed
    # Postgres with a low connection cap, the database's own limit — see
    # discussion #901). The auth and permission lookups below therefore run in
    # an explicit short-lived session, closed before streaming starts;
    # `generate()` itself touches no database.
    effective_token = token or request.cookies.get("access_token", "")
    if not effective_token:
        raise HTTPException(status_code=401, detail="Not authenticated")
    payload = decode_access_token(effective_token)
    if payload is None:
        raise HTTPException(status_code=401, detail="Invalid or expired token")

    async with async_session() as db:
        # Resolve the real user so inactive / time-boxed (rescue) accounts are
        # rejected on the live stream too, mirroring get_current_user.
        result = await db.execute(select(User).where(User.id == uuid.UUID(payload.get("sub"))))
        user = result.scalar_one_or_none()
        if user is None or not user.is_active:
            raise HTTPException(status_code=401, detail="User not found or inactive")
        if user.access_expires_at is not None and user.access_expires_at < datetime.now(
            timezone.utc
        ):
            raise HTTPException(status_code=401, detail="Account access has expired")
        # Mirrors get_current_user: a token of an ended MCP connection is no token.
        if not await mcp_session_service.token_session_is_live(db, payload):
            raise HTTPException(status_code=401, detail="MCP connection ended")

        is_events_admin = await PermissionService.has_app_permission(db, user, "admin.events")
        user_id = str(user.id)
    # Session closed: its connection is back in the pool before the stream opens.

    async def generate():
        # One queue per connection: the bus fans out into it, and the
        # live-update registry writes this stream's hello and card pings into
        # it. The hello goes in first, so the bus subscription is in place
        # before the browser learns its stream id and registers any watch.
        inbox: asyncio.Queue = asyncio.Queue(maxsize=256)
        stream_id = card_watch.open_stream(user_id, inbox)
        inbox.put_nowait(card_watch.hello(stream_id))
        try:
            async for message in event_bus.subscribe(inbox=inbox):
                if await request.is_disconnected():
                    break
                if isinstance(message, card_watch.StreamMessage):
                    # The hello, or a ping already reduced to {event, card_id,
                    # timestamp} and queued only for a card this user could
                    # read when watching it.
                    if isinstance(message, card_watch.CardChangedPing):
                        card_watch.mark_forwarded(stream_id, message["card_id"])
                    yield f"data: {json.dumps(message)}\n\n"
                elif _event_visible_to(is_events_admin, message, user_id):
                    yield f"data: {json.dumps(message, default=str)}\n\n"
        finally:
            card_watch.close_stream(stream_id)

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


class StreamWatchRequest(BaseModel):
    card_ids: list[uuid.UUID] = Field(default_factory=list, max_length=card_watch.MAX_WATCHED_CARDS)


class StreamWatchResponse(BaseModel):
    card_ids: list[str]
    expires_in: int


@router.put("/stream/{stream_id}/watch", response_model=StreamWatchResponse)
async def watch_stream_cards(
    stream_id: str,
    body: StreamWatchRequest,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> StreamWatchResponse:
    """Choose the cards whose changes this stream is told about (live updates).

    Replaces the stream's watch set; calling it again refreshes the expiry
    (``expires_in`` seconds). A card is accepted only when the caller may open
    it through ``GET /cards/{id}`` (``card_detail_readable_ids`` — the same
    read gate); any other id, an unknown one included, is simply left out of
    the answer. The stream then receives only
    ``{"event": "event.stream.card_changed", "card_id", "timestamp"}`` — see
    ``app/services/card_watch.py``. 404 for a stream that is not the caller's.
    """
    if not card_watch.owns_stream(stream_id, user.id):
        raise HTTPException(404, "Stream not found")
    readable = await card_detail_readable_ids(db, user, body.card_ids)
    accepted = card_watch.set_watch(stream_id, user.id, readable)
    if accepted is None:
        # The stream closed while the read checks ran.
        raise HTTPException(404, "Stream not found")
    return StreamWatchResponse(
        card_ids=[str(cid) for cid in accepted],
        expires_in=card_watch.WATCH_TTL_SECONDS,
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
        # Same activity-feed rule as the dashboard's: no event about a card,
        # or naming a peer, hidden from the reader.
        .where(*event_read_filters(await CardReadScope.load(db, user)))
        # A decision linked to the card names the decision: shown only to a
        # reader who may open it.
        .where(*await document_event_read_filters(db, user))
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

    payloads = await scrub_event_payloads(
        db, await CardReadScope.load(db, user), [e.data for e in events_list]
    )
    payloads = await scrub_event_costs(
        db, user, [(e.card_id, data) for e, data in zip(events_list, payloads)]
    )
    return [
        {
            "id": str(e.id),
            "card_id": str(e.card_id) if e.card_id else None,
            "card_name": _resolve_name(e),
            "event_type": e.event_type,
            "data": data,
            "user_display_name": e.user.display_name if e.user else None,
            "created_at": e.created_at.isoformat() if e.created_at else None,
        }
        for e, data in zip(events_list, payloads)
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
