"""Unit tests for migration 140 (drop stale stakeholder role permission keys).

Migration 140 removes the two card permission keys migration 024 left
semantically stale (``card.quality_seal``, ``card.manage_subscriptions``). These
tests exercise the pure planning helper — no DB — and assert it is guarded,
idempotent, and non-destructive to anything an admin customised.
"""

from __future__ import annotations

import importlib.util
from pathlib import Path

from app.core.permissions import (
    ALL_CARD_PERMISSION_KEYS,
    LEGACY_CARD_PERMISSION_KEYS,
    strip_legacy_card_permissions,
)

_MIG_PATH = (
    Path(__file__).resolve().parents[2]
    / "alembic"
    / "versions"
    / "140_drop_stale_stakeholder_role_permissions.py"
)
_spec = importlib.util.spec_from_file_location("mig140", _MIG_PATH)
mig = importlib.util.module_from_spec(_spec)
assert _spec and _spec.loader
_spec.loader.exec_module(mig)

STALE = mig.STALE_KEYS


def test_targets_exactly_the_two_stale_keys():
    assert STALE == frozenset({"card.quality_seal", "card.manage_subscriptions"})


def test_stale_keys_are_not_in_the_current_catalogue():
    # If either ever became a real permission again, the migration would start
    # deleting a live grant instead of dead data.
    assert not (STALE & ALL_CARD_PERMISSION_KEYS)


def test_migration_and_runtime_agree_on_what_is_stale():
    # The migration keeps its own literal so it describes the DB as of this
    # revision, but the two must not silently diverge while both are in use.
    assert STALE == LEGACY_CARD_PERMISSION_KEYS


def test_strips_both_stale_keys():
    plan = mig.plan_permissions(
        {
            "card.view": True,
            "card.quality_seal": True,
            "card.manage_subscriptions": False,
        },
        STALE,
    )
    assert plan == {"card.view": True}


def test_preserves_modern_and_admin_added_keys_verbatim():
    perms = {
        "card.view": True,
        "card.edit": False,
        "card.approval_status": True,
        "card.manage_stakeholders": True,
        "card.quality_seal": True,
    }
    plan = mig.plan_permissions(perms, STALE)
    assert plan == {
        "card.view": True,
        "card.edit": False,
        "card.approval_status": True,
        "card.manage_stakeholders": True,
    }


def test_does_not_remap_to_the_modern_equivalents():
    # Remapping would grant approve/reject + stakeholder management to every
    # existing holder of the role — a privilege escalation, not a fix.
    plan = mig.plan_permissions({"card.quality_seal": True}, STALE)
    assert plan == {}
    assert "card.approval_status" not in plan


def test_clean_map_is_left_alone():
    assert mig.plan_permissions({"card.view": True}, STALE) is None


def test_empty_map_is_left_alone():
    assert mig.plan_permissions({}, STALE) is None


def test_is_idempotent():
    perms = {"card.view": True, "card.quality_seal": True}
    once = mig.plan_permissions(perms, STALE)
    assert once is not None
    # A re-run over the already-rewritten map reports "nothing to do", so the
    # migration touches no rows the second time.
    assert mig.plan_permissions(once, STALE) is None


def test_non_dict_permissions_are_skipped():
    # NOT NULL in the model, but a hand-edited or third-party row could hold
    # anything; the planner must not raise mid-migration.
    assert mig.plan_permissions(None, STALE) is None
    assert mig.plan_permissions([], STALE) is None
    assert mig.plan_permissions("card.view", STALE) is None


def test_planner_matches_the_runtime_stripper():
    # The migration repairs data at rest and the API strips on write; they must
    # agree, or a saved role would differ from a migrated one.
    perms = {"card.view": True, "card.quality_seal": True, "card.manage_subscriptions": True}
    assert mig.plan_permissions(perms, STALE) == strip_legacy_card_permissions(perms)


def test_downgrade_is_a_documented_no_op():
    assert mig.downgrade() is None
