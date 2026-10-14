"""The diagram card-id extractor shared by the diagrams API and workspace transfer."""

from __future__ import annotations

from app.services.drawio_refs import CARD_ID_RE, extract_card_refs

A = "11111111-1111-1111-1111-111111111111"
B = "22222222-2222-2222-2222-222222222222"


def test_extracts_each_card_id_once_in_first_seen_order():
    xml = f'<object cardId="{B}"/><object cardId="{A}"/><object cardId="{B}"/>'
    assert extract_card_refs({"xml": xml}) == [B, A]


def test_a_pending_cell_is_not_a_card_reference():
    assert extract_card_refs({"xml": '<object cardId="pending-abc"/>'}) == []


def test_no_data_no_xml_and_empty_xml_yield_nothing():
    assert extract_card_refs(None) == []
    assert extract_card_refs({}) == []
    assert extract_card_refs({"xml": ""}) == []


def test_the_pattern_captures_the_id_alone():
    assert CARD_ID_RE.findall(f'x cardId="{A}" y') == [A]
