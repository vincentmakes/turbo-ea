"""``plan_relates_links``: the legacy ``related_decisions`` list as ``relates`` pairs.

Pure — no database. Migration 167 carries a copy of the same function, pinned
by ``test_alembic_167_decision_register.py``.
"""

from __future__ import annotations

import uuid

from app.services.decision_links_legacy import (
    LEGACY_COLUMN,
    decode_related_cell,
    plan_bundle_links,
    plan_relates_links,
)

A = uuid.UUID("00000000-0000-4000-8000-00000000000a")
B = uuid.UUID("00000000-0000-4000-8000-00000000000b")
C = uuid.UUID("00000000-0000-4000-8000-00000000000c")
GHOST = "00000000-0000-4000-8000-0000000000ff"


def test_an_id_entry_becomes_a_pair():
    rows = [(A, "ADR-001", [str(B)]), (B, "ADR-002", [])]
    assert plan_relates_links(rows) == [(A, B)]


def test_an_upper_case_id_entry_matches():
    rows = [(A, "ADR-001", [str(B).upper()]), (B, "ADR-002", None)]
    assert plan_relates_links(rows) == [(A, B)]


def test_a_reference_entry_becomes_a_pair_whatever_its_case_and_spaces():
    rows = [(A, "ADR-001", []), (B, "ADR-002", [" adr-001 "])]
    assert plan_relates_links(rows) == [(B, A)]


def test_the_two_spellings_of_one_target_give_one_pair():
    rows = [(A, "ADR-001", [str(B), "ADR-002", "adr-002"]), (B, "ADR-002", [])]
    assert plan_relates_links(rows) == [(A, B)]


def test_both_directions_are_kept_as_two_ordered_pairs():
    rows = [(A, "ADR-001", ["ADR-002"]), (B, "ADR-002", [str(A)])]
    assert plan_relates_links(rows) == [(A, B), (B, A)]


def test_self_links_are_dropped_in_either_spelling():
    rows = [(A, "ADR-001", ["ADR-001", str(A)])]
    assert plan_relates_links(rows) == []


def test_dicts_non_strings_blanks_and_dangling_entries_are_dropped():
    related = [
        {"type": "assessment", "id": str(B)},
        42,
        None,
        "",
        "   ",
        GHOST,
        "ADR-999",
        "ADR-003",
    ]
    rows = [(A, "ADR-001", related), (B, "ADR-002", []), (C, "ADR-003", [])]
    assert plan_relates_links(rows) == [(A, C)]


def test_a_value_that_is_not_a_list_yields_nothing():
    rows = [(A, "ADR-001", {"ADR-002": True}), (B, "ADR-002", "ADR-001")]
    assert plan_relates_links(rows) == []


def test_a_reference_shared_by_two_rows_names_no_decision():
    rows = [(A, "ADR-001", ["ADR-002"]), (B, "ADR-002", []), (C, "ADR-002", [])]
    assert plan_relates_links(rows) == []
    # The ids of those rows still resolve.
    rows = [(A, "ADR-001", [str(C)]), (B, "ADR-002", []), (C, "ADR-002", [])]
    assert plan_relates_links(rows) == [(A, C)]


def test_a_row_without_a_reference_is_reachable_by_id_only():
    rows = [(A, None, [str(B), "None"]), (B, "", ["ADR-001"])]
    assert plan_relates_links(rows) == [(A, B)]


def test_pairs_come_in_row_then_entry_order_and_keep_the_given_ids():
    rows = [
        (str(C), "ADR-003", ["ADR-002", "ADR-001"]),
        (str(A), "ADR-001", ["ADR-003"]),
        (str(B), "ADR-002", []),
    ]
    assert plan_relates_links(iter(rows)) == [
        (str(C), str(B)),
        (str(C), str(A)),
        (str(A), str(C)),
    ]


# --- Older workspace bundles ---------------------------------------------------


def test_decode_related_cell():
    assert decode_related_cell('["ADR-001", "x"]') == ["ADR-001", "x"]
    assert decode_related_cell("null") is None
    assert decode_related_cell("") is None
    assert decode_related_cell("   ") is None
    assert decode_related_cell("not json") is None
    assert decode_related_cell(None) is None
    assert decode_related_cell(["already"]) == ["already"]


def _sheet(*rows):
    return [{"id": str(i), "reference_number": ref, LEGACY_COLUMN: cell} for i, ref, cell in rows]


def test_bundle_links_resolve_through_the_bundle_rows():
    rows = _sheet(
        (A, "ADR-001", f'["ADR-002", "{C}", "ADR-404", {{"id": "{B}"}}]'),
        (B, "ADR-002", '["ADR-001"]'),
        (C, "ADR-003", None),
    )
    assert plan_bundle_links(
        rows, created_ids=[A, B, C], present_ids=[A, B, C], existing_pairs=[]
    ) == [(A, B), (A, C), (B, A)]


def test_only_created_sources_present_targets_and_new_pairs_are_kept():
    rows = _sheet(
        (A, "ADR-001", '["ADR-002", "ADR-003"]'),
        (B, "ADR-002", '["ADR-001"]'),
        (C, "ADR-003", '["ADR-001"]'),
    )
    # B pre-existed (not created); C failed to import (not present); A -> B is
    # already linked; the reverse pair B -> A would be a separate link.
    assert (
        plan_bundle_links(
            rows,
            created_ids={str(A)},
            present_ids=[A, B],
            existing_pairs=[(A, B)],
        )
        == []
    )
    assert plan_bundle_links(
        rows, created_ids=[A, B], present_ids=[A, B], existing_pairs=[(B, C)]
    ) == [(A, B), (B, A)]


def test_a_row_whose_id_is_not_a_uuid_is_ignored():
    rows = [
        {"id": "not-a-uuid", "reference_number": "ADR-009", LEGACY_COLUMN: '["ADR-001"]'},
        {"id": None, "reference_number": "ADR-008", LEGACY_COLUMN: '["ADR-001"]'},
        *_sheet((A, "ADR-001", '["ADR-009"]'), (B, "ADR-002", '["ADR-001"]')),
    ]
    out = plan_bundle_links(rows, created_ids=[A, B], present_ids=[A, B], existing_pairs=[])
    assert out == [(B, A)]
    assert all(isinstance(i, uuid.UUID) for pair in out for i in pair)
