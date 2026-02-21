"""Extended permission service tests — card-level permissions and effective permissions.

These are integration tests requiring a PostgreSQL test database.
"""

from __future__ import annotations

import uuid

import pytest

from app.core.permissions import (
    MEMBER_PERMISSIONS,
    OBSERVER_CARD_PERMISSIONS,
    RESPONSIBLE_CARD_PERMISSIONS,
    VIEWER_PERMISSIONS,
)
from app.services.permission_service import PermissionService
from tests.conftest import (
    create_card,
    create_card_type,
    create_role,
    create_stakeholder_role_def,
    create_user,
)


@pytest.fixture
async def perm_env(db):
    """Shared test data for permission tests."""
    await create_role(db, key="admin", label="Admin", permissions={"*": True})
    await create_role(db, key="member", label="Member", permissions=MEMBER_PERMISSIONS)
    await create_role(db, key="viewer", label="Viewer", permissions=VIEWER_PERMISSIONS)

    ct = await create_card_type(db, key="Application", label="Application")
    admin = await create_user(db, email="admin@test.com", role="admin")
    member = await create_user(db, email="member@test.com", role="member")
    viewer = await create_user(db, email="viewer@test.com", role="viewer")

    card = await create_card(db, card_type="Application", name="Test App", user_id=admin.id)

    return {"ct": ct, "admin": admin, "member": member, "viewer": viewer, "card": card}


async def _assign_stakeholder(db, card_id, user_id, role_key):
    """Helper to assign a stakeholder role to a user on a card."""
    from app.models.stakeholder import Stakeholder

    s = Stakeholder(card_id=card_id, user_id=user_id, role=role_key)
    db.add(s)
    await db.flush()
    return s


# ---------------------------------------------------------------------------
# has_card_permission
# ---------------------------------------------------------------------------


class TestHasCardPermission:
    async def test_no_stakeholder_returns_false(self, db, perm_env):
        """User with no stakeholder role on card gets False."""
        result = await PermissionService.has_card_permission(
            db, perm_env["viewer"], perm_env["card"].id, "card.edit"
        )
        assert result is False

    async def test_stakeholder_with_permission_returns_true(self, db, perm_env):
        """User with stakeholder role that grants permission gets True."""
        await create_stakeholder_role_def(
            db,
            card_type_key="Application",
            key="responsible",
            label="Responsible",
            permissions=RESPONSIBLE_CARD_PERMISSIONS,
        )
        await _assign_stakeholder(db, perm_env["card"].id, perm_env["viewer"].id, "responsible")

        result = await PermissionService.has_card_permission(
            db, perm_env["viewer"], perm_env["card"].id, "card.edit"
        )
        assert result is True

    async def test_stakeholder_without_permission_returns_false(self, db, perm_env):
        """User with observer role (no edit) should not get card.edit."""
        await create_stakeholder_role_def(
            db,
            card_type_key="Application",
            key="observer",
            label="Observer",
            permissions=OBSERVER_CARD_PERMISSIONS,
        )
        await _assign_stakeholder(db, perm_env["card"].id, perm_env["viewer"].id, "observer")

        result = await PermissionService.has_card_permission(
            db, perm_env["viewer"], perm_env["card"].id, "card.edit"
        )
        assert result is False

    async def test_observer_can_view(self, db, perm_env):
        """Observer role should grant card.view."""
        await create_stakeholder_role_def(
            db,
            card_type_key="Application",
            key="observer",
            label="Observer",
            permissions=OBSERVER_CARD_PERMISSIONS,
        )
        await _assign_stakeholder(db, perm_env["card"].id, perm_env["viewer"].id, "observer")

        result = await PermissionService.has_card_permission(
            db, perm_env["viewer"], perm_env["card"].id, "card.view"
        )
        assert result is True

    async def test_multiple_roles_any_grants(self, db, perm_env):
        """User with multiple roles — if any role grants the permission, return True."""
        await create_stakeholder_role_def(
            db,
            card_type_key="Application",
            key="observer",
            label="Observer",
            permissions=OBSERVER_CARD_PERMISSIONS,
        )
        await create_stakeholder_role_def(
            db,
            card_type_key="Application",
            key="responsible",
            label="Responsible",
            permissions=RESPONSIBLE_CARD_PERMISSIONS,
        )
        user = perm_env["viewer"]
        card_id = perm_env["card"].id
        await _assign_stakeholder(db, card_id, user.id, "observer")
        await _assign_stakeholder(db, card_id, user.id, "responsible")

        # Observer doesn't have edit, but responsible does
        result = await PermissionService.has_card_permission(db, user, card_id, "card.edit")
        assert result is True

    async def test_nonexistent_card_returns_false(self, db, perm_env):
        """Card that doesn't exist should return False."""
        result = await PermissionService.has_card_permission(
            db, perm_env["admin"], uuid.uuid4(), "card.view"
        )
        assert result is False

    async def test_archived_srd_not_used(self, db, perm_env):
        """Archived stakeholder role definitions should not grant permissions."""
        await create_stakeholder_role_def(
            db,
            card_type_key="Application",
            key="archived_role",
            label="Archived",
            permissions={"card.view": True, "card.edit": True},
            is_archived=True,
        )
        await _assign_stakeholder(db, perm_env["card"].id, perm_env["viewer"].id, "archived_role")

        result = await PermissionService.has_card_permission(
            db, perm_env["viewer"], perm_env["card"].id, "card.edit"
        )
        assert result is False


# ---------------------------------------------------------------------------
# check_permission (combined app + card)
# ---------------------------------------------------------------------------


class TestCheckPermissionCombined:
    async def test_app_grants_access_without_card(self, db, perm_env):
        """If app-level permission grants access, card-level is not needed."""
        result = await PermissionService.check_permission(db, perm_env["member"], "inventory.edit")
        assert result is True

    async def test_app_denied_card_grants_access(self, db, perm_env):
        """Viewer denied app-level edit, but stakeholder role grants card-level edit."""
        await create_stakeholder_role_def(
            db,
            card_type_key="Application",
            key="responsible",
            label="Responsible",
            permissions=RESPONSIBLE_CARD_PERMISSIONS,
        )
        await _assign_stakeholder(db, perm_env["card"].id, perm_env["viewer"].id, "responsible")

        result = await PermissionService.check_permission(
            db,
            perm_env["viewer"],
            "inventory.edit",
            card_id=perm_env["card"].id,
            card_permission="card.edit",
        )
        assert result is True

    async def test_both_denied(self, db, perm_env):
        """Viewer denied app-level, no stakeholder role — returns False."""
        result = await PermissionService.check_permission(
            db,
            perm_env["viewer"],
            "inventory.edit",
            card_id=perm_env["card"].id,
            card_permission="card.edit",
        )
        assert result is False

    async def test_card_id_none_skips_card_check(self, db, perm_env):
        """When card_id is None, only app-level is checked."""
        result = await PermissionService.check_permission(db, perm_env["viewer"], "inventory.edit")
        assert result is False

    async def test_card_permission_none_skips_card_check(self, db, perm_env):
        """When card_permission is None, only app-level is checked."""
        result = await PermissionService.check_permission(
            db,
            perm_env["viewer"],
            "inventory.edit",
            card_id=perm_env["card"].id,
            card_permission=None,
        )
        assert result is False


# ---------------------------------------------------------------------------
# get_effective_card_permissions
# ---------------------------------------------------------------------------


class TestGetEffectiveCardPermissions:
    async def test_admin_gets_all_effective(self, db, perm_env):
        """Admin with wildcard should get all can_* = True."""
        result = await PermissionService.get_effective_card_permissions(
            db, perm_env["admin"], perm_env["card"].id
        )
        assert result["app_level"] == {"*": True}
        eff = result["effective"]
        assert eff["can_view"] is True
        assert eff["can_edit"] is True
        assert eff["can_archive"] is True
        assert eff["can_delete"] is True
        assert eff["can_approval_status"] is True
        assert eff["can_manage_stakeholders"] is True
        assert eff["can_manage_relations"] is True
        assert eff["can_manage_documents"] is True
        assert eff["can_manage_comments"] is True
        assert eff["can_create_comments"] is True
        assert eff["can_bpm_edit"] is True
        assert eff["can_bpm_manage_drafts"] is True
        assert eff["can_bpm_approve"] is True

    async def test_viewer_gets_view_only(self, db, perm_env):
        """Viewer with no stakeholder role gets limited effective permissions."""
        result = await PermissionService.get_effective_card_permissions(
            db, perm_env["viewer"], perm_env["card"].id
        )
        eff = result["effective"]
        assert eff["can_view"] is True
        assert eff["can_edit"] is False
        assert eff["can_archive"] is False
        assert eff["can_delete"] is False

    async def test_viewer_with_responsible_stakeholder(self, db, perm_env):
        """Viewer + responsible stakeholder role gets card-level edit."""
        await create_stakeholder_role_def(
            db,
            card_type_key="Application",
            key="responsible",
            label="Responsible",
            permissions=RESPONSIBLE_CARD_PERMISSIONS,
        )
        await _assign_stakeholder(db, perm_env["card"].id, perm_env["viewer"].id, "responsible")

        result = await PermissionService.get_effective_card_permissions(
            db, perm_env["viewer"], perm_env["card"].id
        )
        assert result["stakeholder_roles"] == ["responsible"]
        assert result["card_level"].get("card.edit") is True
        eff = result["effective"]
        assert eff["can_view"] is True
        assert eff["can_edit"] is True

    async def test_member_app_level_permissions(self, db, perm_env):
        """Member's app_level dict contains non-wildcard permissions."""
        result = await PermissionService.get_effective_card_permissions(
            db, perm_env["member"], perm_env["card"].id
        )
        assert "*" not in result["app_level"]
        assert "inventory.view" in result["app_level"]
        assert result["app_level"]["inventory.view"] is True

    async def test_multiple_stakeholder_roles_union(self, db, perm_env):
        """Multiple stakeholder roles produce union of card-level permissions."""
        await create_stakeholder_role_def(
            db,
            card_type_key="Application",
            key="observer",
            label="Observer",
            permissions=OBSERVER_CARD_PERMISSIONS,
        )
        await create_stakeholder_role_def(
            db,
            card_type_key="Application",
            key="responsible",
            label="Responsible",
            permissions=RESPONSIBLE_CARD_PERMISSIONS,
        )
        user = perm_env["viewer"]
        card_id = perm_env["card"].id
        await _assign_stakeholder(db, card_id, user.id, "observer")
        await _assign_stakeholder(db, card_id, user.id, "responsible")

        result = await PermissionService.get_effective_card_permissions(db, user, card_id)
        assert set(result["stakeholder_roles"]) == {"observer", "responsible"}
        # Union: observer has create_comments, responsible has edit
        assert result["card_level"].get("card.create_comments") is True
        assert result["card_level"].get("card.edit") is True

    async def test_nonexistent_card_returns_empty(self, db, perm_env):
        """For a nonexistent card, stakeholder_roles and card_level are empty."""
        result = await PermissionService.get_effective_card_permissions(
            db, perm_env["viewer"], uuid.uuid4()
        )
        assert result["stakeholder_roles"] == []
        assert result["card_level"] == {}
