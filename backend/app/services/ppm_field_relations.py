"""Write configured PML card relations in the financial transaction."""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from typing import Any

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.card import Card
from app.models.relation_type import RelationType
from app.models.user import User
from app.schemas.ppm_fields import PmlSectionConfig
from app.services.card_read_scope import is_card_readable
from app.services.card_write_service import (
    WriteActor,
    find_relation,
    lock_bo_relation_writes,
    upsert_relation,
)
from app.services.permission_service import PermissionService
from app.services.ppm_ancestors import active_initiative_ancestors
from app.services.relation_orientation import oriented


@dataclass(frozen=True)
class PmlRelationCandidate:
    type_key: str
    source_id: uuid.UUID
    target_id: uuid.UUID
    referenced_id: uuid.UUID
    referenced_type: str


async def prepare_configured_card_relations(
    db: AsyncSession,
    user: User,
    initiative: Card,
    config: PmlSectionConfig,
    old_values: dict[str, Any],
    new_values: dict[str, Any],
    *,
    extra_lock_card_ids: tuple[uuid.UUID, ...] | list[uuid.UUID] = (),
) -> list[PmlRelationCandidate]:
    candidates: list[PmlRelationCandidate] = []
    for definition in config.fields:
        value = new_values.get(definition.key)
        if (
            definition.kind != "card_reference"
            or not definition.active
            or not definition.relation_type
            or value is None
            or value == old_values.get(definition.key)
        ):
            continue
        try:
            card_id = uuid.UUID(str(value))
        except (ValueError, TypeError) as exc:
            raise HTTPException(422, "Invalid card reference") from exc
        card = await db.get(Card, card_id)
        if card is None or card.status != "ACTIVE" or card.type != definition.card_type:
            raise HTTPException(404, "Referenced card not found")
        if not await is_card_readable(db, user, card.id, mode="module", type_key=card.type):
            raise HTTPException(404, "Referenced card not found")
        relation_type = await db.scalar(
            select(RelationType).where(RelationType.key == definition.relation_type)
        )
        if relation_type is None or {
            relation_type.source_type_key,
            relation_type.target_type_key,
        } != {card.type, initiative.type}:
            raise HTTPException(422, "Incompatible relation type")
        source, target = oriented(relation_type, card.id, initiative.id, card.type, initiative.type)
        candidate = PmlRelationCandidate(relation_type.key, source, target, card.id, card.type)
        if candidate not in candidates:
            candidates.append(candidate)
    if not candidates and not extra_lock_card_ids:
        return candidates

    pairs = [(item.type_key, item.source_id, item.target_id) for item in candidates]
    await lock_bo_relation_writes(db, pairs)
    ancestors = await active_initiative_ancestors(db, initiative)
    card_ids = {initiative.id, *(item.id for item in ancestors)}
    card_ids.update(item.referenced_id for item in candidates)
    card_ids.update(extra_lock_card_ids)
    locked = list(
        (
            await db.scalars(
                select(Card)
                .where(Card.id.in_(card_ids))
                .order_by(Card.id)
                .with_for_update()
                .execution_options(populate_existing=True)
            )
        ).all()
    )
    by_id = {card.id: card for card in locked}
    current = by_id.get(initiative.id)
    if current is None:
        raise HTTPException(404, "Initiative not found")
    fresh_ancestors = await active_initiative_ancestors(db, current)
    if any(item.id not in by_id for item in fresh_ancestors):
        raise HTTPException(409, "Initiative hierarchy changed; retry")

    for item in candidates:
        card = by_id.get(item.referenced_id)
        if card is None or card.status != "ACTIVE" or card.type != item.referenced_type:
            raise HTTPException(404, "Referenced card not found")
        if not await is_card_readable(db, user, card.id, mode="module", type_key=card.type):
            raise HTTPException(404, "Referenced card not found")
        relation_type = await db.scalar(
            select(RelationType)
            .where(RelationType.key == item.type_key)
            .execution_options(populate_existing=True)
        )
        if (
            relation_type is None
            or relation_type.source_type_key != by_id[item.source_id].type
            or relation_type.target_type_key != by_id[item.target_id].type
        ):
            raise HTTPException(409, "Relation type changed; retry")
    return candidates


async def apply_configured_card_relations(
    db: AsyncSession,
    user: User,
    candidates: list[PmlRelationCandidate],
    deferred_messages: list[dict[str, Any]],
) -> None:
    actor = WriteActor.from_user(user)
    for item in candidates:
        existing = await find_relation(db, item.type_key, item.source_id, item.target_id)
        if existing is None:
            await PermissionService.require_permission(db, user, "relations.manage")
        await upsert_relation(
            db,
            actor,
            type_key=item.type_key,
            source_id=item.source_id,
            target_id=item.target_id,
            create_only=True,
            deferred_messages=deferred_messages,
        )
