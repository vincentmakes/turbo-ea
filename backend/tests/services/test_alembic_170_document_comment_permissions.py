"""Unit tests for migration 170 (grant ``adr.comment`` / ``soaw.comment`` to stored roles).

Seeding never rewrites a stored role, so without the migration every existing
role would lack both keys. The pure planners are exercised here — no DB.
"""

from __future__ import annotations

import importlib.util
from pathlib import Path

import pytest

from app.core.permissions import (
    ALL_APP_PERMISSION_KEYS,
    BPM_ADMIN_PERMISSIONS,
    MEMBER_PERMISSIONS,
    VIEWER_PERMISSIONS,
)

_MIG_PATH = (
    Path(__file__).resolve().parents[2]
    / "alembic"
    / "versions"
    / "170_document_comment_permissions.py"
)
_spec = importlib.util.spec_from_file_location("mig170", _MIG_PATH)
mig = importlib.util.module_from_spec(_spec)
assert _spec and _spec.loader
_spec.loader.exec_module(mig)


def test_revision_chain():
    assert mig.revision == "170"
    assert mig.down_revision == "169"


def test_the_migration_imports_no_app_code():
    source = _MIG_PATH.read_text()
    assert "from app" not in source
    assert "import app" not in source


def test_the_keys_are_registered():
    assert set(mig.GRANTS) == {"adr.comment", "soaw.comment"}
    assert set(mig.GRANTS) <= ALL_APP_PERMISSION_KEYS


def test_the_seeded_defaults():
    assert (MEMBER_PERMISSIONS["adr.comment"], MEMBER_PERMISSIONS["soaw.comment"]) == (True, True)
    assert (BPM_ADMIN_PERMISSIONS["adr.comment"], BPM_ADMIN_PERMISSIONS["soaw.comment"]) == (
        True,
        True,
    )
    assert (VIEWER_PERMISSIONS["adr.comment"], VIEWER_PERMISSIONS["soaw.comment"]) == (
        False,
        False,
    )


@pytest.mark.parametrize(
    "source, expected",
    [
        ({"adr.manage": True}, (True, False)),
        ({"adr.sign": True}, (True, False)),
        ({"adr.manage": False, "adr.sign": False}, (False, False)),
        ({"soaw.manage": True}, (False, True)),
        ({"soaw.sign": True}, (False, True)),
        ({"adr.sign": True, "soaw.manage": True}, (True, True)),
        ({"adr.view": True, "soaw.view": True}, (False, False)),
        ({}, (False, False)),
    ],
)
def test_each_key_follows_its_own_source_permissions(source, expected):
    planned = mig.plan_comment_grants(source)
    assert planned == {**source, "adr.comment": expected[0], "soaw.comment": expected[1]}
    assert type(planned["adr.comment"]) is bool
    assert type(planned["soaw.comment"]) is bool


def test_a_truthy_non_bool_source_is_written_as_a_bool():
    assert mig.plan_comment_grants({"adr.sign": 1, "soaw.manage": "yes"}) == {
        "adr.sign": 1,
        "soaw.manage": "yes",
        "adr.comment": True,
        "soaw.comment": True,
    }


def test_the_seeded_roles_end_where_the_defaults_say():
    for defaults in (MEMBER_PERMISSIONS, BPM_ADMIN_PERMISSIONS, VIEWER_PERMISSIONS):
        before = {k: v for k, v in defaults.items() if k not in mig.GRANTS}
        assert mig.plan_comment_grants(before) == defaults


def test_a_key_already_held_keeps_its_value():
    assert mig.plan_comment_grants({"adr.manage": True, "adr.comment": False}) == {
        "adr.manage": True,
        "adr.comment": False,
        "soaw.comment": False,
    }
    assert mig.plan_comment_grants({"soaw.comment": True}) == {
        "soaw.comment": True,
        "adr.comment": False,
    }


def test_a_role_holding_both_keys_is_left_alone():
    assert mig.plan_comment_grants({"adr.comment": False, "soaw.comment": True}) is None


@pytest.mark.parametrize("permissions", [{"*": True}, None, [], "x"])
def test_the_wildcard_and_non_maps_are_left_alone(permissions):
    assert mig.plan_comment_grants(permissions) is None


def test_a_wildcard_set_to_false_is_an_ordinary_role():
    assert mig.plan_comment_grants({"*": False, "adr.manage": True}) == {
        "*": False,
        "adr.manage": True,
        "adr.comment": True,
        "soaw.comment": False,
    }


def test_the_input_is_not_mutated():
    source = {"adr.manage": True}
    mig.plan_comment_grants(source)
    assert source == {"adr.manage": True}


def test_removal_drops_both_keys_only():
    assert mig.plan_removal({"adr.manage": True, "adr.comment": True, "soaw.comment": False}) == {
        "adr.manage": True
    }
    assert mig.plan_removal({"adr.comment": True}) == {}


@pytest.mark.parametrize("permissions", [{"adr.manage": True}, {}, {"*": True}, None, []])
def test_removal_leaves_a_role_without_the_keys_alone(permissions):
    assert mig.plan_removal(permissions) is None
