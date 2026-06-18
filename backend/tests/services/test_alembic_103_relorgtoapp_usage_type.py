"""Unit tests for migration 103 (backfill the relOrgToApp ``usageType`` attribute).

Migration 103 repairs installs whose built-in ``relOrgToApp`` relation type was
seeded before the ``usageType`` attribute existed (and therefore has an empty
``attributes_schema``). These tests exercise the pure ``plan_backfill`` helper —
no DB — and assert it is guarded, idempotent, and non-destructive.
"""

from __future__ import annotations

import copy
import importlib.util
from pathlib import Path

_MIG_PATH = (
    Path(__file__).resolve().parents[2] / "alembic" / "versions" / "103_relorgtoapp_usage_type.py"
)
_spec = importlib.util.spec_from_file_location("mig103", _MIG_PATH)
mig = importlib.util.module_from_spec(_spec)
assert _spec and _spec.loader
_spec.loader.exec_module(mig)


def _keys(schema: list) -> list[str]:
    return [f["key"] for f in schema]


def test_backfills_empty_schema():
    out = mig.plan_backfill([])
    assert out is not None
    assert _keys(out) == ["usageType"]
    field = out[0]
    assert field["type"] == "single_select"
    assert [o["key"] for o in field["options"]] == ["owner", "user", "stakeholder"]


def test_treats_non_list_as_empty():
    out = mig.plan_backfill(None)
    assert out is not None
    assert _keys(out) == ["usageType"]


def test_noop_when_usage_type_already_present():
    # Already migrated / freshly seeded — leave it alone.
    assert mig.plan_backfill([copy.deepcopy(mig.USAGE_TYPE_FIELD)]) is None


def test_idempotent_on_backfilled_schema():
    once = mig.plan_backfill([])
    assert once is not None
    assert mig.plan_backfill(once) is None


def test_preserves_admin_added_attributes():
    custom = {"key": "customFlag", "type": "single_select", "options": []}
    out = mig.plan_backfill([custom])
    assert out is not None
    # Custom attribute kept, usageType appended.
    assert _keys(out) == ["customFlag", "usageType"]
