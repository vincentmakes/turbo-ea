"""Tests for the RBAC permission service.

These are integration tests — they require a PostgreSQL test database.
"""

from __future__ import annotations

import pytest
from fastapi import HTTPException

from app.services.permission_service import PermissionService
from tests.conftest import create_role, create_user

# ---------------------------------------------------------------------------
# has_app_permission
# ---------------------------------------------------------------------------


class TestHasAppPermission:
    async def test_admin_wildcard_grants_any_permission(self, db):
        await create_role(db, key="admin", permissions={"*": True})
        user = await create_user(db, role="admin")

        assert await PermissionService.has_app_permission(db, user, "inventory.view") is True
        assert await PermissionService.has_app_permission(db, user, "admin.settings") is True
        assert await PermissionService.has_app_permission(db, user, "anything.at.all") is True

    async def test_member_has_inventory_view(self, db):
        from app.core.permissions import MEMBER_PERMISSIONS

        await create_role(db, key="member", permissions=MEMBER_PERMISSIONS)
        user = await create_user(db, role="member")

        assert await PermissionService.has_app_permission(db, user, "inventory.view") is True

    async def test_member_denied_admin_settings(self, db):
        from app.core.permissions import MEMBER_PERMISSIONS

        await create_role(db, key="member", permissions=MEMBER_PERMISSIONS)
        user = await create_user(db, role="member")

        assert await PermissionService.has_app_permission(db, user, "admin.settings") is False

    async def test_viewer_denied_inventory_create(self, db):
        from app.core.permissions import VIEWER_PERMISSIONS

        await create_role(db, key="viewer", permissions=VIEWER_PERMISSIONS)
        user = await create_user(db, role="viewer")

        assert await PermissionService.has_app_permission(db, user, "inventory.create") is False

    async def test_viewer_has_inventory_view(self, db):
        from app.core.permissions import VIEWER_PERMISSIONS

        await create_role(db, key="viewer", permissions=VIEWER_PERMISSIONS)
        user = await create_user(db, role="viewer")

        assert await PermissionService.has_app_permission(db, user, "inventory.view") is True

    async def test_nonexistent_role_returns_false(self, db):
        user = await create_user(db, role="nonexistent")

        assert await PermissionService.has_app_permission(db, user, "inventory.view") is False


# ---------------------------------------------------------------------------
# require_permission
# ---------------------------------------------------------------------------


class TestRequirePermission:
    async def test_passes_for_admin(self, db):
        await create_role(db, key="admin", permissions={"*": True})
        user = await create_user(db, role="admin")

        # Should NOT raise
        await PermissionService.require_permission(db, user, "admin.settings")

    async def test_raises_403_for_viewer_on_create(self, db):
        from app.core.permissions import VIEWER_PERMISSIONS

        await create_role(db, key="viewer", permissions=VIEWER_PERMISSIONS)
        user = await create_user(db, role="viewer")

        with pytest.raises(HTTPException) as exc_info:
            await PermissionService.require_permission(db, user, "inventory.create")
        assert exc_info.value.status_code == 403


# ---------------------------------------------------------------------------
# check_permission (app-level only, no card)
# ---------------------------------------------------------------------------


class TestCheckPermission:
    async def test_app_level_grants_access(self, db):
        from app.core.permissions import MEMBER_PERMISSIONS

        await create_role(db, key="member", permissions=MEMBER_PERMISSIONS)
        user = await create_user(db, role="member")

        assert await PermissionService.check_permission(db, user, "inventory.edit") is True

    async def test_app_level_denies_access(self, db):
        from app.core.permissions import VIEWER_PERMISSIONS

        await create_role(db, key="viewer", permissions=VIEWER_PERMISSIONS)
        user = await create_user(db, role="viewer")

        assert await PermissionService.check_permission(db, user, "inventory.edit") is False


# ---------------------------------------------------------------------------
# Cache invalidation
# ---------------------------------------------------------------------------


class TestCacheInvalidation:
    async def test_invalidate_specific_role(self, db):
        await create_role(db, key="admin", permissions={"*": True})
        await create_user(db, role="admin")

        # Load into cache
        await PermissionService.load_role(db, "admin")
        assert "admin" in PermissionService._role_cache

        PermissionService.invalidate_role_cache("admin")
        assert "admin" not in PermissionService._role_cache

    async def test_invalidate_all_roles(self, db):
        from app.core.permissions import MEMBER_PERMISSIONS

        await create_role(db, key="admin", permissions={"*": True})
        await create_role(db, key="member", permissions=MEMBER_PERMISSIONS)

        await PermissionService.load_role(db, "admin")
        await PermissionService.load_role(db, "member")

        PermissionService.invalidate_role_cache()
        assert len(PermissionService._role_cache) == 0

    def test_invalidate_srd_specific(self):
        PermissionService._srd_cache[("Application", "responsible")] = (
            {"card.view": True},
            0,
        )
        PermissionService._srd_cache[("Application", "observer")] = (
            {"card.view": True},
            0,
        )

        PermissionService.invalidate_srd_cache("Application", "responsible")
        assert ("Application", "responsible") not in PermissionService._srd_cache
        assert ("Application", "observer") in PermissionService._srd_cache

    def test_invalidate_srd_by_type(self):
        PermissionService._srd_cache[("Application", "responsible")] = (
            {"card.view": True},
            0,
        )
        PermissionService._srd_cache[("DataObject", "responsible")] = (
            {"card.view": True},
            0,
        )

        PermissionService.invalidate_srd_cache("Application")
        assert ("Application", "responsible") not in PermissionService._srd_cache
        assert ("DataObject", "responsible") in PermissionService._srd_cache

    def test_invalidate_srd_all(self):
        PermissionService._srd_cache[("A", "x")] = ({"card.view": True}, 0)
        PermissionService._srd_cache[("B", "y")] = ({"card.view": True}, 0)

        PermissionService.invalidate_srd_cache()
        assert len(PermissionService._srd_cache) == 0
