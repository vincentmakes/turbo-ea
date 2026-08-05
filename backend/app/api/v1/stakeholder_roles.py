"""Stakeholder role definition management API routes."""

from __future__ import annotations

import re
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.core.permissions import ALL_CARD_PERMISSION_KEYS, CARD_PERMISSIONS
from app.database import get_db
from app.models.card import Card
from app.models.card_type import CardType
from app.models.stakeholder import Stakeholder
from app.models.stakeholder_role_definition import StakeholderRoleDefinition
from app.models.survey import Survey
from app.models.user import User
from app.services.permission_service import PermissionService

router = APIRouter(tags=["stakeholder-roles"])

# Stakeholder role keys follow the same camelCase grammar as every other
# metamodel key (card types, fields, options, relation types, subtypes) — see
# ``frontend/src/components/KeyInput.tsx``. This deliberately matches the shared
# KeyInput component: the two used to disagree (the UI stripped underscores and
# allowed uppercase, this pattern required snake_case), so a key the UI happily
# accepted was rejected here with a raw regex in the error message (#907).
#
# Only *new* keys are validated. Pre-existing snake_case keys — from an older
# install, the API, or a workspace-transfer bundle — are never re-validated on
# read or update, so they keep working untouched.
ROLE_KEY_PATTERN = re.compile(r"^[a-zA-Z][a-zA-Z0-9]{2,49}$")
_KEY_RULE = "Key must be 3-50 characters, start with a letter, and contain only letters and digits (camelCase)"  # noqa: E501


# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------


class StakeholderRoleCreate(BaseModel):
    key: str = Field(..., min_length=3, max_length=50)
    label: str = Field(..., min_length=1, max_length=200)
    description: str | None = None
    color: str = "#757575"
    permissions: dict[str, bool] = {}
    translations: dict = {}

    @field_validator("key")
    @classmethod
    def validate_key(cls, v: str) -> str:
        if not ROLE_KEY_PATTERN.match(v):
            raise ValueError(_KEY_RULE)
        return v

    @field_validator("permissions")
    @classmethod
    def validate_permissions(cls, v: dict[str, bool]) -> dict[str, bool]:
        unknown = set(v.keys()) - ALL_CARD_PERMISSION_KEYS
        if unknown:
            raise ValueError(f"Unknown permission keys: {', '.join(sorted(unknown))}")
        return v


class StakeholderRoleUpdate(BaseModel):
    # A key may be changed only while the role is unused — see ``_role_usage``.
    key: str | None = Field(None, min_length=3, max_length=50)
    label: str | None = None
    description: str | None = None
    color: str | None = None
    permissions: dict[str, bool] | None = None
    sort_order: int | None = None
    translations: dict | None = None

    @field_validator("key")
    @classmethod
    def validate_key(cls, v: str | None) -> str | None:
        if v is not None and not ROLE_KEY_PATTERN.match(v):
            raise ValueError(_KEY_RULE)
        return v

    @field_validator("permissions")
    @classmethod
    def validate_permissions(cls, v: dict[str, bool] | None) -> dict[str, bool] | None:
        if v is not None:
            unknown = set(v.keys()) - ALL_CARD_PERMISSION_KEYS
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
        "translations": srd.translations or {},
    }
    if stakeholder_count is not None:
        data["stakeholder_count"] = stakeholder_count
    return data


async def _ensure_type_exists(db: AsyncSession, type_key: str) -> None:
    result = await db.execute(select(CardType).where(CardType.key == type_key))
    if not result.scalar_one_or_none():
        raise HTTPException(404, f"Card type '{type_key}' not found")


async def _stakeholder_count(db: AsyncSession, type_key: str, role_key: str) -> int:
    """Count stakeholder assignments for a role **on cards of this card type**.

    The card-type join is essential: ``stakeholders.role`` is a bare string with
    no foreign key, and the same role key legitimately exists on many card types
    (``responsible`` is defined on every one of them). Counting by role key alone
    reports every assignment across the whole instance.
    """
    result = await db.execute(
        select(func.count(Stakeholder.id))
        .join(Card, Stakeholder.card_id == Card.id)
        .where(Card.type == type_key, Stakeholder.role == role_key)
    )
    return result.scalar() or 0


async def _role_usage(db: AsyncSession, type_key: str, role_key: str) -> dict:
    """Everything that blocks deleting or re-keying a stakeholder role.

    Shared by the usage endpoint, ``DELETE`` and the re-key path in ``PATCH`` so
    the preview the admin is shown and the guard the server enforces can never
    drift apart.
    """
    stakeholder_count = await _stakeholder_count(db, type_key, role_key)

    card_count = (
        await db.execute(
            select(func.count(func.distinct(Stakeholder.card_id)))
            .join(Card, Stakeholder.card_id == Card.id)
            .where(Card.type == type_key, Stakeholder.role == role_key)
        )
    ).scalar() or 0

    survey_count = (
        await db.execute(
            select(func.count(Survey.id)).where(
                Survey.target_type_key == type_key,
                Survey.target_roles.contains([role_key]),
            )
        )
    ).scalar() or 0

    other_active = (
        await db.execute(
            select(func.count(StakeholderRoleDefinition.id)).where(
                StakeholderRoleDefinition.card_type_key == type_key,
                StakeholderRoleDefinition.is_archived == False,  # noqa: E712
                StakeholderRoleDefinition.key != role_key,
            )
        )
    ).scalar() or 0

    return {
        "role_key": role_key,
        "stakeholder_count": stakeholder_count,
        "card_count": card_count,
        "survey_count": survey_count,
        "is_last_active": other_active == 0,
    }


def _usage_blocker(usage: dict, action: str) -> str | None:
    """Human-readable reason this role cannot be deleted / re-keyed, if any.

    The two actions do not answer for the same things, and conflating them made
    built-in roles look permanently un-renamable:

    - **Live assignments** block both. A rename would leave every
      ``stakeholders.role`` string pointing at a key that no longer exists, and
      there is no foreign key to catch it.
    - **A survey targeting the role** blocks only a delete. A rename keeps the
      role, so the survey's ``target_roles`` simply follows it — see
      ``_rewrite_survey_roles``. Deleting cannot follow anything: dropping the
      role from the survey's targets would silently change what the survey asks.
    - **Being the type's last active role** blocks only a delete, which would
      leave the type with none and hand it back to the legacy JSONB fallback.
      A rename keeps the count exactly as it was.

    So a rename is refused only while somebody actually holds the role.
    """
    if usage["stakeholder_count"]:
        return (
            f"Cannot {action} role '{usage['role_key']}': it is assigned to "
            f"{usage['stakeholder_count']} stakeholder(s) on {usage['card_count']} card(s). "
            "Remove those assignments, or archive the role instead."
        )
    if action != "delete":
        return None
    if usage["survey_count"]:
        return (
            f"Cannot {action} role '{usage['role_key']}': {usage['survey_count']} survey(s) "
            "target it. Update those surveys first."
        )
    if usage["is_last_active"]:
        return f"Cannot {action} the last active stakeholder role for this type"
    return None


async def _rewrite_jsonb_role(
    db: AsyncSession, type_key: str, role_key: str, new_key: str | None
) -> None:
    """Rename (or drop, when ``new_key`` is None) a role in the legacy JSONB mirror.

    ``card_types.stakeholder_roles`` is a legacy copy that ``_roles_for_type``
    (``stakeholders.py``) still falls back to whenever the definition table has
    no rows for a type. Leaving a stale entry there means a deleted role can
    reappear; the column must be reassigned rather than mutated in place for
    SQLAlchemy to flush the change.
    """
    result = await db.execute(select(CardType).where(CardType.key == type_key))
    card_type = result.scalar_one_or_none()
    if not card_type or not card_type.stakeholder_roles:
        return

    updated = []
    for entry in card_type.stakeholder_roles:
        if entry.get("key") != role_key:
            updated.append(entry)
        elif new_key is not None:
            updated.append({**entry, "key": new_key})
    card_type.stakeholder_roles = updated


async def _rewrite_survey_roles(
    db: AsyncSession, type_key: str, role_key: str, new_key: str
) -> None:
    """Follow a role re-key into the surveys that target it.

    ``surveys.target_roles`` is a JSONB array of role-key strings with no
    foreign key, so a rename would otherwise leave the survey targeting a key
    that no longer exists — it would quietly reach nobody. Reassign the list
    rather than mutating it in place so SQLAlchemy flushes the change.
    """
    result = await db.execute(
        select(Survey).where(
            Survey.target_type_key == type_key,
            Survey.target_roles.contains([role_key]),
        )
    )
    for survey in result.scalars().all():
        survey.target_roles = [new_key if r == role_key else r for r in (survey.target_roles or [])]


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
    """List stakeholder roles for a card type, each with its assignment count."""
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

    # One grouped query for every role rather than a count per row — the panel
    # renders this list on every card-type drawer open.
    count_rows = (
        await db.execute(
            select(Stakeholder.role, func.count(Stakeholder.id))
            .join(Card, Stakeholder.card_id == Card.id)
            .where(Card.type == type_key)
            .group_by(Stakeholder.role)
        )
    ).all()
    counts: dict[str, int] = {role: count for role, count in count_rows}

    return [_srd_response(srd, stakeholder_count=counts.get(srd.key, 0)) for srd in srds]


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

    stakeholder_count = await _stakeholder_count(db, type_key, role_key)
    return _srd_response(srd, stakeholder_count=stakeholder_count)


@router.get("/metamodel/types/{type_key}/stakeholder-roles/{role_key}/usage")
async def stakeholder_role_usage(
    type_key: str,
    role_key: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Report what would block deleting or re-keying this role.

    Mirrors ``GET /metamodel/types/{key}/field-usage`` so the admin UI can show
    the impact before offering a destructive action.
    """
    await PermissionService.require_permission(db, user, "admin.metamodel")

    result = await db.execute(
        select(StakeholderRoleDefinition).where(
            StakeholderRoleDefinition.card_type_key == type_key,
            StakeholderRoleDefinition.key == role_key,
        )
    )
    if not result.scalar_one_or_none():
        raise HTTPException(404, "Stakeholder role not found")

    usage = await _role_usage(db, type_key, role_key)
    usage["can_delete"] = _usage_blocker(usage, "delete") is None
    usage["can_rekey"] = _usage_blocker(usage, "rename") is None
    return usage


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
        translations=body.translations,
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

    # ── Re-key ────────────────────────────────────────────────────────────────
    # Allowed only while the role is unused, which is what keeps this a
    # single-row update: nothing in `stakeholders`, `surveys` or the permission
    # caches can be pointing at the old key, so there is no cascade to get wrong.
    new_key = data.pop("key", None)
    if new_key is not None and new_key != role_key:
        blocker = _usage_blocker(await _role_usage(db, type_key, role_key), "rename")
        if blocker:
            raise HTTPException(409, blocker)

        clash = await db.execute(
            select(StakeholderRoleDefinition).where(
                StakeholderRoleDefinition.card_type_key == type_key,
                StakeholderRoleDefinition.key == new_key,
            )
        )
        if clash.scalar_one_or_none():
            raise HTTPException(
                409, f"Stakeholder role '{new_key}' already exists for type '{type_key}'"
            )

        srd.key = new_key
        await _rewrite_jsonb_role(db, type_key, role_key, new_key)
        await _rewrite_survey_roles(db, type_key, role_key, new_key)
    else:
        new_key = None

    for field, value in data.items():
        if field == "translations":
            # NOT NULL column — a client clearing every translation must land an
            # empty map, not a constraint violation.
            value = value or {}
        setattr(srd, field, value)

    await db.commit()
    await db.refresh(srd)
    PermissionService.invalidate_srd_cache(type_key, role_key)
    if new_key:
        PermissionService.invalidate_srd_cache(type_key, new_key)
    return _srd_response(srd)


@router.delete("/metamodel/types/{type_key}/stakeholder-roles/{role_key}", status_code=204)
async def delete_stakeholder_role(
    type_key: str,
    role_key: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Permanently delete an **unused** stakeholder role.

    Refused (409) while anyone holds the role on a card of this type, while a
    survey targets it, or when it is the type's last active role — archive is the
    answer in those cases. Deleting an in-use role would silently strip the
    card-level permissions it grants from real users, unrecoverably, and
    ``stakeholders.role`` has no foreign key to make that visible.
    """
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

    blocker = _usage_blocker(await _role_usage(db, type_key, role_key), "delete")
    if blocker:
        raise HTTPException(409, blocker)

    await db.delete(srd)
    await _rewrite_jsonb_role(db, type_key, role_key, None)
    await db.commit()
    PermissionService.invalidate_srd_cache(type_key, role_key)


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
        raise HTTPException(409, "Cannot archive the last active stakeholder role for this type")

    # Count affected stakeholders — scoped to cards of this type.
    affected_count = await _stakeholder_count(db, type_key, role_key)

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
async def card_permissions_schema(user: User = Depends(get_current_user)):
    """Return the full card-level permission key catalog."""
    return CARD_PERMISSIONS
