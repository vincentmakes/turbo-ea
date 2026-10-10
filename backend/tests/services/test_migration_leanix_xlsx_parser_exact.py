"""Exact outputs of the LeanIX xlsx parser's auxiliary sheets.

``test_migration_leanix_xlsx_parser.py`` checks that each sheet is read;
this file pins what comes out of it, field by field: tags and their group
modes, the ``Types`` sheet's enum fallback, documents, comments and their
replies, and the parse errors an unresolvable reference leaves behind.
"""

from __future__ import annotations

from datetime import datetime

from openpyxl import Workbook  # type: ignore[import-untyped]

from app.services.migration.snapshot import Document, Tag
from app.services.migration.sources.leanix.xlsx_parser import _synth_comment_id, parse_xlsx
from tests.services.test_migration_leanix_xlsx_parser import (
    _minimal_workbook,
    _to_stream,
    _write_sheet,
)


def _parse(wb: Workbook):
    return parse_xlsx(_to_stream(wb))


def _replace_sheet(wb: Workbook, name: str, rows: list[list]) -> None:
    del wb[name]
    _write_sheet(wb, name, rows)


# ---------------------------------------------------------------------------
# Tags
# ---------------------------------------------------------------------------


def test_every_tag_carries_its_group_mode_and_colour() -> None:
    snap = _parse(_minimal_workbook())
    assert snap.tags == [
        Tag("tag-emea", "EMEA", "Region", "MULTIPLE", "#1194e0"),
        Tag("tag-apac", "APAC", "Region", "MULTIPLE", "#1194e0"),
        Tag("tag-pilot", "Pilot", "Other tags", "SINGLE", "#999999"),
    ]


def test_a_group_without_a_mode_or_sheet_row_is_multiple() -> None:
    wb = _minimal_workbook()
    _replace_sheet(
        wb,
        "TagGroups",
        [
            ["id", "name", "mode"],
            ["ID", "Name", "Mode"],
            ["tg-1", "Region", ""],  # no mode
            ["tg-x", "", "SINGLE"],  # no name: ignored
        ],
    )
    _replace_sheet(
        wb,
        "Tags",
        [
            ["id", "tagGroupId", "name", "backgroundColor"],
            ["ID", "Group", "Name", "Color"],
            ["tag-emea", "Region", "EMEA", ""],
            ["tag-free", "Unlisted group", "Free", "#000000"],
            ["", "Region", "No id", ""],
            ["tag-noname", "Region", "", ""],
            ["tag-nogroup", "", "Orphan", ""],
        ],
    )
    snap = _parse(wb)
    assert snap.tags == [
        Tag("tag-emea", "EMEA", "Region", "MULTIPLE", None),
        Tag("tag-free", "Free", "Unlisted group", "MULTIPLE", "#000000"),
    ]


# ---------------------------------------------------------------------------
# Types sheet: the enum fallback when there is no ReadMe
# ---------------------------------------------------------------------------


def _types_workbook(types_rows: list[list]) -> Workbook:
    wb = Workbook()
    _write_sheet(
        wb,
        "Application",
        [
            ["id", "type", "name", "displayName", "hostingType", "notes"],
            ["ID", "Type", "Name", "Display", "Hosting", "Notes"],
            ["fs-1", "Application", "CRM", "CRM", "cloud", "x"],
        ],
    )
    _write_sheet(wb, "Types", types_rows)
    return wb


def _fields(snap) -> dict:
    (app,) = [t for t in snap.metamodel_types if t.name == "Application"]
    return {f.key: (f.data_type, f.options) for f in app.fields}


def test_the_types_sheet_supplies_select_options_in_column_order() -> None:
    snap = _parse(
        _types_workbook(
            [
                ["factSheetType", "fieldName", "v1", "v2", "v3"],
                ["Type", "Field", "V1", "V2", "V3"],
                ["Application", "hostingType", "onPremise", "", "cloud"],
            ]
        )
    )
    fields = _fields(snap)
    assert fields["hostingType"] == (
        "SINGLE_SELECT",
        [{"key": "onPremise", "label": "onPremise"}, {"key": "cloud", "label": "cloud"}],
    )
    assert fields["notes"] == ("STRING", [])


def test_incomplete_types_rows_supply_nothing() -> None:
    snap = _parse(
        _types_workbook(
            [
                ["factSheetType", "fieldName", "v1"],
                ["Type", "Field", "V1"],
                ["", "hostingType", "cloud"],  # no type
                ["Application", "", "cloud"],  # no field
                ["Application", "notes", ""],  # no values
            ]
        )
    )
    fields = _fields(snap)
    assert fields["hostingType"] == ("STRING", [])
    assert fields["notes"] == ("STRING", [])


def test_a_types_row_does_not_stop_the_rows_after_it() -> None:
    snap = _parse(
        _types_workbook(
            [
                ["factSheetType", "fieldName", "v1"],
                ["Type", "Field", "V1"],
                ["", "", ""],
                ["Application", "notes", ""],
                ["Application", "hostingType", "cloud"],
            ]
        )
    )
    assert _fields(snap)["hostingType"] == (
        "SINGLE_SELECT",
        [{"key": "cloud", "label": "cloud"}],
    )


# ---------------------------------------------------------------------------
# Documents
# ---------------------------------------------------------------------------


def test_a_document_keeps_its_ids_name_url_and_filled_cells() -> None:
    snap = _parse(_minimal_workbook())
    assert snap.documents == [
        Document(
            source_id="doc-1",
            entity_id="fs-app-1",
            name="Runbook",
            url="https://wiki/runbook",
            raw={
                "id": "doc-1",
                "factSheet": "Salesforce CRM",
                "name": "Runbook",
                "url": "https://wiki/runbook",
                "createdAt": datetime(2024, 6, 1),
                "documentType": "documentation",
                "type": "Application",
            },
        )
    ]


def test_an_unresolved_document_is_reported_and_skipped() -> None:
    wb = _minimal_workbook()
    wb["Documents"].append(
        ["doc-2", "Nowhere", "Lost", "", "", None, "", "", "", "", "", "Application"]
    )
    wb["Documents"].append(
        ["", "Salesforce CRM", "", "", "", None, "", "", "", "", "", "Application"]
    )
    snap = _parse(wb)
    assert [d.source_id for d in snap.documents] == ["doc-1", ""]
    assert snap.documents[1].name == ""
    assert snap.documents[1].url is None
    assert "document 'doc-2': unresolved endpoint ('Nowhere', 'Application')" in snap.parse_errors


# ---------------------------------------------------------------------------
# Comments
# ---------------------------------------------------------------------------


def test_a_comment_and_its_reply_land_as_two_comments() -> None:
    snap = _parse(_minimal_workbook())
    first, reply = snap.comments
    created = datetime(2024, 7, 1, 12, 0, 0)
    replied = datetime(2024, 7, 1, 12, 5, 0)

    assert first.source_id == _synth_comment_id(
        "fs-app-1", created, "a@example.com", "First comment", 0
    )
    assert (first.entity_id, first.author_email, first.body, first.created_at) == (
        "fs-app-1",
        "a@example.com",
        "First comment",
        created,
    )
    assert first.raw["replyMessage"] == "First reply"
    assert "replyMessage" in first.raw and None not in first.raw.values()

    assert reply.source_id == _synth_comment_id(
        "fs-app-1", replied, "b@example.com", "First reply", 0, reply=True
    )
    assert (reply.entity_id, reply.author_email, reply.body, reply.created_at, reply.raw) == (
        "fs-app-1",
        "b@example.com",
        "First reply",
        replied,
        {},
    )


def test_comments_without_body_author_or_reply() -> None:
    wb = _minimal_workbook()
    sheet = wb["Comments"]
    # No message: skipped with its reply.
    sheet.append(
        ["Salesforce CRM", None, "", "c@example.com", "", "d@example.com", None, "R", "Application"]
    )
    # No author and no reply.
    sheet.append(["Salesforce CRM", None, "Anonymous", "", "", "", None, "", "Application"])
    # Reply without an author.
    sheet.append(["Salesforce CRM", None, "Q", "e@example.com", "", "", None, "A", "Application"])
    snap = _parse(wb)

    bodies = [(c.body, c.author_email) for c in snap.comments]
    assert bodies == [
        ("First comment", "a@example.com"),
        ("First reply", "b@example.com"),
        ("Anonymous", None),
        ("Q", "e@example.com"),
        ("A", None),
    ]
    anonymous = snap.comments[2]
    assert anonymous.source_id == _synth_comment_id("fs-app-1", None, "", "Anonymous", 2)
    answer = snap.comments[4]
    assert answer.source_id == _synth_comment_id("fs-app-1", None, "", "A", 3, reply=True)


def test_an_unresolved_comment_is_reported_and_skipped() -> None:
    wb = _minimal_workbook()
    wb["Comments"].append(
        ["Nowhere", None, "Lost", "x@example.com", "", "", None, "", "Application"]
    )
    snap = _parse(wb)
    assert len(snap.comments) == 2
    assert "comment: unresolved endpoint ('Nowhere', 'Application')" in snap.parse_errors
