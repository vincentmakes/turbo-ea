"""Unit tests for migration 179 (custom card types get the role definitions
they showed, #1437).

The pure planner decides which ``stakeholder_role_definitions`` rows one custom
type needs; these tests pin it without a database, and pin the frozen
permission literals to the runtime defaults a new type is created with.
"""

from __future__ import annotations

import importlib.util
from pathlib import Path

from app.core.permissions import ALL_CARD_PERMISSION_KEYS, DEFAULT_CARD_PERMISSIONS_BY_ROLE
from app.services.stakeholder_service import DEFAULT_STAKEHOLDER_ROLES

_MIG_PATH = (
    Path(__file__).resolve().parents[2]
    / "alembic"
    / "versions"
    / "179_backfill_custom_type_stakeholder_roles.py"
)
_spec = importlib.util.spec_from_file_location("mig179", _MIG_PATH)
mig = importlib.util.module_from_spec(_spec)
assert _spec and _spec.loader
_spec.loader.exec_module(mig)


def keys(rows):
    return [r["key"] for r in rows]


def test_follows_178():
    assert mig.revision == "179"
    assert mig.down_revision == "178"


def test_the_literals_match_what_a_new_type_gets_today():
    assert list(mig.DEFAULT_ROLES) == list(DEFAULT_STAKEHOLDER_ROLES)
    for role, perms in mig.PERMISSIONS_BY_ROLE.items():
        assert set(perms) <= ALL_CARD_PERMISSION_KEYS
        runtime = DEFAULT_CARD_PERMISSIONS_BY_ROLE[role]
        assert {k: runtime.get(k, False) for k in perms} == perms


def test_a_type_without_rows_gets_the_defaults_when_its_list_is_empty():
    rows = mig.plan_rows([], set(), [])
    assert rows == [
        {
            "key": "responsible",
            "label": "Responsible",
            "permissions": mig.RESPONSIBLE_PERMISSIONS,
            "counts_for_quality": True,
            "sort_order": 0,
        },
        {
            "key": "observer",
            "label": "Observer",
            "permissions": mig.OBSERVER_PERMISSIONS,
            "counts_for_quality": False,
            "sort_order": 1,
        },
    ]
    assert mig.plan_rows(None, set(), []) == rows


def test_a_type_without_rows_gets_its_own_list_in_order():
    rows = mig.plan_rows(
        [
            {"key": "owner", "label": "Owner"},
            {"key": "responsible", "label": "Accountable"},
            {"key": "owner", "label": "Twice"},
            {"label": "no key"},
            "observer",
            {"key": "y" * 51},
            {"key": "steward", "label": " "},
        ],
        set(),
        [],
    )
    assert [(r["key"], r["label"], r["sort_order"]) for r in rows] == [
        ("owner", "Owner", 0),
        ("responsible", "Accountable", 1),
        ("steward", "steward", 2),
    ]
    # An unknown key grants nothing — as before, when no row granted anything.
    assert rows[0]["permissions"] == {}
    assert rows[1]["permissions"] == mig.RESPONSIBLE_PERMISSIONS


def test_the_reporters_state_gets_back_only_the_roles_still_held():
    # An admin added `dataSteward`, which hid the fallback Responsible and
    # Observer; only Responsible is still held on a card.
    rows = mig.plan_rows(
        [{"key": "responsible", "label": "Responsible"}, {"key": "observer", "label": "Observer"}],
        {"dataSteward"},
        ["responsible", "dataSteward"],
        next_sort=4,
    )
    assert [(r["key"], r["label"], r["sort_order"]) for r in rows] == [
        ("responsible", "Responsible", 4)
    ]
    assert rows[0]["permissions"] == mig.RESPONSIBLE_PERMISSIONS


def test_a_held_key_no_list_names_is_defined_too():
    assert keys(mig.plan_rows([], set(), ["zeta", "alpha"])) == [
        "responsible",
        "observer",
        "alpha",
        "zeta",
    ]
    rows = mig.plan_rows([], {"responsible"}, ["auditor"])
    assert [(r["key"], r["label"], r["permissions"]) for r in rows] == [("auditor", "auditor", {})]


def test_a_complete_type_is_left_alone():
    assert mig.plan_rows([], {"responsible", "observer"}, ["responsible", "observer"]) == []
    assert mig.plan_rows([{"key": "x"}], {"x"}, []) == []


def test_unusable_held_keys_are_skipped():
    assert mig.plan_rows([], {"a"}, ["", "z" * 51, None]) == []


def test_a_long_label_is_cut_to_the_column():
    rows = mig.plan_rows([{"key": "k", "label": "L" * 300}], set(), [])
    assert rows[0]["label"] == "L" * 200


def test_downgrade_is_a_no_op():
    assert mig.downgrade() is None
