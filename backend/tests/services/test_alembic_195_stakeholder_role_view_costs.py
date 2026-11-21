"""Unit tests for migration 195 (which stakeholder roles show a card's costs).

The migration writes ``card.view_costs`` into every existing role definition:
``true`` everywhere, ``false`` on Observer, the role a user can give themselves
(#1412). These tests exercise the pure planning helpers — no DB — and pin that
the rule is the one the workspace importer applies to an older bundle.
"""

from __future__ import annotations

import importlib.util
from pathlib import Path

import pytest

from app.core.permissions import (
    ALL_CARD_PERMISSION_KEYS,
    DEFAULT_CARD_PERMISSIONS_BY_ROLE,
    SELF_ASSIGNABLE_STAKEHOLDER_ROLE,
    VIEW_COSTS_CARD_PERMISSION,
    with_legacy_cost_grant,
)

_MIG_PATH = (
    Path(__file__).resolve().parents[2]
    / "alembic"
    / "versions"
    / "195_stakeholder_role_view_costs.py"
)
_spec = importlib.util.spec_from_file_location("mig195", _MIG_PATH)
mig = importlib.util.module_from_spec(_spec)
assert _spec and _spec.loader
_spec.loader.exec_module(mig)


def test_the_literals_match_the_runtime():
    assert mig.VIEW_COSTS_KEY == VIEW_COSTS_CARD_PERMISSION == "card.view_costs"
    assert mig.SELF_ASSIGNABLE_ROLE == SELF_ASSIGNABLE_STAKEHOLDER_ROLE == "observer"
    assert mig.VIEW_COSTS_KEY in ALL_CARD_PERMISSION_KEYS


def test_follows_194():
    assert mig.revision == "195"
    assert mig.down_revision == "194"


def test_an_owner_role_keeps_showing_costs():
    plan = mig.plan_permissions("responsible", {"card.view": True, "card.edit": True})
    assert plan == {"card.view": True, "card.edit": True, "card.view_costs": True}


def test_observer_stops_showing_costs():
    plan = mig.plan_permissions("observer", {"card.view": True, "card.create_comments": True})
    assert plan == {"card.view": True, "card.create_comments": True, "card.view_costs": False}


def test_a_custom_role_keeps_showing_costs_whatever_else_it_allows():
    # Before the key existed any role showed costs, a view-only one included.
    assert mig.plan_permissions("auditor", {"card.view": True}) == {
        "card.view": True,
        "card.view_costs": True,
    }
    assert mig.plan_permissions("auditor", {}) == {"card.view_costs": True}


def test_only_the_exact_observer_key_is_excluded():
    assert mig.plan_permissions("Observer", {})["card.view_costs"] is True
    assert mig.plan_permissions("observers", {})["card.view_costs"] is True
    assert mig.plan_permissions("observer", {})["card.view_costs"] is False


@pytest.mark.parametrize("stored", [True, False])
def test_a_row_that_already_has_the_key_is_left_alone(stored):
    # Idempotent, and an admin's own choice survives: Observer set to true and
    # an owner set to false both stay.
    for role in ("observer", "responsible"):
        assert mig.plan_permissions(role, {"card.view": True, "card.view_costs": stored}) is None


def test_a_null_map_is_filled_and_a_broken_one_is_skipped():
    assert mig.plan_permissions("responsible", None) == {"card.view_costs": True}
    assert mig.plan_permissions("responsible", ["card.view"]) is None
    assert mig.plan_permissions("responsible", "card.view") is None


def test_the_input_map_is_not_mutated():
    stored = {"card.view": True}
    mig.plan_permissions("responsible", stored)
    assert stored == {"card.view": True}


def test_a_second_run_changes_nothing():
    once = mig.plan_permissions("observer", {"card.view": True})
    assert mig.plan_permissions("observer", once) is None


@pytest.mark.parametrize("role", ["responsible", "observer", "auditor"])
@pytest.mark.parametrize(
    "stored", [{}, {"card.view": True}, {"card.view_costs": False}, {"card.view_costs": True}]
)
def test_the_importer_applies_the_same_rule(role, stored):
    # An install upgraded by this migration and a pre-2.206.0 bundle imported
    # into a new install must end with the same grants.
    planned = mig.plan_permissions(role, stored)
    assert with_legacy_cost_grant(role, stored) == (stored if planned is None else planned)


def test_the_seed_defaults_are_what_the_migration_writes():
    # A fresh install (seed) and an upgraded one (this migration) agree on
    # every built-in role.
    for role, perms in DEFAULT_CARD_PERMISSIONS_BY_ROLE.items():
        baseline = {k: v for k, v in perms.items() if k != "card.view_licenses"}
        without = {k: v for k, v in baseline.items() if k != "card.view_costs"}
        assert mig.plan_permissions(role, without) == baseline, role


def test_downgrade_drops_the_key_and_nothing_else():
    assert mig.unplan_permissions({"card.view": True, "card.view_costs": True}) == {
        "card.view": True
    }
    assert mig.unplan_permissions({"card.view_costs": False}) == {}
    assert mig.unplan_permissions({"card.view": True}) is None
    assert mig.unplan_permissions(None) is None
