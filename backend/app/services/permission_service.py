"""Centralized permission checking service. All route handlers should use this."""

from __future__ import annotations

import time
from uuid import UUID

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.permissions import FS_TO_APP_PERMISSION_MAP
from app.models.fact_sheet import FactSheet
from app.models.role import Role
from app.models.subscription import Subscription
from app.models.subscription_role_definition import SubscriptionRoleDefinition
from app.models.user import User


class PermissionService:
    """Centralized permission checking. All route handlers should use this."""

    # In-memory cache: key → (role_obj_dict, timestamp)
    _role_cache: dict[str, tuple[dict, float]] = {}
    CACHE_TTL = 300  # 5 minutes

    # Subscription role cache: (type_key, role_key) → (permissions_dict, timestamp)
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
        """Check if user's app-level role grants the given permission."""
        role_key = user.role
        role_data = await PermissionService.load_role(db, role_key)
        if not role_data:
            return False
        perms = role_data.get("permissions", {})
        if perms.get("*"):
            return True
        return bool(perms.get(permission, False))

    @staticmethod
    async def has_fs_permission(
        db: AsyncSession, user: User, fact_sheet_id: UUID, permission: str
    ) -> bool:
        """Check if user has permission on a specific fact sheet via subscription."""
        subs = await db.execute(
            select(Subscription.role).where(
                Subscription.fact_sheet_id == fact_sheet_id,
                Subscription.user_id == user.id,
            )
        )
        fs_type_result = await db.execute(
            select(FactSheet.type).where(FactSheet.id == fact_sheet_id)
        )
        type_key = fs_type_result.scalar_one_or_none()
        if not type_key:
            return False

        for (sub_role,) in subs.all():
            # Check cache first
            now = time.time()
            cache_key = (type_key, sub_role)
            cached = PermissionService._srd_cache.get(cache_key)
            if cached and (now - cached[1]) < PermissionService.CACHE_TTL:
                perms = cached[0]
            else:
                srd = await db.execute(
                    select(SubscriptionRoleDefinition.permissions).where(
                        SubscriptionRoleDefinition.fact_sheet_type_key == type_key,
                        SubscriptionRoleDefinition.key == sub_role,
                        SubscriptionRoleDefinition.is_archived == False,  # noqa: E712
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
        fact_sheet_id: UUID | None = None,
        fs_permission: str | None = None,
    ) -> bool:
        """Combined check: returns True if app-level OR fact-sheet-level grants access."""
        if await PermissionService.has_app_permission(db, user, app_permission):
            return True
        if fact_sheet_id and fs_permission:
            return await PermissionService.has_fs_permission(
                db, user, fact_sheet_id, fs_permission
            )
        return False

    @staticmethod
    async def require_permission(
        db: AsyncSession,
        user: User,
        app_permission: str,
        fact_sheet_id: UUID | None = None,
        fs_permission: str | None = None,
    ) -> None:
        """Raise 403 if permission check fails."""
        if not await PermissionService.check_permission(
            db, user, app_permission, fact_sheet_id, fs_permission
        ):
            raise HTTPException(403, "Insufficient permissions")

    @staticmethod
    async def get_effective_fs_permissions(
        db: AsyncSession, user: User, fact_sheet_id: UUID
    ) -> dict:
        """Return the user's effective permissions on a specific fact sheet.

        Returns a dict with app_level, subscription_roles, fs_level, and effective keys.
        """
        # Get user's app-level permissions
        role_data = await PermissionService.load_role(db, user.role)
        app_perms = role_data.get("permissions", {}) if role_data else {}

        # Get fact sheet type
        fs_type_result = await db.execute(
            select(FactSheet.type).where(FactSheet.id == fact_sheet_id)
        )
        type_key = fs_type_result.scalar_one_or_none()

        # Get user subscriptions on this FS
        subs = await db.execute(
            select(Subscription.role).where(
                Subscription.fact_sheet_id == fact_sheet_id,
                Subscription.user_id == user.id,
            )
        )
        sub_roles = [r for (r,) in subs.all()]

        # Aggregate FS-level permissions from all subscriptions
        fs_level: dict[str, bool] = {}
        if type_key:
            for sub_role in sub_roles:
                srd = await db.execute(
                    select(SubscriptionRoleDefinition.permissions).where(
                        SubscriptionRoleDefinition.fact_sheet_type_key == type_key,
                        SubscriptionRoleDefinition.key == sub_role,
                        SubscriptionRoleDefinition.is_archived == False,  # noqa: E712
                    )
                )
                perms = srd.scalar_one_or_none()
                if perms:
                    for k, v in perms.items():
                        if v:
                            fs_level[k] = True

        # Compute effective permissions (union of app-level and FS-level)
        is_admin = app_perms.get("*", False)
        effective = {
            "can_view": is_admin or app_perms.get("inventory.view", False) or fs_level.get("fs.view", False),
            "can_edit": is_admin or app_perms.get("inventory.edit", False) or fs_level.get("fs.edit", False),
            "can_delete": is_admin or app_perms.get("inventory.delete", False) or fs_level.get("fs.delete", False),
            "can_quality_seal": is_admin or app_perms.get("inventory.quality_seal", False) or fs_level.get("fs.quality_seal", False),
            "can_manage_subscriptions": is_admin or app_perms.get("subscriptions.manage", False) or fs_level.get("fs.manage_subscriptions", False),
            "can_manage_relations": is_admin or app_perms.get("relations.manage", False) or fs_level.get("fs.manage_relations", False),
            "can_manage_documents": is_admin or app_perms.get("documents.manage", False) or fs_level.get("fs.manage_documents", False),
            "can_manage_comments": is_admin or app_perms.get("comments.manage", False) or fs_level.get("fs.manage_comments", False),
            "can_create_comments": is_admin or app_perms.get("comments.create", False) or fs_level.get("fs.create_comments", False),
            "can_bpm_edit": is_admin or app_perms.get("bpm.edit", False) or fs_level.get("fs.bpm_edit", False),
            "can_bpm_manage_drafts": is_admin or app_perms.get("bpm.manage_drafts", False) or fs_level.get("fs.bpm_manage_drafts", False),
            "can_bpm_approve": is_admin or app_perms.get("bpm.approve_flows", False) or fs_level.get("fs.bpm_approve", False),
        }

        return {
            "app_level": {k: v for k, v in app_perms.items() if k != "*"} if not is_admin else {"*": True},
            "subscription_roles": sub_roles,
            "fs_level": fs_level,
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
        """Invalidate subscription role definition cache."""
        if type_key and role_key:
            PermissionService._srd_cache.pop((type_key, role_key), None)
        elif type_key:
            keys_to_remove = [k for k in PermissionService._srd_cache if k[0] == type_key]
            for k in keys_to_remove:
                del PermissionService._srd_cache[k]
        else:
            PermissionService._srd_cache.clear()
