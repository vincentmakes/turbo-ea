"""Unit tests for the LeanIX Integration API bundle writer.

No database: a :class:`MigrationSnapshot` is built by hand in Turbo EA
vocabulary and serialised with :func:`build_bundle`; the tests read the
zip back and check the LDIF document and the processor configuration
against the conventions LeanIX's Integration API expects (external
identifiers, one processor per content type, run ordering, the
``forEach`` sub-collections) and against the import tables, so the two
directions of the adapter cannot drift.
"""

from __future__ import annotations

import json
import zipfile
from io import BytesIO

from app.services.migration.snapshot import MigrationSnapshot
from app.services.migration.sources.leanix.ldif_exporter import (
    COMMENTS_FILE,
    LDIF_FILE,
    PARENT_RELATION,
    PROCESSORS_FILE,
    README_FILE,
    build_bundle,
)
from app.services.migration.sources.leanix.mappings import (
    EXPORT_FLIP_DIRECTION,
    EXPORT_RELATION_API_MAPPING,
    EXPORT_TYPE_MAPPING,
    FLIP_DIRECTION,
    RELATION_MAPPING,
    TYPE_MAPPING,
)
from tests.migration_helpers import sample_snapshot as _snapshot


def _open(data: bytes) -> tuple[dict, dict, list, str]:
    with zipfile.ZipFile(BytesIO(data)) as zf:
        return (
            json.loads(zf.read(LDIF_FILE)),
            json.loads(zf.read(PROCESSORS_FILE)),
            json.loads(zf.read(COMMENTS_FILE)),
            zf.read(README_FILE).decode("utf-8"),
        )


def _items(ldif: dict, content_type: str) -> list[dict]:
    return [i for i in ldif["content"] if i["type"] == content_type]


def _processor(processors: dict, content_type: str, processor_type: str) -> dict:
    return next(
        p
        for p in processors["processors"]
        if p["filter"]["type"] == content_type and p["processorType"] == processor_type
    )


def _update(processor: dict, key: str) -> dict:
    return next(u for u in processor["updates"] if u["key"]["expr"] == key)


# ---------------------------------------------------------------------------
# Mapping tables — export and import must agree
# ---------------------------------------------------------------------------


class TestMappingConsistency:
    def test_every_export_type_maps_back_to_its_own_key(self):
        for tea_key, lx_name in EXPORT_TYPE_MAPPING.items():
            assert TYPE_MAPPING[lx_name] == tea_key, (tea_key, lx_name)

    def test_every_export_relation_maps_back_to_its_own_key(self):
        for tea_key, lx_name in EXPORT_RELATION_API_MAPPING.items():
            assert RELATION_MAPPING[lx_name] == tea_key, (tea_key, lx_name)

    def test_export_relation_names_are_the_api_form(self):
        for lx_name in EXPORT_RELATION_API_MAPPING.values():
            assert lx_name.startswith("rel"), lx_name

    def test_export_flip_set_is_the_mirror_of_the_import_flip_set(self):
        for tea_key in EXPORT_FLIP_DIRECTION:
            assert EXPORT_RELATION_API_MAPPING[tea_key] in FLIP_DIRECTION, tea_key

    def test_every_seeded_relation_type_has_an_export_name(self):
        from app.services.seed import RELATIONS

        seeded = {r["key"] for r in RELATIONS}
        missing = seeded - set(EXPORT_RELATION_API_MAPPING) - {"relProcessCalls"}
        assert not missing, missing


# ---------------------------------------------------------------------------
# Bundle + LDIF
# ---------------------------------------------------------------------------


class TestLdif:
    def test_bundle_holds_the_four_files_and_a_valid_ldif_envelope(self):
        data = build_bundle(_snapshot())
        assert data[:4] == b"PK\x03\x04"
        with zipfile.ZipFile(BytesIO(data)) as zf:
            assert set(zf.namelist()) == {LDIF_FILE, PROCESSORS_FILE, COMMENTS_FILE, README_FILE}
        ldif, processors, _, _ = _open(data)
        assert ldif["processingDirection"] == "inbound"
        assert ldif["processingMode"] == "partial"
        for key in ("connectorType", "connectorId", "connectorVersion", "lxVersion"):
            assert ldif[key] == processors[key] if key != "lxVersion" else ldif[key]
        assert ldif["customFields"] == {}

    def test_fact_sheet_items_carry_leanix_types_and_the_card_data(self):
        ldif, _, _, _ = _open(build_bundle(_snapshot()))
        types = {i["type"] for i in ldif["content"]}
        assert {"Application", "BusinessCapability", "Process", "UserGroup", "Server"} <= types
        assert "BusinessProcess" not in types and "Organization" not in types

        sf = next(i for i in _items(ldif, "Application") if i["id"] == "app-1")
        d = sf["data"]
        assert d["name"] == "Salesforce"
        assert d["description"] == "CRM"
        assert d["category"] == "businessApplication"
        assert d["lifecycle"] == {"plan": "2019-01-01", "active": "2020-01-01"}
        assert d["fields"] == {
            "costTotalAnnual": 1200.5,
            "hostingType": "cloud",
            "regions": ["emea", "apac"],
        }
        assert d["sourceExternalId"] == "LX-42"
        assert d["alias"] == "SFDC"
        assert d["tags"] == [
            {"group": "Region", "name": "EMEA"},
            {"group": "Stage", "name": "Pilot"},
        ]
        assert d["subscriptions"] == [
            {"email": "owner@example.com", "type": "RESPONSIBLE", "role": "Application Owner"},
            {"email": "a@example.com", "type": "OBSERVER", "role": "Observer"},
        ]
        assert d["documents"] == [{"name": "Runbook", "url": "https://wiki.example.com/sf"}]

        empty = next(i for i in _items(ldif, "Application") if i["id"] == "app-2")["data"]
        assert empty["fields"] == {} and empty["tags"] == [] and empty["lifecycle"] == {}

    def test_hierarchy_becomes_rel_to_parent_items(self):
        ldif, _, _, _ = _open(build_bundle(_snapshot()))
        parents = _items(ldif, PARENT_RELATION)
        assert [(p["data"]["from"], p["data"]["to"]) for p in parents] == [("bc-2", "bc-1")]
        child = next(i for i in _items(ldif, "BusinessCapability") if i["id"] == "bc-2")
        assert child["data"]["parentId"] == "bc-1"
        assert child["data"]["displayName"] == "Sales / Lead Mgmt"

    def test_relations_use_api_names_and_lineage_is_swapped(self):
        ldif, _, _, _ = _open(build_bundle(_snapshot()))
        rel = _items(ldif, "relApplicationToBusinessCapability")
        assert [(r["data"]["from"], r["data"]["to"]) for r in rel] == [("app-1", "bc-2")]
        # LeanIX: from = the older fact sheet ("Salesforce has successor New CRM").
        succ = _items(ldif, "relApplicationSuccessor")[0]["data"]
        assert (succ["from"], succ["to"]) == ("app-1", "app-2")
        org = _items(ldif, "relUserGroupToApplication")[0]["data"]
        assert org["attributes"] == {"usageType": "owner"}
        assert _items(ldif, "relProcessToApplication")
        assert _items(ldif, "relServerToApp")  # custom relation keeps its key

    def test_dangling_relations_are_dropped_and_every_endpoint_exists(self):
        ldif, _, _, _ = _open(build_bundle(_snapshot()))
        fact_sheet_ids = {i["id"] for i in ldif["content"] if "from" not in i["data"]}
        for item in ldif["content"]:
            if "from" in item["data"]:
                assert item["data"]["from"] in fact_sheet_ids, item
                assert item["data"]["to"] in fact_sheet_ids, item
        assert not any(i["id"] == "rel-6" for i in ldif["content"])

    def test_comments_are_kept_for_reference(self):
        _, _, comments, _ = _open(build_bundle(_snapshot()))
        assert comments == [
            {
                "factSheetId": "app-1",
                "factSheetType": "Application",
                "factSheet": "Salesforce",
                "author": "owner@example.com",
                "createdAt": "2024-03-01T12:00:00",
                "message": "Renewal due in Q3",
            }
        ]

    def test_empty_workspace_still_produces_a_valid_bundle(self):
        snap = MigrationSnapshot("turbo-ea", [], [], [], [], [], [], [], [], [])
        ldif, processors, comments, readme = _open(build_bundle(snap))
        assert ldif["content"] == [] and processors["processors"] == [] and comments == []
        assert "Integration API" in readme


# ---------------------------------------------------------------------------
# Processors
# ---------------------------------------------------------------------------


class TestProcessors:
    def test_every_content_type_has_a_processor_and_vice_versa(self):
        ldif, processors, _, _ = _open(build_bundle(_snapshot()))
        content_types = {i["type"] for i in ldif["content"]}
        filtered = {p["filter"]["type"] for p in processors["processors"]}
        assert content_types == filtered

    def test_fact_sheet_processor_identifies_by_external_id_and_writes_every_field(self):
        _, processors, _, _ = _open(build_bundle(_snapshot()))
        p = _processor(processors, "Application", "inboundFactSheet")
        assert p["type"] == "Application"
        assert p["run"] == 0
        assert p["identifier"] == {
            "external": {"id": {"expr": "${content.id}"}, "type": {"expr": "externalId"}}
        }
        keys = [u["key"]["expr"] for u in p["updates"]]
        assert keys == [
            "name",
            "description",
            "category",
            "alias",
            "lifecycle.plan",
            "lifecycle.active",
            "costTotalAnnual",
            "hostingType",
            "regions",
        ]
        assert "unusedField" not in keys  # only fields the cards carry
        assert _update(p, "name")["values"] == [{"expr": "${data.name}"}]
        # Partial mode must never blank a field the export did not carry.
        assert _update(p, "costTotalAnnual")["values"] == [
            {
                "expr": "${data.fields.costTotalAnnual != null ? data.fields.costTotalAnnual "
                ": lx.factsheet.costTotalAnnual}"
            }
        ]
        assert _update(p, "lifecycle.plan")["values"][0]["expr"].startswith(
            "${data.lifecycle.plan != null"
        )

    def test_types_without_subtypes_or_lifecycle_get_no_such_updates(self):
        _, processors, _, _ = _open(build_bundle(_snapshot()))
        bc = _processor(processors, "BusinessCapability", "inboundFactSheet")
        assert [u["key"]["expr"] for u in bc["updates"]] == ["name", "description"]

    def test_relation_processors_reference_both_ends_by_external_id(self):
        _, processors, _, _ = _open(build_bundle(_snapshot()))
        p = _processor(processors, "relApplicationToBusinessCapability", "inboundRelation")
        assert p["type"] == "relApplicationToBusinessCapability"
        assert p["run"] == 1
        assert p["from"]["external"]["id"] == {"expr": "${data.from}"}
        assert p["to"]["external"]["id"] == {"expr": "${data.to}"}
        parent = _processor(processors, PARENT_RELATION, "inboundRelation")
        assert parent["type"] == PARENT_RELATION

    def test_tag_subscription_and_document_processors_iterate_the_sub_collections(self):
        _, processors, _, _ = _open(build_bundle(_snapshot()))
        tags = _processor(processors, "Application", "inboundTag")
        assert tags["forEach"] == "${data.tags}"
        assert _update(tags, "group.name")["values"] == [
            {"expr": "${integration.valueOfForEach.group}"}
        ]
        subs = _processor(processors, "Application", "inboundSubscription")
        assert subs["forEach"] == "${data.subscriptions}"
        assert _update(subs, "user")["values"] == [{"expr": "${integration.valueOfForEach.email}"}]
        assert _update(subs, "subscriptionRoles")["values"] == [
            {"map": [{"key": "roleName", "value": "${integration.valueOfForEach.role}"}]}
        ]
        docs = _processor(processors, "Application", "inboundDocument")
        assert docs["forEach"] == "${data.documents}"
        # Types without tags / subscriptions / documents get no such processor.
        kinds = {
            (p["filter"]["type"], p["processorType"])
            for p in processors["processors"]
            if p["filter"]["type"] == "BusinessCapability"
        }
        assert kinds == {("BusinessCapability", "inboundFactSheet")}

    def test_fact_sheets_run_before_relations_and_sub_collections(self):
        _, processors, _, _ = _open(build_bundle(_snapshot()))
        for p in processors["processors"]:
            expected = 0 if p["processorType"] == "inboundFactSheet" else 1
            assert p["run"] == expected, p["processorName"]


# ---------------------------------------------------------------------------
# README
# ---------------------------------------------------------------------------


class TestReadme:
    def test_readme_explains_loading_and_lists_the_unknown_types(self):
        _, _, _, readme = _open(build_bundle(_snapshot()))
        assert "Administration → Integration API" in readme
        assert "synchronizationRuns" in readme
        assert "Test run" in readme
        assert "| `Application` | `Application` | 2 |" in readme
        assert "| `Process` | `BusinessProcess` | 1 |" in readme
        assert "| `relToParent` |" in readme
        assert "fact-sheet type `Server`" in readme
        assert "relation type `relServerToApp`" in readme
        assert "comments.json" in readme
