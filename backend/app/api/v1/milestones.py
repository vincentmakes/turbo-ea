"""Milestones API — named date markers on Initiative timelines."""
from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.database import get_db
from app.models.fact_sheet import FactSheet
from app.models.milestone import Milestone
from app.models.user import User
from app.schemas.transformation import (
    MilestoneCreate,
    MilestoneResponse,
    MilestoneUpdate,
)
from app.services.event_bus import event_bus

router = APIRouter(prefix="/milestones", tags=["milestones"])


def _ms_to_response(ms: Milestone) -> MilestoneResponse:
    initiative_ref = None
    if ms.initiative:
        initiative_ref = {
            "id": str(ms.initiative.id),
            "type": ms.initiative.type,
            "name": ms.initiative.name,
        }
    return MilestoneResponse(
        id=str(ms.id),
        initiative_id=str(ms.initiative_id),
        initiative=initiative_ref,
        name=ms.name,
        target_date=ms.target_date,
        description=ms.description,
        created_at=ms.created_at,
        updated_at=ms.updated_at,
    )


@router.get("", response_model=list[MilestoneResponse])
async def list_milestones(
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(get_current_user),
    initiative_id: str | None = Query(None),
):
    """List milestones, optionally filtered by initiative."""
    q = select(Milestone)
    if initiative_id:
        q = q.where(Milestone.initiative_id == uuid.UUID(initiative_id))
    q = q.order_by(Milestone.target_date)

    result = await db.execute(q)
    milestones = result.scalars().all()
    return [_ms_to_response(ms) for ms in milestones]


@router.post("", response_model=MilestoneResponse, status_code=201)
async def create_milestone(
    body: MilestoneCreate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Create a milestone on an Initiative."""
    # Validate initiative
    result = await db.execute(
        select(FactSheet).where(FactSheet.id == uuid.UUID(body.initiative_id))
    )
    initiative = result.scalar_one_or_none()
    if not initiative:
        raise HTTPException(status_code=404, detail="Initiative not found")
    if initiative.type != "Initiative":
        raise HTTPException(
            status_code=400, detail="Milestones can only be added to Initiatives"
        )

    ms = Milestone(
        initiative_id=uuid.UUID(body.initiative_id),
        name=body.name,
        target_date=body.target_date,
        description=body.description,
    )
    db.add(ms)

    await event_bus.publish(
        "milestone.created",
        {"id": str(ms.id), "name": ms.name, "initiative_id": str(ms.initiative_id)},
        db=db,
        fact_sheet_id=ms.initiative_id,
        user_id=user.id,
    )
    await db.commit()
    await db.refresh(ms)

    return _ms_to_response(ms)


@router.get("/{milestone_id}", response_model=MilestoneResponse)
async def get_milestone(
    milestone_id: str,
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(get_current_user),
):
    """Get a single milestone."""
    result = await db.execute(
        select(Milestone).where(Milestone.id == uuid.UUID(milestone_id))
    )
    ms = result.scalar_one_or_none()
    if not ms:
        raise HTTPException(status_code=404, detail="Milestone not found")
    return _ms_to_response(ms)


@router.patch("/{milestone_id}", response_model=MilestoneResponse)
async def update_milestone(
    milestone_id: str,
    body: MilestoneUpdate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Update a milestone."""
    result = await db.execute(
        select(Milestone).where(Milestone.id == uuid.UUID(milestone_id))
    )
    ms = result.scalar_one_or_none()
    if not ms:
        raise HTTPException(status_code=404, detail="Milestone not found")

    if body.name is not None:
        ms.name = body.name
    if body.target_date is not None:
        ms.target_date = body.target_date
    if body.description is not None:
        ms.description = body.description

    await event_bus.publish(
        "milestone.updated",
        {"id": str(ms.id), "name": ms.name},
        db=db,
        fact_sheet_id=ms.initiative_id,
        user_id=user.id,
    )
    await db.commit()
    await db.refresh(ms)

    return _ms_to_response(ms)


@router.delete("/{milestone_id}", status_code=204)
async def delete_milestone(
    milestone_id: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Delete a milestone."""
    result = await db.execute(
        select(Milestone).where(Milestone.id == uuid.UUID(milestone_id))
    )
    ms = result.scalar_one_or_none()
    if not ms:
        raise HTTPException(status_code=404, detail="Milestone not found")

    await event_bus.publish(
        "milestone.deleted",
        {"id": str(ms.id), "name": ms.name, "initiative_id": str(ms.initiative_id)},
        db=db,
        fact_sheet_id=ms.initiative_id,
        user_id=user.id,
    )
    await db.delete(ms)
    await db.commit()
