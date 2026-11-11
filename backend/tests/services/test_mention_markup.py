"""The mention span grammar (``app/services/mention_markup.py``), no database.

Canonical markup is double-quoted, and ``map_ids`` leaves any other span byte
for byte. A span a browser would still read as a mention (single quotes,
unquoted values, upper case) is read through ``normalise``: a valid one is
its canonical mention, anything else its escaped text. Every pattern runs in
linear time on hostile input.
"""

from __future__ import annotations

import time
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


# --- spans outside the grammar: normalise ----------------------------------------------

OUTSIDE = [
    f"<span data-type='mention' data-kind='card' data-id='{CARD}'>@Fake</span>",
    f"<SPAN DATA-TYPE=mention data-kind=card data-id={CARD}>@Fake</SPAN>",
    f'<span data-id="{CARD}" data-kind="CARD" data-type="MENTION"><b>@Fake</b></span>',
    f'<span data-type="mention" data-kind="card" data-id="{CARD}" />@Fake</span>',
    f'<span data-type="&#109;ention" data-kind="card" data-id="{CARD}">@Fake</span>',
]


@pytest.mark.parametrize("html", OUTSIDE, ids=[f"outside-{i}" for i in range(len(OUTSIDE))])
def test_a_valid_span_outside_the_grammar_becomes_its_canonical_span(html):
    assert mm.normalise(f"<p>a {html} b</p>") == f"<p>a {span('card', CARD)} b</p>"
    assert mm.iter_mentions(html) == [("card", CARD)]


INVALID = [
    f"<span data-type='mention' data-kind='team' data-id='{CARD}'>@A &amp; <b>B</b></span>",
    "<span data-type='mention' data-kind='card' data-id='nope'>@A &amp; <b>B</b></span>",
    f"<span data-type='mention' data-kind='card' data-id='{CARD}' class=x>@A &amp; <b>B</b></span>",
    f"<span data-type=mention data-kind=card data-id={CARD} data-id={USER}>"
    "@A &amp; <b>B</b></span>",
    "<span data-type=mention data-kind=card data-id>@A &amp; <b>B</b></span>",
    "<span data-type='mention' data-kind='card' data-token='abc'>@A &amp; <b>B</b></span>",
]


@pytest.mark.parametrize("html", INVALID, ids=[f"invalid-{i}" for i in range(len(INVALID))])
def test_an_invalid_mention_like_span_becomes_its_escaped_text(html):
    assert mm.normalise(f"<p>{html}!</p>") == "<p>@A &amp; B!</p>"
    assert mm.iter_mentions(html) == []


def test_normalise_only_allows_the_given_kinds():
    html = f"<p><span data-type='mention' data-kind='user' data-id='{USER}'>@Ada</span></p>"
    assert mm.normalise(html, ("card", "decision")) == "<p>@Ada</p>"
    assert mm.normalise(html) == f"<p>{span('user', USER)}</p>"


def test_normalise_keeps_every_other_byte():
    html = (
        '<p class="x">a &amp; b <span class="other">c</span> <!-- n --> &#169;</p>\n'
        f"<ul><li>{span('card', CARD)}</li></ul>"
    )
    assert mm.normalise(html) is html
    plain = "<p>no hint here</p>"
    assert mm.normalise(plain) is plain
    assert mm.normalise(None) is None


def test_a_nested_span_belongs_to_the_label_of_the_outer_mention():
    html = (
        f'<p><span data-type="mention" data-kind="card" data-id="{CARD}">@A'
        f"<span data-type='mention' data-kind='user' data-id='{USER}'>@B</span>"
        "<span>c</span></span>!</p>"
    )
    assert mm.normalise(html) == f"<p>{span('card', CARD)}!</p>"
    assert mm.iter_mentions(html) == [("card", CARD)]


def test_a_mention_span_never_closed_keeps_only_the_text_after_it():
    html = f"<p>a</p><span data-type='mention' data-kind='card' data-id='{CARD}'><p>b &amp; c</p>"
    assert mm.normalise(html) == "<p>a</p>b &amp; c"
    assert mm.iter_mentions(html) == []


def test_a_span_hidden_in_script_content_is_found_too():
    html = f"<script><span data-type='mention' data-kind='card' data-id='{CARD}'>@X</span></script>"
    assert mm.normalise(html) == f"<script>{span('card', CARD)}</script>"


def test_normalise_reaches_a_fixed_point_on_a_span_assembled_from_a_collapsed_one():
    # Collapsing the inner span leaves "<sp" + "an data-type=..." behind: a new span.
    assembled = (
        '<p><sp<span data-type="mention" data-kind="zz"></span>an data-type="mention" '
        f'data-kind="card" data-id="{CARD}" data-archived="true">Fake name</span></p>'
    )
    once = mm.normalise(assembled)
    assert mm.normalise(once) == once
    assert "Fake name" not in once
    assert mm.iter_mentions(once) == mm.iter_mentions(assembled)


def test_markup_that_never_settles_keeps_its_text_only(monkeypatch):
    monkeypatch.setattr(mm, "MAX_PASSES", 1)
    assembled = (
        '<p><sp<span data-type="mention" data-kind="zz"></span>an data-type="mention" '
        f'data-kind="card" data-id="{CARD}">Fake</span></p>'
    )
    assert mm.normalise(assembled) == "Fake"


def test_grammar_clean():
    assert mm.grammar_clean(f"<p>{span('card', CARD, text='@CRM')}</p>") is True
    assert mm.grammar_clean("<p>plain</p>") is True
    # a data-type outside any matched span, a matched span that is not a mention
    assert mm.grammar_clean(f"<p data-type='x'>{span('card', CARD)}</p>") is False
    assert mm.grammar_clean(span("card", CARD, extra=' class="x"')) is False
    assert mm.grammar_clean(OUTSIDE[0]) is False


def test_has_hint_and_text_of():
    assert mm.has_hint("<p DATA-Type=x>") is True
    assert mm.has_hint("<p>nothing</p>") is False
    assert mm.has_hint(None) is False
    assert mm.text_of("@<i>A</i> &lt;b&gt; &amp; a < b") == "@A &lt;b&gt; &amp; a &lt; b"


# --- linear time on hostile input ---------------------------------------------------------

#: Far above what a linear scan of these inputs takes (milliseconds) and far
#: below what the quadratic patterns took (seconds to minutes).
BUDGET = 2.0

HOSTILE = {
    "span-100k": "<span" * 20000 + ' data-type="mention" ',
    "spaced-span-100k": "<span " * 16666 + 'data-type="mention"',
    "lt-100k": "<" * 100000,
    "open-mention-100k": '<span data-type="mention">' * 4000,
    "attributes-in-one-tag": "<span " + 'data-type="mention" ' * 5000,
    "spaces-in-one-tag": "<span" + " " * 100000 + 'x data-type="mention">',
    "span-300k": "<span" * 60000 + ' data-type="mention" ',
}


@pytest.mark.parametrize("html", HOSTILE.values(), ids=list(HOSTILE))
def test_reading_hostile_markup_takes_linear_time(html):
    started = time.perf_counter()
    mm.iter_mentions(html)
    mm.normalise(html)
    mm.map_ids(html, lambda kind, mention_id: mention_id)
    mm.parse_attributes(" " * 100000 + "x")
    assert time.perf_counter() - started < BUDGET


def test_ordinary_spans_parse_exactly_as_before():
    tiptap = f'<span data-id="{CARD}" data-kind="card" data-type="mention">@CRM</span>'
    html = f"<p>{span('card', CARD, text='<b>@CRM</b>')} and {tiptap}</p>"
    assert [m.group(2) for m in mm.MENTION_SPAN_RE.finditer(html)] == ["<b>@CRM</b>", "@CRM"]
    assert mm.iter_mentions(html) == [("card", CARD), ("card", CARD)]
    assert mm.normalise(html) == f"<p>{span('card', CARD)} and {span('card', CARD)}</p>"


# --- exact answers the mutation run left open --------------------------------------


def test_canonical_span_names_what_it_refuses():
    with pytest.raises(ValueError, match=r"^Unknown mention kind 'x'$"):
        mm.canonical_span("x", CARD)
    with pytest.raises(ValueError, match=r"^Not a UUID: 'nope'$"):
        mm.canonical_span("card", "nope")


def test_a_clean_labelled_span_is_read_as_it_is():
    html = "<p>" + span("card", CARD, "@CRM") + "</p>"
    assert mm.for_reading(html) is html
    assert "@CRM" in mm.for_reading(html)


def test_two_clean_spans_are_grammar_clean():
    assert mm.grammar_clean(span("card", CARD) + span("user", USER)) is True
    assert mm.grammar_clean(span("card", CARD) + " data-type") is False


def test_a_malformed_span_beside_a_remapped_one_stays_byte_for_byte():
    bad = f'<span data-type="mention" data-kind="bogus" data-id="{CARD}">@Bad</span>'
    html = bad + span("card", CARD, "@CRM")
    out, remapped, unresolved = mm.map_ids(html, lambda kind, mid: NEW_CARD)
    assert out == bad + span("card", NEW_CARD, "@CRM")
    assert (remapped, unresolved) == (1, 0)


def test_a_span_carrying_every_known_attribute_is_still_a_mention():
    attrs = (
        f' data-type="mention" data-kind="card" data-id="{CARD}" data-token="t"'
        ' data-restricted="true" data-missing="true" data-archived="true"'
    )
    assert mm.mention_of(attrs) == ("card", CARD)


def test_parsed_attributes_without_a_type_or_a_kind_are_no_mention():
    no_type = [("data-kind", "card"), ("data-id", CARD)]
    no_kind = [("data-type", "mention"), ("data-id", CARD)]
    assert mm.mention_of_parsed(no_type, mm.MENTION_KINDS) is None
    assert mm.mention_of_parsed(no_kind, mm.MENTION_KINDS) is None


def test_a_span_whose_other_attribute_says_mention_is_not_rewritten():
    html = '<span title="mention">a</span> data-type'
    assert mm.normalise(html) == html


def test_nested_spans_inside_a_mention_close_at_the_outer_span():
    html = span("card", CARD, "<span><span>x</span></span>y") + "tail"
    assert mm.normalise(html) == mm.canonical_span("card", CARD) + "tail"
