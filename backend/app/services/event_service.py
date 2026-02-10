import uuid

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.event import Event, EventType


async def persist_event(
    db: AsyncSession,
    event_type: EventType,
    entity_type: str,
    entity_id: uuid.UUID,
    payload: dict,
    changes: dict | None = None,
    user_id: uuid.UUID | None = None,
) -> Event:
    event = Event(
        type=event_type,
        entity_type=entity_type,
        entity_id=entity_id,
        user_id=user_id,
        payload=payload,
        changes=changes,
    )
    db.add(event)
    await db.flush()
    return event


async def get_events(
    db: AsyncSession,
    entity_type: str | None = None,
    entity_id: uuid.UUID | None = None,
    event_type: EventType | None = None,
    limit: int = 50,
    offset: int = 0,
) -> tuple[list[Event], int]:
    query = select(Event)
    count_query = select(func.count(Event.id))

    if entity_type:
        query = query.where(Event.entity_type == entity_type)
        count_query = count_query.where(Event.entity_type == entity_type)
    if entity_id:
        query = query.where(Event.entity_id == entity_id)
        count_query = count_query.where(Event.entity_id == entity_id)
    if event_type:
        query = query.where(Event.type == event_type)
        count_query = count_query.where(Event.type == event_type)

    total = (await db.execute(count_query)).scalar_one()

    query = query.order_by(Event.created_at.desc()).offset(offset).limit(limit)
    result = await db.execute(query)
    events = list(result.scalars().all())

    return events, total
