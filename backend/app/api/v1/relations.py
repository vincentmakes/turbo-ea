from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.api.deps import get_current_user
from app.database import get_db
from app.models.card import Card
from app.models.card_type import CardType
from app.models.relation import Relation
from app.models.user import User
from app.schemas.relation import CardRef, RelationCreate, RelationResponse, RelationUpdate
from app.services.calculation_engine import run_calculations_for_card
from app.services.event_bus import event_bus
from app.services.permission_service import PermissionService

router = APIRouter(prefix="/relations", tags=["relations"])


def _rel_to_response(r: Relation) -> RelationResponse:
    source_ref = CardRef(id=str(r.source.id), type=r.source.type, name=r.source.name) if r.source else None
    target_ref = CardRef(id=str(r.target.id), type=r.target.type, name=r.target.name) if r.target else None
    return RelationResponse(
        id=str(r.id),
        type=r.type,
        source_id=str(r.source_id),
        target_id=str(r.target_id),
        source=source_ref,
        target=target_ref,
        attributes=r.attributes,
        description=r.description,
        created_at=r.created_at,
    )


@router.get("")
async def list_relations(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
    card_id: str | None = Query(None),
    type: str | None = Query(None),
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
):
    q = select(Relation)

    # Exclude relations involving cards of hidden types
    hidden_types_sq = select(CardType.key).where(CardType.is_hidden == True)  # noqa: E712
    src_fs = select(Card.id).where(Card.type.in_(hidden_types_sq))
    q = q.where(Relation.source_id.not_in(src_fs), Relation.target_id.not_in(src_fs))

    if card_id:
        uid = uuid.UUID(card_id)
        q = q.where((Relation.source_id == uid) | (Relation.target_id == uid))
    if type:
        q = q.where(Relation.type == type)

    # Count total before pagination
    count_q = select(func.count()).select_from(q.subquery())
    total = (await db.execute(count_q)).scalar() or 0

    q = q.options(selectinload(Relation.source), selectinload(Relation.target))
    q = q.offset((page - 1) * page_size).limit(page_size)
    result = await db.execute(q)
    return {
        "items": [_rel_to_response(r) for r in result.scalars().all()],
        "total": total,
        "page": page,
        "page_size": page_size,
    }


@router.post("", response_model=RelationResponse, status_code=201)
async def create_relation(
    body: RelationCreate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    await PermissionService.require_permission(db, user, "relations.manage")
    rel = Relation(
        type=body.type,
        source_id=uuid.UUID(body.source_id),
        target_id=uuid.UUID(body.target_id),
        attributes=body.attributes or {},
        description=body.description,
    )
    db.add(rel)
    await db.flush()
    await event_bus.publish(
        "relation.created",
        {"id": str(rel.id), "type": rel.type, "source_id": body.source_id, "target_id": body.target_id},
        db=db, card_id=uuid.UUID(body.source_id), user_id=user.id,
    )

    # Run calculated fields for both source and target cards
    source_card = await db.get(Card, uuid.UUID(body.source_id))
    target_card = await db.get(Card, uuid.UUID(body.target_id))
    if source_card:
        await run_calculations_for_card(db, source_card)
    if target_card:
        await run_calculations_for_card(db, target_card)

    await db.commit()
    result = await db.execute(
        select(Relation).where(Relation.id == rel.id)
        .options(selectinload(Relation.source), selectinload(Relation.target))
    )
    rel = result.scalar_one()
    return _rel_to_response(rel)


@router.patch("/{rel_id}", response_model=RelationResponse)
async def update_relation(
    rel_id: str,
    body: RelationUpdate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    await PermissionService.require_permission(db, user, "relations.manage")
    result = await db.execute(select(Relation).where(Relation.id == uuid.UUID(rel_id)))
    rel = result.scalar_one_or_none()
    if not rel:
        raise HTTPException(404, "Relation not found")
    for field, value in body.model_dump(exclude_unset=True).items():
        setattr(rel, field, value)

    # Run calculated fields for both source and target cards
    source_card = await db.get(Card, rel.source_id)
    target_card = await db.get(Card, rel.target_id)
    if source_card:
        await run_calculations_for_card(db, source_card)
    if target_card:
        await run_calculations_for_card(db, target_card)

    await db.commit()
    result = await db.execute(
        select(Relation).where(Relation.id == rel.id)
        .options(selectinload(Relation.source), selectinload(Relation.target))
    )
    rel = result.scalar_one()
    return _rel_to_response(rel)


@router.delete("/{rel_id}", status_code=204)
async def delete_relation(
    rel_id: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    await PermissionService.require_permission(db, user, "relations.manage")
    result = await db.execute(select(Relation).where(Relation.id == uuid.UUID(rel_id)))
    rel = result.scalar_one_or_none()
    if not rel:
        raise HTTPException(404, "Relation not found")
    source_id = rel.source_id
    target_id = rel.target_id
    await event_bus.publish(
        "relation.deleted",
        {"id": str(rel.id), "type": rel.type},
        db=db, card_id=source_id, user_id=user.id,
    )
    await db.delete(rel)

    # Run calculated fields for both source and target cards
    source_card = await db.get(Card, source_id)
    target_card = await db.get(Card, target_id)
    if source_card:
        await run_calculations_for_card(db, source_card)
    if target_card:
        await run_calculations_for_card(db, target_card)

    await db.commit()
