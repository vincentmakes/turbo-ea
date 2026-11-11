"""The discussion and history tools of decisions and SoAWs.

``get_document_discussion`` (``GET /{adr|soaw}/{id}/comments``, each body also
as plain ``text``), ``get_document_history`` (``GET …/history``, the timeline
only) and the write tool ``add_document_comment`` (plain text escaped into
``<p>`` paragraphs; the preview reads the discussion before its dry-run batch;
the commit posts inside a mutation batch and maps every refusal). Also the
pure ``text_render.html_to_text`` they rely on.
"""

from __future__ import annotations

import json
from contextlib import ExitStack
from unittest.mock import patch

import httpx
import pytest

from turbo_ea_mcp import server, text_render
from turbo_ea_mcp.text_render import html_to_text, mention_text

DOC_ID = "11111111-1111-1111-1111-111111111111"
THREAD_ID = "22222222-2222-2222-2222-222222222222"
REPLY_ID = "33333333-3333-3333-3333-333333333333"
NEW_REPLY_ID = "44444444-4444-4444-4444-444444444444"

CARD_SPAN = '<span data-type="mention" data-kind="card" data-id="{id}">@CRM</span>'.format(
    id="55555555-5555-5555-5555-555555555555"
)
RESTRICTED_SPAN = (
    '<span data-type="mention" data-kind="card" data-restricted="true" '
    'data-token="ab12cd34"></span>'
)
MISSING_SPAN = (
    '<span data-type="mention" data-kind="card" '
    'data-id="66666666-6666-6666-6666-666666666666" data-missing="true"></span>'
)


@pytest.fixture
def fake_token(monkeypatch):
    monkeypatch.setattr(server, "_stdio_token", "test-token")
    yield "test-token"


def _parse(s: str):
    return json.loads(s)


def _http_error(status: int, detail: object) -> httpx.HTTPStatusError:
    request = httpx.Request("POST", "http://backend/api/v1/adr")
    response = httpx.Response(status, json={"detail": detail}, request=request)
    return httpx.HTTPStatusError(f"{status} error", request=request, response=response)


class _Backend:
    """Records every call (method, path, params or body, the client's batch
    id). The batch routes answer as the backend does; ``get`` answers
    ``get_answer`` (or raises it), the comment POST answers ``post_answer``
    (or raises it)."""

    def __init__(self, *, get_answer=None, post_answer=None) -> None:
        self.calls: list[tuple[str, str, object, str | None]] = []
        self.get_answer = get_answer
        self.post_answer = post_answer

    async def _get(self, client, path, params=None):
        self.calls.append(("get", path, params, client._batch_id))
        if isinstance(self.get_answer, Exception):
            raise self.get_answer
        return self.get_answer

    async def _post(self, client, path, json=None):
        self.calls.append(("post", path, json, client._batch_id))
        if path == "/mutation-batches/B-1/commit":
            return {"id": "B-1", "committed_at": "now"}
        if path.startswith("/mutation-batches"):
            return {"id": "B-1", "dry_run": (json or {}).get("dry_run")}
        if isinstance(self.post_answer, Exception):
            raise self.post_answer
        return self.post_answer

    async def run(self, coro_factory):
        with ExitStack() as stack:
            for name, fn in (("get", self._get), ("post", self._post)):
                stack.enter_context(
                    patch.object(server.TurboEAClient, name, autospec=True, side_effect=fn)
                )
            return _parse(await coro_factory())

    @property
    def batch_posts(self) -> list[tuple[str, object]]:
        return [(p, j) for m, p, j, _ in self.calls if m == "post" and "/mutation-batches" in p]

    @property
    def document_calls(self) -> list[tuple[str, str, object, str | None]]:
        return [c for c in self.calls if "/mutation-batches" not in c[1]]


def _open(dry_run: bool) -> tuple[str, dict]:
    return (
        "/mutation-batches?row_count=1",
        {"tool_name": "add_document_comment", "dry_run": dry_run},
    )


def _close(summary: dict) -> tuple[str, dict]:
    return ("/mutation-batches/B-1/commit", {"summary": summary})


# ── text_render ─────────────────────────────────────────────────────────────


class TestHtmlToText:
    def test_paragraphs_are_separated_by_a_blank_line(self):
        html = "<p>Hello <strong>world</strong></p><p>Second</p>"
        assert html_to_text(html) == "Hello world\n\nSecond"

    def test_a_line_break_stays_a_line_break(self):
        assert html_to_text("<p>a<br>b</p>") == "a\nb"
        assert html_to_text("<p>a<br/>b</p>") == "a\nb"

    def test_bullet_lists_nest_with_indentation(self):
        html = "<ul><li><p>one</p></li><li><p>two</p><ul><li>nested</li></ul></li></ul><p>after</p>"
        assert html_to_text(html) == "- one\n- two\n  - nested\n\nafter"

    def test_a_second_paragraph_in_an_item_is_indented_under_it(self):
        assert html_to_text("<ul><li><p>a</p><p>b</p></li></ul>") == "- a\n  b"

    def test_ordered_lists_are_numbered(self):
        assert html_to_text("<ol><li>x</li><li>y</li><li>z</li></ol>") == "1. x\n2. y\n3. z"

    def test_an_item_outside_a_list_is_a_bullet(self):
        assert html_to_text("<li>loose</li>") == "- loose"

    def test_a_quote_is_prefixed(self):
        html = "<blockquote><p>quoted</p><p>more</p></blockquote><p>end</p>"
        assert html_to_text(html) == "> quoted\n\n> more\n\nend"

    def test_a_link_shows_its_target_after_its_text(self):
        assert html_to_text('<p>See <a href="https://x.org/a">docs</a>.</p>') == (
            "See docs (https://x.org/a)."
        )

    def test_a_link_whose_text_is_its_target_is_not_repeated(self):
        assert html_to_text('<a href="https://y.org">https://y.org</a>') == "https://y.org"
        assert html_to_text('<a href="mailto:a@b.co">a@b.co</a>') == "a@b.co"

    def test_an_empty_link_shows_its_target(self):
        assert html_to_text('<p>go <a href="https://z.org"></a></p>') == "go https://z.org"

    def test_an_unsafe_link_target_is_never_shown(self):
        assert html_to_text('<a href="javascript:alert(1)">bad</a>') == "bad"
        assert html_to_text("<a>plain</a>") == "plain"

    def test_entities_are_read(self):
        assert html_to_text("<p>x &lt;y&gt; &amp; &quot;z&quot; &#65;&#x42;</p>") == (
            'x <y> & "z" AB'
        )

    def test_nested_inline_tags_keep_their_text(self):
        assert html_to_text("<p><em><strong>deep</strong> text</em> <s>gone</s></p>") == (
            "deep text gone"
        )

    def test_whitespace_collapses_outside_pre(self):
        assert html_to_text("<p>  a \n\t b  </p>") == "a b"
        assert html_to_text("<pre>a  b\n c</pre>") == "a  b\n c"

    def test_table_cells_are_spaced(self):
        assert html_to_text("<table><tr><td>a</td><td>b</td></tr></table>") == "a b"

    def test_a_resolved_card_mention_reads_as_its_label(self):
        assert html_to_text(f"<p>Use {CARD_SPAN} now</p>") == "Use @CRM now"

    def test_a_restricted_mention_reads_restricted(self):
        assert html_to_text(f"<p>Use {RESTRICTED_SPAN} now</p>") == "Use [restricted] now"

    def test_a_missing_mention_reads_deleted(self):
        assert html_to_text(f"<p>Use {MISSING_SPAN} now</p>") == "Use [deleted] now"

    def test_a_decision_label_gains_an_at_sign(self):
        span = (
            '<span data-type="mention" data-kind="decision" '
            'data-id="77777777-7777-7777-7777-777777777777">ADR-012 · Rev 2 Cloud</span>'
        )
        assert html_to_text(span) == "@ADR-012 · Rev 2 Cloud"

    def test_markup_inside_a_mention_is_its_label(self):
        span = (
            '<span data-type="mention" data-kind="card" data-id="x">'
            "<span>@<b>Big</b></span>  name</span> tail"
        )
        assert html_to_text(span) == "@Big name tail"

    def test_an_unclosed_mention_is_still_written(self):
        assert html_to_text('a <span data-type="mention" data-kind="user" data-id="x">@Ann') == (
            "a @Ann"
        )

    def test_a_plain_span_is_just_text(self):
        assert html_to_text('<span class="x">hi</span>') == "hi"

    def test_scripts_and_styles_are_dropped_with_their_content(self):
        html = "<script>alert(1)</script><style>p{color:red}</style><p>ok</p>"
        assert html_to_text(html) == "ok"
        assert html_to_text("<template><p>no</p></template>yes") == "yes"

    def test_markup_never_survives_as_markup(self):
        assert html_to_text('<img src=x onerror="alert(1)"><p>t</p>') == "t"
        assert html_to_text("&lt;script&gt;") == "<script>"

    def test_deep_nesting_stays_bounded(self):
        out = html_to_text("<ul>" * 3000 + "<li>deep" + "<blockquote>" * 3000 + "q")
        assert out.startswith("- deep")
        assert len(out) < 200

    def test_unclosed_and_stray_tags_do_not_fail(self):
        assert html_to_text("<p>unclosed <b>bold") == "unclosed bold"
        assert html_to_text("</ul></blockquote></pre></a>text") == "text"
        assert html_to_text("<![if foo") == ""

    def test_anything_but_a_string_is_empty(self):
        assert html_to_text(None) == ""
        assert html_to_text(42) == ""
        assert html_to_text("") == ""

    def test_parser_failure_falls_back_to_stripping_tags(self, monkeypatch):
        def broken(self, data):
            raise AssertionError("parser gave up")

        monkeypatch.setattr(text_render._Renderer, "feed", broken)
        assert html_to_text("<p>a &amp;  b</p><p>c</p>") == "a & b c"


class TestMentionText:
    def test_states(self):
        assert mention_text({"data-restricted": "true"}, "@x") == "[restricted]"
        assert mention_text({"data-missing": "true"}, "@x") == "[deleted]"
        assert mention_text({}, "  ") == "[mention]"
        assert mention_text({}, "@CRM") == "@CRM"
        assert mention_text({}, "Plain") == "@Plain"
        assert mention_text({"data-archived": "true"}, "@Old") == "@Old (archived)"

    def test_restricted_wins_over_a_label(self):
        assert mention_text({"data-restricted": "true", "data-missing": "true"}, "@x") == (
            "[restricted]"
        )


# ── get_document_discussion ─────────────────────────────────────────────────


def _discussion():
    return {
        "can": {"comment": True, "moderate": False},
        "open_count": 1,
        "threads": [
            {
                "id": THREAD_ID,
                "kind": "comment",
                "body": f"<p>Ask {CARD_SPAN}</p>",
                "replies": [
                    {"id": REPLY_ID, "body": f"<p>{RESTRICTED_SPAN} and {MISSING_SPAN}</p>"}
                ],
            },
            {"id": "t2", "kind": "rejection", "body": "", "replies": []},
        ],
    }


class TestGetDocumentDiscussion:
    @pytest.mark.asyncio
    @pytest.mark.parametrize("document_type", ["adr", "soaw"])
    @pytest.mark.parametrize(
        ("earlier", "scope"), [(False, "document"), (True, "chain")], ids=["document", "chain"]
    )
    async def test_reads_the_comments_route(self, fake_token, document_type, earlier, scope):
        backend = _Backend(get_answer=_discussion())
        data = await backend.run(
            lambda: server.get_document_discussion(
                document_type, DOC_ID, include_earlier_revisions=earlier
            )
        )
        assert backend.calls == [
            ("get", f"/{document_type}/{DOC_ID}/comments", {"scope": scope}, None)
        ]
        assert data["open_count"] == 1

    @pytest.mark.asyncio
    async def test_each_body_is_also_given_as_text(self, fake_token):
        backend = _Backend(get_answer=_discussion())
        data = await backend.run(lambda: server.get_document_discussion("adr", DOC_ID))
        first, second = data["threads"]
        assert first["body"] == f"<p>Ask {CARD_SPAN}</p>"
        assert first["text"] == "Ask @CRM"
        assert first["replies"][0]["body"] == f"<p>{RESTRICTED_SPAN} and {MISSING_SPAN}</p>"
        assert first["replies"][0]["text"] == "[restricted] and [deleted]"
        assert second["text"] == ""

    @pytest.mark.asyncio
    async def test_an_upper_case_id_is_sent_lower_case(self, fake_token):
        backend = _Backend(get_answer={"threads": []})
        await backend.run(lambda: server.get_document_discussion("soaw", DOC_ID.upper()))
        assert backend.calls[0][1] == f"/soaw/{DOC_ID}/comments"

    @pytest.mark.asyncio
    async def test_odd_threads_are_passed_through(self, fake_token):
        answer = {"threads": ["x", {"id": "t", "body": "<p>b</p>", "replies": ["y"]}]}
        backend = _Backend(get_answer=answer)
        data = await backend.run(lambda: server.get_document_discussion("adr", DOC_ID))
        assert data["threads"] == [
            "x",
            {"id": "t", "body": "<p>b</p>", "replies": ["y"], "text": "b"},
        ]

    @pytest.mark.asyncio
    async def test_an_unknown_document_type_lists_both(self, fake_token):
        backend = _Backend(get_answer={})
        data = await backend.run(lambda: server.get_document_discussion("card", DOC_ID))
        assert data["error"] == "unknown_document_type"
        assert data["document_type"] == "card"
        assert data["allowed"] == ["adr", "soaw"]
        assert '"adr"' in data["message"] and '"soaw"' in data["message"]
        assert backend.calls == []

    @pytest.mark.asyncio
    @pytest.mark.parametrize("bad", ["not-a-uuid", "", "../users"])
    async def test_a_malformed_id_is_refused(self, fake_token, bad):
        backend = _Backend(get_answer={})
        data = await backend.run(lambda: server.get_document_discussion("soaw", bad))
        assert data["error"] == "invalid_document_id"
        assert data["document_id"] == bad
        assert "list_soaws" in data["message"]
        assert backend.calls == []

    @pytest.mark.asyncio
    async def test_a_forbidden_read_is_explained(self, fake_token):
        backend = _Backend(get_answer=_http_error(403, "Insufficient permissions"))
        data = await backend.run(lambda: server.get_document_discussion("soaw", DOC_ID))
        assert data["error"] == "forbidden"
        assert data["detail"] == "Insufficient permissions"
        assert "soaw.view" in data["message"]

    @pytest.mark.asyncio
    async def test_an_unknown_document_is_not_found(self, fake_token):
        backend = _Backend(get_answer=_http_error(404, "Architecture decision not found"))
        data = await backend.run(lambda: server.get_document_discussion("adr", DOC_ID))
        assert data["error"] == "document_not_found"
        assert data["message"] == "No decision has this id."

    @pytest.mark.asyncio
    async def test_another_error_is_raised(self, fake_token):
        backend = _Backend(get_answer=_http_error(500, "boom"))
        with pytest.raises(httpx.HTTPStatusError):
            await backend.run(lambda: server.get_document_discussion("adr", DOC_ID))

    @pytest.mark.asyncio
    async def test_needs_a_token(self, monkeypatch):
        monkeypatch.setattr(server, "_stdio_token", None)
        out = await server.get_document_discussion("adr", DOC_ID)
        assert out == "Error: Not authenticated. Please reconnect."


# ── get_document_history ────────────────────────────────────────────────────


class TestGetDocumentHistory:
    @pytest.mark.asyncio
    @pytest.mark.parametrize("document_type", ["adr", "soaw"])
    async def test_reads_the_history_route_with_its_page(self, fake_token, document_type):
        answer = {"can_view_versions": False, "can_restore": False, "total": 1, "entries": []}
        backend = _Backend(get_answer=answer)
        data = await backend.run(
            lambda: server.get_document_history(document_type, DOC_ID, page=2, page_size=10)
        )
        assert backend.calls == [
            ("get", f"/{document_type}/{DOC_ID}/history", {"page": 2, "page_size": 10}, None)
        ]
        assert data == answer

    @pytest.mark.asyncio
    async def test_the_defaults_are_page_one_of_fifty(self, fake_token):
        backend = _Backend(get_answer={"entries": []})
        await backend.run(lambda: server.get_document_history("adr", DOC_ID))
        assert backend.calls[0][2] == {"page": 1, "page_size": 50}

    @pytest.mark.asyncio
    @pytest.mark.parametrize(("page", "size"), [(0, 50), (1, 0), (1, 201), (-1, 10)])
    async def test_a_page_out_of_range_is_refused(self, fake_token, page, size):
        backend = _Backend(get_answer={})
        data = await backend.run(lambda: server.get_document_history("adr", DOC_ID, page, size))
        assert data["error"] == "invalid_page"
        assert "between 1 and 200" in data["message"]
        assert backend.calls == []

    @pytest.mark.asyncio
    async def test_the_largest_page_is_accepted(self, fake_token):
        backend = _Backend(get_answer={"entries": []})
        await backend.run(lambda: server.get_document_history("soaw", DOC_ID, 1, 200))
        assert backend.calls[0][2] == {"page": 1, "page_size": 200}

    @pytest.mark.asyncio
    async def test_the_document_is_validated(self, fake_token):
        backend = _Backend(get_answer={})
        bad_type = await backend.run(lambda: server.get_document_history("risk", DOC_ID))
        bad_id = await backend.run(lambda: server.get_document_history("adr", "x"))
        assert bad_type["error"] == "unknown_document_type"
        assert bad_id["error"] == "invalid_document_id"
        assert "list_adrs" in bad_id["message"]
        assert backend.calls == []

    @pytest.mark.asyncio
    async def test_refusals_are_mapped(self, fake_token):
        backend = _Backend(get_answer=_http_error(404, "Statement of Architecture Work not found"))
        data = await backend.run(lambda: server.get_document_history("soaw", DOC_ID))
        assert data["error"] == "document_not_found"
        assert data["message"] == "No Statement of Architecture Work has this id."

    @pytest.mark.asyncio
    async def test_another_error_is_raised(self, fake_token):
        backend = _Backend(get_answer=_http_error(502, "down"))
        with pytest.raises(httpx.HTTPStatusError):
            await backend.run(lambda: server.get_document_history("soaw", DOC_ID))

    @pytest.mark.asyncio
    async def test_needs_a_token(self, monkeypatch):
        monkeypatch.setattr(server, "_stdio_token", None)
        out = await server.get_document_history("adr", DOC_ID)
        assert out == "Error: Not authenticated. Please reconnect."

    def test_the_docstring_says_versions_are_web_only(self):
        doc = server.get_document_history.__doc__
        assert "timeline only" in doc
        assert "web UI" in doc

    def test_the_docstring_gives_the_order_the_api_returns(self):
        # The history route orders by ``seq`` descending: newest first.
        doc = server.get_document_history.__doc__
        assert "NEWEST FIRST" in doc
        assert "in the order they happened" not in doc


# ── add_document_comment: the body ──────────────────────────────────────────


class TestPlainCommentHtml:
    def test_paragraphs_and_line_breaks(self):
        assert server._plain_comment_html("one\ntwo\n\nthree") == "<p>one<br>two</p><p>three</p>"

    def test_markup_is_escaped(self):
        assert (
            server._plain_comment_html('<b>x</b> & "q"') == '<p>&lt;b&gt;x&lt;/b&gt; &amp; "q"</p>'
        )

    def test_a_mention_span_is_escaped_too(self):
        assert server._plain_comment_html(CARD_SPAN).startswith("<p>&lt;span data-type=")

    def test_windows_newlines_and_blank_runs(self):
        assert server._plain_comment_html("a\r\nb\r\n \r\n\r\n\rc") == "<p>a<br>b</p><p>c</p>"

    def test_blank_text_is_empty(self):
        assert server._plain_comment_html(" \n\t\n\n ") == ""


# ── add_document_comment: validation (identical on preview and commit) ─────


def _comment(**kw):
    args = {"document_type": "adr", "document_id": DOC_ID, "body": "hi", **kw}
    return lambda: server.add_document_comment(**args)


@pytest.mark.parametrize("dry_run", [True, False], ids=["preview", "commit"])
class TestAddDocumentCommentValidation:
    @pytest.mark.asyncio
    @pytest.mark.parametrize(
        ("kw", "error"),
        [
            ({"document_type": "risk"}, "unknown_document_type"),
            ({"document_id": "nope"}, "invalid_document_id"),
            ({"body": "  \n\n "}, "empty_body"),
            ({"body": "<" * 5000}, "body_too_long"),
            ({"parent_id": "nope"}, "invalid_parent_id"),
            ({"parent_id": THREAD_ID, "section": "context"}, "section_on_reply"),
            ({"section": "risks"}, "unknown_section"),
            ({"document_type": "soaw", "section": "Intro"}, "unknown_section"),
            ({"document_type": "soaw", "section": "a b"}, "unknown_section"),
            ({"document_type": "soaw", "section": "x" * 65}, "unknown_section"),
        ],
    )
    async def test_refused_before_any_call(self, fake_token, dry_run, kw, error):
        backend = _Backend(get_answer=_discussion(), post_answer={})
        data = await backend.run(_comment(dry_run=dry_run, **kw))
        assert data["error"] == error
        assert backend.calls == []

    @pytest.mark.asyncio
    async def test_too_long_counts_the_converted_html(self, fake_token, dry_run):
        backend = _Backend(get_answer=_discussion(), post_answer={})
        data = await backend.run(_comment(dry_run=dry_run, body="<" * 5000))
        assert data["length"] == 20_007
        assert data["max_length"] == 20_000

    @pytest.mark.asyncio
    async def test_a_decision_section_lists_the_allowed_ones(self, fake_token, dry_run):
        backend = _Backend(get_answer=_discussion(), post_answer={})
        data = await backend.run(_comment(dry_run=dry_run, section="risks"))
        assert data["allowed"] == [
            "general",
            "context",
            "decision",
            "consequences",
            "alternatives_considered",
        ]

    @pytest.mark.asyncio
    async def test_writes_disabled(self, fake_token, dry_run, monkeypatch):
        monkeypatch.setattr(server, "MCP_WRITES_ENABLED", False)
        backend = _Backend(get_answer=_discussion(), post_answer={})
        data = await backend.run(_comment(dry_run=dry_run))
        assert data["error"] == "writes_disabled"
        assert backend.calls == []


class TestAddDocumentCommentAccepted:
    @pytest.mark.asyncio
    @pytest.mark.parametrize(
        ("document_type", "section"),
        [
            ("adr", "general"),
            ("adr", "alternatives_considered"),
            ("soaw", "1.1"),
            ("soaw", "custom_3"),
            ("soaw", "general"),
            ("soaw", "x" * 64),
        ],
    )
    async def test_a_valid_section_reaches_the_backend(self, fake_token, document_type, section):
        backend = _Backend(post_answer={"id": THREAD_ID, "replies": []})
        await backend.run(_comment(document_type=document_type, section=section, dry_run=False))
        (call,) = backend.document_calls
        assert call[2] == {"body": "<p>hi</p>", "section": section}

    @pytest.mark.asyncio
    async def test_the_longest_body_is_accepted(self, fake_token):
        backend = _Backend(post_answer={"id": THREAD_ID})
        await backend.run(_comment(body="a" * 19_993, dry_run=False))
        (call,) = backend.document_calls
        assert len(call[2]["body"]) == 20_000


# ── add_document_comment: the preview ───────────────────────────────────────


class TestAddDocumentCommentPreview:
    @pytest.mark.asyncio
    @pytest.mark.parametrize("document_type", ["adr", "soaw"])
    async def test_reads_the_discussion_then_records_a_dry_run(self, fake_token, document_type):
        backend = _Backend(get_answer=_discussion())
        data = await backend.run(
            _comment(document_type=document_type, body="Looks good\nto me", section="general")
        )
        path = f"/{document_type}/{DOC_ID}/comments"
        # The read comes first, outside the batch; nothing is posted.
        assert backend.calls[0] == ("get", path, {"scope": "document"}, None)
        assert backend.document_calls == [("get", path, {"scope": "document"}, None)]
        assert backend.batch_posts == [
            _open(True),
            _close({"document_id": DOC_ID, "status": "previewed"}),
        ]
        assert data == {
            "dry_run": True,
            "document_type": document_type,
            "can": {"comment": True, "moderate": False},
            "would_comment": {
                "path": path,
                "body": {"body": "<p>Looks good<br>to me</p>", "section": "general"},
            },
            "document_id": DOC_ID,
            "batch_id": "B-1",
        }

    @pytest.mark.asyncio
    async def test_reports_that_the_caller_may_not_comment(self, fake_token):
        answer = {"can": {"comment": False, "moderate": False}, "threads": []}
        backend = _Backend(get_answer=answer)
        data = await backend.run(_comment(document_type="soaw"))
        assert data["can"] == {"comment": False, "moderate": False}
        assert data["would_refuse"]["error"] == "cannot_comment"
        assert "soaw.comment" in data["would_refuse"]["message"]
        assert "would_comment" not in data
        assert backend.batch_posts[-1] == _close({"document_id": DOC_ID, "status": "refused"})

    @pytest.mark.asyncio
    async def test_a_discussion_without_rights_reads_as_no_rights(self, fake_token):
        backend = _Backend(get_answer={"can": {"comment": "yes"}})
        data = await backend.run(_comment())
        assert data["can"] == {"comment": False, "moderate": False}
        assert data["would_refuse"]["error"] == "cannot_comment"

    @pytest.mark.asyncio
    async def test_a_reply_to_a_thread_of_the_document(self, fake_token):
        backend = _Backend(get_answer=_discussion())
        data = await backend.run(_comment(parent_id=THREAD_ID.upper()))
        assert data["would_comment"]["body"] == {"body": "<p>hi</p>", "parent_id": THREAD_ID}

    @pytest.mark.asyncio
    @pytest.mark.parametrize(
        "parent", [REPLY_ID, NEW_REPLY_ID], ids=["a-reply", "another-document"]
    )
    async def test_a_reply_to_anything_but_a_thread_here_is_refused(self, fake_token, parent):
        backend = _Backend(get_answer=_discussion())
        data = await backend.run(_comment(parent_id=parent))
        assert data["would_refuse"]["error"] == "invalid_parent"
        assert data["would_refuse"]["parent_id"] == parent
        assert "would_comment" not in data
        assert backend.batch_posts[-1] == _close({"document_id": DOC_ID, "status": "refused"})

    @pytest.mark.asyncio
    async def test_an_unknown_document_is_refused_without_a_batch(self, fake_token):
        backend = _Backend(get_answer=_http_error(404, "Architecture decision not found"))
        data = await backend.run(_comment())
        assert data["error"] == "document_not_found"
        assert data["document_id"] == DOC_ID
        assert backend.batch_posts == []

    @pytest.mark.asyncio
    async def test_another_lookup_error_is_raised(self, fake_token):
        backend = _Backend(get_answer=_http_error(500, "boom"))
        with pytest.raises(httpx.HTTPStatusError):
            await backend.run(_comment())
        assert backend.batch_posts == []


# ── add_document_comment: the commit ────────────────────────────────────────


class TestAddDocumentCommentCommit:
    @pytest.mark.asyncio
    @pytest.mark.parametrize("document_type", ["adr", "soaw"])
    async def test_posts_a_thread_inside_a_batch(self, fake_token, document_type):
        thread = {
            "id": THREAD_ID,
            "body": f"<p>see {CARD_SPAN}</p>",
            "replies": [],
            "unnotified_mentions": [{"id": "u1", "display_name": "Ann"}],
        }
        backend = _Backend(post_answer=thread)
        data = await backend.run(
            _comment(document_type=document_type, body="a & <b>", dry_run=False)
        )
        path = f"/{document_type}/{DOC_ID}/comments"
        assert backend.calls == [
            ("post", "/mutation-batches?row_count=1", _open(False)[1], None),
            ("post", path, {"body": "<p>a &amp; &lt;b&gt;</p>"}, "B-1"),
            (
                "post",
                "/mutation-batches/B-1/commit",
                {"summary": {"document_id": DOC_ID, "comment_id": THREAD_ID}},
                None,
            ),
        ]
        assert data["thread_id"] == THREAD_ID
        assert data["comment_id"] == THREAD_ID
        assert data["unnotified_mentions"] == [{"id": "u1", "display_name": "Ann"}]
        assert data["thread"]["text"] == "see @CRM"
        assert data["document_type"] == document_type
        assert data["document_id"] == DOC_ID
        assert data["batch_id"] == "B-1"

    @pytest.mark.asyncio
    async def test_a_reply_reports_its_own_id(self, fake_token):
        thread = {
            "id": THREAD_ID,
            "body": "<p>q</p>",
            "replies": [
                {"id": REPLY_ID, "body": "<p>a</p>"},
                {"id": NEW_REPLY_ID, "body": "<p>b</p>"},
            ],
            "unnotified_mentions": [],
        }
        backend = _Backend(post_answer=thread)
        data = await backend.run(_comment(parent_id=THREAD_ID, dry_run=False))
        (call,) = backend.document_calls
        assert call[2] == {"body": "<p>hi</p>", "parent_id": THREAD_ID}
        assert data["thread_id"] == THREAD_ID
        assert data["comment_id"] == NEW_REPLY_ID
        assert data["thread"]["replies"][1]["text"] == "b"
        assert backend.batch_posts[-1] == _close(
            {"document_id": DOC_ID, "comment_id": NEW_REPLY_ID}
        )

    @pytest.mark.asyncio
    async def test_no_unnotified_mentions_is_an_empty_list(self, fake_token):
        backend = _Backend(post_answer={"id": THREAD_ID})
        data = await backend.run(_comment(dry_run=False))
        assert data["unnotified_mentions"] == []

    @pytest.mark.asyncio
    @pytest.mark.parametrize(
        ("status", "detail", "error"),
        [
            (403, "You may not comment on this document", "cannot_comment"),
            (403, "Insufficient permissions", "forbidden"),
            (400, "A comment needs some text", "empty_body"),
            (400, "Unknown section", "unknown_section"),
            (400, "A comment is longer than 20000 characters", "body_too_long"),
            (400, "A reply must answer a thread of this document", "invalid_parent"),
            (400, "Something else", "rejected"),
            (404, "Card not found", "mention_refused"),
            (404, "Decision not found", "mention_refused"),
            (404, "User not found", "mention_refused"),
            (404, "Architecture decision not found", "document_not_found"),
        ],
    )
    async def test_each_refusal_is_mapped(self, fake_token, status, detail, error):
        backend = _Backend(post_answer=_http_error(status, detail))
        data = await backend.run(_comment(dry_run=False))
        assert data["error"] == error
        assert data["detail"] == detail
        assert data["document_id"] == DOC_ID
        assert data["batch_id"] == "B-1"
        assert backend.batch_posts[-1] == _close(
            {"document_id": DOC_ID, "status": "refused", "error": error}
        )

    @pytest.mark.asyncio
    async def test_the_refusal_messages(self, fake_token):
        cases = {
            (403, "You may not comment on this document"): "adr.comment",
            (400, "Unknown section"): "Unknown section",
            (404, "Card not found"): "was not posted",
        }
        for (status, detail), needle in cases.items():
            backend = _Backend(post_answer=_http_error(status, detail))
            data = await backend.run(_comment(dry_run=False))
            assert needle in data["message"], data

    @pytest.mark.asyncio
    async def test_a_400_without_text_has_a_message(self, fake_token):
        backend = _Backend(post_answer=_http_error(400, {"x": 1}))
        data = await backend.run(_comment(dry_run=False))
        assert data["error"] == "rejected"
        assert data["message"] == "The comment was refused."

    @pytest.mark.asyncio
    async def test_another_error_is_raised_and_the_batch_closed(self, fake_token):
        backend = _Backend(post_answer=_http_error(500, "boom"))
        with pytest.raises(httpx.HTTPStatusError):
            await backend.run(_comment(dry_run=False))
        assert backend.batch_posts[-1][0] == "/mutation-batches/B-1/commit"
        assert backend.batch_posts[-1][1]["summary"]["status"] == "errored"


class TestDocstrings:
    def test_the_comment_tool_explains_its_limits(self):
        doc = server.add_document_comment.__doc__
        assert "plain text" in doc
        assert "web UI only" in doc
        assert "rollback_batch" in doc
        assert "rejection" in doc and "sign_note" in doc

    def test_the_decision_tools_explain_mentions(self):
        assert 'data-type="mention"' in server.get_adr.__doc__
        assert "open_thread_count" in server.get_adr.__doc__
        assert "404" in server.update_adr.__doc__
        assert "get_document_discussion" in server.list_soaws.__doc__


# ── the helpers' exact answers ──────────────────────────────────────────────


class TestDocumentHelperAnswers:
    def test_an_unknown_document_type(self):
        assert server._document_problem("risk", DOC_ID) == {
            "error": "unknown_document_type",
            "document_type": "risk",
            "allowed": ["adr", "soaw"],
            "message": (
                'document_type is "adr" (an architecture decision) or "soaw" '
                "(a Statement of Architecture Work)."
            ),
        }

    def test_a_forbidden_read(self):
        exc = _http_error(403, "Insufficient permissions")
        assert server._document_read_refusal(exc, "soaw") == {
            "error": "forbidden",
            "detail": "Insufficient permissions",
            "message": "Reading a Statement of Architecture Work needs the soaw.view permission.",
        }

    def test_a_refused_comment_on_a_soaw(self):
        exc = _http_error(403, "You may not comment on this document")
        assert server._comment_refusal(exc, "soaw") == {
            "error": "cannot_comment",
            "detail": "You may not comment on this document",
            "message": (
                "You may not comment on this Statement of Architecture Work: it takes the "
                "soaw.comment permission or being a signatory of this revision."
            ),
        }

    def test_a_refused_mention(self):
        exc = _http_error(404, "User not found")
        assert server._comment_refusal(exc, "adr") == {
            "error": "mention_refused",
            "detail": "User not found",
            "message": (
                "The comment mentions something you cannot read or that does not exist, "
                "so it was not posted."
            ),
        }

    def test_a_reply_to_a_closed_thread(self):
        exc = _http_error(409, "This thread's first comment was deleted")
        assert server._comment_refusal(exc, "adr") == {
            "error": "thread_closed",
            "detail": "This thread's first comment was deleted",
            "message": (
                "This thread's first comment was deleted: the thread is closed and takes "
                "no reply. Start a new thread instead."
            ),
        }

    def test_another_conflict_is_not_answered(self):
        exc = _http_error(409, "Something else")
        assert server._comment_refusal(exc, "adr") is None

    def test_leading_spaces_and_x_of_a_block_are_kept(self):
        assert server._plain_comment_html("  a\nb  ") == "<p>  a<br>b  </p>"
        assert server._plain_comment_html("XML\nnoteX") == "<p>XML<br>noteX</p>"


class TestCommentProblem:
    def test_a_document_problem_comes_without_a_body(self):
        problem, html = server._comment_problem("risk", DOC_ID, "hi", "", "")
        assert problem is not None and problem["error"] == "unknown_document_type"
        assert html == ""

    def test_an_empty_body(self):
        assert server._comment_problem("adr", DOC_ID, " \n ", "", "") == (
            {"error": "empty_body", "message": "A comment needs some text."},
            "",
        )

    def test_a_body_that_is_not_text_is_empty(self):
        assert server._comment_problem("adr", DOC_ID, None, "", "") == (
            {"error": "empty_body", "message": "A comment needs some text."},
            "",
        )

    def test_a_body_too_long(self):
        problem, html = server._comment_problem("adr", DOC_ID, "<" * 5000, "", "")
        assert problem["message"] == (
            "The comment is 20007 characters once converted to HTML; "
            "the limit is 20000. Shorten it or split it into replies."
        )
        assert html == ""

    def test_a_malformed_parent(self):
        assert server._comment_problem("adr", DOC_ID, "hi", "", "nope") == (
            {
                "error": "invalid_parent_id",
                "parent_id": "nope",
                "message": "parent_id must be the UUID of a thread (see get_document_discussion).",
            },
            "",
        )

    def test_a_section_on_a_reply(self):
        assert server._comment_problem("adr", DOC_ID, "hi", "context", THREAD_ID) == (
            {
                "error": "section_on_reply",
                "message": "A reply takes its thread's section: leave section empty.",
            },
            "",
        )

    def test_an_unknown_decision_section(self):
        assert server._comment_problem("adr", DOC_ID, "hi", "risks", "") == (
            {
                "error": "unknown_section",
                "section": "risks",
                "allowed": [
                    "general",
                    "context",
                    "decision",
                    "consequences",
                    "alternatives_considered",
                ],
                "message": (
                    "A decision's thread is tagged to one of: general, context, decision, "
                    "consequences, alternatives_considered."
                ),
            },
            "",
        )

    def test_an_unknown_soaw_section(self):
        assert server._comment_problem("soaw", DOC_ID, "hi", "Intro", "") == (
            {
                "error": "unknown_section",
                "section": "Intro",
                "message": (
                    "A SoAW's thread is tagged to a section key such as 1.1 or "
                    "custom_3 (lower-case letters, digits, '_' and '.', at most 64), "
                    "or general."
                ),
            },
            "",
        )

    def test_a_valid_comment_comes_with_its_body(self):
        assert server._comment_problem("soaw", DOC_ID, "hi", "1.1", "") == (None, "<p>hi</p>")


class TestCommentPreview:
    def test_a_discussion_that_is_not_an_object_grants_nothing(self):
        refusal, rights = server._comment_preview(None, "adr", "")
        assert refusal["error"] == "cannot_comment"
        assert rights == {"comment": False, "moderate": False}

    def test_the_moderate_right_is_read(self):
        discussion = {"can": {"comment": True, "moderate": True}, "threads": []}
        assert server._comment_preview(discussion, "adr", "") == (
            None,
            {"comment": True, "moderate": True},
        )

    def test_a_reply_to_a_closed_thread(self):
        discussion = {
            "can": {"comment": True},
            "threads": [{"id": THREAD_ID, "deleted": True}],
        }
        assert server._comment_preview(discussion, "adr", THREAD_ID) == (
            {
                "error": "thread_closed",
                "parent_id": THREAD_ID,
                "message": (
                    "This thread's first comment was deleted: the thread is closed and "
                    "takes no reply. Start a new thread instead."
                ),
            },
            {"comment": True, "moderate": False},
        )

    def test_a_reply_to_a_live_thread(self):
        discussion = {
            "can": {"comment": True},
            "threads": [{"id": THREAD_ID, "deleted": False}],
        }
        assert server._comment_preview(discussion, "adr", THREAD_ID) == (
            None,
            {"comment": True, "moderate": False},
        )

    def test_a_reply_to_no_thread_here(self):
        discussion = {"can": {"comment": True}, "threads": [{"id": THREAD_ID}]}
        assert server._comment_preview(discussion, "adr", REPLY_ID) == (
            {
                "error": "invalid_parent",
                "parent_id": REPLY_ID,
                "message": (
                    "A reply must answer a thread of this document: parent_id is not "
                    "a top-level thread of this revision (a reply cannot be answered; "
                    "a thread of an earlier revision is answered on that revision's id)."
                ),
            },
            {"comment": True, "moderate": False},
        )
