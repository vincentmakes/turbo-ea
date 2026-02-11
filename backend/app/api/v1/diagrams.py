from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.database import get_db
from app.models.diagram import Diagram
from app.models.user import User

router = APIRouter(prefix="/diagrams", tags=["diagrams"])


class DiagramCreate(BaseModel):
    name: str
    type: str = "free_draw"
    data: dict | None = None


class DiagramUpdate(BaseModel):
    name: str | None = None
    data: dict | None = None


class DiagramOut(BaseModel):
    id: str
    name: str
    type: str
    data: dict | None = None
    created_at: str | None = None
    updated_at: str | None = None


@router.get("")
async def list_diagrams(db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Diagram).order_by(Diagram.updated_at.desc()))
    rows = result.scalars().all()
    return [
        {
            "id": str(d.id),
            "name": d.name,
            "type": d.type,
            "thumbnail": (d.data or {}).get("thumbnail"),
            "created_at": d.created_at.isoformat() if d.created_at else None,
            "updated_at": d.updated_at.isoformat() if d.updated_at else None,
        }
        for d in rows
    ]


@router.post("", status_code=201)
async def create_diagram(
    body: DiagramCreate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    d = Diagram(name=body.name, type=body.type, data=body.data or {}, created_by=user.id)
    db.add(d)
    await db.commit()
    await db.refresh(d)
    return {"id": str(d.id), "name": d.name, "type": d.type}


@router.get("/{diagram_id}")
async def get_diagram(
    diagram_id: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    result = await db.execute(select(Diagram).where(Diagram.id == uuid.UUID(diagram_id)))
    d = result.scalar_one_or_none()
    if not d:
        raise HTTPException(404, "Diagram not found")
    return {
        "id": str(d.id),
        "name": d.name,
        "type": d.type,
        "data": d.data,
        "created_at": d.created_at.isoformat() if d.created_at else None,
        "updated_at": d.updated_at.isoformat() if d.updated_at else None,
    }


@router.patch("/{diagram_id}")
async def update_diagram(
    diagram_id: str,
    body: DiagramUpdate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    result = await db.execute(select(Diagram).where(Diagram.id == uuid.UUID(diagram_id)))
    d = result.scalar_one_or_none()
    if not d:
        raise HTTPException(404, "Diagram not found")
    if body.name is not None:
        d.name = body.name
    if body.data is not None:
        d.data = body.data
    await db.commit()
    await db.refresh(d)
    return {"id": str(d.id), "name": d.name}


@router.delete("/{diagram_id}", status_code=204)
async def delete_diagram(
    diagram_id: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    result = await db.execute(select(Diagram).where(Diagram.id == uuid.UUID(diagram_id)))
    d = result.scalar_one_or_none()
    if not d:
        raise HTTPException(404, "Diagram not found")
    await db.delete(d)
    await db.commit()
