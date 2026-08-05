"""Unit tests for the migration staging service — pure helpers only.

Stage-and-apply round-trip integration tests live in
``test_migration_apply.py`` and require the DB conftest.
"""

from __future__ import annotations

from unittest.mock import MagicMock

from app.services.migration.snapshot import SourceEntity
from app.services.migration.sources.leanix.adapter import LeanixSource
from app.services.migration.sources.leanix.mappings import (
    FIELD_TYPE_MAPPING,
    FLIP_DIRECTION,
    RELATION_MAPPING,
    SUBSCRIPTION_ROLE_MAPPING,
    TYPE_MAPPING,
)
from app.services.migration.staging import (
    _compare_relation_attrs,
    _looks_like_email,
    _normalise_tag_group_mode,
    build_card_payload,
    compute_card_diff,
    infer_field_type,
    map_relation,
    map_type,
)

_SOURCE = LeanixSource()


def _entity(**kw):
    base = dict(source_id="fs-1", type="Application", name="App")
    base.update(kw)
    return SourceEntity(**base)


def test_map_type_covers_all_defaults() -> None:
    assert map_type(_SOURCE, "Application") == "Application"
    assert map_type(_SOURCE, "ITComponent") == "ITComponent"
    assert map_type(_SOURCE, "Project") == "Initiative"
    assert map_type(_SOURCE, "Process") == "BusinessProcess"
    assert map_type(_SOURCE, "UserGroup") == "Organization"
    assert map_type(_SOURCE, "RegulatoryRequirement") is None
    # 13 defaults + UserGroup edge-case = 14 entries
    assert len(TYPE_MAPPING) >= 13


def test_build_card_payload_basic() -> None:
    entity = _entity(
        category="businessApplication",
        description="CRM",
        lifecycle={"active": "2020-01-01"},
        custom_fields={"vendor": "Salesforce"},
    )
    p = build_card_payload(_SOURCE, entity, "Application")
    assert p["type"] == "Application"
    assert p["subtype"] == "businessApplication"
    assert p["external_id"] == "fs-1"
    assert p["lifecycle"] == {"active": "2020-01-01"}
    assert p["attributes"] == {"vendor": "Salesforce"}
    assert p["approval_status"] == "DRAFT"


def test_build_card_payload_user_group_force_team_subtype() -> None:
    """LeanIX adapter quirk — UserGroup lands as Organization with
    subtype=team and a ``source_origin`` attribute so the admin can
    re-classify post-import. The legacy ``leanix_origin`` key is kept
    in parallel for backwards-compatibility with existing reports."""
    entity = _entity(source_id="ug-1", type="UserGroup", name="Sales team", category="ignored")
    p = build_card_payload(_SOURCE, entity, "Organization")
    assert p["subtype"] == "team"
    assert p["attributes"]["source_origin"] == "leanix:UserGroup"
    assert p["attributes"]["leanix_origin"] == "UserGroup"


def test_build_card_payload_falls_back_to_display_name() -> None:
    entity = SourceEntity(source_id="fs-9", type="Application", name="", display_name="Salesforce")
    p = build_card_payload(_SOURCE, entity, "Application")
    assert p["name"] == "Salesforce"


def test_compute_card_diff_no_changes() -> None:
    existing = MagicMock()
    existing.name = "App"
    existing.description = "X"
    existing.subtype = "businessApplication"
    existing.external_id = "fs-1"
    existing.lifecycle = {"active": "2020-01-01"}
    existing.attributes = {"vendor": "Salesforce"}

    entity = _entity(
        category="businessApplication",
        description="X",
        lifecycle={"active": "2020-01-01"},
        custom_fields={"vendor": "Salesforce"},
    )
    p = build_card_payload(_SOURCE, entity, "Application")
    # external_id round-trips and name matches → empty diff
    p["name"] = "App"
    diff = compute_card_diff(p, existing)
    assert diff == {}


def test_map_relation_default_and_legacy_names() -> None:
    assert map_relation(_SOURCE, "relApplicationToITComponent") == "relAppToITC"
    assert map_relation(_SOURCE, "relApplicationToBusinessCapability") == "relAppToBC"
    assert map_relation(_SOURCE, "relInterfaceToDataObject") == "relInterfaceToDataObj"
    # LeanIX "Project" and "Initiative" both fold into Turbo EA Initiative.
    assert map_relation(_SOURCE, "relProjectToObjective") == "relInitiativeToObjective"
    assert map_relation(_SOURCE, "relInitiativeToObjective") == "relInitiativeToObjective"
    # Hierarchy edges are intentionally not mapped — parent_id handles them.
    assert map_relation(_SOURCE, "relToParent") is None
    assert map_relation(_SOURCE, "relToChild") is None
    # Unknown / custom LeanIX relations.
    assert map_relation(_SOURCE, "relCustomSomething") is None
    # Sanity check: table covers the core surface area.
    assert len(RELATION_MAPPING) >= 40


def test_flip_direction_covers_every_successor_relation() -> None:
    """Every LeanIX relation type whose TEA target is a ``rel*Successor``
    edge must be in ``FLIP_DIRECTION`` — LeanIX's "X has successor Y"
    direction is the reverse of TEA's "source succeeds target", so
    staging swaps them. Missing entries here would land successors as
    predecessors and vice-versa in the CardDetail lineage view."""
    successor_lx_names = {lx for lx, tea in RELATION_MAPPING.items() if tea.endswith("Successor")}
    missing = successor_lx_names - FLIP_DIRECTION
    assert missing == set(), f"Successor LX relations missing from flip set: {missing}"


def test_flip_direction_does_not_swap_non_successor_relations() -> None:
    """Inverse of the above — nothing in ``FLIP_DIRECTION`` should map
    to a non-successor TEA key. A stray entry here would silently invert a
    healthy edge (e.g. ``relAppToITC``) and corrupt the import."""
    for lx_name in FLIP_DIRECTION:
        tea = RELATION_MAPPING.get(lx_name)
        # ``None`` means the LX type isn't in the static map (it may still
        # be staged via the parser-synthesised metamodel path, but no
        # built-in TEA edge claims it — fine).
        assert tea is None or tea.endswith("Successor"), (
            f"{lx_name!r} flips direction but maps to non-successor {tea!r}"
        )


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
    assert _SOURCE.map_subscription_role("Application Owner", "RESPONSIBLE") == "responsible"
    assert _SOURCE.map_subscription_role("Responsible", None) == "responsible"
    assert _SOURCE.map_subscription_role("Process Owner", None) == "processOwner"
    assert _SOURCE.map_subscription_role("Project Manager", "ACCOUNTABLE") == "itProjectManager"
    assert _SOURCE.map_subscription_role("IT Project Manager", "RESPONSIBLE") == "itProjectManager"
    assert _SOURCE.map_subscription_role("Observer", "OBSERVER") == "observer"
    # Sanity-check the table size.
    assert len(SUBSCRIPTION_ROLE_MAPPING) >= 6


def test_map_subscription_role_unknown_falls_back() -> None:
    # Unknown role-name, RESPONSIBLE type → responsible.
    assert _SOURCE.map_subscription_role("Procurement Lead", "RESPONSIBLE") == "responsible"
    # Unknown role-name, OBSERVER type → observer.
    assert _SOURCE.map_subscription_role("Architecture Auditor", "OBSERVER") == "observer"
    # Nothing known at all → responsible (most-permissive default).
    assert _SOURCE.map_subscription_role(None, None) == "responsible"
    assert _SOURCE.map_subscription_role("", "") == "responsible"


def test_infer_field_type_coverage() -> None:
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
        assert infer_field_type(_SOURCE, lx) == tea, f"{lx!r} → expected {tea!r}"
    # Case-insensitive.
    assert infer_field_type(_SOURCE, "string") == "text"
    # Reference fields → None (handled as relation_type instead).
    assert infer_field_type(_SOURCE, "FACT_SHEET_REFERENCE") is None
    # Genuinely unknown types → None (admin must remap in preview).
    assert infer_field_type(_SOURCE, "WEIRD_CUSTOM") is None
    # Sanity check: enough mappings to cover real-world tenants.
    assert len(FIELD_TYPE_MAPPING) >= 12


def test_compute_card_diff_surfaces_attribute_changes() -> None:
    existing = MagicMock()
    existing.name = "App"
    existing.description = "old"
    existing.subtype = "businessApplication"
    existing.external_id = "fs-1"
    existing.lifecycle = {"active": "2020-01-01"}
    existing.attributes = {"vendor": "old-vendor"}

    entity = _entity(
        category="businessApplication",
        description="new",
        lifecycle={"active": "2020-01-01", "phaseOut": "2027-01-01"},
        custom_fields={"vendor": "new-vendor", "newField": "x"},
    )
    p = build_card_payload(_SOURCE, entity, "Application")
    p["name"] = "App"
    diff = compute_card_diff(p, existing)
    assert diff["description"] == {"old": "old", "new": "new"}
    assert diff["lifecycle"]["new"] == {"active": "2020-01-01", "phaseOut": "2027-01-01"}
    assert diff["attributes"]["vendor"] == {"old": "old-vendor", "new": "new-vendor"}
    assert diff["attributes"]["newField"] == {"old": None, "new": "x"}


def test_looks_like_email_accepts_real_addresses() -> None:
    assert _looks_like_email("john.doe@example.com")
    assert _looks_like_email("a+b@sub.example.co.uk")


def test_looks_like_email_rejects_combined_unsplit_cells() -> None:
    # The bug we're guarding against: a LeanIX Full Snapshot ``;``-delimited
    # subscription cell that slipped through the splitter must be flagged
    # as malformed so it doesn't land as a real user.
    assert not _looks_like_email("john.doe@example.com;jane.doe@example.com")
    assert not _looks_like_email("a@x.com, b@x.com")


def test_looks_like_email_rejects_obvious_garbage() -> None:
    assert not _looks_like_email("")
    assert not _looks_like_email("not-an-email")
    assert not _looks_like_email("a@b")  # no dot in host
    assert not _looks_like_email("@example.com")
    assert not _looks_like_email("alice@")
    assert not _looks_like_email("alice@@example.com")
    assert not _looks_like_email("alice example@example.com")
