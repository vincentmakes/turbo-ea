"""Unit tests for migration 141 (rename legacy app permission keys).

141 sweeps up ``roles.permissions`` maps carrying the pre-024 names that
migration 033 already renamed — the ones that arrived *after* 033 ran, via a
workspace bundle exported from an instance that never did. These tests exercise
the pure planning helper (no DB) and pin the two properties that make renaming,
rather than dropping, the correct repair at this tier.
"""

from __future__ import annotations

import importlib.util
from pathlib import Path

from app.core.permissions import (
    ALL_APP_PERMISSION_KEYS,
    LEGACY_APP_PERMISSION_RENAMES,
    migrate_legacy_app_permissions,
)

_MIG_PATH = (
    Path(__file__).resolve().parents[2]
    / "alembic"
    / "versions"
    / "141_rename_legacy_app_permission_keys.py"
)
_spec = importlib.util.spec_from_file_location("mig141", _MIG_PATH)
mig = importlib.util.module_from_spec(_spec)
assert _spec and _spec.loader
_spec.loader.exec_module(mig)

RENAMES = mig.RENAMES


def test_targets_exactly_the_three_renames_033_performs():
    assert RENAMES == {
        "subscriptions.view": "stakeholders.view",
        "subscriptions.manage": "stakeholders.manage",
        "inventory.quality_seal": "inventory.approval_status",
    }


def test_migration_and_runtime_agree():
    # The migration keeps its own literal so it describes the DB as of this
    # revision, but the two must not silently diverge while both are in use.
    assert RENAMES == LEGACY_APP_PERMISSION_RENAMES


def test_every_destination_is_a_live_permission():
    # This is what separates 141 from 140: there the keys are dead and get
    # dropped, here each one maps onto a permission still being read, so the
    # grant must be carried across rather than discarded.
    for target in RENAMES.values():
        assert target in ALL_APP_PERMISSION_KEYS, target


def test_no_source_is_a_live_permission():
    for source in RENAMES:
        assert source not in ALL_APP_PERMISSION_KEYS, source


def test_renames_and_preserves_siblings():
    plan = mig.plan_permissions({"inventory.view": True, "subscriptions.view": True}, RENAMES)
    assert plan == {"inventory.view": True, "stakeholders.view": True}


def test_preserves_a_false_value_rather_than_granting_access():
    assert mig.plan_permissions({"subscriptions.manage": False}, RENAMES) == {
        "stakeholders.manage": False
    }


def test_modern_key_wins_when_both_present():
    # Matches 033: keep the modern key's own value and drop the stale one, so a
    # deliberate newer setting is never clobbered by a leftover.
    assert mig.plan_permissions(
        {"subscriptions.view": True, "stakeholders.view": False}, RENAMES
    ) == {"stakeholders.view": False}


def test_admin_wildcard_survives():
    assert mig.plan_permissions({"*": True}, RENAMES) is None


def test_clean_map_is_left_alone():
    # The no-op case, and the common one: every install whose history runs
    # through 033 is already repaired, so this migration writes nothing.
    assert mig.plan_permissions({"inventory.view": True}, RENAMES) is None


def test_is_idempotent():
    once = mig.plan_permissions({"subscriptions.view": True}, RENAMES)
    assert once is not None
    assert mig.plan_permissions(once, RENAMES) is None


def test_non_dict_permissions_are_skipped():
    assert mig.plan_permissions(None, RENAMES) is None
    assert mig.plan_permissions([], RENAMES) is None


def test_planner_matches_the_runtime_migrator():
    # The migration repairs data at rest and the API renames on write; they must
    # agree, or a saved role would differ from a migrated one.
    perms = {"inventory.view": True, "subscriptions.view": True}
    assert mig.plan_permissions(perms, RENAMES) == migrate_legacy_app_permissions(perms)


def test_downgrade_is_a_documented_no_op():
    assert mig.downgrade() is None
