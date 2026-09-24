"""Unit tests for migration 153 (store every relation in its type's direction).

Rows written before every write path oriented relations could be stored the
other way round — an Interface as the source of an Application → Interface
link — which card detail showed on neither card and an arrow drew backwards
(#1140). Migration 153 swaps their ends, keeps their attributes verbatim, and
collapses a turned row onto a correct duplicate with migration 131's rule.

These exercise the pure ``plan_orientation`` helper — no DB.
"""

from __future__ import annotations

import importlib.util
from datetime import datetime, timedelta
from pathlib import Path

_MIG_PATH = (
    Path(__file__).resolve().parents[2]
    / "alembic"
    / "versions"
    / "153_orient_relations_to_their_type.py"
)
_spec = importlib.util.spec_from_file_location("mig153", _MIG_PATH)
mig = importlib.util.module_from_spec(_spec)
assert _spec and _spec.loader
_spec.loader.exec_module(mig)

T0 = datetime(2026, 1, 1)
APP, IFACE = "app-1", "iface-1"


def row(rid, *, backwards, created=0, attributes=None, description=None, rtype="relAppToIf"):
    source, target = (IFACE, APP) if backwards else (APP, IFACE)
    return mig.RelRow(
        id=rid,
        type=rtype,
        source_id=source,
        target_id=target,
        created_at=T0 + timedelta(days=created),
        attributes=attributes,
        description=description,
        backwards=backwards,
    )


def test_a_lone_backwards_row_is_swapped_with_its_attributes_untouched():
    plan = mig.plan_orientation([row("b", backwards=True, attributes={"flowDirection": "forward"})])
    assert plan.swaps == ["b"]
    assert plan.updates == {}
    assert plan.deletes == []


def test_a_backwards_row_folds_into_an_older_correct_row():
    correct = row("c", backwards=False, created=0, attributes={"flowDirection": "reverse"})
    backwards = row("b", backwards=True, created=5, attributes={"flowDirection": "forward", "x": 1})
    plan = mig.plan_orientation([correct, backwards])
    # The correct row is the older one: it survives, keeps its own flow and
    # only gains the key it did not have.
    assert plan.swaps == []
    assert plan.deletes == ["b"]
    assert plan.updates == {"c": ({"flowDirection": "reverse", "x": 1}, None)}


def test_an_older_backwards_row_survives_and_is_swapped():
    backwards = row("b", backwards=True, created=0, attributes={"flowDirection": "forward"})
    correct = row("c", backwards=False, created=5, description="added again")
    plan = mig.plan_orientation([backwards, correct])
    assert plan.swaps == ["b"]
    assert plan.deletes == ["c"]
    assert plan.updates == {"b": ({"flowDirection": "forward"}, "added again")}


def test_correct_rows_on_their_own_are_left_alone():
    plan = mig.plan_orientation([row("c1", backwards=False), row("c2", backwards=False, rtype="x")])
    assert (plan.swaps, plan.updates, plan.deletes) == ([], {}, [])


def test_rows_of_different_types_never_merge():
    plan = mig.plan_orientation(
        [row("b", backwards=True), row("c", backwards=False, rtype="relOther")]
    )
    assert plan.swaps == ["b"]
    assert plan.deletes == []
