"""The pure rules of mentions in decision and SoAW text (no database).

Exact strings on both sides: the frontend round-trips the reader's markup
byte for byte (attribute order type, kind, id, restricted, token, missing,
archived; ``@Name`` for a card or person, ``ADR-012 · Rev 2 Title`` for a
decision; restricted and missing spans empty).
"""

from __future__ import annotations

import hashlib
import hmac
import re
import time

import pytest

from app.config import settings
from app.services import mention_service as ms

CARD = "11111111-2222-3333-4444-555555555555"
OTHER = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"
DOC = "99999999-8888-7777-6666-555555555555"
DOC2 = "12345678-1234-1234-1234-123456789abc"


def span(kind: str, mention_id: str) -> str:
    return f'<span data-type="mention" data-kind="{kind}" data-id="{mention_id}"></span>'


# --- text fields ----------------------------------------------------------------


def test_text_fields_of():
    assert ms.text_fields_of("adr") == (
        "context",
        "decision",
        "consequences",
        "alternatives_considered",
    )
    assert ms.text_fields_of("soaw") == ("sections",)
    with pytest.raises(ValueError, match="Unknown document kind 'card'"):
        ms.text_fields_of("card")


# --- token ----------------------------------------------------------------------


def test_token_is_the_first_16_hex_of_an_hmac_over_scope_kind_target(monkeypatch):
    monkeypatch.setattr(settings, "SECRET_KEY", "k-test")
    expected = hmac.new(b"k-test", f"{DOC}:card:{CARD}".encode(), hashlib.sha256).hexdigest()[:16]
    token = ms.token_for(DOC, "card", CARD)
    assert token == expected
    assert re.fullmatch(r"[0-9a-f]{16}", token)
    # Stable, and the same for an upper-case spelling of the same ids.
    assert ms.token_for(DOC, "card", CARD) == token
    assert ms.token_for(DOC.upper(), "card", CARD.upper()) == token


def test_token_differs_across_documents_kinds_targets_and_keys(monkeypatch):
    monkeypatch.setattr(settings, "SECRET_KEY", "k-test")
    base = ms.token_for(DOC, "card", CARD)
    assert ms.token_for(DOC2, "card", CARD) != base
    assert ms.token_for(DOC, "decision", CARD) != base
    assert ms.token_for(DOC, "card", OTHER) != base
    monkeypatch.setattr(settings, "SECRET_KEY", "another")
    assert ms.token_for(DOC, "card", CARD) != base


# --- canonicalise ----------------------------------------------------------------


def test_canonicalise_leaves_text_without_mentions_as_it_is():
    text = "<p>Plain <b>text</b> &amp; more</p>"
    assert ms.canonicalise(text, ms.DOCUMENT_KINDS) is text
    assert ms.canonicalise(None, ms.DOCUMENT_KINDS) is None
    assert ms.canonicalise(7, ms.DOCUMENT_KINDS) == 7


def test_canonicalise_strips_the_label_and_reader_flags():
    upper = CARD.upper()
    html = (
        f'<p>See <span data-type="mention" data-kind="card" data-id="{upper}" '
        f'data-archived="true">@CRM</span> and '
        f'<span data-id="{OTHER}" data-missing="true" data-kind="decision" '
        f'data-type="mention"></span>.</p>'
    )
    assert ms.canonicalise(html, ms.DOCUMENT_KINDS) == (
        f"<p>See {span('card', CARD)} and {span('decision', OTHER)}.</p>"
    )


def test_canonicalise_collapses_a_person_in_a_document_to_text():
    html = f'<p>Ask <span data-type="mention" data-kind="user" data-id="{CARD}">@Ada</span></p>'
    assert ms.canonicalise(html, ms.DOCUMENT_KINDS) == "<p>Ask @Ada</p>"
    # A comment allows people.
    assert ms.canonicalise(html, ("card", "decision", "user")) == (
        f"<p>Ask {span('user', CARD)}</p>"
    )


@pytest.mark.parametrize(
    "bad",
    [
        # unknown kind
        f'<span data-type="mention" data-kind="team" data-id="{CARD}">@A &amp; <b>B</b></span>',
        # unknown attribute
        f'<span data-type="mention" data-kind="card" data-id="{CARD}" class="x">@A &amp; '
        "<b>B</b></span>",
        # not a uuid
        '<span data-type="mention" data-kind="card" data-id="nope">@A &amp; <b>B</b></span>',
        # no id
        '<span data-type="mention" data-kind="card">@A &amp; <b>B</b></span>',
    ],
)
def test_canonicalise_collapses_a_malformed_span_to_its_escaped_text(bad):
    assert ms.canonicalise(f"<p>{bad}!</p>", ms.DOCUMENT_KINDS) == "<p>@A &amp; B!</p>"


def test_canonicalise_drops_a_restricted_span_left_without_a_target():
    html = (
        '<p>x<span data-type="mention" data-kind="card" data-restricted="true" '
        'data-token="abc"></span>y</p>'
    )
    assert ms.canonicalise(html, ms.DOCUMENT_KINDS) == "<p>xy</p>"


def test_escaped_text():
    assert ms.escaped_text('@<i>A</i> &lt;b&gt; &amp; "q"') == '@A &lt;b&gt; &amp; "q"'


# --- restore tokens ----------------------------------------------------------------


def _token_of(kind: str, mention_id: str) -> str:
    return ms.token_for(DOC, kind, mention_id)


def _restricted(kind: str, token: str) -> str:
    return (
        f'<span data-type="mention" data-kind="{kind}" data-restricted="true" '
        f'data-token="{token}"></span>'
    )


def test_restore_tokens_maps_a_stored_token_back_to_its_mention():
    html = f"<p>a {_restricted('card', _token_of('card', CARD))} b</p>"
    assert ms.restore_tokens(html, {("card", CARD), ("card", OTHER)}, _token_of) == (
        f"<p>a {span('card', CARD)} b</p>"
    )


def test_restore_tokens_accepts_any_attribute_order():
    token = _token_of("card", CARD)
    html = f'<span data-token="{token}" data-kind="card" data-type="mention"></span>'
    assert ms.restore_tokens(html, {("card", CARD)}, _token_of) == span("card", CARD)


def test_restore_tokens_drops_a_foreign_or_unknown_token():
    foreign = ms.token_for(DOC2, "card", CARD)
    html = f"<p>a{_restricted('card', foreign)}b{_restricted('card', 'ffffffffffffffff')}c</p>"
    assert ms.restore_tokens(html, {("card", CARD)}, _token_of) == "<p>abc</p>"


def test_restore_tokens_drops_a_token_given_with_another_kind():
    html = _restricted("decision", _token_of("card", CARD))
    assert ms.restore_tokens(html, {("card", CARD)}, _token_of) == ""


def test_restore_tokens_restores_nothing_on_a_new_document():
    html = f"<p>{_restricted('card', _token_of('card', CARD))}</p>"
    assert ms.restore_tokens(html, set(), _token_of) == "<p></p>"


def test_restore_tokens_leaves_spans_with_an_id_and_text_without_tokens():
    with_id = f'<span data-type="mention" data-kind="card" data-id="{CARD}" data-token="x"></span>'
    assert ms.restore_tokens(with_id, {("card", OTHER)}, _token_of) == with_id
    plain = f"<p>{span('card', CARD)}</p>"
    assert ms.restore_tokens(plain, {("card", CARD)}, _token_of) is plain
    assert ms.restore_tokens(None, set(), _token_of) is None
    odd = "<span data-type=\"mention\" data-token='x'></span>"
    assert ms.restore_tokens(odd + ' data-token="', set(), _token_of) == odd + ' data-token="'


# --- render -------------------------------------------------------------------------


def _resolver(states):
    return lambda kind, mention_id: states.get((kind, mention_id), ms.MISSING_STATE)


def test_render_a_resolved_card_and_decision():
    html = f"<p>{span('card', CARD)} / {span('decision', OTHER)}</p>"
    out = ms.render(
        html,
        _resolver(
            {
                ("card", CARD): ms.resolved("@CRM"),
                ("decision", OTHER): ms.resolved("ADR-012 · Rev 2 Use Postgres"),
            }
        ),
    )
    assert out == (
        f'<p><span data-type="mention" data-kind="card" data-id="{CARD}">@CRM</span> / '
        f'<span data-type="mention" data-kind="decision" data-id="{OTHER}">'
        "ADR-012 · Rev 2 Use Postgres</span></p>"
    )


def test_render_an_archived_card():
    out = ms.render(
        span("card", CARD), _resolver({("card", CARD): ms.resolved("@Old", archived=True)})
    )
    assert out == (
        f'<span data-type="mention" data-kind="card" data-id="{CARD}" '
        'data-archived="true">@Old</span>'
    )


def test_render_a_restricted_mention_carries_no_id_and_no_text():
    out = ms.render(span("card", CARD), _resolver({("card", CARD): ms.restricted("ab12cd34")}))
    assert out == (
        '<span data-type="mention" data-kind="card" data-restricted="true" '
        'data-token="ab12cd34"></span>'
    )
    assert CARD not in out


def test_render_a_missing_mention_keeps_its_id_and_no_text():
    out = ms.render(span("decision", OTHER), _resolver({}))
    assert out == (
        f'<span data-type="mention" data-kind="decision" data-id="{OTHER}" '
        'data-missing="true"></span>'
    )


def test_render_escapes_the_label():
    out = ms.render(span("card", CARD), _resolver({("card", CARD): ms.resolved('@<b>x</b> & "y"')}))
    assert out == (
        f'<span data-type="mention" data-kind="card" data-id="{CARD}">'
        '@&lt;b&gt;x&lt;/b&gt; &amp; "y"</span>'
    )


def test_render_collapses_a_malformed_span_and_leaves_plain_text():
    bad = f'<span data-type="mention" data-kind="card" data-id="{CARD}" class="x">@Secret</span>'
    assert ms.render(f"<p>{bad}</p>", _resolver({})) == "<p>@Secret</p>"
    plain = "<p>none</p>"
    assert ms.render(plain, _resolver({})) is plain
    assert ms.render(None, _resolver({})) is None


def test_render_for_scopes_the_token_and_defaults_to_missing():
    states = {("card", CARD): ms.restricted()}
    out = ms.render_for(f"{span('card', CARD)}{span('card', OTHER)}", states, DOC)
    assert out == (
        '<span data-type="mention" data-kind="card" data-restricted="true" '
        f'data-token="{ms.token_for(DOC, "card", CARD)}"></span>'
        f'<span data-type="mention" data-kind="card" data-id="{OTHER}" '
        'data-missing="true"></span>'
    )


def test_a_rendered_restricted_chip_saved_back_restores_its_mention():
    rendered = ms.render_for(span("card", CARD), {("card", CARD): ms.restricted()}, DOC)
    restored = ms.restore_tokens(f"<p>{rendered}</p>", {("card", CARD)}, _token_of)
    assert ms.canonicalise(restored, ms.DOCUMENT_KINDS) == f"<p>{span('card', CARD)}</p>"


def test_decision_label():
    assert ms.decision_label("ADR-012", 1, "Use Postgres") == "ADR-012 Use Postgres"
    assert ms.decision_label("ADR-012", 2, "Use Postgres") == "ADR-012 · Rev 2 Use Postgres"


def test_marker_of():
    assert ms.marker_of("card", CARD.upper()) == f'data-kind="card" data-id="{CARD}"'
    assert ms.marker_of("decision", OTHER) in span("decision", OTHER)


# --- SoAW sections ---------------------------------------------------------------------


def test_walk_soaw_sections_touches_string_content_only_and_copies():
    table = {"rows": [["<p>cell</p>"]]}
    sections = {
        "1.1": {"content": "<p>a</p>", "hidden": False},
        "custom_x": {"content": "<p>b</p>", "title": "Mine"},
        "3.2": {"table_data": table},
        "4.1": {"content": None},
        "odd": "text",
    }
    out = ms.walk_soaw_sections(sections, lambda text: text.upper())
    assert out == {
        "1.1": {"content": "<P>A</P>", "hidden": False},
        "custom_x": {"content": "<P>B</P>", "title": "Mine"},
        "3.2": {"table_data": table},
        "4.1": {"content": None},
        "odd": "text",
    }
    assert out is not sections
    assert sections["1.1"] == {"content": "<p>a</p>", "hidden": False}
    assert sections["custom_x"] == {"content": "<p>b</p>", "title": "Mine"}
    assert ms.walk_soaw_sections(None, str.upper) is None


def test_field_texts_map_field_and_mentions_of():
    sections = {"1.1": {"content": span("card", CARD)}, "2.1": {"content": 3}, "x": "y"}
    assert ms.field_texts("soaw", "sections", sections) == [span("card", CARD)]
    assert ms.field_texts("soaw", "sections", None) == []
    assert ms.field_texts("adr", "decision", "<p>a</p>") == ["<p>a</p>"]
    assert ms.field_texts("adr", "decision", None) == []
    assert ms.map_field("adr", "a", str.upper) == "A"
    assert ms.map_field("adr", None, str.upper) is None
    assert ms.map_field("soaw", {"1": {"content": "a"}}, str.upper) == {"1": {"content": "A"}}
    payload = {
        "context": span("card", CARD),
        "decision": span("decision", OTHER) + span("card", CARD),
        "title": span("card", DOC),
    }
    assert ms.mentions_of("adr", payload) == {("card", CARD), ("decision", OTHER)}
    assert ms.has_marker("adr", payload) is True
    assert ms.has_marker("adr", {"title": span("card", DOC), "decision": "<p/>"}) is False
    assert ms.mentions_of("soaw", {"sections": sections}) == {("card", CARD)}
    assert ms.has_marker("soaw", {"sections": sections}) is True
    assert ms.has_marker("soaw", {"name": span("card", CARD)}) is False


def test_stored_mentions():
    class Row:
        context = span("card", CARD)
        decision = None
        consequences = span("decision", OTHER)
        alternatives_considered = "<p/>"

    assert ms.stored_mentions("adr", Row()) == {("card", CARD), ("decision", OTHER)}
    assert ms.stored_mentions("adr", None) == set()


# --- spans outside the grammar: canonical on write, never the writer's label on read ---


def test_canonicalise_turns_a_span_outside_the_grammar_into_its_mention():
    sq = f"<p><span data-type='mention' data-kind='card' data-id='{CARD}'>@A</span></p>"
    assert ms.canonicalise(sq, ms.DOCUMENT_KINDS) == f"<p>{span('card', CARD)}</p>"


def test_canonicalising_twice_stores_identical_text():
    assembled = (
        '<p><sp<span data-type="mention" data-kind="zz"></span>an data-type="mention" '
        f'data-kind="card" data-id="{CARD}" data-archived="true">Fake name</span></p>'
    )
    once = ms.canonicalise(assembled, ms.DOCUMENT_KINDS)
    assert ms.canonicalise(once, ms.DOCUMENT_KINDS) == once
    assert "Fake name" not in once
    # Reading the raw text never splices the label back into a span either.
    read = ms.render(assembled, _resolver({("card", CARD): ms.restricted("ab12cd34")}))
    assert read == (
        '<p><span data-type="mention" data-kind="card" data-restricted="true" '
        'data-token="ab12cd34"></span></p>'
    )


def test_render_never_returns_the_writers_label_for_a_span_outside_the_grammar():
    sq = f"<p><SPAN data-type='mention' data-kind='card' data-id='{CARD}'>@Fake</SPAN></p>"
    out = ms.render(sq, _resolver({("card", CARD): ms.resolved("@CRM")}))
    assert out == f'<p><span data-type="mention" data-kind="card" data-id="{CARD}">@CRM</span></p>'
    hidden = ms.render(sq, _resolver({("card", CARD): ms.restricted("ab12cd34")}))
    assert hidden == (
        '<p><span data-type="mention" data-kind="card" data-restricted="true" '
        'data-token="ab12cd34"></span></p>'
    )
    assert ms.mentions_of("adr", {"context": sq}) == {("card", CARD)}
    assert ms.has_marker("adr", {"context": sq}) is True


def test_canonicalise_and_render_take_linear_time_on_hostile_markup():
    started = time.perf_counter()
    ms.canonicalise("<span" * 60000 + ' data-type="mention" ', ms.DOCUMENT_KINDS)
    ms.canonicalise("<span " * 50000 + 'data-type="mention"', ms.DOCUMENT_KINDS)
    ms.render('<span data-type="mention">' * 4000, _resolver({}))
    ms.escaped_text("<" * 100000)
    assert time.perf_counter() - started < 2.0
