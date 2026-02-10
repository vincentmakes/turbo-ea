import uuid

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.event import EventType
from app.models.relation import Relation, RelationType
from app.schemas.relation import RelationCreate, RelationUpdate
from app.services.event_bus import event_bus
from app.services.event_service import persist_event


async def create_relation(
    db: AsyncSession,
    data: RelationCreate,
    user_id: uuid.UUID | None = None,
) -> Relation:
    rel = Relation(
        type=data.type,
        from_fact_sheet_id=data.from_fact_sheet_id,
        to_fact_sheet_id=data.to_fact_sheet_id,
        description=data.description,
        active_from=data.active_from,
        active_until=data.active_until,
        attributes=data.attributes or {},
    )
    db.add(rel)
    await db.flush()

    payload = {
        "id": str(rel.id),
        "type": rel.type.value,
        "from_fact_sheet_id": str(rel.from_fact_sheet_id),
        "to_fact_sheet_id": str(rel.to_fact_sheet_id),
    }

    await persist_event(db, EventType.RELATION_CREATED, "relation", rel.id, payload, user_id=user_id)
    await event_bus.publish(EventType.RELATION_CREATED, "relation", rel.id, payload, user_id=user_id)

    return rel


async def get_relation(db: AsyncSession, rel_id: uuid.UUID) -> Relation | None:
    result = await db.execute(select(Relation).where(Relation.id == rel_id))
    return result.scalar_one_or_none()


async def list_relations(
    db: AsyncSession,
    fact_sheet_id: uuid.UUID | None = None,
    rel_type: RelationType | None = None,
    limit: int = 100,
    offset: int = 0,
) -> tuple[list[Relation], int]:
    query = select(Relation)
    count_query = select(func.count(Relation.id))

    if fact_sheet_id:
        condition = (Relation.from_fact_sheet_id == fact_sheet_id) | (
            Relation.to_fact_sheet_id == fact_sheet_id
        )
        query = query.where(condition)
        count_query = count_query.where(condition)
    if rel_type:
        query = query.where(Relation.type == rel_type)
        count_query = count_query.where(Relation.type == rel_type)

    total = (await db.execute(count_query)).scalar_one()
    query = query.order_by(Relation.created_at.desc()).offset(offset).limit(limit)
    result = await db.execute(query)
    items = list(result.scalars().all())

    return items, total


async def update_relation(
    db: AsyncSession,
    rel: Relation,
    data: RelationUpdate,
    user_id: uuid.UUID | None = None,
) -> Relation:
    changes = {}
    update_data = data.model_dump(exclude_unset=True)

    for field, value in update_data.items():
        old_value = getattr(rel, field)
        if old_value != value:
            changes[field] = {"old": str(old_value), "new": str(value)}
            setattr(rel, field, value)

    if changes:
        await db.flush()

        payload = {
            "id": str(rel.id),
            "type": rel.type.value,
            "from_fact_sheet_id": str(rel.from_fact_sheet_id),
            "to_fact_sheet_id": str(rel.to_fact_sheet_id),
        }

        await persist_event(db, EventType.RELATION_UPDATED, "relation", rel.id, payload, changes, user_id)
        await event_bus.publish(EventType.RELATION_UPDATED, "relation", rel.id, payload, changes, user_id)

    return rel


async def delete_relation(
    db: AsyncSession,
    rel: Relation,
    user_id: uuid.UUID | None = None,
) -> None:
    payload = {
        "id": str(rel.id),
        "type": rel.type.value,
        "from_fact_sheet_id": str(rel.from_fact_sheet_id),
        "to_fact_sheet_id": str(rel.to_fact_sheet_id),
    }

    await persist_event(db, EventType.RELATION_DELETED, "relation", rel.id, payload, user_id=user_id)
    await event_bus.publish(EventType.RELATION_DELETED, "relation", rel.id, payload, user_id=user_id)

    await db.delete(rel)
    await db.flush()
