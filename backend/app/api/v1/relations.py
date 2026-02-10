import uuid

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.core.exceptions import NotFoundError
from app.database import get_db
from app.models.relation import RelationType
from app.models.user import User
from app.schemas.relation import RelationCreate, RelationList, RelationRead, RelationUpdate
from app.services import relation_service as svc

router = APIRouter()


@router.post("", response_model=RelationRead, status_code=201)
async def create_relation(
    data: RelationCreate,
    db: AsyncSession = Depends(get_db),
    user: User | None = Depends(get_current_user),
):
    rel = await svc.create_relation(db, data, user_id=user.id if user else None)
    return rel


@router.get("", response_model=RelationList)
async def list_relations(
    fact_sheet_id: uuid.UUID | None = None,
    type: RelationType | None = None,
    limit: int = Query(100, ge=1, le=500),
    offset: int = Query(0, ge=0),
    db: AsyncSession = Depends(get_db),
):
    items, total = await svc.list_relations(db, fact_sheet_id, type, limit, offset)
    return RelationList(items=items, total=total)


@router.get("/{rel_id}", response_model=RelationRead)
async def get_relation(
    rel_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
):
    rel = await svc.get_relation(db, rel_id)
    if rel is None:
        raise NotFoundError("Relation not found")
    return rel


@router.patch("/{rel_id}", response_model=RelationRead)
async def update_relation(
    rel_id: uuid.UUID,
    data: RelationUpdate,
    db: AsyncSession = Depends(get_db),
    user: User | None = Depends(get_current_user),
):
    rel = await svc.get_relation(db, rel_id)
    if rel is None:
        raise NotFoundError("Relation not found")
    return await svc.update_relation(db, rel, data, user_id=user.id if user else None)


@router.delete("/{rel_id}", status_code=204)
async def delete_relation(
    rel_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: User | None = Depends(get_current_user),
):
    rel = await svc.get_relation(db, rel_id)
    if rel is None:
        raise NotFoundError("Relation not found")
    await svc.delete_relation(db, rel, user_id=user.id if user else None)
