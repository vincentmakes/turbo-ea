"""Unit tests for migration 116 (backfill ``servicenow.view`` from ``servicenow.manage``).

Migration 116 accompanies the re-tiering of the read-only ServiceNow
endpoints from ``servicenow.manage`` to ``servicenow.view``. Permission
checks are exact-key lookups, so a pre-existing custom role holding
``manage`` without ``view`` would lose read access it had before the
upgrade. These tests exercise the pure ``plan_patch`` helper — no DB —
and assert it is guarded, idempotent, and non-destructive.
"""

from __future__ import annotations

import importlib.util
from pathlib import Path

_MIG_PATH = (
    Path(__file__).resolve().parents[2] / "alembic" / "versions" / "116_backfill_servicenow_view.py"
)
_spec = importlib.util.spec_from_file_location("mig116", _MIG_PATH)
mig = importlib.util.module_from_spec(_spec)
assert _spec and _spec.loader
_spec.loader.exec_module(mig)


def test_grants_view_to_manage_only_role():
    perms = {"servicenow.manage": True, "servicenow.view": False, "inventory.view": True}
    out = mig.plan_patch(perms)
    assert out is not None
    assert out["servicenow.view"] is True
    # Everything else untouched.
    assert out["servicenow.manage"] is True
    assert out["inventory.view"] is True


def test_grants_view_when_key_missing_entirely():
    out = mig.plan_patch({"servicenow.manage": True})
    assert out is not None
    assert out["servicenow.view"] is True


def test_noop_when_view_already_granted():
    assert mig.plan_patch({"servicenow.manage": True, "servicenow.view": True}) is None


def test_noop_without_manage_grant():
    assert mig.plan_patch({"servicenow.manage": False, "servicenow.view": False}) is None
    assert mig.plan_patch({"inventory.view": True}) is None


def test_noop_for_wildcard_admin_role():
    # The admin role is {"*": true} and holds no explicit servicenow keys.
    assert mig.plan_patch({"*": True}) is None


def test_noop_for_non_dict_permissions():
    assert mig.plan_patch(None) is None
    assert mig.plan_patch(["servicenow.manage"]) is None


def test_idempotent():
    once = mig.plan_patch({"servicenow.manage": True})
    assert once is not None
    assert mig.plan_patch(once) is None


def test_does_not_mutate_input():
    perms = {"servicenow.manage": True}
    mig.plan_patch(perms)
    assert perms == {"servicenow.manage": True}
