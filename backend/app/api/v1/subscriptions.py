from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.database import get_db
from app.models.fact_sheet import FactSheet
from app.models.subscription import Subscription
from app.models.user import User
from app.schemas.common import SubscriptionCreate

router = APIRouter(tags=["subscriptions"])

# Roles available for all fact sheet types
UNIVERSAL_ROLES = {"responsible", "observer"}
# Roles restricted to specific fact sheet types
TYPE_SPECIFIC_ROLES = {
    "technical_application_owner": {"Application"},
    "business_application_owner": {"Application"},
}
ALL_ROLES = UNIVERSAL_ROLES | TYPE_SPECIFIC_ROLES.keys()

ROLE_LABELS = {
    "responsible": "Responsible",
    "observer": "Observer",
    "technical_application_owner": "Technical Application Owner",
    "business_application_owner": "Business Application Owner",
}


@router.get("/subscription-roles")
async def list_roles():
    """Return role definitions for the UI."""
    return [
        {
            "key": k,
            "label": v,
            "allowed_types": list(TYPE_SPECIFIC_ROLES[k]) if k in TYPE_SPECIFIC_ROLES else None,
        }
        for k, v in ROLE_LABELS.items()
    ]


@router.get("/fact-sheets/{fs_id}/subscriptions")
async def list_subscriptions(fs_id: str, db: AsyncSession = Depends(get_db)):
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
            "role_label": ROLE_LABELS.get(s.role, s.role),
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
    if body.role not in ALL_ROLES:
        raise HTTPException(400, f"Invalid role '{body.role}'. Valid: {sorted(ALL_ROLES)}")

    # Check type-specific role constraints
    if body.role in TYPE_SPECIFIC_ROLES:
        fs_result = await db.execute(
            select(FactSheet.type).where(FactSheet.id == uuid.UUID(fs_id))
        )
        fs_type = fs_result.scalar_one_or_none()
        if not fs_type:
            raise HTTPException(404, "Fact sheet not found")
        allowed = TYPE_SPECIFIC_ROLES[body.role]
        if fs_type not in allowed:
            raise HTTPException(
                400,
                f"Role '{body.role}' is only allowed for types: {sorted(allowed)}. "
                f"This fact sheet is type '{fs_type}'.",
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
    return {
        "id": str(sub.id),
        "user_id": str(sub.user_id),
        "user_display_name": sub.user.display_name if sub.user else None,
        "role": sub.role,
        "role_label": ROLE_LABELS.get(sub.role, sub.role),
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

    if body.role not in ALL_ROLES:
        raise HTTPException(400, f"Invalid role '{body.role}'. Valid: {sorted(ALL_ROLES)}")

    if body.role in TYPE_SPECIFIC_ROLES:
        fs_result = await db.execute(
            select(FactSheet.type).where(FactSheet.id == sub.fact_sheet_id)
        )
        fs_type = fs_result.scalar_one_or_none()
        allowed = TYPE_SPECIFIC_ROLES[body.role]
        if fs_type and fs_type not in allowed:
            raise HTTPException(
                400, f"Role '{body.role}' is only allowed for types: {sorted(allowed)}"
            )

    sub.role = body.role
    await db.commit()
    return {
        "id": str(sub.id),
        "user_id": str(sub.user_id),
        "role": sub.role,
        "role_label": ROLE_LABELS.get(sub.role, sub.role),
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
    await db.delete(sub)
    await db.commit()
