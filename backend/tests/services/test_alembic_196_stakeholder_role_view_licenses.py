"""The license permission migration preserves prior grants except Observer."""

import importlib.util
from pathlib import Path

import pytest

from app.core.permissions import (
    DEFAULT_CARD_PERMISSIONS_BY_ROLE,
    with_legacy_license_grant,
)

_path = (
    Path(__file__).resolve().parents[2] / "alembic/versions/196_stakeholder_role_view_licenses.py"
)
_spec = importlib.util.spec_from_file_location("mig196", _path)
assert _spec and _spec.loader
migration = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(migration)


@pytest.mark.parametrize("role", ["observer", "responsible", "custom"])
@pytest.mark.parametrize(
    "stored", [{}, {"card.view_licenses": True}, {"card.view_licenses": False}]
)
def test_migration_and_old_bundle_agree(role, stored):
    planned = migration.plan_permissions(role, stored)
    assert with_legacy_license_grant(role, stored) == (stored if planned is None else planned)


def test_defaults_match_existing_role_migration():
    assert migration.down_revision == "195"
    for role, permissions in DEFAULT_CARD_PERMISSIONS_BY_ROLE.items():
        old = {key: value for key, value in permissions.items() if key != "card.view_licenses"}
        assert migration.plan_permissions(role, old) == permissions


def test_observer_and_downgrade():
    assert migration.plan_permissions("observer", {}) == {"card.view_licenses": False}
    assert migration.plan_permissions("responsible", {}) == {"card.view_licenses": True}
    assert migration.unplan_permissions({"card.view": True, "card.view_licenses": True}) == {
        "card.view": True
    }
