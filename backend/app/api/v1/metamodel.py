from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.fact_sheet_type import FactSheetType
from app.models.relation_type import RelationType

router = APIRouter(prefix="/metamodel", tags=["metamodel"])


@router.get("/types")
async def list_types(db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(FactSheetType).order_by(FactSheetType.sort_order))
    types = result.scalars().all()
    return [
        {
            "key": t.key,
            "label": t.label,
            "description": t.description,
            "icon": t.icon,
            "color": t.color,
            "category": t.category,
            "has_hierarchy": t.has_hierarchy,
            "fields_schema": t.fields_schema,
            "built_in": t.built_in,
        }
        for t in types
    ]


@router.get("/types/{key}")
async def get_type(key: str, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(FactSheetType).where(FactSheetType.key == key))
    t = result.scalar_one_or_none()
    if not t:
        raise HTTPException(404, "Fact sheet type not found")
    return {
        "key": t.key,
        "label": t.label,
        "description": t.description,
        "icon": t.icon,
        "color": t.color,
        "category": t.category,
        "has_hierarchy": t.has_hierarchy,
        "fields_schema": t.fields_schema,
        "built_in": t.built_in,
    }


@router.post("/types", status_code=201)
async def create_type(body: dict, db: AsyncSession = Depends(get_db)):
    existing = await db.execute(select(FactSheetType).where(FactSheetType.key == body.get("key", "")))
    if existing.scalar_one_or_none():
        raise HTTPException(400, "Type key already exists")
    t = FactSheetType(
        key=body["key"],
        label=body["label"],
        description=body.get("description"),
        icon=body.get("icon", "category"),
        color=body.get("color", "#1976d2"),
        category=body.get("category", "application"),
        has_hierarchy=body.get("has_hierarchy", False),
        fields_schema=body.get("fields_schema", []),
        built_in=False,
        sort_order=99,
    )
    db.add(t)
    await db.commit()
    return {"key": t.key, "label": t.label}


@router.patch("/types/{key}")
async def update_type(key: str, body: dict, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(FactSheetType).where(FactSheetType.key == key))
    t = result.scalar_one_or_none()
    if not t:
        raise HTTPException(404, "Type not found")
    for field in ["label", "description", "icon", "color", "category", "has_hierarchy", "fields_schema"]:
        if field in body:
            setattr(t, field, body[field])
    await db.commit()
    return {"key": t.key, "label": t.label}


@router.get("/relation-types")
async def list_relation_types(db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(RelationType))
    rtypes = result.scalars().all()
    return [
        {
            "key": r.key,
            "label": r.label,
            "source_type_key": r.source_type_key,
            "target_type_key": r.target_type_key,
            "attributes_schema": r.attributes_schema,
            "built_in": r.built_in,
        }
        for r in rtypes
    ]


@router.post("/relation-types", status_code=201)
async def create_relation_type(body: dict, db: AsyncSession = Depends(get_db)):
    existing = await db.execute(select(RelationType).where(RelationType.key == body.get("key", "")))
    if existing.scalar_one_or_none():
        raise HTTPException(400, "Relation type key already exists")
    rt = RelationType(
        key=body["key"],
        label=body["label"],
        source_type_key=body["source_type_key"],
        target_type_key=body["target_type_key"],
        attributes_schema=body.get("attributes_schema", []),
        built_in=False,
    )
    db.add(rt)
    await db.commit()
    return {"key": rt.key, "label": rt.label}
