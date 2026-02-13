"""Milestones API — named date markers on Initiative timelines."""
from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import or_, select
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


async def _propagate_milestone_date(
    db: AsyncSession, milestone_id: str, new_date: str
) -> None:
    """Update lifecycle dates on all fact sheets linked to this milestone."""
    result = await db.execute(
        select(FactSheet).where(
            FactSheet.milestone_links.isnot(None),
            FactSheet.status == "ACTIVE",
        )
    )
    for fs in result.scalars().all():
        links = fs.milestone_links or {}
        changed = False
        lc = dict(fs.lifecycle or {})
        for phase_key, linked_ms_id in links.items():
            if linked_ms_id == milestone_id:
                lc[phase_key] = new_date
                changed = True
        if changed:
            fs.lifecycle = lc


@router.get("", response_model=list[MilestoneResponse])
async def list_milestones(
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(get_current_user),
    initiative_id: str | None = Query(None),
    include_inherited: bool = Query(False),
):
    """List milestones, optionally filtered by initiative.

    When *include_inherited* is true and *initiative_id* is provided, the
    response also includes milestones from ancestor (parent) Initiatives,
    marked with ``inherited: true``.
    """
    q = select(Milestone)
    if initiative_id:
        uid = uuid.UUID(initiative_id)
        if include_inherited:
            # Collect ancestor initiative IDs
            ancestor_ids: list[uuid.UUID] = []
            current_id: uuid.UUID | None = uid
            seen: set[uuid.UUID] = set()
            while current_id and current_id not in seen:
                seen.add(current_id)
                res = await db.execute(
                    select(FactSheet.parent_id, FactSheet.type).where(
                        FactSheet.id == current_id
                    )
                )
                row = res.one_or_none()
                if not row or row[0] is None:
                    break
                parent_id = row[0]
                # Walk up only Initiative-typed ancestors
                p_res = await db.execute(
                    select(FactSheet.type).where(FactSheet.id == parent_id)
                )
                p_type = p_res.scalar_one_or_none()
                if p_type == "Initiative":
                    ancestor_ids.append(parent_id)
                current_id = parent_id
            q = q.where(
                or_(
                    Milestone.initiative_id == uid,
                    Milestone.initiative_id.in_(ancestor_ids) if ancestor_ids else False,
                )
            )
        else:
            q = q.where(Milestone.initiative_id == uid)
    q = q.order_by(Milestone.target_date)

    result = await db.execute(q)
    milestones = result.scalars().all()
    target_uid = uuid.UUID(initiative_id) if initiative_id else None
    responses = []
    for ms in milestones:
        resp = _ms_to_response(ms)
        # Mark as inherited if from a parent initiative
        if target_uid and ms.initiative_id != target_uid:
            resp.inherited = True
        responses.append(resp)
    return responses


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
    date_changed = False
    if body.target_date is not None and body.target_date != ms.target_date:
        ms.target_date = body.target_date
        date_changed = True
    if body.description is not None:
        ms.description = body.description

    # Propagate date changes to all fact sheets that link this milestone
    if date_changed:
        await _propagate_milestone_date(db, str(ms.id), str(ms.target_date))

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
