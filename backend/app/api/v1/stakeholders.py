from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.database import get_db
from app.models.card import Card
from app.models.card_type import CardType
from app.models.stakeholder import Stakeholder
from app.models.stakeholder_role_definition import StakeholderRoleDefinition
from app.models.user import User
from app.schemas.common import StakeholderCreate
from app.services.permission_service import PermissionService

router = APIRouter(tags=["stakeholders"])

_DEFAULT_ROLES = [
    {"key": "responsible", "label": "Responsible"},
    {"key": "observer", "label": "Observer"},
]


async def _roles_for_type(db: AsyncSession, type_key: str) -> list[dict]:
    """Return active stakeholder roles from stakeholder_role_definitions table."""
    result = await db.execute(
        select(StakeholderRoleDefinition)
        .where(
            StakeholderRoleDefinition.card_type_key == type_key,
            StakeholderRoleDefinition.is_archived == False,  # noqa: E712
        )
        .order_by(StakeholderRoleDefinition.sort_order)
    )
    srds = result.scalars().all()
    if srds:
        return [{"key": s.key, "label": s.label, "color": s.color} for s in srds]
    # Fallback to JSONB for backward compat during migration
    result = await db.execute(
        select(CardType.stakeholder_roles).where(CardType.key == type_key)
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


@router.get("/stakeholder-roles")
async def list_roles(
    type_key: str | None = Query(None, description="Filter roles by card type"),
    db: AsyncSession = Depends(get_db),
):
    """Return role definitions from stakeholder_role_definitions table."""
    if type_key:
        roles = await _roles_for_type(db, type_key)
        return [{"key": r["key"], "label": r["label"]} for r in roles]

    # Return all unique active roles across all types
    result = await db.execute(
        select(StakeholderRoleDefinition.key, StakeholderRoleDefinition.label)
        .where(StakeholderRoleDefinition.is_archived == False)  # noqa: E712
        .distinct(StakeholderRoleDefinition.key)
        .order_by(StakeholderRoleDefinition.key)
    )
    return [{"key": row[0], "label": row[1]} for row in result.all()]


@router.get("/cards/{card_id}/stakeholders")
async def list_stakeholders(
    card_id: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    await PermissionService.require_permission(db, user, "stakeholders.view")
    card_result = await db.execute(
        select(Card.type).where(Card.id == uuid.UUID(card_id))
    )
    card_type_key = card_result.scalar_one_or_none()
    roles = await _roles_for_type(db, card_type_key) if card_type_key else _DEFAULT_ROLES
    labels = _role_labels(roles)

    result = await db.execute(
        select(Stakeholder).where(Stakeholder.card_id == uuid.UUID(card_id))
    )
    stakeholder_list = result.scalars().all()
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
        for s in stakeholder_list
    ]


@router.post("/cards/{card_id}/stakeholders", status_code=201)
async def create_stakeholder(
    card_id: str,
    body: StakeholderCreate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    card_uuid = uuid.UUID(card_id)
    if not await PermissionService.check_permission(
        db, user, "stakeholders.manage", card_uuid, "card.manage_stakeholders"
    ):
        raise HTTPException(403, "Not enough permissions")
    card_result = await db.execute(
        select(Card.type).where(Card.id == card_uuid)
    )
    card_type_key = card_result.scalar_one_or_none()
    if not card_type_key:
        raise HTTPException(404, "Card not found")

    roles = await _roles_for_type(db, card_type_key)
    valid_keys = {r["key"] for r in roles}
    if body.role not in valid_keys:
        raise HTTPException(
            400,
            f"Invalid role '{body.role}'. Valid for {card_type_key}: {sorted(valid_keys)}",
        )

    # Prevent duplicate role for same user on same card
    existing = await db.execute(
        select(Stakeholder).where(
            Stakeholder.card_id == uuid.UUID(card_id),
            Stakeholder.user_id == uuid.UUID(body.user_id),
            Stakeholder.role == body.role,
        )
    )
    if existing.scalar_one_or_none():
        raise HTTPException(409, "User already has this role on this card")

    stakeholder = Stakeholder(
        card_id=uuid.UUID(card_id),
        user_id=uuid.UUID(body.user_id),
        role=body.role,
    )
    db.add(stakeholder)
    await db.commit()
    await db.refresh(stakeholder)

    labels = _role_labels(roles)
    return {
        "id": str(stakeholder.id),
        "user_id": str(stakeholder.user_id),
        "user_display_name": stakeholder.user.display_name if stakeholder.user else None,
        "role": stakeholder.role,
        "role_label": labels.get(stakeholder.role, stakeholder.role),
    }


@router.patch("/stakeholders/{stakeholder_id}")
async def update_stakeholder(
    stakeholder_id: str,
    body: StakeholderCreate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    result = await db.execute(select(Stakeholder).where(Stakeholder.id == uuid.UUID(stakeholder_id)))
    stakeholder = result.scalar_one_or_none()
    if not stakeholder:
        raise HTTPException(404, "Stakeholder not found")
    if not await PermissionService.check_permission(
        db, user, "stakeholders.manage", stakeholder.card_id, "card.manage_stakeholders"
    ):
        raise HTTPException(403, "Not enough permissions")

    card_result = await db.execute(
        select(Card.type).where(Card.id == stakeholder.card_id)
    )
    card_type_key = card_result.scalar_one_or_none()
    roles = await _roles_for_type(db, card_type_key) if card_type_key else _DEFAULT_ROLES
    valid_keys = {r["key"] for r in roles}
    if body.role not in valid_keys:
        raise HTTPException(400, f"Invalid role '{body.role}'. Valid: {sorted(valid_keys)}")

    stakeholder.role = body.role
    await db.commit()

    labels = _role_labels(roles)
    return {
        "id": str(stakeholder.id),
        "user_id": str(stakeholder.user_id),
        "role": stakeholder.role,
        "role_label": labels.get(stakeholder.role, stakeholder.role),
    }


@router.delete("/stakeholders/{stakeholder_id}", status_code=204)
async def delete_stakeholder(
    stakeholder_id: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    result = await db.execute(select(Stakeholder).where(Stakeholder.id == uuid.UUID(stakeholder_id)))
    stakeholder = result.scalar_one_or_none()
    if not stakeholder:
        raise HTTPException(404, "Stakeholder not found")
    if not await PermissionService.check_permission(
        db, user, "stakeholders.manage", stakeholder.card_id, "card.manage_stakeholders"
    ):
        raise HTTPException(403, "Not enough permissions")
    await db.delete(stakeholder)
    await db.commit()
