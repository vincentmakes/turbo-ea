"""App-level role management API routes."""

from __future__ import annotations

import re
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.core.permissions import ALL_APP_PERMISSION_KEYS, APP_PERMISSIONS
from app.database import get_db
from app.models.role import Role
from app.models.user import User
from app.services.permission_service import PermissionService

router = APIRouter(prefix="/roles", tags=["roles"])

ROLE_KEY_PATTERN = re.compile(r"^[a-z][a-z0-9_]{1,48}[a-z0-9]$")


# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------

class RoleCreate(BaseModel):
    key: str = Field(..., min_length=3, max_length=50)
    label: str = Field(..., min_length=1, max_length=200)
    description: str | None = None
    color: str = "#757575"
    permissions: dict[str, bool] = {}
    is_default: bool = False

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
        unknown = set(v.keys()) - ALL_APP_PERMISSION_KEYS - {"*"}
        if unknown:
            raise ValueError(f"Unknown permission keys: {', '.join(sorted(unknown))}")
        return v


class RoleUpdate(BaseModel):
    label: str | None = None
    description: str | None = None
    color: str | None = None
    permissions: dict[str, bool] | None = None
    is_default: bool | None = None
    sort_order: int | None = None

    @field_validator("permissions")
    @classmethod
    def validate_permissions(cls, v: dict[str, bool] | None) -> dict[str, bool] | None:
        if v is not None:
            unknown = set(v.keys()) - ALL_APP_PERMISSION_KEYS - {"*"}
            if unknown:
                raise ValueError(f"Unknown permission keys: {', '.join(sorted(unknown))}")
        return v


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _role_response(role: Role, user_count: int | None = None) -> dict:
    data = {
        "id": str(role.id),
        "key": role.key,
        "label": role.label,
        "description": role.description,
        "is_system": role.is_system,
        "is_default": role.is_default,
        "is_archived": role.is_archived,
        "color": role.color,
        "permissions": role.permissions,
        "sort_order": role.sort_order,
        "created_at": role.created_at.isoformat() if role.created_at else None,
        "updated_at": role.updated_at.isoformat() if role.updated_at else None,
        "archived_at": role.archived_at.isoformat() if role.archived_at else None,
        "archived_by": str(role.archived_by) if role.archived_by else None,
    }
    if user_count is not None:
        data["user_count"] = user_count
    return data


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@router.get("")
async def list_roles(
    include_archived: bool = False,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """List all roles. Any authenticated user can view roles."""
    query = select(Role).order_by(Role.sort_order, Role.key)
    if not include_archived:
        query = query.where(Role.is_archived == False)  # noqa: E712
    result = await db.execute(query)
    roles = result.scalars().all()

    # Get user counts per role
    count_result = await db.execute(
        select(User.role, func.count(User.id)).where(User.is_active == True).group_by(User.role)  # noqa: E712
    )
    counts = dict(count_result.all())

    return [_role_response(r, user_count=counts.get(r.key, 0)) for r in roles]


@router.get("/permissions-schema")
async def permissions_schema(user: User = Depends(get_current_user)):
    """Return the full permission key catalog with labels/descriptions."""
    return APP_PERMISSIONS


@router.get("/{key}")
async def get_role(
    key: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    result = await db.execute(select(Role).where(Role.key == key))
    role = result.scalar_one_or_none()
    if not role:
        raise HTTPException(404, "Role not found")

    # Get user count
    count_result = await db.execute(
        select(func.count(User.id)).where(User.role == key, User.is_active == True)  # noqa: E712
    )
    user_count = count_result.scalar() or 0

    return _role_response(role, user_count=user_count)


@router.post("", status_code=201)
async def create_role(
    body: RoleCreate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    await PermissionService.require_permission(db, user, "admin.roles")

    # Check uniqueness
    existing = await db.execute(select(Role).where(Role.key == body.key))
    if existing.scalar_one_or_none():
        raise HTTPException(409, f"A role with key '{body.key}' already exists")

    # Handle is_default
    if body.is_default:
        await db.execute(
            select(Role).where(Role.is_default == True)  # noqa: E712
        )
        # Clear existing default
        result = await db.execute(select(Role).where(Role.is_default == True))  # noqa: E712
        for r in result.scalars().all():
            r.is_default = False

    role = Role(
        key=body.key,
        label=body.label,
        description=body.description,
        color=body.color,
        permissions=body.permissions,
        is_default=body.is_default,
        is_system=False,
    )
    db.add(role)
    await db.commit()
    await db.refresh(role)
    PermissionService.invalidate_role_cache(body.key)
    return _role_response(role, user_count=0)


@router.patch("/{key}")
async def update_role(
    key: str,
    body: RoleUpdate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    await PermissionService.require_permission(db, user, "admin.roles")

    result = await db.execute(select(Role).where(Role.key == key))
    role = result.scalar_one_or_none()
    if not role:
        raise HTTPException(404, "Role not found")

    if role.is_archived:
        raise HTTPException(400, "Cannot edit an archived role. Restore it first.")

    data = body.model_dump(exclude_unset=True)

    # Protect admin wildcard permission
    if role.key == "admin" and role.is_system and "permissions" in data:
        if not data["permissions"].get("*"):
            raise HTTPException(400, "Cannot remove wildcard permission from admin role")

    # Handle is_default change
    if data.get("is_default") is True:
        existing_defaults = await db.execute(
            select(Role).where(Role.is_default == True, Role.key != key)  # noqa: E712
        )
        for r in existing_defaults.scalars().all():
            r.is_default = False

    for field, value in data.items():
        setattr(role, field, value)

    await db.commit()
    await db.refresh(role)
    PermissionService.invalidate_role_cache(key)
    return _role_response(role)


@router.post("/{key}/archive")
async def archive_role(
    key: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    await PermissionService.require_permission(db, user, "admin.roles")

    result = await db.execute(select(Role).where(Role.key == key))
    role = result.scalar_one_or_none()
    if not role:
        raise HTTPException(404, "Role not found")

    if role.is_system:
        raise HTTPException(403, "Cannot archive a system role")

    if role.is_default:
        raise HTTPException(409, "Cannot archive the default role. Reassign default first.")

    if role.is_archived:
        raise HTTPException(400, "Role is already archived")

    # Count affected users
    count_result = await db.execute(
        select(func.count(User.id)).where(User.role == key)
    )
    affected_users_count = count_result.scalar() or 0

    role.is_archived = True
    role.archived_at = datetime.now(timezone.utc)
    role.archived_by = user.id
    await db.commit()
    await db.refresh(role)
    PermissionService.invalidate_role_cache(key)

    resp = _role_response(role)
    resp["affected_users_count"] = affected_users_count
    return resp


@router.post("/{key}/restore")
async def restore_role(
    key: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    await PermissionService.require_permission(db, user, "admin.roles")

    result = await db.execute(select(Role).where(Role.key == key))
    role = result.scalar_one_or_none()
    if not role:
        raise HTTPException(404, "Role not found")

    if not role.is_archived:
        raise HTTPException(400, "Role is not archived")

    role.is_archived = False
    role.archived_at = None
    role.archived_by = None
    await db.commit()
    await db.refresh(role)
    PermissionService.invalidate_role_cache(key)

    return _role_response(role)
