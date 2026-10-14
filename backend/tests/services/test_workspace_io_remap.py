"""Pure tests for the workspace-transfer id translation (#1246).

Every rule in ``remap.py`` is exercised here without a database; the round-trip
tests prove the wiring end to end.
"""

from __future__ import annotations

import uuid

import pytest

from app.services.compliance_scanner import compute_finding_key
from app.services.workspace_io import remap as rm

OLD_A = "aaaaaaaa-0000-0000-0000-000000000001"
OLD_B = "aaaaaaaa-0000-0000-0000-000000000002"
OLD_C = "aaaaaaaa-0000-0000-0000-000000000003"
NEW_A = "bbbbbbbb-0000-0000-0000-000000000001"
NEW_B = "bbbbbbbb-0000-0000-0000-000000000002"
NEW_C = "bbbbbbbb-0000-0000-0000-000000000003"
OLD_REL = "cccccccc-0000-0000-0000-000000000001"
NEW_REL = "dddddddd-0000-0000-0000-000000000001"
OLD_TAG = "eeeeeeee-0000-0000-0000-000000000001"
NEW_TAG = "ffffffff-0000-0000-0000-000000000001"


def _ids() -> rm.IdMap:
    ids = rm.IdMap()
    ids.record(rm.CARDS, OLD_A, NEW_A)
    ids.record(rm.CARDS, OLD_B, NEW_B)
    ids.record(rm.RELATIONS, OLD_REL, NEW_REL)
    ids.record(rm.TAGS, OLD_TAG, NEW_TAG)
    return ids


def _ctx(**kw) -> rm.RemapContext:
    return rm.RemapContext(ids=kw.pop("ids", _ids()), **kw)


# ── canonical_uuid / IdMap ──────────────────────────────────────────────────


def test_canonical_uuid_accepts_only_the_dashed_form_and_lowercases_it():
    assert rm.canonical_uuid(OLD_A.upper()) == OLD_A
    assert rm.canonical_uuid(f"  {OLD_A} ") == OLD_A
    assert rm.canonical_uuid(uuid.UUID(OLD_A)) == OLD_A
    assert rm.canonical_uuid(None) is None
    assert rm.canonical_uuid("") is None
    assert rm.canonical_uuid("__empty__") is None
    assert rm.canonical_uuid("Process_1") is None
    assert rm.canonical_uuid(OLD_A.replace("-", "")) is None
    assert rm.canonical_uuid(f"{OLD_A}x") is None
    assert rm.canonical_uuid(f"x{OLD_A}") is None


def test_an_id_map_records_once_and_ignores_invalid_ids():
    ids = rm.IdMap()
    ids.record(rm.CARDS, OLD_A.upper(), NEW_A.upper())
    ids.record(rm.CARDS, OLD_A, NEW_B)  # first mapping wins
    ids.record(rm.CARDS, None, NEW_C)
    ids.record(rm.CARDS, OLD_C, "not-an-id")
    assert ids.cards == {OLD_A: NEW_A}
    assert ids.lookup(rm.CARDS, OLD_A.upper()) == NEW_A
    assert ids.lookup(rm.CARDS, OLD_C) is None
    assert ids.lookup(rm.CARDS, "nope") is None


def test_an_id_map_keeps_one_table_per_kind():
    ids = _ids()
    assert ids.table(rm.CARDS) is ids.cards
    assert ids.table(rm.RELATIONS) is ids.relations
    assert ids.table(rm.TAGS) is ids.tags
    assert ids.lookup(rm.RELATIONS, OLD_A) is None
    assert ids.lookup(rm.TAGS, OLD_TAG) == NEW_TAG
    with pytest.raises(ValueError):
        ids.table("users")


# ── RewriteTally ────────────────────────────────────────────────────────────


def test_a_tally_counts_merges_and_caps_its_messages():
    a = rm.RewriteTally()
    a.bump(rm.REMAPPED)
    a.bump(rm.REMAPPED, 2)
    for i in range(rm.MAX_MESSAGES + 5):
        a.note(f"m{i}")
    assert a.counts == {rm.REMAPPED: 3}
    assert len(a.messages) == rm.MAX_MESSAGES
    b = rm.RewriteTally()
    b.bump(rm.UNRESOLVED)
    b.note("from b")
    b.merge(a)
    assert b.counts == {rm.UNRESOLVED: 1, rm.REMAPPED: 3}
    assert b.messages[0] == "from b"
    assert len(b.messages) == rm.MAX_MESSAGES


def test_a_tally_has_changed_only_when_an_id_moved():
    t = rm.RewriteTally()
    assert not t.changed()
    t.bump(rm.UNRESOLVED)
    assert not t.changed()
    t.bump(rm.RELINKED_BY_NAME)
    assert t.changed()
    t2 = rm.RewriteTally()
    t2.bump(rm.REMAPPED)
    assert t2.changed()


# ── building the map ────────────────────────────────────────────────────────


def test_a_sheet_carries_source_ids_when_its_header_has_the_column():
    assert rm.bundle_carries_source_ids([{"name": "x", "source_id": None}])
    assert not rm.bundle_carries_source_ids([{"name": "x"}])
    assert rm.bundle_carries_source_ids([])  # nothing to map, nothing to fall back for


def test_backfill_maps_only_unmapped_rows_that_resolve():
    ids = rm.IdMap()
    ids.record(rm.CARDS, OLD_A, NEW_A)
    seen = []

    def resolve(row):
        seen.append(row["name"])
        return {"B": uuid.UUID(NEW_B)}.get(row["name"])

    rows = [
        {"name": "A", "source_id": OLD_A},  # already mapped — not resolved again
        {"name": "B", "source_id": OLD_B},
        {"name": "C", "source_id": OLD_C},  # does not resolve
        {"name": "D", "source_id": None},  # nothing to map
    ]
    rm.backfill(rows, ids, rm.CARDS, resolve)
    assert ids.cards == {OLD_A: NEW_A, OLD_B: NEW_B}
    assert seen == ["B", "C"]


def test_legacy_called_processes_map_through_their_reference():
    ids = rm.IdMap()
    ids.record(rm.CARDS, OLD_C, NEW_C)
    calls = []

    def resolve(ctype, ref):
        calls.append((ctype, ref))
        return {"Credit": uuid.UUID(NEW_A)}.get(ref)

    rows = [
        {
            "called_element": OLD_A,
            "business_process_id__ref": "Credit",
            "business_process_id__type": "BusinessProcess",
        },
        {"called_element": "Process_9", "business_process_id__ref": "X"},  # foreign
        {"called_element": OLD_B, "business_process_id__type": "BusinessProcess"},  # no ref
        {"called_element": OLD_B, "business_process_id__ref": "Gone"},  # no type
        {
            "called_element": OLD_B,
            "business_process_id__ref": "Gone",
            "business_process_id__type": "BusinessProcess",
        },
        {
            "called_element": OLD_C,  # already mapped
            "business_process_id__ref": "Credit",
            "business_process_id__type": "BusinessProcess",
        },
    ]
    rm.harvest_legacy_process_refs(rows, ids, resolve)
    assert ids.cards == {OLD_A: NEW_A, OLD_C: NEW_C}
    assert calls == [("BusinessProcess", "Credit"), ("BusinessProcess", "Gone")]


# ── primitives ──────────────────────────────────────────────────────────────


def test_map_id_translates_counts_and_leaves_everything_else():
    tally = rm.RewriteTally()
    table = _ids().cards
    assert rm.map_id(OLD_A, table, tally) == NEW_A
    assert rm.map_id(OLD_A.upper(), table, tally) == NEW_A
    assert rm.map_id(OLD_C, table, tally) == OLD_C  # unmapped — kept, counted
    assert rm.map_id(None, table, tally) is None
    assert rm.map_id("__empty__", table, tally) == "__empty__"
    assert tally.counts == {rm.REMAPPED: 2, rm.UNRESOLVED: 1}


def test_an_identity_mapping_is_not_counted_as_remapped():
    tally = rm.RewriteTally()
    assert rm.map_id(NEW_A, {NEW_A: NEW_A}, tally) == NEW_A
    assert tally.counts == {}


def test_list_and_dict_mappers_keep_shape_and_pass_malformed_values_through():
    tally = rm.RewriteTally()
    table = _ids().cards
    assert rm.map_id_list([OLD_A, "__empty__", OLD_B], table, tally) == [
        NEW_A,
        "__empty__",
        NEW_B,
    ]
    assert rm.map_id_list([], table, tally) == []
    assert rm.map_id_list(None, table, tally) is None
    assert rm.map_id_list("x", table, tally) == "x"
    assert rm.map_dict_values({"relX": [OLD_A], "relY": []}, table, tally) == {
        "relX": [NEW_A],
        "relY": [],
    }
    assert rm.map_dict_values(["x"], table, tally) == ["x"]
    assert tally.counts == {rm.REMAPPED: 3}


# ── DrawIO ──────────────────────────────────────────────────────────────────


def _cell(cell_id, card_id, card_type="Application", name="App", **extra):
    attrs = " ".join(f'{k}="{v}"' for k, v in extra.items())
    return (
        f'<object label="{name}" cardId="{card_id}" cardType="{card_type}" id="{cell_id}" '
        f'{attrs}><mxCell vertex="1" parent="1"/></object>'
    )


def _edge(edge_id, rel_id, source, target, rel_type="relAppToApp"):
    return (
        f'<object label="uses" relationType="{rel_type}" relationId="{rel_id}" id="{edge_id}">'
        f'<mxCell edge="1" parent="1" source="{source}" target="{target}"/></object>'
    )


def _model(*cells):
    return '<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/>' + (
        "".join(cells) + "</root></mxGraphModel>"
    )


def test_drawio_ids_are_rewritten_and_nothing_else_changes():
    xml = _model(
        _cell("v1", OLD_A),
        _cell("v2", OLD_B),
        '<object label="New" cardId="pending-1" id="v3"><mxCell vertex="1"/></object>',
        f'<object xcardId="{OLD_A}" id="v4"><mxCell vertex="1"/></object>',
        _edge("e1", OLD_REL, "v1", "v2"),
    )
    tally = rm.RewriteTally()
    out = rm.rewrite_drawio_xml(xml, _ids().cards, _ids().relations, tally)
    expected = (
        xml.replace(f'cardId="{OLD_A}" cardType', f'cardId="{NEW_A}" cardType')
        .replace(f'cardId="{OLD_B}"', f'cardId="{NEW_B}"')
        .replace(f'relationId="{OLD_REL}"', f'relationId="{NEW_REL}"')
    )
    assert out == expected
    assert f'xcardId="{OLD_A}"' in out
    assert 'cardId="pending-1"' in out
    assert tally.counts == {rm.REMAPPED: 3}


def test_an_unmapped_drawio_id_is_kept_and_counted():
    tally = rm.RewriteTally()
    xml = _model(_cell("v1", OLD_C))
    assert rm.rewrite_drawio_xml(xml, _ids().cards, {}, tally) == xml
    assert tally.counts == {rm.UNRESOLVED: 1}


def test_a_relation_id_is_looked_up_among_relations_not_cards():
    tally = rm.RewriteTally()
    xml = f'<object relationId="{OLD_A}"/>'
    assert rm.rewrite_drawio_xml(xml, _ids().cards, {}, tally) == xml
    assert tally.counts == {rm.UNRESOLVED: 1}


def test_compressed_payloads_are_recognised():
    assert rm.is_compressed_drawio('<mxfile><diagram id="p">7ZhNb</diagram></mxfile>')
    assert rm.is_compressed_drawio('<diagram name="x">\n  7ZhNb</diagram>')
    assert not rm.is_compressed_drawio('<mxfile><diagram id="p"><mxGraphModel/></diagram>')
    assert not rm.is_compressed_drawio("<mxGraphModel/>")


def test_a_cell_name_is_its_card_name_else_the_first_line_of_its_label():
    assert rm.cell_display_name("  SAP  ", "ignored") == "SAP"
    assert rm.cell_display_name(None, "Plain") == "Plain"
    assert rm.cell_display_name("", "<b>SAP &amp; Co</b><br>Cost: 3") == "SAP & Co"
    assert rm.cell_display_name("   ", "<div>  </div><div>Second</div>") == "Second"
    assert rm.cell_display_name(None, "Line<BR/>Next") == "Line"
    assert rm.cell_display_name(None, "<p>First</p>Next") == "First"
    assert rm.cell_display_name(None, None) == ""


def test_a_scan_reads_card_cells_and_relation_edges():
    xml = _model(
        _cell("v1", OLD_A.upper(), "Application", "Billing", cardName="Billing"),
        '<UserObject label="&lt;b&gt;HR&lt;/b&gt;" cardId="'
        + OLD_B
        + '" cardType="Organization"><mxCell id="inner-2" vertex="1"/></UserObject>',
        '<object label="free" id="v3"><mxCell vertex="1"/></object>',
        _edge("e1", OLD_REL, "v1", "inner-2", "relAppToOrg"),
        f'<object relationId="{OLD_REL}" relationType="x" source="a" target="b"/>',
    )
    scan = rm.scan_drawio_cells(xml)
    assert scan is not None
    assert scan.cards == [
        rm.DrawioCardCell(("v1",), OLD_A, "Application", "Billing"),
        rm.DrawioCardCell(("inner-2",), OLD_B, "Organization", "HR"),
    ]
    assert scan.edges == [
        rm.DrawioEdge(OLD_REL, "relAppToOrg", "v1", "inner-2"),
        rm.DrawioEdge(OLD_REL, "x", "a", "b"),
    ]


def test_a_cell_registers_both_its_outer_and_inner_ids():
    xml = (
        f'<root><object cardId="{OLD_A}" id="outer"><mxCell id="inner"/></object>'
        f'<object cardId="{OLD_B}" cardType="T"/></root>'
    )
    scan = rm.scan_drawio_cells(xml)
    assert scan.cards == [
        rm.DrawioCardCell(("outer", "inner"), OLD_A, "", ""),
        rm.DrawioCardCell((), OLD_B, "T", ""),
    ]


def test_malformed_xml_does_not_scan():
    assert rm.scan_drawio_cells("<mxGraphModel><root>") is None


def _legacy_ctx(**kw):
    return rm.RemapContext(ids=rm.IdMap(), legacy=True, **kw)


def test_legacy_cells_relink_by_type_and_name():
    scan = rm.DrawioScan(
        cards=[
            rm.DrawioCardCell(("v1",), OLD_A, "Application", "Billing"),
            rm.DrawioCardCell(("v1b",), OLD_A, "Application", "Billing"),  # same card twice
            rm.DrawioCardCell(("v2",), OLD_B, "Application", "Ghost"),
        ]
    )
    ctx = _legacy_ctx(cards_by_type_name={("Application", "billing"): [NEW_A]})
    tally = rm.RewriteTally()
    assert rm.infer_legacy_card_ids(scan, ctx, set(), tally) == {OLD_A: NEW_A}
    assert tally.counts == {rm.RELINKED_BY_NAME: 1, rm.UNRESOLVED: 1}
    assert tally.messages == ["diagram card 'Ghost' (Application) not found"]


def test_legacy_name_matches_are_typed():
    scan = rm.DrawioScan(cards=[rm.DrawioCardCell(("v1",), OLD_A, "Organization", "Billing")])
    ctx = _legacy_ctx(cards_by_type_name={("Application", "billing"): [NEW_A]})
    assert rm.infer_legacy_card_ids(scan, ctx, set(), rm.RewriteTally()) == {}


def test_legacy_ambiguity_is_settled_by_the_diagrams_own_cards():
    scan = rm.DrawioScan(
        cards=[
            rm.DrawioCardCell(("v1",), OLD_A, "Application", "CRM"),
            rm.DrawioCardCell(("v2",), OLD_B, "Application", "ERP"),
            rm.DrawioCardCell(("v3",), OLD_C, "Application", "Ledger"),
        ]
    )
    ctx = _legacy_ctx(
        cards_by_type_name={
            ("Application", "crm"): [NEW_A, NEW_C],
            ("Application", "erp"): [NEW_B, NEW_C],
            ("Application", "ledger"): [NEW_A, NEW_B],
        }
    )
    tally = rm.RewriteTally()
    found = rm.infer_legacy_card_ids(scan, ctx, {NEW_A, NEW_B}, tally)
    # CRM narrows to NEW_A, ERP to NEW_B; Ledger keeps two candidates.
    assert found == {OLD_A: NEW_A, OLD_B: NEW_B}
    assert tally.counts == {rm.RELINKED_BY_NAME: 2, rm.AMBIGUOUS: 1}
    assert tally.messages == ["diagram card 'Ledger' (Application) matches several cards"]


def test_legacy_ambiguity_with_no_hint_is_reported_not_guessed():
    scan = rm.DrawioScan(cards=[rm.DrawioCardCell(("v1",), OLD_A, "Application", "CRM")])
    ctx = _legacy_ctx(cards_by_type_name={("Application", "crm"): [NEW_A, NEW_C]})
    tally = rm.RewriteTally()
    assert rm.infer_legacy_card_ids(scan, ctx, set(), tally) == {}
    assert tally.counts == {rm.AMBIGUOUS: 1}


def test_legacy_cells_that_already_resolve_are_left_alone():
    scan = rm.DrawioScan(
        cards=[
            rm.DrawioCardCell(("v1",), NEW_A, "Application", "Billing"),
            rm.DrawioCardCell(("v2",), OLD_B, "Application", "Billing"),
        ]
    )
    ids = rm.IdMap()
    ids.record(rm.CARDS, OLD_B, NEW_B)
    ctx = rm.RemapContext(
        ids=ids,
        legacy=True,
        live_card_ids={NEW_A},
        cards_by_type_name={("Application", "billing"): [NEW_C]},
    )
    tally = rm.RewriteTally()
    assert rm.infer_legacy_card_ids(scan, ctx, set(), tally) == {}
    assert tally.counts == {}


def test_legacy_edges_relink_through_their_endpoints_in_either_direction():
    scan = rm.DrawioScan(
        cards=[
            rm.DrawioCardCell(("v1", "v1i"), OLD_A, "Application", "A"),
            rm.DrawioCardCell(("v2",), OLD_B, "Application", "B"),
        ],
        edges=[
            rm.DrawioEdge(OLD_REL, "relAppToApp", "v1i", "v2"),
            rm.DrawioEdge(OLD_REL, "relAppToApp", "v1", "v2"),  # same edge id again
            rm.DrawioEdge(OLD_C, "relAppToApp", "v2", "v1"),  # drawn backwards
            rm.DrawioEdge(OLD_TAG, "relOther", "v1", "v2"),  # no such relation
            rm.DrawioEdge(OLD_B, "relAppToApp", "v1", "nowhere"),
            rm.DrawioEdge(NEW_REL, "relAppToApp", "v1", "v2"),  # already live
        ],
    )
    other_rel = "dddddddd-0000-0000-0000-000000000002"
    ctx = _legacy_ctx(
        relations_by_ends={
            ("relAppToApp", NEW_A, NEW_B): NEW_REL,
            ("relAppToApp", NEW_B, NEW_C): other_rel,
        }
    )
    tally = rm.RewriteTally()
    found = rm.infer_legacy_relation_ids(scan, {OLD_A: NEW_A, OLD_B: NEW_B}, ctx, tally)
    assert found == {OLD_REL: NEW_REL, OLD_C: NEW_REL}
    assert tally.counts == {rm.RELINKED_BY_NAME: 2, rm.UNRESOLVED: 2}


def test_legacy_edges_prefer_the_relations_own_direction():
    scan = rm.DrawioScan(
        cards=[
            rm.DrawioCardCell(("v1",), OLD_A, "Application", "A"),
            rm.DrawioCardCell(("v2",), OLD_B, "Application", "B"),
        ],
        edges=[rm.DrawioEdge(OLD_REL, "relAppToApp", "v1", "v2")],
    )
    backwards = "dddddddd-0000-0000-0000-000000000009"
    ctx = _legacy_ctx(
        relations_by_ends={
            ("relAppToApp", NEW_B, NEW_A): backwards,
            ("relAppToApp", NEW_A, NEW_B): NEW_REL,
        }
    )
    found = rm.infer_legacy_relation_ids(scan, {OLD_A: NEW_A, OLD_B: NEW_B}, ctx, rm.RewriteTally())
    assert found == {OLD_REL: NEW_REL}


def test_a_diagram_row_is_rewritten_and_its_card_refs_recomputed():
    data = {
        "xml": _model(_cell("v1", OLD_A), _edge("e1", OLD_REL, "v1", "v1")),
        "thumbnail": "data:image/png;base64,AA",
        "card_refs": [OLD_A],
    }
    kwargs = {"id": uuid.uuid4(), "data": data}
    tally = rm.rewrite_diagram_row(kwargs, _ctx())
    assert f'cardId="{NEW_A}"' in data["xml"]
    assert f'relationId="{NEW_REL}"' in data["xml"]
    assert OLD_A not in data["xml"]
    assert data["card_refs"] == [NEW_A]
    assert data["thumbnail"] == "data:image/png;base64,AA"
    assert tally.counts == {rm.REMAPPED: 2}


def test_card_refs_are_only_written_when_the_diagram_had_them():
    data = {"xml": _model(_cell("v1", OLD_A))}
    rm.rewrite_diagram_row({"id": None, "data": data}, _ctx())
    assert "card_refs" not in data


def test_a_diagram_without_xml_is_left_alone():
    for data in (None, "x", {}, {"xml": ""}, {"xml": None}):
        assert rm.rewrite_diagram_row({"data": data}, _ctx()).counts == {}


def test_a_compressed_diagram_is_counted():
    data = {"xml": '<mxfile><diagram id="p">7ZhNb</diagram></mxfile>'}
    tally = rm.rewrite_diagram_row({"data": data}, _ctx())
    assert tally.counts == {rm.COMPRESSED: 1}


def test_a_legacy_diagram_relinks_by_name_using_its_own_hints():
    diagram_id = uuid.uuid4()
    xml = _model(
        _cell("v1", OLD_A, name="CRM"),
        _cell("v2", OLD_B, name="ERP"),
        _cell("v3", OLD_C, name="Ghost"),
        _edge("e1", OLD_REL, "v1", "v2"),
    )
    ctx = _legacy_ctx(
        cards_by_type_name={
            ("Application", "crm"): [NEW_A, NEW_C],
            ("Application", "erp"): [NEW_B],
        },
        relations_by_ends={("relAppToApp", NEW_A, NEW_B): NEW_REL},
        diagram_card_hints={str(diagram_id): {NEW_A}},
    )
    data = {"xml": xml}
    tally = rm.rewrite_diagram_row({"id": diagram_id, "data": data}, ctx)
    assert f'cardId="{NEW_A}"' in data["xml"]
    assert f'cardId="{NEW_B}"' in data["xml"]
    assert f'cardId="{OLD_C}"' in data["xml"]  # not found — left as it was
    assert f'relationId="{NEW_REL}"' in data["xml"]
    # Ghost is counted once, by the fallback — not again by the rewrite.
    assert tally.counts == {rm.RELINKED_BY_NAME: 3, rm.UNRESOLVED: 1}


def test_a_legacy_edge_between_a_relinked_and_a_live_card_resolves():
    xml = _model(
        _cell("v1", OLD_A, name="CRM"), _cell("v2", NEW_B), _edge("e1", OLD_REL, "v1", "v2")
    )
    ctx = _legacy_ctx(
        cards_by_type_name={("Application", "crm"): [NEW_A]},
        live_card_ids={NEW_B},
        relations_by_ends={("relAppToApp", NEW_A, NEW_B): NEW_REL},
    )
    data = {"xml": xml}
    rm.rewrite_diagram_row({"data": data}, ctx)
    assert f'relationId="{NEW_REL}"' in data["xml"]


def test_an_unparseable_legacy_diagram_is_counted_and_kept():
    data = {"xml": "<mxGraphModel><root>" + f'<object cardId="{OLD_A}">'}
    tally = rm.rewrite_diagram_row({"data": data}, _legacy_ctx())
    assert tally.counts == {rm.UNPARSEABLE: 1}
    assert OLD_A in data["xml"]


# ── BPM ─────────────────────────────────────────────────────────────────────


def test_bpmn_references_to_cards_are_rewritten_and_foreign_ones_kept():
    xml = (
        f'<bpmn:callActivity id="c1" calledElement="{OLD_A}"/>'
        f'<bpmn:task id="t1" turboea:processRef="{OLD_B}"/>'
        f'<bpmn:task id="t2" x:processRef="{OLD_C}"/>'
        '<bpmn:callActivity id="c2" calledElement="Proc_Other"/>'
        f'<bpmn:participant id="p" processRef="{OLD_A}"/>'
        f'<bpmn:task id="t3" xcalledElement="{OLD_A}"/>'
    )
    tally = rm.RewriteTally()
    out = rm.rewrite_bpmn_xml(xml, _ids(), tally)
    assert f'calledElement="{NEW_A}"' in out
    assert f'turboea:processRef="{NEW_B}"' in out
    assert f'x:processRef="{OLD_C}"' in out  # unmapped
    assert 'calledElement="Proc_Other"' in out
    assert f'processRef="{OLD_A}"/>' in out.split("participant")[1]
    assert f'xcalledElement="{OLD_A}"' in out
    assert tally.counts == {rm.REMAPPED: 2, rm.UNRESOLVED: 1}


def test_bpmn_rewrite_passes_non_text_through():
    tally = rm.RewriteTally()
    assert rm.rewrite_bpmn_xml(None, _ids(), tally) is None
    assert rm.rewrite_bpmn_xml("", _ids(), tally) == ""


def test_draft_links_are_translated_and_explicit_clears_survive():
    links = {
        "Task_1": {
            "application_id": OLD_A,
            "data_object_id": None,
            "it_component_id": OLD_B,
            "business_process_id": OLD_C,
            "organization_ids": [OLD_A, OLD_B],
            "custom_fields": {"note": OLD_A},
        },
        "Task_2": {"organization_ids": []},
        "Task_3": "garbage",
    }
    tally = rm.RewriteTally()
    out = rm.rewrite_draft_element_links(links, _ids(), tally)
    assert out == {
        "Task_1": {
            "application_id": NEW_A,
            "data_object_id": None,
            "it_component_id": NEW_B,
            "business_process_id": OLD_C,
            "organization_ids": [NEW_A, NEW_B],
            "custom_fields": {"note": OLD_A},
        },
        "Task_2": {"organization_ids": []},
        "Task_3": "garbage",
    }
    assert links["Task_1"]["application_id"] == OLD_A  # input untouched
    assert tally.counts == {rm.REMAPPED: 4, rm.UNRESOLVED: 1}
    assert rm.rewrite_draft_element_links(None, _ids(), tally) is None


def test_process_rows_rewrite_their_xml_links_and_called_element():
    kw = {"bpmn_xml": f'<x calledElement="{OLD_A}"/>'}
    assert rm.rewrite_process_diagram_row(kw, _ctx()).counts == {rm.REMAPPED: 1}
    assert kw["bpmn_xml"] == f'<x calledElement="{NEW_A}"/>'

    kw = {
        "bpmn_xml": f'<x turboea:processRef="{OLD_B}"/>',
        "draft_element_links": {"T": {"application_id": OLD_A}},
    }
    assert rm.rewrite_flow_version_row(kw, _ctx()).counts == {rm.REMAPPED: 2}
    assert kw["bpmn_xml"] == f'<x turboea:processRef="{NEW_B}"/>'
    assert kw["draft_element_links"] == {"T": {"application_id": NEW_A}}

    kw = {"bpmn_xml": "<x/>"}
    rm.rewrite_flow_version_row(kw, _ctx())
    assert "draft_element_links" not in kw

    kw = {"called_element": OLD_A}
    assert rm.rewrite_process_element_row(kw, _ctx()).counts == {rm.REMAPPED: 1}
    assert kw["called_element"] == NEW_A
    kw = {"called_element": "Process_1"}
    assert rm.rewrite_process_element_row(kw, _ctx()).counts == {}
    assert kw["called_element"] == "Process_1"


# ── saved reports, surveys, portals, bookmarks ─────────────────────────────


def test_every_report_key_that_holds_an_id_is_translated():
    config = {
        "center": OLD_A,
        "scopeIds": [OLD_A],
        "rowScopeIds": [OLD_B],
        "colScopeIds": [OLD_A, OLD_B],
        "filterOrgs": [OLD_B],
        "filterCtxs": [OLD_A, "__empty__"],
        "relationFilters": {"relAppToOrg": [OLD_B]},
        "tagFilterIds": [OLD_TAG],
        "tagFilters": {"group": [OLD_TAG]},
        "drillStack": [{"cardId": OLD_A, "cardName": "A"}, {"cardName": "no id"}, "x"],
        "cardTypeKey": "Application",
        "attrFilters": {"status": [OLD_A]},
    }
    tally = rm.RewriteTally()
    out = rm.rewrite_saved_report_config(config, _ids(), tally)
    assert out == {
        "center": NEW_A,
        "scopeIds": [NEW_A],
        "rowScopeIds": [NEW_B],
        "colScopeIds": [NEW_A, NEW_B],
        "filterOrgs": [NEW_B],
        "filterCtxs": [NEW_A, "__empty__"],
        "relationFilters": {"relAppToOrg": [NEW_B]},
        "tagFilterIds": [NEW_TAG],
        "tagFilters": {"group": [NEW_TAG]},
        "drillStack": [{"cardId": NEW_A, "cardName": "A"}, {"cardName": "no id"}, "x"],
        "cardTypeKey": "Application",
        # Not a named key — but a mapped id is a mapped id wherever it sits.
        "attrFilters": {"status": [NEW_A]},
    }
    assert config["center"] == OLD_A  # input untouched
    assert tally.counts == {rm.REMAPPED: 12}


def test_card_and_tag_ids_are_looked_up_in_their_own_tables():
    tally = rm.RewriteTally()
    out = rm.rewrite_saved_report_config(
        {"scopeIds": [OLD_TAG], "tagFilterIds": [OLD_A]}, _ids(), tally
    )
    assert out == {"scopeIds": [OLD_TAG], "tagFilterIds": [OLD_A]}
    assert tally.counts == {rm.UNRESOLVED: 2}


def test_a_report_without_config_keys_or_config_is_untouched():
    assert rm.rewrite_saved_report_config({"view": "chart"}, _ids(), rm.RewriteTally()) == {
        "view": "chart"
    }
    assert rm.rewrite_saved_report_config(None, _ids(), rm.RewriteTally()) is None
    kw = {"name": "x"}
    assert rm.rewrite_saved_report_row(kw, _ctx()).counts == {}
    assert kw == {"name": "x"}
    kw = {"config": {"center": OLD_A}}
    rm.rewrite_saved_report_row(kw, _ctx())
    assert kw == {"config": {"center": NEW_A}}


def test_survey_portal_and_bookmark_filters_are_translated():
    kw = {
        "target_filters": {
            "card_ids": [OLD_A],
            "related_ids": [OLD_B],
            "tag_ids": [OLD_TAG],
            "relation_type_key": "relAppToOrg",
        }
    }
    assert rm.rewrite_survey_row(kw, _ctx()).counts == {rm.REMAPPED: 3}
    assert kw["target_filters"] == {
        "card_ids": [NEW_A],
        "related_ids": [NEW_B],
        "tag_ids": [NEW_TAG],
        "relation_type_key": "relAppToOrg",
    }
    kw = {"filters": {"tag_ids": [OLD_TAG], "card_ids": [OLD_A]}}
    rm.rewrite_portal_row(kw, _ctx())
    assert kw["filters"] == {"tag_ids": [NEW_TAG], "card_ids": [NEW_A]}
    kw = {"filters": {"tagIds": [OLD_TAG], "relations": {"relX": ["Some App"]}}}
    rm.rewrite_bookmark_row(kw, _ctx())
    assert kw["filters"] == {"tagIds": [NEW_TAG], "relations": {"relX": ["Some App"]}}


def test_filter_rows_without_their_column_or_with_junk_are_untouched():
    for fn, col in (
        (rm.rewrite_survey_row, "target_filters"),
        (rm.rewrite_portal_row, "filters"),
        (rm.rewrite_bookmark_row, "filters"),
    ):
        kw = {"name": "x"}
        assert fn(kw, _ctx()).counts == {}
        assert kw == {"name": "x"}
        kw = {col: None}
        fn(kw, _ctx())
        assert kw == {col: None}


# ── todos, compliance findings ─────────────────────────────────────────────


def test_card_ids_in_links_are_translated_and_other_ids_kept():
    survey = "99999999-0000-0000-0000-000000000001"
    ids = _ids()
    cases = {
        f"/cards/{OLD_A}": f"/cards/{NEW_A}",
        f"/cards/{OLD_A}?tab=2": f"/cards/{NEW_A}?tab=2",
        f"/ppm/{OLD_B}?tab=tasks": f"/ppm/{NEW_B}?tab=tasks",
        f"/surveys/{survey}/respond/{OLD_A}": f"/surveys/{survey}/respond/{NEW_A}",
        f"/grc/risks/{survey}": f"/grc/risks/{survey}",
        "/todos": "/todos",
    }
    for before, after in cases.items():
        assert rm.rewrite_link(before, ids, rm.RewriteTally()) == after


def test_an_unmapped_card_link_is_counted_but_an_unknown_module_id_is_not():
    tally = rm.RewriteTally()
    assert rm.rewrite_link(f"/cards/{OLD_C}", _ids(), tally) == f"/cards/{OLD_C}"
    assert tally.counts == {rm.UNRESOLVED: 1}
    tally = rm.RewriteTally()
    rm.rewrite_link(f"/grc/risks/{OLD_C}", _ids(), tally)
    assert tally.counts == {}
    tally = rm.RewriteTally()
    rm.rewrite_link(f"/ppm/{OLD_C}", _ids(), tally)
    assert tally.counts == {rm.UNRESOLVED: 1}


def test_link_rewrite_passes_non_text_through():
    assert rm.rewrite_link(None, _ids(), rm.RewriteTally()) is None
    assert rm.rewrite_link("", _ids(), rm.RewriteTally()) == ""
    kw = {"title": "x"}
    assert rm.rewrite_todo_row(kw, _ctx()).counts == {}
    kw = {"link": f"/cards/{OLD_A}"}
    assert rm.rewrite_todo_row(kw, _ctx()).counts == {rm.REMAPPED: 1}
    assert kw == {"link": f"/cards/{NEW_A}"}


def test_a_finding_key_is_recomputed_for_the_card_it_now_belongs_to():
    new_card = uuid.UUID(NEW_A)
    kw = {
        "scope_type": "card",
        "card_id": new_card,
        "regulation": "gdpr",
        "regulation_article": "Art. 30",
        "finding_key": compute_finding_key("card", OLD_A, "gdpr", "Art. 30"),
    }
    tally = rm.refresh_finding_key_row(kw, _ctx())
    assert kw["finding_key"] == compute_finding_key("card", new_card, "gdpr", "Art. 30")
    assert tally.counts == {rm.REMAPPED: 1}
    again = rm.refresh_finding_key_row(kw, _ctx())  # already right: nothing to do
    assert again.counts == {}
    assert rm.refresh_finding_key_row({"card_id": new_card}, _ctx()).counts == {}


def test_relation_answers_in_survey_responses_are_translated():
    kw = {
        "responses": {
            "relAppToOrg": {
                "current_value": [{"id": OLD_A, "name": "Sales"}],
                "new_value": [OLD_B, {"id": OLD_C, "name": "Gone"}, {"name": "no id"}],
                "confirmed": True,
            },
            "criticality": {"current_value": "high", "new_value": ["a", "b"]},
            "note": "junk",
        }
    }
    tally = rm.rewrite_survey_response_row(kw, _ctx())
    assert kw["responses"] == {
        "relAppToOrg": {
            "current_value": [{"id": NEW_A, "name": "Sales"}],
            "new_value": [NEW_B, {"id": OLD_C, "name": "Gone"}, {"name": "no id"}],
            "confirmed": True,
        },
        "criticality": {"current_value": "high", "new_value": ["a", "b"]},
        "note": "junk",
    }
    assert tally.counts == {rm.REMAPPED: 2, rm.UNRESOLVED: 1}
    empty = {"responses": None}
    assert rm.rewrite_survey_response_row(empty, _ctx()).counts == {}
    assert empty == {"responses": None}
    partial = {"responses": {"f": {"confirmed": False}}}
    rm.rewrite_survey_response_row(partial, _ctx())
    assert partial == {"responses": {"f": {"confirmed": False}}}


def test_a_legacy_diagram_counts_what_the_map_alone_translated():
    """A legacy bundle's ids come from the map too (harvested called
    processes, a backfilled row); the rewrite must report them or the heal
    path cannot tell the row changed."""
    ids = rm.IdMap()
    ids.record(rm.CARDS, OLD_A, NEW_A)
    ctx = rm.RemapContext(ids=ids, legacy=True)
    data = {"xml": _model(_cell("v1", OLD_A))}
    tally = rm.rewrite_diagram_row({"data": data}, ctx)
    assert f'cardId="{NEW_A}"' in data["xml"]
    assert tally.counts == {rm.REMAPPED: 1}
    assert tally.changed()


def test_a_mapped_id_is_replaced_wherever_a_config_holds_it():
    """A key no report has today still translates; an unknown UUID is not an
    id the walk can name, so it is neither touched nor counted."""
    unknown = "12345678-1234-1234-1234-123456789abc"
    tally = rm.RewriteTally()
    config = {
        "focusIds": [OLD_A, unknown],
        "nested": {"deeper": {"card": OLD_B.upper()}},
        "tag": OLD_TAG,
        OLD_A: "a key is never an id",
        "n": 3,
        "flag": None,
    }
    out = rm.rewrite_saved_report_config(config, _ids(), tally)
    assert out == {
        "focusIds": [NEW_A, unknown],
        "nested": {"deeper": {"card": NEW_B}},
        "tag": NEW_TAG,
        OLD_A: "a key is never an id",
        "n": 3,
        "flag": None,
    }
    assert tally.counts == {rm.REMAPPED: 3}
    assert rm.replace_mapped_ids(OLD_A, (_ids().cards,), rm.RewriteTally()) == NEW_A
    assert rm.replace_mapped_ids(7, (_ids().cards,), rm.RewriteTally()) == 7


def test_a_filter_key_no_one_listed_still_translates():
    kw = {"target_filters": {"owner_card_ids": [OLD_A]}}
    assert rm.rewrite_survey_row(kw, _ctx()).counts == {rm.REMAPPED: 1}
    assert kw["target_filters"] == {"owner_card_ids": [NEW_A]}


def test_a_legacy_diagram_reports_the_maps_moves_apart_from_its_own():
    """A diagram holding one card the map knows twice and one the name
    fallback places: remapped counts the map's two occurrences, relinked the
    fallback's one cell, and nothing twice."""
    ids = rm.IdMap()
    ids.record(rm.CARDS, OLD_A, NEW_A)
    ctx = rm.RemapContext(
        ids=ids, legacy=True, cards_by_type_name={("Application", "erp"): [NEW_B]}
    )
    data = {"xml": _model(_cell("v1", OLD_A), _cell("v2", OLD_A), _cell("v3", OLD_B, name="ERP"))}
    tally = rm.rewrite_diagram_row({"data": data}, ctx)
    assert tally.counts == {rm.REMAPPED: 2, rm.RELINKED_BY_NAME: 1}
    assert data["xml"].count(f'cardId="{NEW_A}"') == 2
    assert f'cardId="{NEW_B}"' in data["xml"]
    assert rm.count_mapped_drawio_ids(data["xml"], ids.cards, {}) == 0
