import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import NotFoundError
from app.database import get_db
from app.models.tag import FactSheetTag, Tag, TagGroup
from app.schemas.tag import TagCreate, TagGroupCreate, TagGroupRead, TagRead

router = APIRouter()


# --- Tag Groups ---


@router.post("/groups", response_model=TagGroupRead, status_code=201)
async def create_tag_group(data: TagGroupCreate, db: AsyncSession = Depends(get_db)):
    group = TagGroup(name=data.name, description=data.description)
    db.add(group)
    await db.flush()
    return group


@router.get("/groups", response_model=list[TagGroupRead])
async def list_tag_groups(db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(TagGroup).order_by(TagGroup.name))
    return list(result.scalars().all())


# --- Tags ---


@router.post("", response_model=TagRead, status_code=201)
async def create_tag(data: TagCreate, db: AsyncSession = Depends(get_db)):
    tag = Tag(name=data.name, color=data.color, group_id=data.group_id)
    db.add(tag)
    await db.flush()
    return tag


@router.get("", response_model=list[TagRead])
async def list_tags(group_id: uuid.UUID | None = None, db: AsyncSession = Depends(get_db)):
    query = select(Tag)
    if group_id:
        query = query.where(Tag.group_id == group_id)
    result = await db.execute(query.order_by(Tag.name))
    return list(result.scalars().all())


# --- Assign / Remove Tags from Fact Sheets ---


@router.post("/{tag_id}/fact-sheets/{fs_id}", status_code=201)
async def assign_tag(
    tag_id: uuid.UUID,
    fs_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
):
    existing = await db.execute(
        select(FactSheetTag).where(
            FactSheetTag.fact_sheet_id == fs_id,
            FactSheetTag.tag_id == tag_id,
        )
    )
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Tag already assigned")

    fst = FactSheetTag(fact_sheet_id=fs_id, tag_id=tag_id)
    db.add(fst)
    await db.flush()
    return {"status": "assigned"}


@router.delete("/{tag_id}/fact-sheets/{fs_id}", status_code=204)
async def remove_tag(
    tag_id: uuid.UUID,
    fs_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(FactSheetTag).where(
            FactSheetTag.fact_sheet_id == fs_id,
            FactSheetTag.tag_id == tag_id,
        )
    )
    fst = result.scalar_one_or_none()
    if fst is None:
        raise NotFoundError("Tag assignment not found")
    await db.delete(fst)
    await db.flush()
