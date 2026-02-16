from __future__ import annotations

import re
import uuid

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.database import get_db
from app.models.diagram import Diagram, diagram_initiatives
from app.models.user import User
from app.services.permission_service import PermissionService

router = APIRouter(prefix="/diagrams", tags=["diagrams"])

# Regex to pull factSheetId values out of DrawIO XML <object> elements.
# Faster than full XML parsing and safe here because the attribute value is a UUID.
_FS_ID_RE = re.compile(r'factSheetId="([0-9a-fA-F-]{36})"')


def _extract_fact_sheet_refs(data: dict | None) -> list[str]:
    """Return deduplicated list of fact-sheet UUIDs found in diagram XML."""
    xml = (data or {}).get("xml", "")
    if not xml:
        return []
    return list(dict.fromkeys(_FS_ID_RE.findall(xml)))


class DiagramCreate(BaseModel):
    name: str
    description: str | None = None
    type: str = "free_draw"
    data: dict | None = None
    initiative_ids: list[str] | None = None


class DiagramUpdate(BaseModel):
    name: str | None = None
    description: str | None = None
    data: dict | None = None
    initiative_ids: list[str] | None = None


# ── helpers ───────────────────────────────────────────────────────────────────

async def _get_initiative_ids(db: AsyncSession, diagram_id: uuid.UUID) -> list[str]:
    """Return initiative_ids for a single diagram."""
    result = await db.execute(
        select(diagram_initiatives.c.initiative_id).where(
            diagram_initiatives.c.diagram_id == diagram_id,
        )
    )
    return [str(row[0]) for row in result.all()]


async def _get_initiative_ids_bulk(db: AsyncSession) -> dict[str, list[str]]:
    """Return mapping of diagram_id -> [initiative_id, ...] for all diagrams."""
    result = await db.execute(select(diagram_initiatives))
    mapping: dict[str, list[str]] = {}
    for row in result.all():
        did = str(row.diagram_id)
        mapping.setdefault(did, []).append(str(row.initiative_id))
    return mapping


async def _set_initiative_ids(
    db: AsyncSession, diagram_id: uuid.UUID, initiative_ids: list[str],
) -> None:
    """Replace all initiative links for a diagram."""
    await db.execute(
        delete(diagram_initiatives).where(
            diagram_initiatives.c.diagram_id == diagram_id,
        )
    )
    for iid in initiative_ids:
        await db.execute(
            diagram_initiatives.insert().values(
                diagram_id=diagram_id, initiative_id=uuid.UUID(iid),
            )
        )


# ── endpoints ─────────────────────────────────────────────────────────────────

@router.get("")
async def list_diagrams(
    initiative_id: str | None = None,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    await PermissionService.require_permission(db, user, "diagrams.view")
    if initiative_id:
        # Filter: only diagrams linked to this initiative
        stmt = (
            select(Diagram)
            .join(
                diagram_initiatives,
                diagram_initiatives.c.diagram_id == Diagram.id,
            )
            .where(diagram_initiatives.c.initiative_id == uuid.UUID(initiative_id))
            .order_by(Diagram.updated_at.desc())
        )
    else:
        stmt = select(Diagram).order_by(Diagram.updated_at.desc())

    result = await db.execute(stmt)
    rows = result.scalars().all()

    # Bulk-load initiative_ids
    id_map = await _get_initiative_ids_bulk(db)

    return [
        {
            "id": str(d.id),
            "name": d.name,
            "description": d.description,
            "type": d.type,
            "initiative_ids": id_map.get(str(d.id), []),
            "thumbnail": (d.data or {}).get("thumbnail"),
            "fact_sheet_count": len(_extract_fact_sheet_refs(d.data)),
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
    await PermissionService.require_permission(db, user, "diagrams.manage")
    d = Diagram(
        name=body.name,
        description=body.description,
        type=body.type,
        data=body.data or {},
        created_by=user.id,
    )
    db.add(d)
    await db.flush()  # get d.id

    if body.initiative_ids:
        await _set_initiative_ids(db, d.id, body.initiative_ids)

    await db.commit()
    await db.refresh(d)
    return {
        "id": str(d.id),
        "name": d.name,
        "type": d.type,
        "initiative_ids": body.initiative_ids or [],
    }


@router.get("/{diagram_id}")
async def get_diagram(
    diagram_id: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    await PermissionService.require_permission(db, user, "diagrams.view")
    result = await db.execute(select(Diagram).where(Diagram.id == uuid.UUID(diagram_id)))
    d = result.scalar_one_or_none()
    if not d:
        raise HTTPException(404, "Diagram not found")
    initiative_ids = await _get_initiative_ids(db, d.id)
    return {
        "id": str(d.id),
        "name": d.name,
        "description": d.description,
        "type": d.type,
        "data": d.data,
        "initiative_ids": initiative_ids,
        "fact_sheet_refs": _extract_fact_sheet_refs(d.data),
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
    await PermissionService.require_permission(db, user, "diagrams.manage")
    result = await db.execute(select(Diagram).where(Diagram.id == uuid.UUID(diagram_id)))
    d = result.scalar_one_or_none()
    if not d:
        raise HTTPException(404, "Diagram not found")
    if body.name is not None:
        d.name = body.name
    if body.description is not None:
        d.description = body.description
    if body.data is not None:
        # Store the data and auto-extract fact sheet references into it
        new_data = dict(body.data)
        new_data["fact_sheet_refs"] = _extract_fact_sheet_refs(new_data)
        d.data = new_data
    if body.initiative_ids is not None:
        await _set_initiative_ids(db, d.id, body.initiative_ids)
    await db.commit()
    await db.refresh(d)
    initiative_ids = await _get_initiative_ids(db, d.id)
    return {"id": str(d.id), "name": d.name, "initiative_ids": initiative_ids}


@router.delete("/{diagram_id}", status_code=204)
async def delete_diagram(
    diagram_id: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    await PermissionService.require_permission(db, user, "diagrams.manage")
    result = await db.execute(select(Diagram).where(Diagram.id == uuid.UUID(diagram_id)))
    d = result.scalar_one_or_none()
    if not d:
        raise HTTPException(404, "Diagram not found")
    await db.delete(d)
    await db.commit()
