import uuid

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.core.exceptions import NotFoundError
from app.database import get_db
from app.models.fact_sheet import FactSheetStatus, FactSheetType
from app.models.user import User
from app.schemas.fact_sheet import FactSheetCreate, FactSheetList, FactSheetRead, FactSheetUpdate
from app.services import fact_sheet_service as svc

router = APIRouter()


@router.post("", response_model=FactSheetRead, status_code=201)
async def create_fact_sheet(
    data: FactSheetCreate,
    db: AsyncSession = Depends(get_db),
    user: User | None = Depends(get_current_user),
):
    fs = await svc.create_fact_sheet(db, data, user_id=user.id if user else None)
    return fs


@router.get("", response_model=FactSheetList)
async def list_fact_sheets(
    type: FactSheetType | None = None,
    status: FactSheetStatus | None = None,
    parent_id: uuid.UUID | None = None,
    search: str | None = None,
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
    db: AsyncSession = Depends(get_db),
):
    items, total = await svc.list_fact_sheets(db, type, status, parent_id, search, page, page_size)
    return FactSheetList(items=items, total=total, page=page, page_size=page_size)


@router.get("/{fs_id}", response_model=FactSheetRead)
async def get_fact_sheet(
    fs_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
):
    fs = await svc.get_fact_sheet(db, fs_id)
    if fs is None:
        raise NotFoundError("Fact sheet not found")
    return fs


@router.patch("/{fs_id}", response_model=FactSheetRead)
async def update_fact_sheet(
    fs_id: uuid.UUID,
    data: FactSheetUpdate,
    db: AsyncSession = Depends(get_db),
    user: User | None = Depends(get_current_user),
):
    fs = await svc.get_fact_sheet(db, fs_id)
    if fs is None:
        raise NotFoundError("Fact sheet not found")
    return await svc.update_fact_sheet(db, fs, data, user_id=user.id if user else None)


@router.delete("/{fs_id}", status_code=204)
async def delete_fact_sheet(
    fs_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: User | None = Depends(get_current_user),
):
    fs = await svc.get_fact_sheet(db, fs_id)
    if fs is None:
        raise NotFoundError("Fact sheet not found")
    await svc.delete_fact_sheet(db, fs, user_id=user.id if user else None)
