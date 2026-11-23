from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.card import Card
from app.models.card_type import CardType


async def lock_type(db: AsyncSession, type_key: str, *, shared: bool = False) -> CardType:
    card_type = (
        await db.execute(
            select(CardType)
            .where(CardType.key == type_key)
            .with_for_update(read=shared)
            .execution_options(populate_existing=True)
        )
    ).scalar_one_or_none()
    if card_type is None:
        raise HTTPException(404, "Card type not found")
    return card_type


async def validate_stage(db: AsyncSession, type_key: str, stage: str | None) -> None:
    if stage is None:
        return
    card_type = await lock_type(db, type_key, shared=True)
    if stage not in {item["key"] for item in card_type.lifecycle_stages or []}:
        raise HTTPException(400, "Unknown lifecycle stage")


async def ensure_stages_available(db: AsyncSession, type_key: str, stages: list[dict]) -> CardType:
    card_type = await lock_type(db, type_key)
    keys = {stage["key"] for stage in stages}
    removed = {stage["key"] for stage in card_type.lifecycle_stages or []} - keys
    if removed:
        used = (
            await db.execute(
                select(Card.id)
                .where(Card.type == type_key, Card.lifecycle_stage.in_(removed))
                .limit(1)
            )
        ).first()
        if used:
            raise HTTPException(409, "Lifecycle stage is in use")
    return card_type


async def update_stages(
    db: AsyncSession, type_key: str, stages: list[dict]
) -> tuple[CardType, list[dict]]:
    card_type = await ensure_stages_available(db, type_key, stages)
    previous = card_type.lifecycle_stages or []
    card_type.lifecycle_stages = stages
    return card_type, previous
