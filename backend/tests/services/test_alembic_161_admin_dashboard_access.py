"""Unit tests for migration 161 (state who sees the built-in Admin dashboard).

Seeding is insert-only, so an install whose dashboards were seeded before the
Admin dashboard's ``allowed_roles`` were seeded from ``access_permission`` kept
``[]`` ("everyone") for good. Migration 161 writes the seeded value onto that
row — the ``roles_holding`` rule, written inline — and leaves a row an admin
already restricted alone.

These exercise the pure ``plan_admin_access`` helper — no DB.
"""

from __future__ import annotations

import importlib.util
from pathlib import Path

import pytest

from app.services.dashboard_defaults import DEFAULT_DASHBOARDS
from app.services.dashboard_service import roles_holding

_MIG_PATH = (
    Path(__file__).resolve().parents[2] / "alembic" / "versions" / "161_admin_dashboard_access.py"
)
_spec = importlib.util.spec_from_file_location("mig161", _MIG_PATH)
mig = importlib.util.module_from_spec(_spec)
assert _spec and _spec.loader
_spec.loader.exec_module(mig)

ADMIN = ("admin", {"*": True}, False, 0)
MEMBER = ("member", {"inventory.view": True, "admin.users": False}, False, 2)
USER_MANAGER = ("user_manager", {"admin.users": True}, False, 5)
ARCHIVED_MANAGER = ("old_manager", {"admin.users": True}, True, 1)
NO_PERMISSIONS = ("ghost", None, False, 3)
WILDCARD_OFF = ("viewer", {"*": False, "inventory.view": True}, False, 4)

ROLE_SETS = [
    [ADMIN],
    [ADMIN, MEMBER],
    [MEMBER, USER_MANAGER, ADMIN],
    [ARCHIVED_MANAGER, ADMIN, USER_MANAGER],
    [NO_PERMISSIONS, WILDCARD_OFF, ADMIN],
    [MEMBER, ARCHIVED_MANAGER, NO_PERMISSIONS],
    [],
]


def test_the_migration_names_the_permission_the_spec_seeds_from():
    assert mig.ACCESS_PERMISSION == DEFAULT_DASHBOARDS["admin"]["access_permission"]
    assert mig.DASHBOARD_KEY == "admin"


@pytest.mark.parametrize("roles", ROLE_SETS)
def test_the_plan_is_the_seeded_access(roles):
    """A repaired install and a fresh one end with the same list — and a set
    with no holder is a no-op, never a write of ``[]``."""
    expected = roles_holding("admin.users", roles)
    assert mig.plan_admin_access([], roles) == (expected or None)


def test_holders_of_admin_users_or_the_wildcard_only_active_ones():
    roles = [MEMBER, USER_MANAGER, ARCHIVED_MANAGER, NO_PERMISSIONS, WILDCARD_OFF, ADMIN]
    assert mig.plan_admin_access([], roles) == ["admin", "user_manager"]


def test_ordered_by_sort_order_then_key():
    roles = [
        ("zeta", {"admin.users": True}, False, 1),
        ("alpha", {"admin.users": True}, False, 1),
        ("admin", {"*": True}, False, 9),
        ("first", {"admin.users": True}, False, 0),
    ]
    assert mig.plan_admin_access([], roles) == ["first", "alpha", "zeta", "admin"]


def test_a_missing_sort_order_counts_as_zero():
    roles = [("b", {"admin.users": True}, False, 1), ("a", {"*": True}, False, None)]
    assert mig.plan_admin_access([], roles) == ["a", "b"]


@pytest.mark.parametrize("current", [["member"], ["admin"], ["admin", "user_manager"]])
def test_a_restricted_dashboard_is_left_alone(current):
    assert mig.plan_admin_access(current, [ADMIN, USER_MANAGER]) is None


def test_no_holder_is_a_no_op():
    assert mig.plan_admin_access([], [MEMBER, ARCHIVED_MANAGER]) is None
