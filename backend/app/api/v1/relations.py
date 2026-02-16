from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.database import get_db
from app.models.fact_sheet import FactSheet
from app.models.fact_sheet_type import FactSheetType
from app.models.relation import Relation
from app.models.user import User
from app.schemas.relation import FactSheetRef, RelationCreate, RelationResponse, RelationUpdate
from app.services.event_bus import event_bus
from app.services.permission_service import PermissionService

router = APIRouter(prefix="/relations", tags=["relations"])


def _rel_to_response(r: Relation) -> RelationResponse:
    source_ref = FactSheetRef(id=str(r.source.id), type=r.source.type, name=r.source.name) if r.source else None
    target_ref = FactSheetRef(id=str(r.target.id), type=r.target.type, name=r.target.name) if r.target else None
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


@router.get("", response_model=list[RelationResponse])
async def list_relations(
    db: AsyncSession = Depends(get_db),
    fact_sheet_id: str | None = Query(None),
    type: str | None = Query(None),
):
    q = select(Relation)

    # Exclude relations involving fact sheets of hidden types
    hidden_types_sq = select(FactSheetType.key).where(FactSheetType.is_hidden == True)  # noqa: E712
    src_fs = select(FactSheet.id).where(FactSheet.type.in_(hidden_types_sq))
    q = q.where(Relation.source_id.not_in(src_fs), Relation.target_id.not_in(src_fs))

    if fact_sheet_id:
        uid = uuid.UUID(fact_sheet_id)
        q = q.where((Relation.source_id == uid) | (Relation.target_id == uid))
    if type:
        q = q.where(Relation.type == type)
    result = await db.execute(q)
    return [_rel_to_response(r) for r in result.scalars().all()]


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
        db=db, fact_sheet_id=uuid.UUID(body.source_id), user_id=user.id,
    )
    await db.commit()
    await db.refresh(rel)
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
    await db.commit()
    await db.refresh(rel)
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
    await event_bus.publish(
        "relation.deleted",
        {"id": str(rel.id), "type": rel.type},
        db=db, fact_sheet_id=rel.source_id, user_id=user.id,
    )
    await db.delete(rel)
    await db.commit()
