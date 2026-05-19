"""Unit tests for LeanIX migration staging service — pure helpers only.

Stage-and-apply round-trip integration tests live in
``test_leanix_migration_apply.py`` and require the DB conftest.
"""

from __future__ import annotations

from unittest.mock import MagicMock

from app.services.leanix_migration_service import (
    LX_DATATYPE_TO_TEA_TYPE,
    LX_SUBSCRIPTION_ROLE_MAP,
    LX_TO_TEA_RELATION,
    LX_TO_TEA_TYPE,
    _compare_relation_attrs,
    _normalise_tag_group_mode,
    build_card_payload,
    compute_card_diff,
    infer_tea_field_type,
    map_lx_relation,
    map_lx_type,
    map_subscription_role,
)
from app.services.leanix_snapshot_parser import FactSheet


def _fs(**kw):
    base = dict(leanix_id="fs-1", type="Application", name="App")
    base.update(kw)
    return FactSheet(**base)


def test_map_lx_type_covers_all_defaults() -> None:
    assert map_lx_type("Application") == "Application"
    assert map_lx_type("ITComponent") == "ITComponent"
    assert map_lx_type("Project") == "Initiative"
    assert map_lx_type("Process") == "BusinessProcess"
    assert map_lx_type("UserGroup") == "Organization"
    assert map_lx_type("RegulatoryRequirement") is None
    # 13 defaults + UserGroup edge-case = 14 entries
    assert len(LX_TO_TEA_TYPE) >= 13


def test_build_card_payload_basic() -> None:
    fs = _fs(
        category="businessApplication",
        description="CRM",
        lifecycle={"active": "2020-01-01"},
        custom_fields={"vendor": "Salesforce"},
    )
    p = build_card_payload(fs, "Application")
    assert p["type"] == "Application"
    assert p["subtype"] == "businessApplication"
    assert p["external_id"] == "fs-1"
    assert p["lifecycle"] == {"active": "2020-01-01"}
    assert p["attributes"] == {"vendor": "Salesforce"}
    assert p["approval_status"] == "DRAFT"


def test_build_card_payload_user_group_force_team_subtype() -> None:
    fs = _fs(leanix_id="ug-1", type="UserGroup", name="Sales team", category="ignored")
    p = build_card_payload(fs, "Organization")
    assert p["subtype"] == "team"
    assert p["attributes"]["leanix_origin"] == "UserGroup"


def test_build_card_payload_falls_back_to_display_name() -> None:
    fs = FactSheet(leanix_id="fs-9", type="Application", name="", display_name="Salesforce")
    p = build_card_payload(fs, "Application")
    assert p["name"] == "Salesforce"


def test_compute_card_diff_no_changes() -> None:
    existing = MagicMock()
    existing.name = "App"
    existing.description = "X"
    existing.subtype = "businessApplication"
    existing.external_id = "fs-1"
    existing.lifecycle = {"active": "2020-01-01"}
    existing.attributes = {"vendor": "Salesforce"}

    fs = _fs(
        category="businessApplication",
        description="X",
        lifecycle={"active": "2020-01-01"},
        custom_fields={"vendor": "Salesforce"},
    )
    p = build_card_payload(fs, "Application")
    # external_id round-trips and name matches → empty diff
    p["name"] = "App"
    diff = compute_card_diff(p, existing)
    assert diff == {}


def test_map_lx_relation_default_and_legacy_names() -> None:
    assert map_lx_relation("relApplicationToITComponent") == "relAppToITC"
    assert map_lx_relation("relApplicationToBusinessCapability") == "relAppToBC"
    assert map_lx_relation("relInterfaceToDataObject") == "relInterfaceToDataObj"
    # LeanIX "Project" and "Initiative" both fold into Turbo EA Initiative.
    assert map_lx_relation("relProjectToObjective") == "relInitiativeToObjective"
    assert map_lx_relation("relInitiativeToObjective") == "relInitiativeToObjective"
    # Hierarchy edges are intentionally not mapped — parent_id handles them.
    assert map_lx_relation("relToParent") is None
    assert map_lx_relation("relToChild") is None
    # Unknown / custom LeanIX relations.
    assert map_lx_relation("relCustomSomething") is None
    # Sanity check: table covers the core surface area.
    assert len(LX_TO_TEA_RELATION) >= 40


def test_normalise_tag_group_mode() -> None:
    assert _normalise_tag_group_mode("SINGLE") == "single"
    assert _normalise_tag_group_mode("MULTIPLE") == "multi"
    assert _normalise_tag_group_mode(None) == "multi"
    assert _normalise_tag_group_mode("") == "multi"


def test_compare_relation_attrs() -> None:
    diff = _compare_relation_attrs(
        {"crudRead": True, "criticality": "high"},
        {"crudRead": False, "criticality": "high"},
    )
    assert diff == {"crudRead": {"old": False, "new": True}}
    # Empty / identical → empty diff.
    assert _compare_relation_attrs({}, {}) == {}
    assert _compare_relation_attrs({"x": 1}, {"x": 1}) == {}


def test_map_subscription_role_known_names() -> None:
    assert map_subscription_role("Application Owner", "RESPONSIBLE") == "responsible"
    assert map_subscription_role("Responsible", None) == "responsible"
    assert map_subscription_role("Process Owner", None) == "process_owner"
    assert map_subscription_role("Project Manager", "ACCOUNTABLE") == "it_project_manager"
    assert map_subscription_role("IT Project Manager", "RESPONSIBLE") == "it_project_manager"
    assert map_subscription_role("Observer", "OBSERVER") == "observer"
    # Sanity-check the table size.
    assert len(LX_SUBSCRIPTION_ROLE_MAP) >= 6


def test_map_subscription_role_unknown_falls_back() -> None:
    # Unknown role-name, RESPONSIBLE type → responsible.
    assert map_subscription_role("Procurement Lead", "RESPONSIBLE") == "responsible"
    # Unknown role-name, OBSERVER type → observer.
    assert map_subscription_role("Architecture Auditor", "OBSERVER") == "observer"
    # Nothing known at all → responsible (most-permissive default).
    assert map_subscription_role(None, None) == "responsible"
    assert map_subscription_role("", "") == "responsible"


def test_infer_tea_field_type_coverage() -> None:
    # All LeanIX dataTypes the importer claims to handle should map.
    expected_mappings = {
        "STRING": "text",
        "RICH_TEXT": "text",
        "INTEGER": "number",
        "MONEY": "cost",
        "BOOLEAN": "boolean",
        "DATE": "date",
        "URL": "url",
        "SINGLE_SELECT": "single_select",
        "MULTIPLE_SELECT": "multiple_select",
    }
    for lx, tea in expected_mappings.items():
        assert infer_tea_field_type(lx) == tea, f"{lx!r} → expected {tea!r}"
    # Case-insensitive.
    assert infer_tea_field_type("string") == "text"
    # Reference fields → None (handled as relation_type instead).
    assert infer_tea_field_type("FACT_SHEET_REFERENCE") is None
    # Genuinely unknown types → None (admin must remap in preview).
    assert infer_tea_field_type("WEIRD_CUSTOM") is None
    # Sanity check: enough mappings to cover real-world tenants.
    assert len(LX_DATATYPE_TO_TEA_TYPE) >= 12


def test_compute_card_diff_surfaces_attribute_changes() -> None:
    existing = MagicMock()
    existing.name = "App"
    existing.description = "old"
    existing.subtype = "businessApplication"
    existing.external_id = "fs-1"
    existing.lifecycle = {"active": "2020-01-01"}
    existing.attributes = {"vendor": "old-vendor"}

    fs = _fs(
        category="businessApplication",
        description="new",
        lifecycle={"active": "2020-01-01", "phaseOut": "2027-01-01"},
        custom_fields={"vendor": "new-vendor", "newField": "x"},
    )
    p = build_card_payload(fs, "Application")
    p["name"] = "App"
    diff = compute_card_diff(p, existing)
    assert diff["description"] == {"old": "old", "new": "new"}
    assert diff["lifecycle"]["new"] == {"active": "2020-01-01", "phaseOut": "2027-01-01"}
    assert diff["attributes"]["vendor"] == {"old": "old-vendor", "new": "new-vendor"}
    assert diff["attributes"]["newField"] == {"old": None, "new": "x"}
