"""Unit tests for migration 156 (the card type category registry).

Before 156 ``card_types.category`` was free text. The migration creates the
registry and adopts every stored category that is not one of the four
built-in layers (those are seeded on boot) as a custom row, so the type
editor — which always sends ``category`` back — can still save such a type.

These exercise the pure ``plan_adopted_rows`` helper — no DB.
"""

from __future__ import annotations

import importlib.util
from pathlib import Path

from app.services.seed import DEFAULT_CATEGORY_KEYS

_MIG_PATH = (
    Path(__file__).resolve().parents[2] / "alembic" / "versions" / "156_card_type_categories.py"
)
_spec = importlib.util.spec_from_file_location("mig156", _MIG_PATH)
mig = importlib.util.module_from_spec(_spec)
assert _spec and _spec.loader
_spec.loader.exec_module(mig)


def test_revision_chain():
    assert mig.revision == "156"
    assert mig.down_revision == "155"


def test_a_free_text_category_is_adopted_as_a_custom_row():
    rows = mig.plan_adopted_rows(["Security Architecture"], DEFAULT_CATEGORY_KEYS)
    assert rows == [
        {
            "key": "Security Architecture",
            "label": "Security Architecture",
            "color": "#999999",
            "sort_order": 100,
            "built_in": False,
            "translations": {},
        }
    ]


def test_the_defaults_are_left_to_the_seed():
    assert mig.plan_adopted_rows(sorted(DEFAULT_CATEGORY_KEYS), DEFAULT_CATEGORY_KEYS) == []


def test_values_are_trimmed_deduplicated_and_numbered_in_sorted_order():
    rows = mig.plan_adopted_rows(
        ["Zeta", " Zeta ", "Alpha", None, "", "   ", 3, "Application & Data"],
        DEFAULT_CATEGORY_KEYS,
    )
    assert [(r["key"], r["sort_order"]) for r in rows] == [("Alpha", 100), ("Zeta", 101)]


def test_a_case_variant_of_a_default_is_its_own_row():
    # The stored value must resolve exactly, so it cannot fold into the default.
    rows = mig.plan_adopted_rows(["application & data"], DEFAULT_CATEGORY_KEYS)
    assert [r["key"] for r in rows] == ["application & data"]


def test_an_overlong_value_is_not_adopted():
    assert mig.plan_adopted_rows(["x" * 101], DEFAULT_CATEGORY_KEYS) == []


def test_the_timestamp_columns_default_on_the_server():
    source = _MIG_PATH.read_text()
    assert source.count("server_default=sa.func.now()") == 2
