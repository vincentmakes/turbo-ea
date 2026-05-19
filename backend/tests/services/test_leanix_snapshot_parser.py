"""Unit tests for the LeanIX snapshot parser.

These tests cover the **shape tolerance** of the parser — LeanIX
snapshots are undocumented and we see two top-level layouts in the
wild (snapshot 2.0 with ``factSheets`` at the root, and the
GraphQL-export shape under ``data.allFactSheets.edges``). The parser
must handle both, and degrade gracefully when sections are missing or
field names drift.
"""

from __future__ import annotations

import gzip
import io
import json

from app.services.leanix_snapshot_parser import (
    SUPPORTED_SNAPSHOT_VERSIONS,
    parse_snapshot,
)


def _gz(payload: dict) -> io.BytesIO:
    """Compress a JSON payload into an in-memory gzip stream."""
    raw = json.dumps(payload).encode("utf-8")
    buf = io.BytesIO()
    with gzip.GzipFile(fileobj=buf, mode="wb") as gz:
        gz.write(raw)
    buf.seek(0)
    return buf


def _plain(payload: dict) -> io.BytesIO:
    return io.BytesIO(json.dumps(payload).encode("utf-8"))


def test_parses_minimal_snapshot_2_0_shape() -> None:
    payload = {
        "version": "2.0",
        "factSheets": [
            {
                "id": "fs-1",
                "type": "Application",
                "name": "Salesforce",
                "category": "businessApplication",
                "description": "CRM",
                "lifecycle": {
                    "phases": [
                        {"phase": "active", "startDate": "2020-01-01"},
                        {"phase": "phaseOut", "startDate": "2027-01-01"},
                    ]
                },
                "tags": [{"id": "tag-a"}],
                "qualitySeal": "GREEN",
                "completion": 0.85,
                "customRenewalDate": "2027-06-30",
            }
        ],
        "relations": [],
    }
    snap = parse_snapshot(_plain(payload))
    assert snap.version == "2.0"
    assert snap.version in SUPPORTED_SNAPSHOT_VERSIONS
    assert len(snap.fact_sheets) == 1
    fs = snap.fact_sheets[0]
    assert fs.leanix_id == "fs-1"
    assert fs.type == "Application"
    assert fs.category == "businessApplication"
    assert fs.lifecycle == {"active": "2020-01-01", "phaseOut": "2027-01-01"}
    assert fs.tags == ["tag-a"]
    assert fs.quality_seal == "GREEN"
    assert fs.completion == 0.85
    # Custom fields are everything outside the LeanIX-known whitelist.
    assert fs.custom_fields == {"customRenewalDate": "2027-06-30"}


def test_parses_graphql_export_shape() -> None:
    payload = {
        "data": {
            "allFactSheets": {
                "edges": [{"node": {"id": "fs-2", "type": "ITComponent", "name": "Postgres 16"}}]
            }
        }
    }
    snap = parse_snapshot(_plain(payload))
    assert len(snap.fact_sheets) == 1
    assert snap.fact_sheets[0].leanix_id == "fs-2"
    assert snap.fact_sheets[0].type == "ITComponent"


def test_resolves_hierarchy_via_rel_to_parent() -> None:
    payload = {
        "factSheets": [
            {"id": "child", "type": "BusinessCapability", "name": "L2 cap"},
            {"id": "parent", "type": "BusinessCapability", "name": "L1 cap"},
        ],
        "relations": [
            {
                "id": "r1",
                "type": "relToParent",
                "source": {"id": "child"},
                "target": {"id": "parent"},
            },
        ],
    }
    snap = parse_snapshot(_plain(payload))
    child = next(fs for fs in snap.fact_sheets if fs.leanix_id == "child")
    parent = next(fs for fs in snap.fact_sheets if fs.leanix_id == "parent")
    assert child.parent_id == "parent"
    assert parent.parent_id is None


def test_parses_relations_with_attributes() -> None:
    payload = {
        "factSheets": [],
        "relations": [
            {
                "id": "r1",
                "type": "relApplicationToITComponent",
                "source": {"id": "a"},
                "target": {"id": "b"},
                "technicalSuitability": "appropriate",
                "costTotalAnnual": 12000,
            }
        ],
    }
    snap = parse_snapshot(_plain(payload))
    assert len(snap.relations) == 1
    rel = snap.relations[0]
    assert rel.type == "relApplicationToITComponent"
    assert rel.source_id == "a"
    assert rel.target_id == "b"
    assert rel.attributes["technicalSuitability"] == "appropriate"
    assert rel.attributes["costTotalAnnual"] == 12000


def test_subscriptions_documents_comments() -> None:
    payload = {
        "factSheets": [],
        "subscriptions": [
            {
                "id": "s1",
                "factSheetId": "fs-1",
                "user": {"email": "alice@example.com", "displayName": "Alice"},
                "role": {"name": "Application Owner", "type": "RESPONSIBLE"},
            }
        ],
        "documents": [
            {"id": "d1", "factSheetId": "fs-1", "name": "Arch diagram", "url": "https://x.test/d"}
        ],
        "comments": [
            {
                "id": "c1",
                "factSheetId": "fs-1",
                "author": {"email": "bob@example.com"},
                "message": "Looks good",
                "createdAt": "2026-01-15T10:00:00Z",
            }
        ],
    }
    snap = parse_snapshot(_plain(payload))
    assert len(snap.subscriptions) == 1
    sub = snap.subscriptions[0]
    assert sub.user_email == "alice@example.com"
    assert sub.role_type == "RESPONSIBLE"

    assert len(snap.documents) == 1
    assert snap.documents[0].url == "https://x.test/d"

    assert len(snap.comments) == 1
    assert snap.comments[0].body == "Looks good"
    assert snap.comments[0].created_at is not None


def test_gzipped_input_works() -> None:
    payload = {"factSheets": [{"id": "fs-1", "type": "Application", "name": "X"}]}
    snap = parse_snapshot(_gz(payload))
    assert len(snap.fact_sheets) == 1


def test_unknown_top_level_does_not_crash() -> None:
    payload = {"someUnrelatedTopKey": True}
    snap = parse_snapshot(_plain(payload))
    assert snap.fact_sheets == []
    assert snap.relations == []
    # parse_errors may carry version-sniff noise — that's fine, just not fatal.


def test_malformed_fact_sheet_collected_not_raised() -> None:
    payload = {
        "factSheets": [
            {"name": "no id"},  # no id -> error
            {"id": "ok", "type": "Application", "name": "ok"},
        ]
    }
    snap = parse_snapshot(_plain(payload))
    assert len(snap.fact_sheets) == 1
    assert snap.fact_sheets[0].leanix_id == "ok"
    assert any("fact_sheet" in e for e in snap.parse_errors)


def test_metamodel_section_picked_up() -> None:
    payload = {
        "factSheets": [],
        "metamodel": {
            "factSheetTypes": [
                {
                    "name": "Application",
                    "isCustom": False,
                    "subtypes": ["businessApplication", "microservice"],
                    "fields": [
                        {
                            "key": "contractRenewalDate",
                            "label": "Contract renewal",
                            "type": "DATE",
                            "isCustom": True,
                        }
                    ],
                },
                {
                    "name": "RegulatoryRequirement",
                    "isCustom": True,
                    "fields": [
                        {"key": "regulationCode", "label": "Code", "type": "STRING"},
                    ],
                },
            ],
            "relationTypes": [
                {
                    "name": "relAppToRegRequirement",
                    "from": "Application",
                    "to": "RegulatoryRequirement",
                    "isCustom": True,
                }
            ],
        },
    }
    snap = parse_snapshot(_plain(payload))
    names = {t.name for t in snap.metamodel_types}
    assert "Application" in names and "RegulatoryRequirement" in names
    custom_type = next(t for t in snap.metamodel_types if t.name == "RegulatoryRequirement")
    assert custom_type.is_custom is True
    assert custom_type.fields[0].key == "regulationCode"
    assert len(snap.metamodel_relation_types) == 1
    assert snap.metamodel_relation_types[0].is_custom is True
