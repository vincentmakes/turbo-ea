"""The mention span grammar (``app/services/mention_markup.py``), no database.

Canonical markup is double-quoted: a span written with single quotes, unquoted
or valueless attributes, an unknown attribute or a repeated one is not a
mention, and ``map_ids`` leaves it byte for byte.
"""

from __future__ import annotations

import uuid

import pytest

from app.services import mention_markup as mm

CARD = "0b7f2c1e-1111-4a2b-9c3d-000000000001"
USER = "0b7f2c1e-2222-4a2b-9c3d-000000000002"
DECISION = "0b7f2c1e-3333-4a2b-9c3d-000000000003"
NEW_CARD = "0b7f2c1e-9999-4a2b-9c3d-000000000009"


def span(kind: str, mention_id: str, text: str = "", extra: str = "") -> str:
    return (
        f'<span data-type="mention" data-kind="{kind}" data-id="{mention_id}"{extra}>{text}</span>'
    )


# --- canonical_span --------------------------------------------------------------


def test_canonical_span_is_the_stored_form():
    assert mm.canonical_span("card", CARD) == (
        f'<span data-type="mention" data-kind="card" data-id="{CARD}"></span>'
    )


def test_canonical_span_lower_cases_the_id_and_takes_a_uuid():
    assert mm.canonical_span("user", uuid.UUID(USER)) == span("user", USER)
    assert mm.canonical_span("decision", DECISION.upper()) == span("decision", DECISION)


@pytest.mark.parametrize(
    "kind, mention_id",
    [("tag", CARD), ("Card", CARD), ("card", "not-a-uuid"), ("card", f"{{{CARD}}}"), ("card", "")],
)
def test_canonical_span_refuses_a_bad_kind_or_id(kind, mention_id):
    with pytest.raises(ValueError):
        mm.canonical_span(kind, mention_id)


def test_the_kinds():
    assert mm.MENTION_KINDS == ("card", "decision", "user")


# --- parse_attributes ---------------------------------------------------------------


def test_parse_attributes_reads_double_quoted_pairs():
    assert mm.parse_attributes(' data-type="mention" data-kind="card" data-id="x" ') == {
        "data-type": "mention",
        "data-kind": "card",
        "data-id": "x",
    }


def test_parse_attributes_lower_cases_names_and_unescapes_values():
    assert mm.parse_attributes(' DATA-Kind="a&amp;b"') == {"data-kind": "a&b"}


def test_parse_attributes_of_nothing_is_empty():
    assert mm.parse_attributes("") == {}
    assert mm.parse_attributes("   ") == {}


@pytest.mark.parametrize(
    "attrs",
    [
        " data-type='mention'",
        " data-type=mention",
        " data-type",
        ' data-type="mention" data-type="mention"',
        'data-type="mention"',
        ' data-type="mention"/',
        ' data-type="mention" junk',
        ' data-type="mention"data-kind="card"',
    ],
)
def test_parse_attributes_rejects_what_is_not_canonical(attrs):
    assert mm.parse_attributes(attrs) is None


# --- iter_mentions ---------------------------------------------------------------------


def test_iter_mentions_in_document_order_with_repeats():
    html = f"<p>{span('card', CARD)} and {span('user', USER)} then {span('card', CARD)}</p>"
    assert mm.iter_mentions(html) == [("card", CARD), ("user", USER), ("card", CARD)]


def test_attribute_order_does_not_matter():
    tiptap = f'<span data-id="{CARD}" data-kind="card" data-type="mention">@CRM</span>'
    assert mm.iter_mentions(tiptap) == [("card", CARD)]


def test_upper_case_ids_are_reported_lower_cased():
    assert mm.iter_mentions(span("decision", DECISION.upper())) == [("decision", DECISION)]


def test_a_labelled_span_with_nested_markup_is_a_mention():
    html = span("card", CARD, text="<strong>@CRM</strong> <em>x</em>")
    assert mm.iter_mentions(html) == [("card", CARD)]


def test_reader_state_attributes_are_known():
    html = span("card", CARD, text="@CRM", extra=' data-archived="true"')
    assert mm.iter_mentions(html) == [("card", CARD)]


@pytest.mark.parametrize(
    "html",
    [
        f"<span data-type='mention' data-kind='card' data-id='{CARD}'></span>",
        span("card", CARD, extra=' class="chip"'),
        span("card", CARD, extra=' onclick="x()"'),
        span("tag", CARD),
        span("card", "not-a-uuid"),
        span("card", CARD.replace("-", "")),
        span("card", f" {CARD}"),
        '<span data-type="mention" data-kind="card"></span>',
        f'<span data-type="mention" data-kind="card" data-id="{CARD}" data-id="{USER}"></span>',
        f'<span data-type="link" data-kind="card" data-id="{CARD}"></span>',
        '<span data-type="mention" data-kind="card" data-restricted="true" '
        'data-token="ab12cd34"></span>',
    ],
)
def test_malformed_or_foreign_spans_are_not_mentions(html):
    assert mm.iter_mentions(html) == []


def test_escaped_markup_is_text_not_a_span():
    html = f"<p>&lt;span data-type=&quot;mention&quot; data-id=&quot;{CARD}&quot;&gt;</p>"
    assert mm.iter_mentions(html) == []


@pytest.mark.parametrize("value", [None, "", "<p>plain</p>", 7])
def test_no_span_no_mentions(value):
    assert mm.iter_mentions(value) == []


# --- map_ids ---------------------------------------------------------------------------


def _cards_only(kind, mention_id):
    if kind == "card":
        return {CARD: NEW_CARD}.get(mention_id)
    return mention_id


def test_map_ids_rewrites_only_the_data_id():
    html = f"<p>a &amp; b {span('card', CARD, text='@CRM')} c</p>"
    out, remapped, unresolved = mm.map_ids(html, _cards_only)
    assert out == f"<p>a &amp; b {span('card', NEW_CARD, text='@CRM')} c</p>"
    assert (remapped, unresolved) == (1, 0)


def test_map_ids_keeps_attribute_order_and_nested_label():
    html = f'<span data-id="{CARD}" data-type="mention" data-kind="card"><b>@CRM</b></span>'
    out, remapped, unresolved = mm.map_ids(html, _cards_only)
    assert (
        out == f'<span data-id="{NEW_CARD}" data-type="mention" data-kind="card"><b>@CRM</b></span>'
    )
    assert (remapped, unresolved) == (1, 0)


def test_map_ids_calls_the_mapping_with_kind_and_lower_case_id():
    calls = []

    def mapping(kind, mention_id):
        calls.append((kind, mention_id))
        return mention_id

    html = span("card", CARD.upper()) + span("user", USER) + span("decision", DECISION)
    out, remapped, unresolved = mm.map_ids(html, mapping)
    assert calls == [("card", CARD), ("user", USER), ("decision", DECISION)]
    assert out is html
    assert (remapped, unresolved) == (0, 0)


def test_map_ids_counts_unresolved_and_keeps_the_span():
    html = span("card", USER) + span("card", CARD)
    out, remapped, unresolved = mm.map_ids(html, _cards_only)
    assert out == span("card", USER) + span("card", NEW_CARD)
    assert (remapped, unresolved) == (1, 1)


def test_map_ids_with_only_unresolved_returns_the_same_object():
    html = span("card", USER)
    out, remapped, unresolved = mm.map_ids(html, lambda kind, mention_id: None)
    assert out is html
    assert (remapped, unresolved) == (0, 1)


def test_map_ids_rewrites_several_spans_in_one_string():
    other = "0b7f2c1e-4444-4a2b-9c3d-000000000004"
    other_new = "0b7f2c1e-5555-4a2b-9c3d-000000000005"
    mapping = {CARD: NEW_CARD, other: other_new}
    html = f"<ul><li>{span('card', CARD)}</li><li>{span('card', other)}</li></ul>"
    out, remapped, unresolved = mm.map_ids(html, lambda kind, mention_id: mapping.get(mention_id))
    assert out == f"<ul><li>{span('card', NEW_CARD)}</li><li>{span('card', other_new)}</li></ul>"
    assert (remapped, unresolved) == (2, 0)


def test_map_ids_leaves_malformed_spans_alone():
    single = f"<span data-type='mention' data-kind='card' data-id='{CARD}'></span>"
    extra = span("card", CARD, extra=' class="x"')
    html = single + extra
    out, remapped, unresolved = mm.map_ids(html, _cards_only)
    assert out is html
    assert (remapped, unresolved) == (0, 0)


def test_map_ids_upper_case_attribute_name_still_rewrites():
    html = f'<span data-type="mention" data-kind="card" DATA-ID="{CARD}"></span>'
    out, remapped, _ = mm.map_ids(html, _cards_only)
    assert out == f'<span data-type="mention" data-kind="card" DATA-ID="{NEW_CARD}"></span>'
    assert remapped == 1


@pytest.mark.parametrize("value", ["", "<p>no mention here</p>", None, 3])
def test_map_ids_without_a_span_returns_the_value_itself(value):
    out, remapped, unresolved = mm.map_ids(value, _cards_only)
    assert out is value
    assert (remapped, unresolved) == (0, 0)


def test_map_ids_never_calls_the_mapping_without_a_span():
    def boom(kind, mention_id):
        raise AssertionError("called")

    html = "<p>data-type=&quot;mention&quot;</p>"
    assert mm.map_ids(html, boom) == (html, 0, 0)
