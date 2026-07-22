from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.database import get_db
from app.models.architecture_plan import ArchitecturePlan
from app.models.user import User
from app.services.architecture_plan_commit import execute_plan_commit
from app.services.permission_service import PermissionService

router = APIRouter(prefix="/architecture-plans", tags=["architecture-plans"])


# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------


class PlanCreate(BaseModel):
    title: str
    description: str | None = None
    initiative_id: str | None = None
    scope: dict | None = None
    plan_data: dict | None = None

    model_config = {"extra": "forbid"}


class PlanUpdate(BaseModel):
    title: str | None = None
    description: str | None = None
    initiative_id: str | None = None
    scope: dict | None = None
    plan_data: dict | None = None

    model_config = {"extra": "forbid"}


class PlanCommitRequest(BaseModel):
    initiative_name: str
    start_date: str
    end_date: str
    objective_ids: list[str] = []
    create_adr: bool = True
    selected_change_indices: list[int] | None = None
    renamed_cards: dict[str, str] = {}

    model_config = {"extra": "forbid"}


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _row_to_dict(p: ArchitecturePlan, full: bool = True) -> dict:
    data = {
        "id": str(p.id),
        "title": p.title,
        "description": p.description,
        "status": p.status,
        "scope": p.scope or {},
        "initiative_id": str(p.initiative_id) if p.initiative_id else None,
        "created_by": str(p.created_by) if p.created_by else None,
        "created_at": p.created_at.isoformat() if p.created_at else None,
        "updated_at": p.updated_at.isoformat() if p.updated_at else None,
        "change_count": len((p.plan_data or {}).get("changes", [])),
    }
    if full:
        data["plan_data"] = p.plan_data or {}
    return data


async def _get_plan(db: AsyncSession, plan_id: str) -> ArchitecturePlan:
    try:
        plan_uuid = uuid.UUID(plan_id)
    except (ValueError, TypeError):
        raise HTTPException(404, "Architecture plan not found") from None
    result = await db.execute(select(ArchitecturePlan).where(ArchitecturePlan.id == plan_uuid))
    p = result.scalar_one_or_none()
    if not p:
        raise HTTPException(404, "Architecture plan not found")
    return p


# ---------------------------------------------------------------------------
# CRUD Endpoints
# ---------------------------------------------------------------------------


@router.get("")
async def list_plans(
    initiative_id: str | None = Query(None),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    await PermissionService.require_permission(db, user, "arch_plans.view")
    stmt = select(ArchitecturePlan).order_by(ArchitecturePlan.updated_at.desc())
    if initiative_id:
        stmt = stmt.where(ArchitecturePlan.initiative_id == uuid.UUID(initiative_id))
    result = await db.execute(stmt)
    rows = result.scalars().all()
    # Summary serializer: the baseline snapshot can be large, so the list
    # endpoint omits plan_data — the detail endpoint returns it.
    return [_row_to_dict(p, full=False) for p in rows]


@router.post("", status_code=201)
async def create_plan(
    body: PlanCreate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    await PermissionService.require_permission(db, user, "arch_plans.manage")
    p = ArchitecturePlan(
        title=body.title,
        description=body.description,
        initiative_id=uuid.UUID(body.initiative_id) if body.initiative_id else None,
        scope=body.scope or {},
        plan_data=body.plan_data or {},
        created_by=user.id,
    )
    db.add(p)
    await db.commit()
    await db.refresh(p)
    return _row_to_dict(p)


@router.get("/{plan_id}")
async def get_plan(
    plan_id: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    await PermissionService.require_permission(db, user, "arch_plans.view")
    p = await _get_plan(db, plan_id)
    return _row_to_dict(p)


@router.patch("/{plan_id}")
async def update_plan(
    plan_id: str,
    body: PlanUpdate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    await PermissionService.require_permission(db, user, "arch_plans.manage")
    p = await _get_plan(db, plan_id)

    if p.status == "committed":
        raise HTTPException(409, "Cannot edit a committed plan")

    if body.title is not None:
        p.title = body.title
    if body.description is not None:
        p.description = body.description
    if body.initiative_id is not None:
        p.initiative_id = uuid.UUID(body.initiative_id) if body.initiative_id else None
    if body.scope is not None:
        p.scope = body.scope
    if body.plan_data is not None:
        p.plan_data = body.plan_data
    await db.commit()
    await db.refresh(p)
    return _row_to_dict(p)


@router.delete("/{plan_id}", status_code=204)
async def delete_plan(
    plan_id: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    await PermissionService.require_permission(db, user, "arch_plans.manage")
    p = await _get_plan(db, plan_id)
    await db.delete(p)
    await db.commit()


# ---------------------------------------------------------------------------
# Commit
# ---------------------------------------------------------------------------


@router.post("/{plan_id}/commit")
async def commit_plan(
    plan_id: str,
    body: PlanCommitRequest,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Commit a plan: create the Initiative, proposed cards and relations,
    an optional draft ADR, and stamp end-of-life dates on removed cards.

    Synchronous — a manual plan commit is a handful of inserts (no AI), so
    there is no background run to poll.
    """
    await PermissionService.require_permission(db, user, "arch_plans.commit")
    p = await _get_plan(db, plan_id)

    if p.status == "committed":
        raise HTTPException(409, "Plan is already committed")
    if not (p.plan_data or {}).get("changes"):
        raise HTTPException(400, "Plan has no changes to commit")

    return await execute_plan_commit(db, p, body.model_dump(), user.id)
