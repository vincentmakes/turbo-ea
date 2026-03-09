from __future__ import annotations

import re
import uuid

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.database import get_db
from app.models.diagram import Diagram, diagram_cards
from app.models.user import User
from app.services.permission_service import PermissionService

router = APIRouter(prefix="/diagrams", tags=["diagrams"])

# Regex to pull cardId values out of DrawIO XML <object> elements.
# Faster than full XML parsing and safe here because the attribute value is a UUID.
_CARD_ID_RE = re.compile(r'cardId="([0-9a-fA-F-]{36})"')


def _extract_card_refs(data: dict | None) -> list[str]:
    """Return deduplicated list of card UUIDs found in diagram XML."""
    xml = (data or {}).get("xml", "")
    if not xml:
        return []
    return list(dict.fromkeys(_CARD_ID_RE.findall(xml)))


class DiagramCreate(BaseModel):
    name: str
    description: str | None = None
    type: str = "free_draw"
    data: dict | None = None
    card_ids: list[str] | None = None


class DiagramUpdate(BaseModel):
    name: str | None = None
    description: str | None = None
    data: dict | None = None
    card_ids: list[str] | None = None


# ── helpers ───────────────────────────────────────────────────────────────────


async def _get_card_ids(db: AsyncSession, diagram_id: uuid.UUID) -> list[str]:
    """Return card_ids for a single diagram."""
    result = await db.execute(
        select(diagram_cards.c.card_id).where(
            diagram_cards.c.diagram_id == diagram_id,
        )
    )
    return [str(row[0]) for row in result.all()]


async def _get_card_ids_bulk(db: AsyncSession) -> dict[str, list[str]]:
    """Return mapping of diagram_id -> [card_id, ...] for all diagrams."""
    result = await db.execute(select(diagram_cards))
    mapping: dict[str, list[str]] = {}
    for row in result.all():
        did = str(row.diagram_id)
        mapping.setdefault(did, []).append(str(row.card_id))
    return mapping


async def _set_card_ids(
    db: AsyncSession,
    diagram_id: uuid.UUID,
    card_ids: list[str],
) -> None:
    """Replace all card links for a diagram."""
    await db.execute(
        delete(diagram_cards).where(
            diagram_cards.c.diagram_id == diagram_id,
        )
    )
    for cid in card_ids:
        await db.execute(
            diagram_cards.insert().values(
                diagram_id=diagram_id,
                card_id=uuid.UUID(cid),
            )
        )


# ── endpoints ─────────────────────────────────────────────────────────────────


@router.get("")
async def list_diagrams(
    card_id: str | None = None,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    await PermissionService.require_permission(db, user, "diagrams.view")
    if card_id:
        # Filter: only diagrams linked to this card
        stmt = (
            select(Diagram)
            .join(
                diagram_cards,
                diagram_cards.c.diagram_id == Diagram.id,
            )
            .where(diagram_cards.c.card_id == uuid.UUID(card_id))
            .order_by(Diagram.updated_at.desc())
        )
    else:
        stmt = select(Diagram).order_by(Diagram.updated_at.desc())

    result = await db.execute(stmt)
    rows = result.scalars().all()

    # Bulk-load card_ids
    id_map = await _get_card_ids_bulk(db)

    return [
        {
            "id": str(d.id),
            "name": d.name,
            "description": d.description,
            "type": d.type,
            "card_ids": id_map.get(str(d.id), []),
            "thumbnail": (d.data or {}).get("thumbnail"),
            "card_count": len(_extract_card_refs(d.data)),
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

    if body.card_ids:
        await _set_card_ids(db, d.id, body.card_ids)

    await db.commit()
    await db.refresh(d)
    return {
        "id": str(d.id),
        "name": d.name,
        "type": d.type,
        "card_ids": body.card_ids or [],
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
    linked_card_ids = await _get_card_ids(db, d.id)
    return {
        "id": str(d.id),
        "name": d.name,
        "description": d.description,
        "type": d.type,
        "data": d.data,
        "card_ids": linked_card_ids,
        "card_refs": _extract_card_refs(d.data),
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
        # Store the data and auto-extract card references into it
        new_data = dict(body.data)
        new_data["card_refs"] = _extract_card_refs(new_data)
        d.data = new_data
    if body.card_ids is not None:
        await _set_card_ids(db, d.id, body.card_ids)
    await db.commit()
    await db.refresh(d)
    linked_card_ids = await _get_card_ids(db, d.id)
    return {"id": str(d.id), "name": d.name, "card_ids": linked_card_ids}


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


# ── card link / unlink endpoints ──────────────────────────────────────────────


@router.post("/{diagram_id}/cards", status_code=201)
async def link_card_to_diagram(
    diagram_id: str,
    body: dict,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Link a card to a diagram."""
    await PermissionService.require_permission(db, user, "diagrams.manage")
    card_id = body.get("card_id")
    if not card_id:
        raise HTTPException(400, "card_id is required")

    d_id = uuid.UUID(diagram_id)
    c_id = uuid.UUID(card_id)

    # Check diagram exists
    result = await db.execute(select(Diagram).where(Diagram.id == d_id))
    if not result.scalar_one_or_none():
        raise HTTPException(404, "Diagram not found")

    # Check not already linked
    existing = await db.execute(
        select(diagram_cards).where(
            diagram_cards.c.diagram_id == d_id,
            diagram_cards.c.card_id == c_id,
        )
    )
    if existing.first():
        raise HTTPException(409, "Card already linked to this diagram")

    await db.execute(diagram_cards.insert().values(diagram_id=d_id, card_id=c_id))
    await db.commit()
    return {"diagram_id": str(d_id), "card_id": str(c_id)}


@router.delete("/{diagram_id}/cards/{card_id}", status_code=204)
async def unlink_card_from_diagram(
    diagram_id: str,
    card_id: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Unlink a card from a diagram."""
    await PermissionService.require_permission(db, user, "diagrams.manage")
    d_id = uuid.UUID(diagram_id)
    c_id = uuid.UUID(card_id)

    result = await db.execute(
        delete(diagram_cards).where(
            diagram_cards.c.diagram_id == d_id,
            diagram_cards.c.card_id == c_id,
        )
    )
    if result.rowcount == 0:  # type: ignore[attr-defined]
        raise HTTPException(404, "Link not found")
    await db.commit()
