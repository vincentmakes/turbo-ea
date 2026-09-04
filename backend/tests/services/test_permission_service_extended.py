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


# ---------------------------------------------------------------------------
# Per-card-type permission overrides (discussion #1068)
# ---------------------------------------------------------------------------


@pytest.fixture
async def type_override_env(db, perm_env):
    """`perm_env` plus a second card type, so "denied here, allowed there" is testable."""
    other = await create_card_type(db, key="ITComponent", label="IT Component")
    other_card = await create_card(
        db, card_type="ITComponent", name="Test Component", user_id=perm_env["admin"].id
    )
    PermissionService.invalidate_type_permission_cache()
    return {**perm_env, "other_ct": other, "other_card": other_card}


async def _set_overrides(db, type_key: str, overrides: dict) -> None:
    """Write a type's override map and drop the per-process cache."""
    from sqlalchemy import select

    from app.models.card_type import CardType

    ct = (await db.execute(select(CardType).where(CardType.key == type_key))).scalar_one()
    ct.role_permissions = overrides
    await db.flush()
    PermissionService.invalidate_type_permission_cache(type_key)


class TestTypeScopedOverrides:
    """`has_app_permission` honours a card type's per-role overrides."""

    async def test_deny_removes_a_global_grant(self, db, type_override_env):
        member = type_override_env["member"]
        assert await PermissionService.has_app_permission(db, member, "inventory.create") is True

        await _set_overrides(db, "Application", {"member": {"inventory.create": False}})

        assert (
            await PermissionService.has_app_permission(
                db, member, "inventory.create", card_type_key="Application"
            )
            is False
        )

    async def test_deny_is_scoped_to_the_one_type(self, db, type_override_env):
        member = type_override_env["member"]
        await _set_overrides(db, "Application", {"member": {"inventory.create": False}})

        assert (
            await PermissionService.has_app_permission(
                db, member, "inventory.create", card_type_key="ITComponent"
            )
            is True
        )

    async def test_allow_grants_above_the_global_role(self, db, type_override_env):
        viewer = type_override_env["viewer"]
        assert await PermissionService.has_app_permission(db, viewer, "inventory.create") is False

        await _set_overrides(db, "Application", {"viewer": {"inventory.create": True}})

        assert (
            await PermissionService.has_app_permission(
                db, viewer, "inventory.create", card_type_key="Application"
            )
            is True
        )

    async def test_absent_cell_inherits(self, db, type_override_env):
        member = type_override_env["member"]
        # An override on *another* action must not touch this one.
        await _set_overrides(db, "Application", {"member": {"inventory.delete": True}})

        assert (
            await PermissionService.has_app_permission(
                db, member, "inventory.create", card_type_key="Application"
            )
            is True
        )

    async def test_admin_wildcard_is_immune(self, db, type_override_env):
        admin = type_override_env["admin"]
        # Even a hand-written map naming admin (only reachable by bypassing the
        # API validator) must not lock the wildcard role out.
        await _set_overrides(db, "Application", {"admin": {"inventory.create": False}})

        assert (
            await PermissionService.has_app_permission(
                db, admin, "inventory.create", card_type_key="Application"
            )
            is True
        )

    async def test_non_type_scoped_permission_ignores_overrides(self, db, type_override_env):
        member = type_override_env["member"]
        await _set_overrides(db, "Application", {"member": {"inventory.create": False}})

        # `inventory.view` is not overridable — a create deny must not leak.
        assert (
            await PermissionService.has_app_permission(
                db, member, "inventory.view", card_type_key="Application"
            )
            is True
        )

    async def test_unknown_type_key_inherits(self, db, type_override_env):
        member = type_override_env["member"]
        assert (
            await PermissionService.has_app_permission(
                db, member, "inventory.create", card_type_key="DoesNotExist"
            )
            is True
        )

    async def test_cache_invalidation_picks_up_a_change(self, db, type_override_env):
        member = type_override_env["member"]
        # Warm the cache with the permissive state.
        assert (
            await PermissionService.has_app_permission(
                db, member, "inventory.create", card_type_key="Application"
            )
            is True
        )
        await _set_overrides(db, "Application", {"member": {"inventory.create": False}})
        assert (
            await PermissionService.has_app_permission(
                db, member, "inventory.create", card_type_key="Application"
            )
            is False
        )


class TestCheckPermissionWithOverrides:
    """`check_permission` derives the type from the card, and stakeholders still win."""

    async def test_type_deny_blocks_edit_on_that_card(self, db, type_override_env):
        member = type_override_env["member"]
        card = type_override_env["card"]
        await _set_overrides(db, "Application", {"member": {"inventory.edit": False}})

        assert (
            await PermissionService.check_permission(
                db, member, "inventory.edit", card.id, "card.edit"
            )
            is False
        )

    async def test_type_deny_leaves_other_types_alone(self, db, type_override_env):
        member = type_override_env["member"]
        other_card = type_override_env["other_card"]
        await _set_overrides(db, "Application", {"member": {"inventory.edit": False}})

        assert (
            await PermissionService.check_permission(
                db, member, "inventory.edit", other_card.id, "card.edit"
            )
            is True
        )

    async def test_stakeholder_grant_survives_a_type_deny(self, db, type_override_env):
        """A type-level deny removes the landscape-wide grant, never the
        authority someone holds as the owner of one specific card."""
        member = type_override_env["member"]
        card = type_override_env["card"]
        await create_stakeholder_role_def(
            db,
            card_type_key="Application",
            key="responsible",
            permissions=RESPONSIBLE_CARD_PERMISSIONS,
        )
        await _assign_stakeholder(db, card.id, member.id, "responsible")
        await _set_overrides(db, "Application", {"member": {"inventory.edit": False}})
        PermissionService.invalidate_srd_cache()

        assert (
            await PermissionService.check_permission(
                db, member, "inventory.edit", card.id, "card.edit"
            )
            is True
        )

    async def test_explicit_card_type_key_wins_over_lookup(self, db, type_override_env):
        """Creation has no card yet, so the caller supplies the type directly."""
        member = type_override_env["member"]
        await _set_overrides(db, "Application", {"member": {"inventory.create": False}})

        assert (
            await PermissionService.check_permission(
                db, member, "inventory.create", card_type_key="Application"
            )
            is False
        )


class TestIsTypeDenied:
    """Only an explicit False counts — a missing global grant is not a deny."""

    async def test_explicit_false_is_denied(self, db, type_override_env):
        member = type_override_env["member"]
        await _set_overrides(db, "Application", {"member": {"inventory.edit": False}})
        assert (
            await PermissionService.is_type_denied(db, member, "inventory.edit", "Application")
            is True
        )

    async def test_missing_global_grant_is_not_a_deny(self, db, type_override_env):
        viewer = type_override_env["viewer"]
        assert await PermissionService.has_app_permission(db, viewer, "inventory.edit") is False
        assert (
            await PermissionService.is_type_denied(db, viewer, "inventory.edit", "Application")
            is False
        )

    async def test_explicit_true_is_not_a_deny(self, db, type_override_env):
        viewer = type_override_env["viewer"]
        await _set_overrides(db, "Application", {"viewer": {"inventory.edit": True}})
        assert (
            await PermissionService.is_type_denied(db, viewer, "inventory.edit", "Application")
            is False
        )

    async def test_admin_is_never_denied(self, db, type_override_env):
        admin = type_override_env["admin"]
        await _set_overrides(db, "Application", {"admin": {"inventory.edit": False}})
        assert (
            await PermissionService.is_type_denied(db, admin, "inventory.edit", "Application")
            is False
        )


class TestEffectivePermissionsWithOverrides:
    """`/cards/{id}/my-permissions` must agree with what the write routes allow."""

    async def test_effective_can_edit_reflects_a_deny(self, db, type_override_env):
        member = type_override_env["member"]
        card = type_override_env["card"]
        await _set_overrides(db, "Application", {"member": {"inventory.edit": False}})

        result = await PermissionService.get_effective_card_permissions(db, member, card.id)
        assert result["effective"]["can_edit"] is False
        assert result["type_overrides"] == {"inventory.edit": False}

    async def test_effective_can_archive_and_delete_reflect_overrides(self, db, type_override_env):
        viewer = type_override_env["viewer"]
        card = type_override_env["card"]
        await _set_overrides(
            db,
            "Application",
            {"viewer": {"inventory.archive": True, "inventory.delete": True}},
        )

        result = await PermissionService.get_effective_card_permissions(db, viewer, card.id)
        assert result["effective"]["can_archive"] is True
        assert result["effective"]["can_delete"] is True

    async def test_can_view_is_untouched_by_overrides(self, db, type_override_env):
        member = type_override_env["member"]
        card = type_override_env["card"]
        await _set_overrides(db, "Application", {"member": {"inventory.edit": False}})

        result = await PermissionService.get_effective_card_permissions(db, member, card.id)
        assert result["effective"]["can_view"] is True

    async def test_admin_effective_permissions_unaffected(self, db, type_override_env):
        admin = type_override_env["admin"]
        card = type_override_env["card"]
        await _set_overrides(db, "Application", {"member": {"inventory.edit": False}})

        result = await PermissionService.get_effective_card_permissions(db, admin, card.id)
        assert result["effective"]["can_edit"] is True


class TestTypePermissionsForRole:
    """The `/auth/me` payload carries only the cells an admin actually set."""

    async def test_returns_only_this_role_cells(self, db, type_override_env):
        await _set_overrides(
            db,
            "Application",
            {"member": {"inventory.create": False}, "viewer": {"inventory.edit": True}},
        )

        assert await PermissionService.type_permissions_for_role(db, "member") == {
            "Application": {"inventory.create": False}
        }

    async def test_empty_for_wildcard_role(self, db, type_override_env):
        await _set_overrides(db, "Application", {"member": {"inventory.create": False}})
        assert await PermissionService.type_permissions_for_role(db, "admin") == {}

    async def test_empty_when_nothing_is_overridden(self, db, type_override_env):
        assert await PermissionService.type_permissions_for_role(db, "member") == {}

    async def test_spans_multiple_types(self, db, type_override_env):
        await _set_overrides(db, "Application", {"member": {"inventory.create": False}})
        await _set_overrides(db, "ITComponent", {"member": {"inventory.delete": True}})

        assert await PermissionService.type_permissions_for_role(db, "member") == {
            "Application": {"inventory.create": False},
            "ITComponent": {"inventory.delete": True},
        }


class TestImpersonationWithOverrides:
    """Overrides follow the *effective* role, so "View as" shows the real thing."""

    async def test_impersonated_role_overrides_apply(self, db, type_override_env):
        from app.services.event_bus import request_impersonation

        admin = type_override_env["admin"]
        await _set_overrides(db, "Application", {"member": {"inventory.create": False}})

        token = request_impersonation.set((str(admin.id), "member"))
        try:
            assert (
                await PermissionService.has_app_permission(
                    db, admin, "inventory.create", card_type_key="Application"
                )
                is False
            )
            assert (
                await PermissionService.has_app_permission(
                    db, admin, "inventory.create", card_type_key="ITComponent"
                )
                is True
            )
        finally:
            request_impersonation.reset(token)
