"""Unit tests for the permission key registry.

Validates structural integrity of the permission registry — ensures
all role defaults reference valid keys, mappings are consistent, and
the registry is complete.
"""

from __future__ import annotations

import pytest

from app.core.permissions import (
    ADMIN_PERMISSIONS,
    ALL_APP_PERMISSION_KEYS,
    ALL_CARD_PERMISSION_KEYS,
    APP_PERMISSIONS,
    APP_TO_CARD_PERMISSION_MAP,
    BIZ_APP_OWNER_CARD_PERMISSIONS,
    BPM_ADMIN_PERMISSIONS,
    CARD_PERMISSIONS,
    CARD_TO_APP_PERMISSION_MAP,
    DEFAULT_CARD_PERMISSIONS_BY_ROLE,
    LEGACY_APP_PERMISSION_RENAMES,
    LEGACY_CARD_PERMISSION_KEYS,
    MEMBER_PERMISSIONS,
    OBSERVER_CARD_PERMISSIONS,
    PROCESS_OWNER_CARD_PERMISSIONS,
    RESPONSIBLE_CARD_PERMISSIONS,
    TECH_APP_OWNER_CARD_PERMISSIONS,
    VIEWER_PERMISSIONS,
    migrate_legacy_app_permissions,
    strip_legacy_card_permissions,
)

# ---------------------------------------------------------------------------
# Registry completeness
# ---------------------------------------------------------------------------


class TestRegistryCompleteness:
    def test_all_app_keys_collected(self):
        """ALL_APP_PERMISSION_KEYS should contain every key defined in APP_PERMISSIONS."""
        expected = set()
        for group in APP_PERMISSIONS.values():
            expected.update(group["permissions"].keys())
        assert ALL_APP_PERMISSION_KEYS == expected

    def test_all_card_keys_collected(self):
        """ALL_CARD_PERMISSION_KEYS should match CARD_PERMISSIONS keys."""
        assert ALL_CARD_PERMISSION_KEYS == set(CARD_PERMISSIONS.keys())

    def test_app_permission_groups_have_labels(self):
        """Every group in APP_PERMISSIONS must have a non-empty label."""
        for key, group in APP_PERMISSIONS.items():
            assert "label" in group, f"Group '{key}' missing label"
            assert group["label"], f"Group '{key}' has empty label"

    def test_app_permission_groups_have_permissions(self):
        """Every group must have at least one permission."""
        for key, group in APP_PERMISSIONS.items():
            assert "permissions" in group, f"Group '{key}' missing permissions"
            assert len(group["permissions"]) > 0, f"Group '{key}' has no permissions"

    def test_app_permission_keys_follow_dot_notation(self):
        """All app permission keys must use group.action format."""
        for key in ALL_APP_PERMISSION_KEYS:
            parts = key.split(".")
            assert len(parts) == 2, f"Key '{key}' doesn't follow group.action format"

    def test_card_permission_keys_follow_dot_notation(self):
        """All card permission keys must start with 'card.'."""
        for key in ALL_CARD_PERMISSION_KEYS:
            assert key.startswith("card."), f"Card permission key '{key}' missing 'card.' prefix"

    def test_no_duplicate_app_keys_across_groups(self):
        """No permission key should appear in multiple groups."""
        seen = {}
        for group_key, group in APP_PERMISSIONS.items():
            for perm_key in group["permissions"]:
                if perm_key in seen:
                    pytest.fail(
                        f"Key '{perm_key}' appears in both '{seen[perm_key]}' and '{group_key}'"
                    )
                seen[perm_key] = group_key

    def test_app_permissions_have_descriptions(self):
        """Every app permission should have a non-empty description string."""
        for group in APP_PERMISSIONS.values():
            for key, desc in group["permissions"].items():
                assert isinstance(desc, str), f"'{key}' description is not a string"
                assert desc, f"'{key}' has empty description"

    def test_admin_todos_is_registered(self):
        """`admin.todos` is checked by todos.py to gate cross-user todo
        management and must be a registered key (regression: it was used
        in code but missing from the registry)."""
        assert "admin.todos" in ALL_APP_PERMISSION_KEYS

    def test_servicenow_view_is_registered(self):
        """`servicenow.view` gates the read-only ServiceNow GET routes and
        must be a registered key (it was previously defined but unused)."""
        assert "servicenow.view" in ALL_APP_PERMISSION_KEYS

    def test_card_permissions_have_descriptions(self):
        """Every card permission should have a non-empty description string."""
        for key, desc in CARD_PERMISSIONS.items():
            assert isinstance(desc, str), f"'{key}' description is not a string"
            assert desc, f"'{key}' has empty description"


# ---------------------------------------------------------------------------
# Permission mapping consistency
# ---------------------------------------------------------------------------


class TestPermissionMappings:
    def test_app_to_card_keys_are_valid_app_keys(self):
        """All keys in APP_TO_CARD_PERMISSION_MAP should be valid app permission keys."""
        for app_key in APP_TO_CARD_PERMISSION_MAP:
            assert app_key in ALL_APP_PERMISSION_KEYS, (
                f"'{app_key}' in APP_TO_CARD map but not in ALL_APP_PERMISSION_KEYS"
            )

    def test_app_to_card_values_are_valid_card_keys(self):
        """All values in APP_TO_CARD_PERMISSION_MAP should be valid card permission keys."""
        for card_key in APP_TO_CARD_PERMISSION_MAP.values():
            assert card_key in ALL_CARD_PERMISSION_KEYS, (
                f"'{card_key}' in APP_TO_CARD map but not in ALL_CARD_PERMISSION_KEYS"
            )

    def test_card_to_app_is_exact_reverse(self):
        """CARD_TO_APP_PERMISSION_MAP must be the exact reverse of APP_TO_CARD."""
        expected = {v: k for k, v in APP_TO_CARD_PERMISSION_MAP.items()}
        assert CARD_TO_APP_PERMISSION_MAP == expected

    def test_mapping_is_bijective(self):
        """APP_TO_CARD map should be one-to-one (no two app keys map to same card key)."""
        values = list(APP_TO_CARD_PERMISSION_MAP.values())
        assert len(values) == len(set(values)), "APP_TO_CARD mapping has duplicate card keys"


# ---------------------------------------------------------------------------
# Default role permission sets
# ---------------------------------------------------------------------------


class TestRolePermissionSets:
    @pytest.mark.parametrize(
        "role_perms,role_name",
        [
            (BPM_ADMIN_PERMISSIONS, "BPM_ADMIN"),
            (MEMBER_PERMISSIONS, "MEMBER"),
            (VIEWER_PERMISSIONS, "VIEWER"),
        ],
    )
    def test_role_keys_are_valid_app_keys(self, role_perms, role_name):
        """All keys in role permission dicts must be valid app permission keys."""
        for key in role_perms:
            assert key in ALL_APP_PERMISSION_KEYS, (
                f"'{key}' in {role_name}_PERMISSIONS but not in ALL_APP_PERMISSION_KEYS"
            )

    @pytest.mark.parametrize(
        "role_perms,role_name",
        [
            (BPM_ADMIN_PERMISSIONS, "BPM_ADMIN"),
            (MEMBER_PERMISSIONS, "MEMBER"),
            (VIEWER_PERMISSIONS, "VIEWER"),
        ],
    )
    def test_role_covers_all_app_keys(self, role_perms, role_name):
        """Non-wildcard roles should explicitly set every app permission key."""
        for key in ALL_APP_PERMISSION_KEYS:
            assert key in role_perms, f"'{key}' missing from {role_name}_PERMISSIONS"

    @pytest.mark.parametrize(
        "role_perms,role_name",
        [
            (BPM_ADMIN_PERMISSIONS, "BPM_ADMIN"),
            (MEMBER_PERMISSIONS, "MEMBER"),
            (VIEWER_PERMISSIONS, "VIEWER"),
        ],
    )
    def test_role_values_are_boolean(self, role_perms, role_name):
        """All values in role permission dicts must be booleans."""
        for key, val in role_perms.items():
            assert isinstance(val, bool), (
                f"'{key}' in {role_name}_PERMISSIONS has non-bool value: {val}"
            )

    def test_admin_uses_wildcard(self):
        """Admin role should use the wildcard pattern."""
        assert ADMIN_PERMISSIONS == {"*": True}

    def test_viewer_cannot_create_or_edit(self):
        """Viewer role should have create/edit/manage permissions set to False."""
        assert VIEWER_PERMISSIONS["inventory.create"] is False
        assert VIEWER_PERMISSIONS["inventory.edit"] is False
        assert VIEWER_PERMISSIONS["relations.manage"] is False
        assert VIEWER_PERMISSIONS["stakeholders.manage"] is False

    def test_viewer_can_view(self):
        """Viewer role should have view permissions set to True."""
        assert VIEWER_PERMISSIONS["inventory.view"] is True
        assert VIEWER_PERMISSIONS["relations.view"] is True
        assert VIEWER_PERMISSIONS["reports.ea_dashboard"] is True

    def test_member_cannot_approve_flows(self):
        """Member role should not be able to approve BPM flows."""
        assert MEMBER_PERMISSIONS["bpm.approve_flows"] is False

    def test_bpm_admin_can_approve_flows(self):
        """BPM Admin should be able to approve flows."""
        assert BPM_ADMIN_PERMISSIONS["bpm.approve_flows"] is True

    def test_no_non_admin_has_admin_permissions(self):
        """BPM Admin, Member, Viewer should not have any admin.* = True."""
        for role, name in [
            (BPM_ADMIN_PERMISSIONS, "BPM_ADMIN"),
            (MEMBER_PERMISSIONS, "MEMBER"),
            (VIEWER_PERMISSIONS, "VIEWER"),
        ]:
            for key, val in role.items():
                if key.startswith("admin."):
                    assert val is False, f"{name} has admin permission '{key}' = True"


# ---------------------------------------------------------------------------
# Default stakeholder role permission sets
# ---------------------------------------------------------------------------


class TestStakeholderPermissionSets:
    @pytest.mark.parametrize(
        "role_perms,role_name",
        [
            (RESPONSIBLE_CARD_PERMISSIONS, "RESPONSIBLE"),
            (OBSERVER_CARD_PERMISSIONS, "OBSERVER"),
            (PROCESS_OWNER_CARD_PERMISSIONS, "PROCESS_OWNER"),
            (TECH_APP_OWNER_CARD_PERMISSIONS, "TECH_APP_OWNER"),
            (BIZ_APP_OWNER_CARD_PERMISSIONS, "BIZ_APP_OWNER"),
        ],
    )
    def test_stakeholder_keys_are_valid_card_keys(self, role_perms, role_name):
        """All keys in stakeholder permission dicts must be valid card permission keys."""
        for key in role_perms:
            assert key in ALL_CARD_PERMISSION_KEYS, (
                f"'{key}' in {role_name} but not in ALL_CARD_PERMISSION_KEYS"
            )

    @pytest.mark.parametrize(
        "role_perms,role_name",
        [
            (RESPONSIBLE_CARD_PERMISSIONS, "RESPONSIBLE"),
            (OBSERVER_CARD_PERMISSIONS, "OBSERVER"),
            (PROCESS_OWNER_CARD_PERMISSIONS, "PROCESS_OWNER"),
            (TECH_APP_OWNER_CARD_PERMISSIONS, "TECH_APP_OWNER"),
            (BIZ_APP_OWNER_CARD_PERMISSIONS, "BIZ_APP_OWNER"),
        ],
    )
    def test_stakeholder_covers_all_card_keys(self, role_perms, role_name):
        """Every stakeholder role should explicitly set every card permission key."""
        for key in ALL_CARD_PERMISSION_KEYS:
            assert key in role_perms, f"'{key}' missing from {role_name}_CARD_PERMISSIONS"

    @pytest.mark.parametrize(
        "role_perms,role_name",
        [
            (RESPONSIBLE_CARD_PERMISSIONS, "RESPONSIBLE"),
            (OBSERVER_CARD_PERMISSIONS, "OBSERVER"),
            (PROCESS_OWNER_CARD_PERMISSIONS, "PROCESS_OWNER"),
            (TECH_APP_OWNER_CARD_PERMISSIONS, "TECH_APP_OWNER"),
            (BIZ_APP_OWNER_CARD_PERMISSIONS, "BIZ_APP_OWNER"),
        ],
    )
    def test_stakeholder_values_are_boolean(self, role_perms, role_name):
        """All values in stakeholder permission dicts must be booleans."""
        for key, val in role_perms.items():
            assert isinstance(val, bool), f"'{key}' in {role_name} has non-bool value: {val}"

    def test_all_stakeholder_roles_can_view(self):
        """Every stakeholder role should have card.view = True."""
        for role_key, perms in DEFAULT_CARD_PERMISSIONS_BY_ROLE.items():
            assert perms.get("card.view") is True, (
                f"Stakeholder role '{role_key}' missing card.view = True"
            )

    def test_observer_is_read_only_except_comments(self):
        """Observer should only have view + create_comments."""
        for key, val in OBSERVER_CARD_PERMISSIONS.items():
            if key not in ("card.view", "card.create_comments"):
                assert val is False, f"Observer has '{key}' = True (should be read-only)"

    def test_process_owner_can_approve_bpm(self):
        """Process owner should have BPM approval permissions."""
        assert PROCESS_OWNER_CARD_PERMISSIONS["card.bpm_approve"] is True

    def test_default_card_permissions_by_role_keys_valid(self):
        """DEFAULT_CARD_PERMISSIONS_BY_ROLE values must match a known permission dict."""
        for role_key, perms in DEFAULT_CARD_PERMISSIONS_BY_ROLE.items():
            assert isinstance(perms, dict), f"'{role_key}' value is not a dict"
            assert "card.view" in perms, f"'{role_key}' missing card.view"


# ---------------------------------------------------------------------------
# Expected permission count (regression guard)
# ---------------------------------------------------------------------------


class TestPermissionCounts:
    def test_minimum_app_permission_groups(self):
        """There should be at least 17 permission groups."""
        assert len(APP_PERMISSIONS) >= 17

    def test_minimum_app_permission_keys(self):
        """There should be at least 40 app permission keys."""
        assert len(ALL_APP_PERMISSION_KEYS) >= 40

    def test_minimum_card_permission_keys(self):
        """There should be at least 13 card permission keys."""
        assert len(ALL_CARD_PERMISSION_KEYS) >= 13

    def test_minimum_stakeholder_roles(self):
        """There should be at least 5 default stakeholder roles."""
        assert len(DEFAULT_CARD_PERMISSIONS_BY_ROLE) >= 5


# ---------------------------------------------------------------------------
# Legacy card permission keys
# ---------------------------------------------------------------------------


class TestLegacyCardPermissionKeys:
    """The dead keys migration 024 left in ``stakeholder_role_definitions``.

    024 rewrote the ``fs.`` prefix to ``card.`` without applying the semantic
    rename shipping alongside it, and 033 repaired only the app-level twins in
    ``roles.permissions``. The leftovers made every stakeholder-role save 422.
    """

    def test_names_exactly_the_two_known_stale_keys(self):
        assert LEGACY_CARD_PERMISSION_KEYS == frozenset(
            {"card.quality_seal", "card.manage_subscriptions"}
        )

    def test_stale_keys_are_not_live_permissions(self):
        # The invariant that makes dropping them safe: nothing reads either one,
        # so removing them cannot take away a grant anybody actually holds.
        assert not (LEGACY_CARD_PERMISSION_KEYS & ALL_CARD_PERMISSION_KEYS)

    def test_modern_equivalents_exist_and_are_untouched(self):
        assert "card.approval_status" in ALL_CARD_PERMISSION_KEYS
        assert "card.manage_stakeholders" in ALL_CARD_PERMISSION_KEYS

    def test_strips_stale_keys(self):
        assert strip_legacy_card_permissions(
            {"card.view": True, "card.quality_seal": True, "card.manage_subscriptions": False}
        ) == {"card.view": True}

    def test_does_not_remap_onto_the_modern_keys(self):
        # Remapping would newly grant approve/reject and stakeholder management
        # to every holder of a legacy role — an escalation dressed as a fix.
        assert strip_legacy_card_permissions({"card.quality_seal": True}) == {}

    def test_leaves_unknown_keys_for_the_caller_to_reject(self):
        # Keeps the API validator a validator: only keys this codebase itself
        # once wrote are forgiven, never anything a client invents.
        assert strip_legacy_card_permissions({"fake.permission": True}) == {"fake.permission": True}
        assert strip_legacy_card_permissions({"*": True}) == {"*": True}

    def test_preserves_false_values_and_clean_maps(self):
        assert strip_legacy_card_permissions({"card.edit": False}) == {"card.edit": False}
        assert strip_legacy_card_permissions({}) == {}

    def test_is_idempotent(self):
        once = strip_legacy_card_permissions({"card.view": True, "card.quality_seal": True})
        assert strip_legacy_card_permissions(once) == once

    def test_tolerates_non_dict(self):
        # NOT NULL in the model, but a hand-edited or third-party row could hold
        # anything and this runs on every write path.
        assert strip_legacy_card_permissions(None) is None


# ---------------------------------------------------------------------------
# Legacy app-level permission keys
# ---------------------------------------------------------------------------


class TestLegacyAppPermissionKeys:
    """The pre-024 names migration 033 renamed inside ``roles.permissions``.

    Unlike the card-level keys, these are RENAMED rather than dropped: each maps
    onto a permission that still exists and still means the same thing, so the
    stored ``true`` is a grant somebody made on purpose.
    """

    def test_every_target_is_a_live_permission(self):
        # The invariant that makes renaming (rather than dropping) correct here:
        # each destination must be a key the application actually reads.
        for target in LEGACY_APP_PERMISSION_RENAMES.values():
            assert target in ALL_APP_PERMISSION_KEYS, target

    def test_no_source_is_a_live_permission(self):
        # And each source must be dead, or the rename would move a live grant.
        for source in LEGACY_APP_PERMISSION_RENAMES:
            assert source not in ALL_APP_PERMISSION_KEYS, source

    def test_renames_the_three_known_keys(self):
        assert migrate_legacy_app_permissions(
            {
                "subscriptions.view": True,
                "subscriptions.manage": True,
                "inventory.quality_seal": True,
            }
        ) == {
            "stakeholders.view": True,
            "stakeholders.manage": True,
            "inventory.approval_status": True,
        }

    def test_preserves_the_stored_value_rather_than_granting(self):
        # A role that did NOT have the permission must not gain it.
        assert migrate_legacy_app_permissions({"subscriptions.view": False}) == {
            "stakeholders.view": False
        }

    def test_modern_key_wins_when_both_present(self):
        # Matches migration 033: a deliberate newer value is never clobbered by
        # a stale one, whichever order they happen to be stored in.
        assert migrate_legacy_app_permissions(
            {"subscriptions.view": True, "stakeholders.view": False}
        ) == {"stakeholders.view": False}

    def test_preserves_the_admin_wildcard(self):
        assert migrate_legacy_app_permissions({"*": True}) == {"*": True}

    def test_leaves_unknown_keys_for_the_caller_to_reject(self):
        assert migrate_legacy_app_permissions({"fake.permission": True}) == {
            "fake.permission": True
        }

    def test_clean_map_is_returned_untouched(self):
        perms = {"inventory.view": True}
        assert migrate_legacy_app_permissions(perms) == perms

    def test_is_idempotent(self):
        once = migrate_legacy_app_permissions({"subscriptions.view": True})
        assert migrate_legacy_app_permissions(once) == once

    def test_tolerates_non_dict(self):
        assert migrate_legacy_app_permissions(None) is None

    def test_card_and_app_tiers_do_not_overlap(self):
        # The two normalisers must never both claim a key, or the tier a map
        # belongs to would change its meaning.
        assert not (set(LEGACY_APP_PERMISSION_RENAMES) & LEGACY_CARD_PERMISSION_KEYS)
