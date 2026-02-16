from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.database import get_db
from app.models.fact_sheet import FactSheet
from app.models.fact_sheet_type import FactSheetType
from app.models.subscription import Subscription
from app.models.subscription_role_definition import SubscriptionRoleDefinition
from app.models.user import User
from app.schemas.common import SubscriptionCreate
from app.services.permission_service import PermissionService

router = APIRouter(tags=["subscriptions"])

_DEFAULT_ROLES = [
    {"key": "responsible", "label": "Responsible"},
    {"key": "observer", "label": "Observer"},
]


async def _roles_for_type(db: AsyncSession, type_key: str) -> list[dict]:
    """Return active subscription roles from subscription_role_definitions table."""
    result = await db.execute(
        select(SubscriptionRoleDefinition)
        .where(
            SubscriptionRoleDefinition.fact_sheet_type_key == type_key,
            SubscriptionRoleDefinition.is_archived == False,  # noqa: E712
        )
        .order_by(SubscriptionRoleDefinition.sort_order)
    )
    srds = result.scalars().all()
    if srds:
        return [{"key": s.key, "label": s.label, "color": s.color} for s in srds]
    # Fallback to JSONB for backward compat during migration
    result = await db.execute(
        select(FactSheetType.subscription_roles).where(FactSheetType.key == type_key)
    )
    roles = result.scalar_one_or_none()
    if roles:
        return roles
    return [
        {"key": "responsible", "label": "Responsible"},
        {"key": "observer", "label": "Observer"},
    ]


def _role_labels(roles: list[dict]) -> dict[str, str]:
    return {r["key"]: r["label"] for r in roles}


@router.get("/subscription-roles")
async def list_roles(
    type_key: str | None = Query(None, description="Filter roles by fact sheet type"),
    db: AsyncSession = Depends(get_db),
):
    """Return role definitions from subscription_role_definitions table."""
    if type_key:
        roles = await _roles_for_type(db, type_key)
        return [{"key": r["key"], "label": r["label"]} for r in roles]

    # Return all unique active roles across all types
    result = await db.execute(
        select(SubscriptionRoleDefinition.key, SubscriptionRoleDefinition.label)
        .where(SubscriptionRoleDefinition.is_archived == False)  # noqa: E712
        .distinct(SubscriptionRoleDefinition.key)
        .order_by(SubscriptionRoleDefinition.key)
    )
    return [{"key": row[0], "label": row[1]} for row in result.all()]


@router.get("/fact-sheets/{fs_id}/subscriptions")
async def list_subscriptions(
    fs_id: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    await PermissionService.require_permission(db, user, "subscriptions.view")
    # Fetch the fact sheet type so we can resolve role labels
    fs_result = await db.execute(
        select(FactSheet.type).where(FactSheet.id == uuid.UUID(fs_id))
    )
    fs_type = fs_result.scalar_one_or_none()
    roles = await _roles_for_type(db, fs_type) if fs_type else _DEFAULT_ROLES
    labels = _role_labels(roles)

    result = await db.execute(
        select(Subscription).where(Subscription.fact_sheet_id == uuid.UUID(fs_id))
    )
    subs = result.scalars().all()
    return [
        {
            "id": str(s.id),
            "user_id": str(s.user_id),
            "user_display_name": s.user.display_name if s.user else None,
            "user_email": s.user.email if s.user else None,
            "role": s.role,
            "role_label": labels.get(s.role, s.role),
            "created_at": s.created_at.isoformat() if s.created_at else None,
        }
        for s in subs
    ]


@router.post("/fact-sheets/{fs_id}/subscriptions", status_code=201)
async def create_subscription(
    fs_id: str,
    body: SubscriptionCreate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    fs_uuid = uuid.UUID(fs_id)
    if not await PermissionService.check_permission(
        db, user, "subscriptions.manage", fs_uuid, "fs.manage_subscriptions"
    ):
        raise HTTPException(403, "Not enough permissions")
    # Load fact sheet to get its type
    fs_result = await db.execute(
        select(FactSheet.type).where(FactSheet.id == fs_uuid)
    )
    fs_type = fs_result.scalar_one_or_none()
    if not fs_type:
        raise HTTPException(404, "Fact sheet not found")

    roles = await _roles_for_type(db, fs_type)
    valid_keys = {r["key"] for r in roles}
    if body.role not in valid_keys:
        raise HTTPException(
            400,
            f"Invalid role '{body.role}'. Valid for {fs_type}: {sorted(valid_keys)}",
        )

    # Prevent duplicate role for same user on same fact sheet
    existing = await db.execute(
        select(Subscription).where(
            Subscription.fact_sheet_id == uuid.UUID(fs_id),
            Subscription.user_id == uuid.UUID(body.user_id),
            Subscription.role == body.role,
        )
    )
    if existing.scalar_one_or_none():
        raise HTTPException(409, "User already has this role on this fact sheet")

    sub = Subscription(
        fact_sheet_id=uuid.UUID(fs_id),
        user_id=uuid.UUID(body.user_id),
        role=body.role,
    )
    db.add(sub)
    await db.commit()
    await db.refresh(sub)

    labels = _role_labels(roles)
    return {
        "id": str(sub.id),
        "user_id": str(sub.user_id),
        "user_display_name": sub.user.display_name if sub.user else None,
        "role": sub.role,
        "role_label": labels.get(sub.role, sub.role),
    }


@router.patch("/subscriptions/{sub_id}")
async def update_subscription(
    sub_id: str,
    body: SubscriptionCreate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    result = await db.execute(select(Subscription).where(Subscription.id == uuid.UUID(sub_id)))
    sub = result.scalar_one_or_none()
    if not sub:
        raise HTTPException(404, "Subscription not found")
    if not await PermissionService.check_permission(
        db, user, "subscriptions.manage", sub.fact_sheet_id, "fs.manage_subscriptions"
    ):
        raise HTTPException(403, "Not enough permissions")

    # Look up the fact sheet type to validate the new role
    fs_result = await db.execute(
        select(FactSheet.type).where(FactSheet.id == sub.fact_sheet_id)
    )
    fs_type = fs_result.scalar_one_or_none()
    roles = await _roles_for_type(db, fs_type) if fs_type else _DEFAULT_ROLES
    valid_keys = {r["key"] for r in roles}
    if body.role not in valid_keys:
        raise HTTPException(400, f"Invalid role '{body.role}'. Valid: {sorted(valid_keys)}")

    sub.role = body.role
    await db.commit()

    labels = _role_labels(roles)
    return {
        "id": str(sub.id),
        "user_id": str(sub.user_id),
        "role": sub.role,
        "role_label": labels.get(sub.role, sub.role),
    }


@router.delete("/subscriptions/{sub_id}", status_code=204)
async def delete_subscription(
    sub_id: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    result = await db.execute(select(Subscription).where(Subscription.id == uuid.UUID(sub_id)))
    sub = result.scalar_one_or_none()
    if not sub:
        raise HTTPException(404, "Subscription not found")
    if not await PermissionService.check_permission(
        db, user, "subscriptions.manage", sub.fact_sheet_id, "fs.manage_subscriptions"
    ):
        raise HTTPException(403, "Not enough permissions")
    await db.delete(sub)
    await db.commit()
