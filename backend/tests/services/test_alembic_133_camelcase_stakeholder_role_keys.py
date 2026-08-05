"""Unit tests for migration 133 (camelCase stakeholder role keys).

Migration 133 renames the four built-in snake_case stakeholder role keys to the
camelCase grammar every other metamodel key uses. These tests exercise the pure
planning helpers — no DB — and assert they are guarded, idempotent, and
non-destructive to anything an admin customised.
"""

from __future__ import annotations

import importlib.util
from pathlib import Path

_MIG_PATH = (
    Path(__file__).resolve().parents[2]
    / "alembic"
    / "versions"
    / "133_camelcase_stakeholder_role_keys.py"
)
_spec = importlib.util.spec_from_file_location("mig133", _MIG_PATH)
mig = importlib.util.module_from_spec(_spec)
assert _spec and _spec.loader
_spec.loader.exec_module(mig)

M = mig.RENAMES
INVERSE = {new: old for old, new in M.items()}


def test_renames_exactly_the_four_built_in_keys():
    assert M == {
        "process_owner": "processOwner",
        "technical_application_owner": "technicalApplicationOwner",
        "business_application_owner": "businessApplicationOwner",
        "it_project_manager": "itProjectManager",
    }


def test_responsible_and_observer_are_untouched():
    # Both are already valid camelCase, so they must not appear in the map.
    assert "responsible" not in M
    assert "observer" not in M


# ---------------------------------------------------------------------------
# surveys.target_roles
# ---------------------------------------------------------------------------


def test_survey_roles_renamed():
    out = mig.plan_survey_roles(["responsible", "technical_application_owner"], M)
    assert out == ["responsible", "technicalApplicationOwner"]


def test_survey_roles_noop_when_nothing_matches():
    assert mig.plan_survey_roles(["responsible", "observer"], M) is None


def test_survey_roles_idempotent():
    once = mig.plan_survey_roles(["process_owner"], M)
    assert once == ["processOwner"]
    assert mig.plan_survey_roles(once, M) is None


def test_survey_roles_preserves_custom_keys():
    out = mig.plan_survey_roles(["myCustomRole", "process_owner"], M)
    assert out == ["myCustomRole", "processOwner"]


def test_survey_roles_tolerates_non_list_and_non_string():
    assert mig.plan_survey_roles(None, M) is None
    assert mig.plan_survey_roles("responsible", M) is None
    # A malformed entry is carried through rather than crashing the migration.
    assert mig.plan_survey_roles([None, "process_owner"], M) == [None, "processOwner"]


# ---------------------------------------------------------------------------
# card_types.stakeholder_roles (legacy JSONB mirror)
# ---------------------------------------------------------------------------


def test_type_mirror_renamed():
    out = mig.plan_type_mirror(
        [
            {"key": "responsible", "label": "Responsible"},
            {"key": "process_owner", "label": "Process Owner"},
        ],
        M,
    )
    assert out == [
        {"key": "responsible", "label": "Responsible"},
        {"key": "processOwner", "label": "Process Owner"},
    ]


def test_type_mirror_preserves_other_entry_fields():
    out = mig.plan_type_mirror(
        [{"key": "process_owner", "label": "Process Owner", "translations": {"de": "x"}}], M
    )
    assert out == [{"key": "processOwner", "label": "Process Owner", "translations": {"de": "x"}}]


def test_type_mirror_noop_and_idempotent():
    assert mig.plan_type_mirror([{"key": "responsible", "label": "Responsible"}], M) is None
    once = mig.plan_type_mirror([{"key": "it_project_manager", "label": "PM"}], M)
    assert once == [{"key": "itProjectManager", "label": "PM"}]
    assert mig.plan_type_mirror(once, M) is None


def test_type_mirror_tolerates_non_list_and_malformed_entries():
    assert mig.plan_type_mirror(None, M) is None
    assert mig.plan_type_mirror([{"label": "no key"}], M) is None
    assert mig.plan_type_mirror(["junk", {"key": "process_owner"}], M) == [
        "junk",
        {"key": "processOwner"},
    ]


# ---------------------------------------------------------------------------
# Downgrade
# ---------------------------------------------------------------------------


def test_downgrade_restores_the_original_keys():
    forward = mig.plan_survey_roles(["technical_application_owner"], M)
    assert mig.plan_survey_roles(forward, INVERSE) == ["technical_application_owner"]

    forward_mirror = mig.plan_type_mirror([{"key": "business_application_owner"}], M)
    assert mig.plan_type_mirror(forward_mirror, INVERSE) == [{"key": "business_application_owner"}]
