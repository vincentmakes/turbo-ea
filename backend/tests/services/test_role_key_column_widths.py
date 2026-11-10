"""Every column that stores a role key is as wide as ``roles.key`` (#1330).

``POST /roles`` accepts keys of up to 50 characters, but ``users.role`` and
``sso_invitations.role`` were ``VARCHAR(20)``, so a longer role could be
created and then never assigned: every write of it failed in the database.
These tests tie the API cap, the key pattern, ``roles.key`` and every column
that stores a role key together — the columns are discovered from the model
metadata, so a new table storing a roles.key is guarded without being listed —
and pin migration 159, which widens the two columns on existing installs. No DB.
"""

from __future__ import annotations

import importlib.util
from pathlib import Path
from unittest.mock import patch

import pytest
from annotated_types import MaxLen
from sqlalchemy import Column, String

import app.models  # noqa: F401  (registers every table on Base.metadata)
from app.api.v1.roles import ROLE_KEY_PATTERN, RoleCreate
from app.models.base import Base
from app.models.role import Role
from app.models.sso_invitation import SsoInvitation
from app.models.user import User

_MIG_PATH = (
    Path(__file__).resolve().parents[2] / "alembic" / "versions" / "159_widen_user_role_columns.py"
)
_spec = importlib.util.spec_from_file_location("mig159", _MIG_PATH)
mig = importlib.util.module_from_spec(_spec)
assert _spec and _spec.loader
_spec.loader.exec_module(mig)

ROLE_KEY_LENGTH = 50

# String columns named after a role that hold something OTHER than a roles.key.
# A new column here needs its reason; a column that does store a roles.key is
# found by ``_role_named_columns`` and must be as wide as ``roles.key``.
NOT_A_ROLE_KEY: dict[tuple[str, str], str] = {
    ("risk_cards", "role"): "a card's part in a risk (affected, …), not an app role",
    ("stakeholders", "role"): "a stakeholder_role_definitions.key, its own 50-wide registry",
}


def _role_named_columns() -> dict[tuple[str, str], Column]:
    """Every String column whose name says it holds a role, from the live metadata."""
    found: dict[tuple[str, str], Column] = {}
    for table in Base.metadata.tables.values():
        if table.name == "roles":
            continue
        for column in table.columns:
            if "role" in column.name and isinstance(column.type, String):
                found[(table.name, column.name)] = column
    return found


ROLE_NAMED = _role_named_columns()
# Every column that stores a roles.key (users.role, sso_invitations.role,
# audit_log.impersonated_role, …): discovered, so the next table that stores
# an assigned role key is guarded without anyone remembering to list it.
GUARDED_COLUMNS = {name: col for name, col in ROLE_NAMED.items() if name not in NOT_A_ROLE_KEY}
# The two that were VARCHAR(20) and that migration 159 widens.
ASSIGNED_COLUMNS = {("users", "role"), ("sso_invitations", "role")}


def _api_max_length() -> int:
    lengths = [
        m.max_length for m in RoleCreate.model_fields["key"].metadata if isinstance(m, MaxLen)
    ]
    assert len(lengths) == 1
    return lengths[0]


def test_roles_key_column_matches_the_api_cap():
    key_type = Role.__table__.c.key.type
    assert isinstance(key_type, String)
    assert key_type.length == ROLE_KEY_LENGTH
    assert _api_max_length() == ROLE_KEY_LENGTH


def test_the_key_pattern_accepts_exactly_the_column_width():
    assert ROLE_KEY_PATTERN.match("a" * ROLE_KEY_LENGTH)
    assert not ROLE_KEY_PATTERN.match("a" * (ROLE_KEY_LENGTH + 1))


def test_the_discovery_sees_the_columns_this_bug_was_about():
    assert ASSIGNED_COLUMNS <= set(GUARDED_COLUMNS)
    assert GUARDED_COLUMNS[("users", "role")] is User.__table__.c.role
    assert GUARDED_COLUMNS[("sso_invitations", "role")] is SsoInvitation.__table__.c.role


@pytest.mark.parametrize("name", sorted(GUARDED_COLUMNS), ids=lambda n: ".".join(n))
def test_every_column_storing_a_role_key_holds_any_role_key(name):
    column_type = GUARDED_COLUMNS[name].type
    assert isinstance(column_type, String)
    assert column_type.length is not None
    assert column_type.length >= Role.__table__.c.key.type.length


@pytest.mark.parametrize("name", sorted(ASSIGNED_COLUMNS), ids=lambda n: ".".join(n))
def test_an_assigned_role_column_is_exactly_as_wide_as_roles_key(name):
    assert GUARDED_COLUMNS[name].type.length == Role.__table__.c.key.type.length


def test_no_stale_allowlist_entry():
    """An allowlisted column that no longer exists is a leftover; remove it."""
    assert set(NOT_A_ROLE_KEY) <= set(ROLE_NAMED)


def test_migration_covers_exactly_the_assigned_columns():
    assert mig.revision == "159"
    assert mig.down_revision == "158"
    assert len(mig.ROLE_KEY_COLUMNS) == len(set(mig.ROLE_KEY_COLUMNS))
    assert set(mig.ROLE_KEY_COLUMNS) == ASSIGNED_COLUMNS


def _alter_calls(fn) -> list[tuple[str, str, int, int, bool]]:
    with patch.object(mig, "op") as op:
        fn()
    # Nothing but the two column type changes (no data rewrite, no new constraint).
    assert [name for name, _, _ in op.method_calls] == ["alter_column"] * len(ASSIGNED_COLUMNS)
    out = []
    for c in op.alter_column.call_args_list:
        assert set(c.kwargs) == {"existing_type", "type_", "existing_nullable"}
        assert isinstance(c.kwargs["existing_type"], String)
        assert isinstance(c.kwargs["type_"], String)
        out.append(
            (
                *c.args,
                c.kwargs["existing_type"].length,
                c.kwargs["type_"].length,
                c.kwargs["existing_nullable"],
            )
        )
    return out


def test_upgrade_widens_both_columns_from_20_to_50():
    assert _alter_calls(mig.upgrade) == [
        ("users", "role", 20, ROLE_KEY_LENGTH, False),
        ("sso_invitations", "role", 20, ROLE_KEY_LENGTH, False),
    ]


def test_downgrade_narrows_both_columns_back_to_20():
    assert _alter_calls(mig.downgrade) == [
        ("users", "role", ROLE_KEY_LENGTH, 20, False),
        ("sso_invitations", "role", ROLE_KEY_LENGTH, 20, False),
    ]
