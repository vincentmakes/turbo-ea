"""Centralized permission checking service. All route handlers should use this."""

from __future__ import annotations

import time
from collections.abc import Iterable
from uuid import UUID

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.card import Card
from app.models.role import Role
from app.models.stakeholder import Stakeholder
from app.models.stakeholder_role_definition import StakeholderRoleDefinition
from app.models.user import User
from app.services.event_bus import request_impersonation


def _effective_role(user: User) -> str:
    """Return the role key to use for app-level permission checks.

    When the request's JWT carries an ``impersonated_role`` claim the
    middleware in ``app.main`` stashes ``(impersonator_id, role)`` on the
    ``request_impersonation`` contextvar. We use the impersonated role for
    app-level lookups but only when the contextvar's impersonator id
    matches the current user — guards against the (impossible-in-practice)
    case where contextvars leak across requests. Stakeholder permissions
    are not affected; they're keyed by ``user.id`` and remain the
    impersonator's own.
    """
    impersonation = request_impersonation.get()
    if impersonation is not None:
        impersonator_id, impersonated_role = impersonation
        if impersonator_id == str(user.id):
            return impersonated_role
    return user.role


class PermissionService:
    """Centralized permission checking. All route handlers should use this."""

    # In-memory cache: key → (role_obj_dict, timestamp)
    _role_cache: dict[str, tuple[dict, float]] = {}
    CACHE_TTL = 300  # 5 minutes

    # Stakeholder role cache: (type_key, role_key) → (permissions_dict, timestamp)
    _srd_cache: dict[tuple[str, str], tuple[dict | None, float]] = {}

    @staticmethod
    async def load_role(db: AsyncSession, role_key: str) -> dict | None:
        """Load role permissions with caching."""
        now = time.time()
        cached = PermissionService._role_cache.get(role_key)
        if cached and (now - cached[1]) < PermissionService.CACHE_TTL:
            return cached[0]

        result = await db.execute(select(Role).where(Role.key == role_key))
        role = result.scalar_one_or_none()
        if role:
            role_dict = {
                "key": role.key,
                "label": role.label,
                "color": role.color,
                "permissions": dict(role.permissions) if role.permissions else {},
                "is_system": role.is_system,
                "is_default": role.is_default,
                "is_archived": role.is_archived,
            }
            PermissionService._role_cache[role_key] = (role_dict, now)
            return role_dict
        return None

    @staticmethod
    async def has_app_permission(db: AsyncSession, user: User, permission: str) -> bool:
        """Check if user's app-level role grants the given permission.

        Uses ``_effective_role(user)`` so an active role-impersonation
        session is honoured — an admin impersonating "member" gets the
        member role's permission set here, not the admin wildcard.
        """
        role_key = _effective_role(user)
        role_data = await PermissionService.load_role(db, role_key)
        if not role_data:
            return False
        perms = role_data.get("permissions", {})
        if perms.get("*"):
            return True
        return bool(perms.get(permission, False))

    @staticmethod
    async def has_card_permission(
        db: AsyncSession, user: User, card_id: UUID, permission: str
    ) -> bool:
        """Check if user has permission on a specific card via stakeholder role."""
        stakeholder_result = await db.execute(
            select(Stakeholder.role).where(
                Stakeholder.card_id == card_id,
                Stakeholder.user_id == user.id,
            )
        )
        card_type_result = await db.execute(select(Card.type).where(Card.id == card_id))
        type_key = card_type_result.scalar_one_or_none()
        if not type_key:
            return False

        for (role_key,) in stakeholder_result.all():
            # Check cache first
            now = time.time()
            cache_key = (type_key, role_key)
            cached = PermissionService._srd_cache.get(cache_key)
            if cached and (now - cached[1]) < PermissionService.CACHE_TTL:
                perms = cached[0]
            else:
                srd = await db.execute(
                    select(StakeholderRoleDefinition.permissions).where(
                        StakeholderRoleDefinition.card_type_key == type_key,
                        StakeholderRoleDefinition.key == role_key,
                        StakeholderRoleDefinition.is_archived == False,  # noqa: E712
                    )
                )
                perms = srd.scalar_one_or_none()
                PermissionService._srd_cache[cache_key] = (perms, now)

            if perms and perms.get(permission, False):
                return True
        return False

    @staticmethod
    async def check_permission(
        db: AsyncSession,
        user: User,
        app_permission: str,
        card_id: UUID | None = None,
        card_permission: str | None = None,
    ) -> bool:
        """Combined check: returns True if app-level OR card-level grants access."""
        if await PermissionService.has_app_permission(db, user, app_permission):
            return True
        if card_id and card_permission:
            return await PermissionService.has_card_permission(db, user, card_id, card_permission)
        return False

    @staticmethod
    async def require_permission(
        db: AsyncSession,
        user: User,
        app_permission: str,
        card_id: UUID | None = None,
        card_permission: str | None = None,
    ) -> None:
        """Raise 403 if permission check fails."""
        if not await PermissionService.check_permission(
            db, user, app_permission, card_id, card_permission
        ):
            raise HTTPException(403, "Insufficient permissions")

    @staticmethod
    async def is_stakeholder_of(db: AsyncSession, user: User, card_id: UUID) -> bool:
        """Return True if the user holds any stakeholder role on this card."""
        result = await db.execute(
            select(Stakeholder.id)
            .where(
                Stakeholder.card_id == card_id,
                Stakeholder.user_id == user.id,
            )
            .limit(1)
        )
        return result.scalar_one_or_none() is not None

    @staticmethod
    async def can_view_costs(db: AsyncSession, user: User, card_id: UUID) -> bool:
        """Return True if the user may see cost-typed fields on this card.

        Rule: app-level `costs.view` grants access landscape-wide; otherwise
        any stakeholder role on the card grants access to that card's costs.
        """
        if await PermissionService.has_app_permission(db, user, "costs.view"):
            return True
        return await PermissionService.is_stakeholder_of(db, user, card_id)

    @staticmethod
    async def card_ids_with_cost_access(
        db: AsyncSession, user: User, candidate_card_ids: Iterable[UUID]
    ) -> set[UUID]:
        """Bulk variant of `can_view_costs` for list endpoints.

        Returns the subset of candidate card IDs the user can see costs for.
        If the user has the global `costs.view` permission, returns all candidates.
        """
        candidates = list({cid for cid in candidate_card_ids if cid is not None})
        if not candidates:
            return set()
        if await PermissionService.has_app_permission(db, user, "costs.view"):
            return set(candidates)
        result = await db.execute(
            select(Stakeholder.card_id).where(
                Stakeholder.user_id == user.id,
                Stakeholder.card_id.in_(candidates),
            )
        )
        return {row[0] for row in result.all()}

    @staticmethod
    async def get_effective_card_permissions(db: AsyncSession, user: User, card_id: UUID) -> dict:
        """Return the user's effective permissions on a specific card.

        Returns a dict with app_level, stakeholder_roles, card_level, and effective keys.
        """
        # Get user's app-level permissions (honours an active role-
        # impersonation session — see ``_effective_role`` doc).
        role_data = await PermissionService.load_role(db, _effective_role(user))
        app_perms = role_data.get("permissions", {}) if role_data else {}

        # Get card type
        card_type_result = await db.execute(select(Card.type).where(Card.id == card_id))
        type_key = card_type_result.scalar_one_or_none()

        # Get user stakeholder roles on this card
        stakeholder_result = await db.execute(
            select(Stakeholder.role).where(
                Stakeholder.card_id == card_id,
                Stakeholder.user_id == user.id,
            )
        )
        stakeholder_roles = [r for (r,) in stakeholder_result.all()]

        # Aggregate card-level permissions from all stakeholder roles
        card_level: dict[str, bool] = {}
        if type_key:
            for role_key in stakeholder_roles:
                srd = await db.execute(
                    select(StakeholderRoleDefinition.permissions).where(
                        StakeholderRoleDefinition.card_type_key == type_key,
                        StakeholderRoleDefinition.key == role_key,
                        StakeholderRoleDefinition.is_archived == False,  # noqa: E712
                    )
                )
                perms = srd.scalar_one_or_none()
                if perms:
                    for k, v in perms.items():
                        if v:
                            card_level[k] = True

        # Compute effective permissions (union of app-level and card-level)
        is_admin = app_perms.get("*", False)
        effective = {
            "can_view": is_admin
            or app_perms.get("inventory.view", False)
            or card_level.get("card.view", False),
            "can_edit": is_admin
            or app_perms.get("inventory.edit", False)
            or card_level.get("card.edit", False),
            "can_archive": is_admin
            or app_perms.get("inventory.archive", False)
            or card_level.get("card.archive", False),
            "can_delete": is_admin
            or app_perms.get("inventory.delete", False)
            or card_level.get("card.delete", False),
            "can_approval_status": is_admin
            or app_perms.get("inventory.approval_status", False)
            or card_level.get("card.approval_status", False),
            "can_manage_stakeholders": is_admin
            or app_perms.get("stakeholders.manage", False)
            or card_level.get("card.manage_stakeholders", False),
            "can_manage_relations": is_admin
            or app_perms.get("relations.manage", False)
            or card_level.get("card.manage_relations", False),
            "can_manage_documents": is_admin
            or app_perms.get("documents.manage", False)
            or card_level.get("card.manage_documents", False),
            "can_manage_comments": is_admin
            or app_perms.get("comments.manage", False)
            or card_level.get("card.manage_comments", False),
            "can_create_comments": is_admin
            or app_perms.get("comments.create", False)
            or card_level.get("card.create_comments", False),
            "can_bpm_edit": is_admin
            or app_perms.get("bpm.edit", False)
            or card_level.get("card.bpm_edit", False),
            "can_bpm_manage_drafts": is_admin
            or app_perms.get("bpm.manage_drafts", False)
            or card_level.get("card.bpm_manage_drafts", False),
            "can_bpm_approve": is_admin
            or app_perms.get("bpm.approve_flows", False)
            or card_level.get("card.bpm_approve", False),
            "can_bpm_withdraw": is_admin
            or app_perms.get("bpm.withdraw_flows", False)
            or card_level.get("card.bpm_withdraw", False),
            "can_manage_adr_links": is_admin
            or app_perms.get("adr.manage", False)
            or card_level.get("card.manage_adr_links", False),
            "can_manage_diagram_links": is_admin
            or app_perms.get("diagrams.manage", False)
            or card_level.get("card.manage_diagram_links", False),
            "can_view_costs": is_admin
            or app_perms.get("costs.view", False)
            or len(stakeholder_roles) > 0,
        }

        return {
            "app_level": {k: v for k, v in app_perms.items() if k != "*"}
            if not is_admin
            else {"*": True},
            "stakeholder_roles": stakeholder_roles,
            "card_level": card_level,
            "effective": effective,
        }

    @staticmethod
    def invalidate_role_cache(role_key: str | None = None) -> None:
        """Invalidate role cache."""
        if role_key:
            PermissionService._role_cache.pop(role_key, None)
        else:
            PermissionService._role_cache.clear()

    @staticmethod
    def invalidate_srd_cache(type_key: str | None = None, role_key: str | None = None) -> None:
        """Invalidate stakeholder role definition cache."""
        if type_key and role_key:
            PermissionService._srd_cache.pop((type_key, role_key), None)
        elif type_key:
            keys_to_remove = [k for k in PermissionService._srd_cache if k[0] == type_key]
            for k in keys_to_remove:
                del PermissionService._srd_cache[k]
        else:
            PermissionService._srd_cache.clear()
