"""Stakeholder role definition management API routes."""

from __future__ import annotations

import re
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.core.permissions import ALL_FS_PERMISSION_KEYS, FS_PERMISSIONS
from app.database import get_db
from app.models.card_type import CardType
from app.models.stakeholder import Stakeholder
from app.models.subscription_role_definition import StakeholderRoleDefinition
from app.models.user import User
from app.services.permission_service import PermissionService

router = APIRouter(tags=["stakeholder-roles"])

ROLE_KEY_PATTERN = re.compile(r"^[a-z][a-z0-9_]{1,48}[a-z0-9]$")


# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------

class StakeholderRoleCreate(BaseModel):
    key: str = Field(..., min_length=3, max_length=50)
    label: str = Field(..., min_length=1, max_length=200)
    description: str | None = None
    color: str = "#757575"
    permissions: dict[str, bool] = {}

    @field_validator("key")
    @classmethod
    def validate_key(cls, v: str) -> str:
        if not ROLE_KEY_PATTERN.match(v):
            raise ValueError(
                "Key must match ^[a-z][a-z0-9_]{1,48}[a-z0-9]$ "
                "(lowercase letters, digits, underscores, 3-50 chars)"
            )
        return v

    @field_validator("permissions")
    @classmethod
    def validate_permissions(cls, v: dict[str, bool]) -> dict[str, bool]:
        unknown = set(v.keys()) - ALL_FS_PERMISSION_KEYS
        if unknown:
            raise ValueError(f"Unknown permission keys: {', '.join(sorted(unknown))}")
        return v


class StakeholderRoleUpdate(BaseModel):
    label: str | None = None
    description: str | None = None
    color: str | None = None
    permissions: dict[str, bool] | None = None
    sort_order: int | None = None

    @field_validator("permissions")
    @classmethod
    def validate_permissions(cls, v: dict[str, bool] | None) -> dict[str, bool] | None:
        if v is not None:
            unknown = set(v.keys()) - ALL_FS_PERMISSION_KEYS
            if unknown:
                raise ValueError(f"Unknown permission keys: {', '.join(sorted(unknown))}")
        return v


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _srd_response(srd: StakeholderRoleDefinition, stakeholder_count: int | None = None) -> dict:
    data = {
        "id": str(srd.id),
        "card_type_key": srd.card_type_key,
        "key": srd.key,
        "label": srd.label,
        "description": srd.description,
        "color": srd.color,
        "permissions": srd.permissions,
        "is_archived": srd.is_archived,
        "sort_order": srd.sort_order,
        "created_at": srd.created_at.isoformat() if srd.created_at else None,
        "updated_at": srd.updated_at.isoformat() if srd.updated_at else None,
        "archived_at": srd.archived_at.isoformat() if srd.archived_at else None,
        "archived_by": str(srd.archived_by) if srd.archived_by else None,
    }
    if stakeholder_count is not None:
        data["stakeholder_count"] = stakeholder_count
    return data


async def _ensure_type_exists(db: AsyncSession, type_key: str) -> None:
    result = await db.execute(
        select(CardType).where(CardType.key == type_key)
    )
    if not result.scalar_one_or_none():
        raise HTTPException(404, f"Card type '{type_key}' not found")


# ---------------------------------------------------------------------------
# Routes — mounted under /metamodel/types/{type_key}/stakeholder-roles
# ---------------------------------------------------------------------------

@router.get("/metamodel/types/{type_key}/stakeholder-roles")
async def list_stakeholder_roles(
    type_key: str,
    include_archived: bool = False,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """List stakeholder roles for a card type."""
    await _ensure_type_exists(db, type_key)

    query = (
        select(StakeholderRoleDefinition)
        .where(StakeholderRoleDefinition.card_type_key == type_key)
        .order_by(StakeholderRoleDefinition.sort_order, StakeholderRoleDefinition.key)
    )
    if not include_archived:
        query = query.where(StakeholderRoleDefinition.is_archived == False)  # noqa: E712
    result = await db.execute(query)
    srds = result.scalars().all()

    return [_srd_response(srd) for srd in srds]


@router.get("/metamodel/types/{type_key}/stakeholder-roles/{role_key}")
async def get_stakeholder_role(
    type_key: str,
    role_key: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Get a single stakeholder role with permissions."""
    await _ensure_type_exists(db, type_key)

    result = await db.execute(
        select(StakeholderRoleDefinition).where(
            StakeholderRoleDefinition.card_type_key == type_key,
            StakeholderRoleDefinition.key == role_key,
        )
    )
    srd = result.scalar_one_or_none()
    if not srd:
        raise HTTPException(404, "Stakeholder role not found")

    # Count active stakeholders
    count_result = await db.execute(
        select(func.count(Stakeholder.id)).where(Stakeholder.role == role_key)
    )
    stakeholder_count = count_result.scalar() or 0

    return _srd_response(srd, stakeholder_count=stakeholder_count)


@router.post("/metamodel/types/{type_key}/stakeholder-roles", status_code=201)
async def create_stakeholder_role(
    type_key: str,
    body: StakeholderRoleCreate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    await PermissionService.require_permission(db, user, "admin.metamodel")
    await _ensure_type_exists(db, type_key)

    # Check uniqueness
    existing = await db.execute(
        select(StakeholderRoleDefinition).where(
            StakeholderRoleDefinition.card_type_key == type_key,
            StakeholderRoleDefinition.key == body.key,
        )
    )
    if existing.scalar_one_or_none():
        raise HTTPException(
            409, f"Stakeholder role '{body.key}' already exists for type '{type_key}'"
        )

    # Calculate next sort_order
    max_order = await db.execute(
        select(func.max(StakeholderRoleDefinition.sort_order)).where(
            StakeholderRoleDefinition.card_type_key == type_key
        )
    )
    next_order = (max_order.scalar() or 0) + 1

    srd = StakeholderRoleDefinition(
        card_type_key=type_key,
        key=body.key,
        label=body.label,
        description=body.description,
        color=body.color,
        permissions=body.permissions,
        sort_order=next_order,
    )
    db.add(srd)
    await db.commit()
    await db.refresh(srd)
    PermissionService.invalidate_srd_cache(type_key, body.key)

    return _srd_response(srd, stakeholder_count=0)


@router.patch("/metamodel/types/{type_key}/stakeholder-roles/{role_key}")
async def update_stakeholder_role(
    type_key: str,
    role_key: str,
    body: StakeholderRoleUpdate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    await PermissionService.require_permission(db, user, "admin.metamodel")

    result = await db.execute(
        select(StakeholderRoleDefinition).where(
            StakeholderRoleDefinition.card_type_key == type_key,
            StakeholderRoleDefinition.key == role_key,
        )
    )
    srd = result.scalar_one_or_none()
    if not srd:
        raise HTTPException(404, "Stakeholder role not found")

    if srd.is_archived:
        raise HTTPException(400, "Cannot edit an archived stakeholder role. Restore it first.")

    data = body.model_dump(exclude_unset=True)
    for field, value in data.items():
        setattr(srd, field, value)

    await db.commit()
    await db.refresh(srd)
    PermissionService.invalidate_srd_cache(type_key, role_key)
    return _srd_response(srd)


@router.post("/metamodel/types/{type_key}/stakeholder-roles/{role_key}/archive")
async def archive_stakeholder_role(
    type_key: str,
    role_key: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    await PermissionService.require_permission(db, user, "admin.metamodel")

    result = await db.execute(
        select(StakeholderRoleDefinition).where(
            StakeholderRoleDefinition.card_type_key == type_key,
            StakeholderRoleDefinition.key == role_key,
        )
    )
    srd = result.scalar_one_or_none()
    if not srd:
        raise HTTPException(404, "Stakeholder role not found")

    if srd.is_archived:
        raise HTTPException(400, "Stakeholder role is already archived")

    # Check that at least one active role remains for this type
    active_count = await db.execute(
        select(func.count(StakeholderRoleDefinition.id)).where(
            StakeholderRoleDefinition.card_type_key == type_key,
            StakeholderRoleDefinition.is_archived == False,  # noqa: E712
            StakeholderRoleDefinition.key != role_key,
        )
    )
    if (active_count.scalar() or 0) == 0:
        raise HTTPException(
            409, "Cannot archive the last active stakeholder role for this type"
        )

    # Count affected stakeholders
    count_result = await db.execute(
        select(func.count(Stakeholder.id)).where(Stakeholder.role == role_key)
    )
    affected_count = count_result.scalar() or 0

    srd.is_archived = True
    srd.archived_at = datetime.now(timezone.utc)
    srd.archived_by = user.id
    await db.commit()
    await db.refresh(srd)
    PermissionService.invalidate_srd_cache(type_key, role_key)

    resp = _srd_response(srd)
    resp["affected_stakeholders_count"] = affected_count
    return resp


@router.post("/metamodel/types/{type_key}/stakeholder-roles/{role_key}/restore")
async def restore_stakeholder_role(
    type_key: str,
    role_key: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    await PermissionService.require_permission(db, user, "admin.metamodel")

    result = await db.execute(
        select(StakeholderRoleDefinition).where(
            StakeholderRoleDefinition.card_type_key == type_key,
            StakeholderRoleDefinition.key == role_key,
        )
    )
    srd = result.scalar_one_or_none()
    if not srd:
        raise HTTPException(404, "Stakeholder role not found")

    if not srd.is_archived:
        raise HTTPException(400, "Stakeholder role is not archived")

    srd.is_archived = False
    srd.archived_at = None
    srd.archived_by = None
    await db.commit()
    await db.refresh(srd)
    PermissionService.invalidate_srd_cache(type_key, role_key)

    return _srd_response(srd)


@router.get("/stakeholder-roles/permissions-schema")
async def fs_permissions_schema(user: User = Depends(get_current_user)):
    """Return the full FS-level permission key catalog."""
    return FS_PERMISSIONS
