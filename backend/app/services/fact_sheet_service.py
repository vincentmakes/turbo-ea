import uuid

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.event import EventType
from app.models.fact_sheet import FactSheet, FactSheetStatus, FactSheetType
from app.schemas.fact_sheet import FactSheetCreate, FactSheetUpdate
from app.services.event_bus import event_bus
from app.services.event_service import persist_event


async def create_fact_sheet(
    db: AsyncSession,
    data: FactSheetCreate,
    user_id: uuid.UUID | None = None,
) -> FactSheet:
    fs = FactSheet(
        name=data.name,
        type=data.type,
        description=data.description,
        display_name=data.display_name,
        alias=data.alias,
        external_id=data.external_id,
        parent_id=data.parent_id,
        lifecycle=data.lifecycle,
        attributes=data.attributes or {},
    )
    db.add(fs)
    await db.flush()

    payload = {
        "id": str(fs.id),
        "name": fs.name,
        "type": fs.type.value,
        "status": fs.status.value,
    }

    await persist_event(db, EventType.FACT_SHEET_CREATED, "fact_sheet", fs.id, payload, user_id=user_id)
    await event_bus.publish(EventType.FACT_SHEET_CREATED, "fact_sheet", fs.id, payload, user_id=user_id)

    return fs


async def get_fact_sheet(db: AsyncSession, fs_id: uuid.UUID) -> FactSheet | None:
    result = await db.execute(select(FactSheet).where(FactSheet.id == fs_id))
    return result.scalar_one_or_none()


async def list_fact_sheets(
    db: AsyncSession,
    fs_type: FactSheetType | None = None,
    status: FactSheetStatus | None = None,
    parent_id: uuid.UUID | None = None,
    search: str | None = None,
    page: int = 1,
    page_size: int = 50,
) -> tuple[list[FactSheet], int]:
    query = select(FactSheet)
    count_query = select(func.count(FactSheet.id))

    if fs_type:
        query = query.where(FactSheet.type == fs_type)
        count_query = count_query.where(FactSheet.type == fs_type)
    if status:
        query = query.where(FactSheet.status == status)
        count_query = count_query.where(FactSheet.status == status)
    else:
        query = query.where(FactSheet.status == FactSheetStatus.ACTIVE)
        count_query = count_query.where(FactSheet.status == FactSheetStatus.ACTIVE)
    if parent_id:
        query = query.where(FactSheet.parent_id == parent_id)
        count_query = count_query.where(FactSheet.parent_id == parent_id)
    if search:
        pattern = f"%{search}%"
        query = query.where(FactSheet.name.ilike(pattern))
        count_query = count_query.where(FactSheet.name.ilike(pattern))

    total = (await db.execute(count_query)).scalar_one()

    offset = (page - 1) * page_size
    query = query.order_by(FactSheet.name).offset(offset).limit(page_size)
    result = await db.execute(query)
    items = list(result.scalars().all())

    return items, total


async def update_fact_sheet(
    db: AsyncSession,
    fs: FactSheet,
    data: FactSheetUpdate,
    user_id: uuid.UUID | None = None,
) -> FactSheet:
    changes = {}
    update_data = data.model_dump(exclude_unset=True)

    for field, value in update_data.items():
        old_value = getattr(fs, field)
        if old_value != value:
            changes[field] = {"old": old_value, "new": value}
            setattr(fs, field, value)

    if changes:
        await db.flush()

        payload = {
            "id": str(fs.id),
            "name": fs.name,
            "type": fs.type.value,
            "status": fs.status.value,
        }

        event_type = EventType.FACT_SHEET_ARCHIVED if data.status == FactSheetStatus.ARCHIVED else EventType.FACT_SHEET_UPDATED

        # Serialize changes for JSON storage
        serialized_changes = {}
        for k, v in changes.items():
            serialized_changes[k] = {
                "old": v["old"].value if hasattr(v["old"], "value") else v["old"],
                "new": v["new"].value if hasattr(v["new"], "value") else v["new"],
            }

        await persist_event(db, event_type, "fact_sheet", fs.id, payload, serialized_changes, user_id)
        await event_bus.publish(event_type, "fact_sheet", fs.id, payload, serialized_changes, user_id)

    return fs


async def delete_fact_sheet(
    db: AsyncSession,
    fs: FactSheet,
    user_id: uuid.UUID | None = None,
) -> None:
    payload = {
        "id": str(fs.id),
        "name": fs.name,
        "type": fs.type.value,
    }

    await persist_event(db, EventType.FACT_SHEET_DELETED, "fact_sheet", fs.id, payload, user_id=user_id)
    await event_bus.publish(EventType.FACT_SHEET_DELETED, "fact_sheet", fs.id, payload, user_id=user_id)

    await db.delete(fs)
    await db.flush()
