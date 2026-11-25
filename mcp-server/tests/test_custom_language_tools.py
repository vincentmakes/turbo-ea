"""The custom-language tools: ``list_custom_languages`` and
``get_untranslated_strings`` (reads of ``GET /custom-locales…``) and
``submit_translations`` (``POST /custom-locales/{code}/strings`` with
``origin: "mcp"``, previewed by the backend's ``dry_run``), plus their plain
helpers."""

from __future__ import annotations

import json
from unittest.mock import AsyncMock, patch

import httpx
import pytest

from turbo_ea_mcp import server


@pytest.fixture
def fake_token(monkeypatch):
    monkeypatch.setattr(server, "_stdio_token", "test-token")
    yield "test-token"


def _parse(s: str):
    return json.loads(s)


def _http_error(status: int, detail: object) -> httpx.HTTPStatusError:
    request = httpx.Request("GET", "http://backend/api/v1/custom-locales")
    response = httpx.Response(status, json={"detail": detail}, request=request)
    return httpx.HTTPStatusError(f"{status} error", request=request, response=response)


INSTRUCTIONS_DUTCH = (
    'Translate every value under "strings" from English into Dutch. '
    "Keep the keys, the {{placeholders}}, any <tags> and $t(...) references "
    "exactly as they are, and add no markup or links of your own. Keep product "
    "terms (card, inventory, stakeholder, metamodel, relation, lifecycle) "
    "consistent with the earlier translations. Leave out a string you cannot "
    "translate rather than returning the English text."
)


# ── Plain helpers ───────────────────────────────────────────────────────────


class TestLocaleProblem:
    @pytest.mark.parametrize("code", ["nl", "fil", "pt-BR", "zh-TW"])
    def test_a_well_formed_code_passes(self, code):
        assert server._locale_problem(code) is None

    @pytest.mark.parametrize(
        "code", ["", "n", "NL", "abcd", "pt-br", "pt_BR", "nl-BRA", "nl/x", "../nl", " nl", 7, None]
    )
    def test_anything_else_is_refused_and_echoed(self, code):
        problem = server._locale_problem(code)
        assert problem["error"] == "invalid_locale"
        assert problem["locale"] == code
        assert problem["message"] == (
            "locale must be a custom language code such as 'nl' or 'pt-BR' "
            "(see list_custom_languages)."
        )

    @pytest.mark.parametrize("code", ["nl\n", "nl-BR\n", "xnl", "nl-BR-x"])
    def test_the_whole_code_must_match(self, code):
        # ``$`` would accept a trailing newline; ``fullmatch`` does not.
        assert server._locale_problem(code)["error"] == "invalid_locale"


class TestLocalePath:
    def test_builds_the_route_with_a_tail(self):
        assert server._locale_path("nl", "/strings") == "/custom-locales/nl/strings"

    def test_without_a_tail_it_is_the_detail_route(self):
        assert server._locale_path("pt-BR") == "/custom-locales/pt-BR"

    def test_the_code_is_one_path_segment(self):
        assert server._locale_path("a/b") == "/custom-locales/a%2Fb"


def test_instructions_name_the_language_and_keep_the_markers():
    assert server._translation_instructions("Dutch") == INSTRUCTIONS_DUTCH


class TestTranslationCount:
    def test_counts_every_string_across_namespaces(self):
        count, problem = server._translation_count(
            {"common": {"a": "1", "b": "2"}, "admin": {"c": "3"}}
        )
        assert (count, problem) == (3, None)

    @pytest.mark.parametrize("value", [{}, [], None, "x"])
    def test_nothing_to_submit_is_refused(self, value):
        count, problem = server._translation_count(value)
        assert count == 0
        assert problem == {
            "error": "no_translations",
            "message": "translations must be a non-empty {namespace: {key: text}} object.",
        }

    @pytest.mark.parametrize("keys", [{}, ["a"], "a", None])
    def test_a_namespace_without_keys_is_refused(self, keys):
        count, problem = server._translation_count({"common": {"a": "1"}, "admin": keys})
        assert count == 0
        assert problem == {
            "error": "invalid_translations",
            "message": "Each namespace must map one or more keys to their translation.",
            "namespace": "admin",
        }

    @pytest.mark.parametrize("value", [None, 3, ["x"], {"x": "y"}])
    def test_a_value_that_is_not_text_is_refused(self, value):
        count, problem = server._translation_count({"common": {"a": "1", "b": value}})
        assert count == 0
        assert problem["error"] == "invalid_translations"
        assert (problem["namespace"], problem["key"]) == ("common", "b")
        assert problem["message"] == (
            "Each translation must be text. To clear a translation, use the web app."
        )


class TestAcceptedKeys:
    def test_rejected_and_unknown_rows_are_left_out(self):
        translations = {"common": {"b": "1", "a": "2", "c": "3"}, "admin": {"x": "4"}}
        body = {
            "rejected": [{"namespace": "common", "key": "c", "reason": "too_long"}, "odd"],
            "unknown": [{"namespace": "admin", "key": "x"}],
        }
        assert server._accepted_keys(translations, body) == {"common": ["a", "b"]}

    def test_a_count_for_unknown_is_ignored(self):
        body = {"rejected": None, "unknown": 2}
        assert server._accepted_keys({"common": {"a": "1"}}, body) == {"common": ["a"]}

    def test_a_key_of_another_namespace_is_not_confused(self):
        body = {"rejected": [{"namespace": "admin", "key": "a", "reason": "empty"}]}
        assert server._accepted_keys({"common": {"a": "1"}}, body) == {"common": ["a"]}


# ── list_custom_languages ───────────────────────────────────────────────────


class TestListCustomLanguages:
    @pytest.mark.asyncio
    async def test_returns_the_backend_list(self, fake_token):
        rows = [{"code": "nl", "name": "Nederlands", "stats": {"total": 10, "missing": 4}}]
        get = AsyncMock(return_value=rows)
        with patch.object(server.TurboEAClient, "get", get):
            out = _parse(await server.list_custom_languages())
        get.assert_awaited_once_with("/custom-locales")
        assert out == rows

    @pytest.mark.asyncio
    async def test_a_refusal_is_reported(self, fake_token):
        get = AsyncMock(side_effect=_http_error(403, "Permission denied"))
        with patch.object(server.TurboEAClient, "get", get):
            out = _parse(await server.list_custom_languages())
        assert out == {
            "error": "custom_locales_refused",
            "http_status": 403,
            "detail": "Permission denied",
        }

    def test_requires_auth(self, monkeypatch):
        import asyncio

        monkeypatch.setattr(server, "_stdio_token", None)
        assert "Not authenticated" in asyncio.run(server.list_custom_languages())

    def test_is_read_only(self):
        tool = server.mcp._tool_manager._tools["list_custom_languages"]
        assert tool.annotations == server._READ_ANNOT


# ── get_untranslated_strings ────────────────────────────────────────────────

DETAIL = {"code": "nl", "name": "Nederlands", "english_name": "Dutch", "rtl": False}


class _Reads:
    def __init__(self, detail=None, page=None, error=None):
        self.detail = DETAIL if detail is None else detail
        self.page = page if page is not None else {"total": 0, "items": []}
        self.error = error
        self.calls: list[tuple[str, dict | None]] = []

    async def get(self, path, params=None):
        self.calls.append((path, params))
        if self.error is not None:
            raise self.error
        if path.endswith("/strings"):
            return self.page
        return self.detail

    async def run(self, **kwargs):
        with patch.object(server.TurboEAClient, "get", AsyncMock(side_effect=self.get)):
            return _parse(await server.get_untranslated_strings(**kwargs))


class TestGetUntranslatedStrings:
    @pytest.mark.asyncio
    async def test_reads_the_language_then_its_untranslated_strings(self, fake_token):
        reads = _Reads(
            page={
                "total": 5,
                "items": [
                    {
                        "namespace": "common",
                        "key": "actions.save",
                        "source": "Save",
                        "value": None,
                        "status": "missing",
                    },
                    {
                        "namespace": "common",
                        "key": "actions.close",
                        "source": "Close window",
                        "value": "Sluiten",
                        "status": "stale",
                    },
                    {
                        "namespace": "admin",
                        "key": "title",
                        "source": "Admin",
                        "value": "",
                        "status": "stale",
                    },
                ],
            }
        )
        out = await reads.run(locale="nl")
        assert reads.calls == [
            ("/custom-locales/nl", None),
            ("/custom-locales/nl/strings", {"status": "untranslated", "limit": 100}),
        ]
        assert out == {
            "locale": "nl",
            "language": "Dutch",
            "native_name": "Nederlands",
            "rtl": False,
            "instructions": INSTRUCTIONS_DUTCH,
            "strings": {
                "common": {"actions.save": "Save", "actions.close": "Close window"},
                "admin": {"title": "Admin"},
            },
            "returned": 3,
            "remaining": 2,
            "previous_translations": {"common": {"actions.close": "Sluiten"}},
        }

    @pytest.mark.asyncio
    async def test_missing_only_and_one_namespace(self, fake_token):
        reads = _Reads()
        await reads.run(locale="pt-BR", namespace="admin", include_stale=False, limit=20)
        assert reads.calls[1] == (
            "/custom-locales/pt-BR/strings",
            {"status": "missing", "namespace": "admin", "limit": 20},
        )

    @pytest.mark.asyncio
    @pytest.mark.parametrize(
        ("asked", "sent"), [(0, 1), (-5, 1), (1, 1), (500, 500), (501, 500), (10_000, 500)]
    )
    async def test_the_limit_is_clamped(self, fake_token, asked, sent):
        reads = _Reads()
        await reads.run(locale="nl", limit=asked)
        assert reads.calls[1][1]["limit"] == sent

    @pytest.mark.asyncio
    async def test_a_translated_value_that_is_not_stale_is_not_previous(self, fake_token):
        item = {"namespace": "c", "key": "k", "source": "S", "value": "V", "status": "missing"}
        out = await _Reads(page={"total": 1, "items": [item, "junk"]}).run(locale="nl")
        assert out["strings"] == {"c": {"k": "S"}}
        assert out["returned"] == 1
        assert out["remaining"] == 0
        assert "previous_translations" not in out

    @pytest.mark.asyncio
    async def test_odd_answers_degrade_to_an_empty_page(self, fake_token):
        out = await _Reads(detail=["x"], page={"total": "many", "items": None}).run(locale="nl")
        assert out["language"] == "nl"
        assert out["native_name"] is None
        assert out["rtl"] is False
        assert out["strings"] == {}
        assert (out["returned"], out["remaining"]) == (0, 0)
        assert "into nl." in out["instructions"]

    @pytest.mark.asyncio
    async def test_a_page_that_is_not_an_object_is_empty(self, fake_token):
        out = await _Reads(page=["x"]).run(locale="nl")
        assert out["strings"] == {}
        assert out["returned"] == 0

    @pytest.mark.asyncio
    async def test_rtl_is_reported_only_when_true(self, fake_token):
        out = await _Reads(detail={**DETAIL, "rtl": True}).run(locale="nl")
        assert out["rtl"] is True
        out = await _Reads(detail={**DETAIL, "rtl": "yes"}).run(locale="nl")
        assert out["rtl"] is False

    @pytest.mark.asyncio
    async def test_an_invalid_code_is_refused_before_any_call(self, fake_token):
        reads = _Reads()
        out = await reads.run(locale="../users")
        assert out["error"] == "invalid_locale"
        assert reads.calls == []

    @pytest.mark.asyncio
    async def test_an_unknown_language_is_reported(self, fake_token):
        reads = _Reads(error=_http_error(404, "locale_not_found"))
        out = await reads.run(locale="nl")
        assert out == {
            "error": "custom_locale_refused",
            "http_status": 404,
            "detail": "locale_not_found",
        }

    def test_requires_auth(self, monkeypatch):
        import asyncio

        monkeypatch.setattr(server, "_stdio_token", None)
        assert "Not authenticated" in asyncio.run(server.get_untranslated_strings(locale="nl"))

    def test_is_read_only(self):
        tool = server.mcp._tool_manager._tools["get_untranslated_strings"]
        assert tool.annotations == server._READ_ANNOT


# ── submit_translations ─────────────────────────────────────────────────────

TWO = {"common": {"actions.save": "Opslaan", "actions.close": "Sluiten {{x}"}}
REPORT = {
    "applied": 1,
    "unchanged": 0,
    "cleared": 0,
    "rejected": [{"namespace": "common", "key": "actions.close", "reason": "placeholder_mismatch"}],
    "unknown": [],
}


class _Backend:
    """Answers the batch open / close and the strings write; records posts.
    A dry-run open above 2 rows is issued ``TOK-1``."""

    def __init__(self, answer=None):
        self.answer = REPORT if answer is None else answer
        self.posts: list[tuple[str, dict | None]] = []

    async def post(self, path, json=None):
        self.posts.append((path, json))
        if path.endswith("/commit"):
            return {"id": "B-1", "committed_at": "now"}
        if path.startswith("/mutation-batches"):
            rows = int(path.split("row_count=")[1])
            dry = (json or {}).get("dry_run")
            resp = {"id": "B-1", "dry_run": dry}
            if dry and rows > 2:
                resp["confirm_token"] = "TOK-1"
            return resp
        if isinstance(self.answer, Exception):
            raise self.answer
        return self.answer

    def writes(self):
        return [(p, b) for p, b in self.posts if not p.startswith("/mutation-batches")]

    def closed_summary(self):
        return self.posts[-1][1]["summary"]

    async def run(self, **kwargs):
        with patch.object(server.TurboEAClient, "post", AsyncMock(side_effect=self.post)):
            return _parse(await server.submit_translations(**kwargs))


@pytest.fixture
def threshold_two(monkeypatch):
    monkeypatch.setattr(server, "MCP_BATCH_CONFIRMATION_THRESHOLD", 2)
    monkeypatch.setattr(server, "MCP_REQUIRE_DRYRUN_FIRST", True)


THREE = {"common": {"a": "1", "b": "2"}, "admin": {"c": "3"}}


class TestSubmitTranslations:
    @pytest.mark.asyncio
    async def test_the_preview_validates_on_the_backend_and_stores_nothing(self, fake_token):
        backend = _Backend()
        out = await backend.run(locale="nl", translations=TWO)
        assert backend.posts[0] == (
            "/mutation-batches?row_count=2",
            {"tool_name": "submit_translations", "dry_run": True},
        )
        assert backend.writes() == [
            ("/custom-locales/nl/strings?dry_run=true", {"strings": TWO, "origin": "mcp"})
        ]
        assert backend.posts[-1][0] == "/mutation-batches/B-1/commit"
        assert backend.closed_summary() == {"rows": 2, "would_apply": 1, "rejected": 1}
        assert out == {
            "dry_run": True,
            "locale": "nl",
            "submitted": 2,
            "would_apply": 1,
            "unchanged": 0,
            "rejected": REPORT["rejected"],
            "unknown": [],
            "accepted": {"common": ["actions.save"]},
            "reversible": False,
            "note": server._TRANSLATIONS_NOT_REVERSIBLE,
            "batch_id": "B-1",
        }

    @pytest.mark.asyncio
    async def test_the_commit_writes_with_origin_mcp(self, fake_token):
        backend = _Backend(answer={**REPORT, "applied": 1, "unchanged": 3})
        out = await backend.run(locale="pt-BR", translations=TWO, dry_run=False)
        assert backend.posts[0][1] == {"tool_name": "submit_translations", "dry_run": False}
        assert backend.writes() == [
            ("/custom-locales/pt-BR/strings?dry_run=false", {"strings": TWO, "origin": "mcp"})
        ]
        assert backend.closed_summary() == {"rows": 2, "applied": 1, "rejected": 1}
        assert out["dry_run"] is False
        assert out["applied"] == 1
        assert out["unchanged"] == 3
        assert "would_apply" not in out
        assert out["batch_id"] == "B-1"
        assert "confirm_token" not in out

    @pytest.mark.asyncio
    async def test_a_non_object_answer_reports_zero(self, fake_token):
        backend = _Backend(answer=["odd"])
        out = await backend.run(locale="nl", translations=TWO, dry_run=False)
        assert (out["applied"], out["unchanged"], out["rejected"]) == (0, 0, [])
        assert out["unknown"] is None
        assert out["accepted"] == {"common": ["actions.close", "actions.save"]}
        assert backend.closed_summary() == {"rows": 2, "applied": 0, "rejected": 0}

    @pytest.mark.asyncio
    async def test_a_preview_above_the_threshold_is_issued_a_token(self, fake_token, threshold_two):
        backend = _Backend()
        out = await backend.run(locale="nl", translations=THREE)
        assert backend.posts[0][0] == "/mutation-batches?row_count=3"
        assert out["confirm_token"] == "TOK-1"
        assert out["batch_id"] == "B-1"

    @pytest.mark.asyncio
    async def test_a_commit_above_the_threshold_needs_the_token(self, fake_token, threshold_two):
        backend = _Backend()
        out = await backend.run(locale="nl", translations=THREE, dry_run=False)
        assert out["error"] == "confirm_token_required"
        assert out["tool"] == "submit_translations"
        assert out["received"] == 3
        assert backend.posts == []
        out = await backend.run(
            locale="nl", translations=THREE, dry_run=False, confirm_token="TOK-1"
        )
        assert backend.posts[0] == (
            "/mutation-batches?row_count=3",
            {"tool_name": "submit_translations", "dry_run": False, "confirm_token": "TOK-1"},
        )
        assert out["batch_id"] == "B-1"

    @pytest.mark.asyncio
    async def test_the_cap_counts_strings(self, fake_token, monkeypatch):
        monkeypatch.setattr(server, "MCP_MAX_TRANSLATIONS_PER_CALL", 2)
        backend = _Backend()
        out = await backend.run(locale="nl", translations=THREE)
        assert out["error"] == "batch_too_large"
        assert (out["cap"], out["received"]) == (2, 3)
        assert out["message"] == (
            "This call has 3 strings but the MCP per-call cap is 2. Submit them in smaller calls."
        )
        assert backend.posts == []
        # At the cap, it runs.
        out = await backend.run(locale="nl", translations=TWO)
        assert out["dry_run"] is True

    @pytest.mark.asyncio
    async def test_kill_switch(self, fake_token, monkeypatch):
        monkeypatch.setattr(server, "MCP_WRITES_ENABLED", False)
        backend = _Backend()
        out = await backend.run(locale="nl", translations=TWO)
        assert out["error"] == "writes_disabled"
        assert backend.posts == []

    @pytest.mark.asyncio
    async def test_an_invalid_code_is_refused_before_any_call(self, fake_token):
        backend = _Backend()
        out = await backend.run(locale="nl/../x", translations=TWO)
        assert out["error"] == "invalid_locale"
        assert backend.posts == []

    @pytest.mark.asyncio
    async def test_a_clear_is_refused_before_any_call(self, fake_token):
        backend = _Backend()
        out = await backend.run(locale="nl", translations={"common": {"a": None}})
        assert out["error"] == "invalid_translations"
        assert backend.posts == []

    @pytest.mark.asyncio
    @pytest.mark.parametrize("dry_run", [True, False])
    async def test_a_refusal_is_reported_and_the_batch_closed(self, fake_token, dry_run):
        backend = _Backend(answer=_http_error(503, "catalog_unavailable"))
        out = await backend.run(locale="nl", translations=TWO, dry_run=dry_run)
        assert out == {
            "error": "submit_translations_refused",
            "http_status": 503,
            "detail": "catalog_unavailable",
            "batch_id": "B-1",
        }
        assert backend.closed_summary() == {"rows": 2, "status": "refused"}

    def test_requires_auth(self, monkeypatch):
        import asyncio

        monkeypatch.setattr(server, "_stdio_token", None)
        out = asyncio.run(server.submit_translations(locale="nl", translations=TWO))
        assert "Not authenticated" in out

    def test_is_additive(self):
        tool = server.mcp._tool_manager._tools["submit_translations"]
        assert tool.annotations == server._WRITE_ADDITIVE_ANNOT
