import uuid

from fastapi import APIRouter, Depends, Query, Request
from sqlalchemy.ext.asyncio import AsyncSession
from sse_starlette.sse import EventSourceResponse

from app.database import get_db
from app.models.event import EventType
from app.schemas.event import EventList
from app.services.event_bus import event_bus
from app.services.event_service import get_events

router = APIRouter()


@router.get("/stream")
async def event_stream(request: Request):
    """SSE endpoint for real-time event streaming to clients."""
    sub_id, queue = event_bus.subscribe()

    async def generate():
        async for data in event_bus.stream(sub_id, queue):
            if await request.is_disconnected():
                break
            yield data

    return EventSourceResponse(generate())


@router.get("", response_model=EventList)
async def list_events(
    entity_type: str | None = None,
    entity_id: uuid.UUID | None = None,
    event_type: EventType | None = None,
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    db: AsyncSession = Depends(get_db),
):
    items, total = await get_events(db, entity_type, entity_id, event_type, limit, offset)
    return EventList(items=items, total=total)
