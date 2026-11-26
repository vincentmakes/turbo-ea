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
from turbo_ea_mcp.hash_memory import HashMemory


@pytest.fixture(autouse=True)
def fresh_hash_memory(monkeypatch):
    """Every test starts with nothing remembered."""
    memory = HashMemory()
    monkeypatch.setattr(server, "_HASH_MEMORY", memory)
    return memory


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
    'consistent with the earlier translations. The "metamodel" namespace holds '
    "the names of card types, fields, options and relations: short labels, "
    "translate them first and use the same words for them in every other "
    "string. Leave out a string you cannot translate rather than returning "
    "the English text."
)


# ── Plain helpers ───────────────────────────────────────────────────────────


class TestLocaleProblem:
    @pytest.mark.parametrize(
        "code", ["nl", "fil", "he", "hi", "th", "pt-BR", "zh-TW", "zh-Hant", "sr-Latn-RS"]
    )
    def test_a_well_formed_code_passes(self, code):
        assert server._locale_problem(code) is None

    @pytest.mark.parametrize(
        "code",
        [
            "",
            "n",
            "NL",
            "abcd",
            "pt-br",
            "pt_BR",
            "nl-BRA",
            "nl/x",
            "../nl",
            " nl",
            7,
            None,
            "zh-hant",
            "zh-HANT",
            "zh-Han",
            "zh-Hantx",
            "zh-BR-Hant",
            "he-IL-x",
            "abc-Abcd-AB",
        ],
    )
    def test_anything_else_is_refused_and_echoed(self, code):
        problem = server._locale_problem(code)
        assert problem["error"] == "invalid_locale"
        assert problem["locale"] == code
        assert problem["message"] == (
            "locale must be a custom language code such as 'nl', 'pt-BR' or "
            "'zh-Hant', at most 10 characters (see list_custom_languages)."
        )

    @pytest.mark.parametrize("code", ["nl\n", "nl-BR\n", "zh-Hant\n", "x", "-nl", "nl-", "nl-BR-x"])
    def test_the_whole_code_must_match(self, code):
        assert server._locale_problem(code)["error"] == "invalid_locale"

    def test_ten_characters_pass_and_eleven_do_not(self):
        # The pattern itself allows 11 (``abc-Abcd-AB``); the column holds 10.
        assert server._locale_problem("ab-Abcd-AB") is None
        assert server._locale_problem("abc-Abcd-AB")["error"] == "invalid_locale"

    @pytest.mark.parametrize("code", ["nl\n", "zh-Hant\n"])
    def test_a_trailing_newline_is_refused(self, code):
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


class TestAcceptedCounts:
    def test_rejected_and_unknown_rows_are_left_out(self):
        translations = {"common": {"b": "1", "a": "2", "c": "3"}, "admin": {"x": "4"}}
        body = {
            "rejected": [{"namespace": "common", "key": "c", "reason": "too_long"}, "odd"],
            "unknown": [{"namespace": "admin", "key": "x"}],
        }
        assert server._accepted_counts(translations, body) == {"common": 2}

    def test_unknown_keys_are_left_out(self):
        translations = {"common": {"a": "1", "gone": "2"}, "metamodel": {"type.X.label": "3"}}
        body = {
            "rejected": [],
            "unknown": 2,
            "unknown_keys": [
                {"namespace": "common", "key": "gone"},
                {"namespace": "metamodel", "key": "type.X.label"},
            ],
        }
        assert server._accepted_counts(translations, body) == {"common": 1}

    def test_a_count_for_unknown_is_ignored(self):
        # The backend answers ``unknown`` as an integer count.
        body = {"rejected": None, "unknown": 2}
        assert server._accepted_counts({"common": {"a": "1"}}, body) == {"common": 1}

    def test_a_key_of_another_namespace_is_not_confused(self):
        body = {"rejected": [{"namespace": "admin", "key": "a", "reason": "empty"}]}
        assert server._accepted_counts({"common": {"a": "1"}}, body) == {"common": 1}


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
                        "source_hash": "aaaaaaaaaaaa",
                        "value": None,
                        "status": "missing",
                    },
                    {
                        "namespace": "common",
                        "key": "actions.close",
                        "source": "Close window",
                        "source_hash": "bbbbbbbbbbbb",
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
        out = await reads.run(locale="nl", include_source_hashes=True)
        assert reads.calls == [
            ("/custom-locales/nl", None),
            (
                "/custom-locales/nl/strings",
                {"status": "untranslated", "limit": 100, "offset": 0, "collapse": "true"},
            ),
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
            "source_hashes": {
                "common": {"actions.save": "aaaaaaaaaaaa", "actions.close": "bbbbbbbbbbbb"}
            },
            "returned": 3,
            "remaining": 2,
            "next_offset": 3,
            "previous_translations": {"common": {"actions.close": "Sluiten"}},
        }

    @pytest.mark.asyncio
    async def test_missing_only_and_one_namespace(self, fake_token):
        reads = _Reads()
        await reads.run(locale="pt-BR", namespace="admin", include_stale=False, limit=20)
        assert reads.calls[1] == (
            "/custom-locales/pt-BR/strings",
            {
                "status": "missing",
                "namespace": "admin",
                "limit": 20,
                "offset": 0,
                "collapse": "true",
            },
        )

    @pytest.mark.asyncio
    async def test_identical_english_is_listed_once_with_its_key_count(self, fake_token):
        page = {
            "total": 2,
            "items": [
                {
                    "namespace": "common",
                    "key": "level.high",
                    "source": "High",
                    "source_hash": "aaaaaaaaaaaa",
                    "status": "missing",
                    "same_text": 12,
                },
                {
                    "namespace": "admin",
                    "key": "title",
                    "source": "Admin",
                    "source_hash": "bbbbbbbbbbbb",
                    "status": "missing",
                    "same_text": 1,
                },
                {
                    "namespace": "admin",
                    "key": "odd",
                    "source": "Odd",
                    "source_hash": "cccccccccccc",
                    "status": "missing",
                    "same_text": "3",
                },
            ],
        }
        out = await _Reads(page=page).run(locale="nl")
        # Only a text standing for more than one key is named.
        assert out["identical"] == {"common": {"level.high": 12}}

    @pytest.mark.asyncio
    async def test_collapsing_can_be_switched_off(self, fake_token):
        reads = _Reads()
        out = await reads.run(locale="nl", collapse_identical=False)
        assert "collapse" not in reads.calls[1][1]
        assert "identical" not in out

    @pytest.mark.asyncio
    @pytest.mark.parametrize(("asked", "sent"), [(0, 0), (-3, 0), (40, 40)])
    async def test_the_offset_is_forwarded_and_never_negative(self, fake_token, asked, sent):
        reads = _Reads()
        await reads.run(locale="nl", offset=asked)
        assert reads.calls[1][1]["offset"] == sent

    @pytest.mark.asyncio
    async def test_remaining_and_next_offset_count_the_strings_skipped(self, fake_token):
        items = [
            {"namespace": "c", "key": f"k{i}", "source": "S", "status": "missing"} for i in range(3)
        ]
        out = await _Reads(page={"total": 10, "items": items}).run(locale="nl", offset=4)
        assert out["returned"] == 3
        assert out["remaining"] == 3
        assert out["next_offset"] == 7

    @pytest.mark.asyncio
    async def test_the_last_page_has_no_next_offset(self, fake_token):
        items = [{"namespace": "c", "key": "k", "source": "S", "status": "missing"}]
        out = await _Reads(page={"total": 5, "items": items}).run(locale="nl", offset=4)
        assert out["remaining"] == 0
        assert "next_offset" not in out
        # An offset past the end never reports a negative remainder.
        out = await _Reads(page={"total": 5, "items": items}).run(locale="nl", offset=9)
        assert out["remaining"] == 0
        assert "next_offset" not in out

    @pytest.mark.asyncio
    async def test_a_hash_that_is_not_text_is_left_out(self, fake_token):
        items = [
            {"namespace": "c", "key": "a", "source": "A", "source_hash": None},
            {"namespace": "c", "key": "b", "source": "B", "source_hash": 5},
            {"namespace": "c", "key": "d", "source": "D", "source_hash": "dddddddddddd"},
        ]
        out = await _Reads(page={"total": 3, "items": items}).run(
            locale="nl", include_source_hashes=True
        )
        assert out["source_hashes"] == {"c": {"d": "dddddddddddd"}}

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
        # Not asked for: the server keeps the hashes for submit_translations.
        assert "source_hashes" not in out
        assert out["returned"] == 1
        assert out["remaining"] == 0
        assert "next_offset" not in out
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
    "unknown": 0,
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


#: What ``submit_translations`` posts for ``TWO`` by default.
SENT_TWO = {"strings": TWO, "origin": "mcp", "fill_identical": True}

THREE = {"common": {"a": "1", "b": "2"}, "admin": {"c": "3"}}


class TestSubmitTranslations:
    @pytest.mark.asyncio
    async def test_a_dry_run_validates_on_the_backend_and_stores_nothing(self, fake_token):
        backend = _Backend()
        out = await backend.run(locale="nl", translations=TWO, dry_run=True)
        assert backend.posts[0] == (
            "/mutation-batches?row_count=2",
            {"tool_name": "submit_translations", "dry_run": True},
        )
        assert backend.writes() == [("/custom-locales/nl/strings?dry_run=true", SENT_TWO)]
        assert backend.posts[-1][0] == "/mutation-batches/B-1/commit"
        assert backend.closed_summary() == {"rows": 2, "would_apply": 1, "rejected": 1}
        assert out == {
            "dry_run": True,
            "locale": "nl",
            "submitted": 2,
            "would_apply": 1,
            "unchanged": 0,
            "rejected": REPORT["rejected"],
            "unknown": 0,
            "unknown_keys": [],
            "accepted": {"common": 1},
            "would_fill": 0,
            "fill_rejected": 0,
            "reversible": False,
            "note": server._TRANSLATIONS_NOT_REVERSIBLE,
            "batch_id": "B-1",
        }

    @pytest.mark.asyncio
    async def test_the_first_call_saves_with_origin_mcp(self, fake_token):
        backend = _Backend(answer={**REPORT, "applied": 1, "unchanged": 3})
        out = await backend.run(locale="pt-BR", translations=TWO)
        assert backend.posts[0][1] == {"tool_name": "submit_translations", "dry_run": False}
        assert backend.writes() == [("/custom-locales/pt-BR/strings?dry_run=false", SENT_TWO)]
        assert backend.closed_summary() == {"rows": 2, "applied": 1, "rejected": 1}
        assert out["dry_run"] is False
        assert out["applied"] == 1
        assert out["unchanged"] == 3
        assert "would_apply" not in out
        assert out["batch_id"] == "B-1"
        assert "confirm_token" not in out

    @pytest.mark.asyncio
    async def test_metamodel_labels_in_another_script_go_up_as_one_more_namespace(self, fake_token):
        strings = {
            "metamodel": {"type.Application.label": "יישום"},
            "common": {"actions.save": "שמור"},
        }
        gone = [{"namespace": "common", "key": "actions.gone"}]
        backend = _Backend(
            answer={
                "applied": 2,
                "unchanged": 0,
                "rejected": [],
                "unknown": 1,
                "unknown_keys": gone,
            }
        )
        strings_with_gone = {**strings, "common": {**strings["common"], "actions.gone": "x"}}
        out = await backend.run(locale="he", translations=strings_with_gone, dry_run=False)
        assert backend.writes() == [
            (
                "/custom-locales/he/strings?dry_run=false",
                {"strings": strings_with_gone, "origin": "mcp", "fill_identical": True},
            )
        ]
        assert out["unknown"] == 1
        assert out["unknown_keys"] == gone
        assert out["accepted"] == {"metamodel": 1, "common": 1}

    @pytest.mark.asyncio
    async def test_source_hashes_are_forwarded(self, fake_token):
        hashes = {"common": {"actions.save": "aaaaaaaaaaaa"}}
        backend = _Backend()
        await backend.run(locale="nl", translations=TWO, source_hashes=hashes, dry_run=False)
        assert backend.writes() == [
            (
                "/custom-locales/nl/strings?dry_run=false",
                {
                    "strings": TWO,
                    "source_hashes": hashes,
                    "origin": "mcp",
                    "fill_identical": True,
                },
            )
        ]

    @pytest.mark.asyncio
    async def test_identical_text_fills_are_reported_apart_from_applied(self, fake_token):
        backend = _Backend(answer={**REPORT, "filled": 9, "fill_rejected": 2})
        out = await backend.run(locale="nl", translations=TWO)
        assert (out["applied"], out["filled"], out["fill_rejected"]) == (1, 9, 2)
        assert "would_fill" not in out
        out = await backend.run(locale="nl", translations=TWO, dry_run=True)
        assert (out["would_fill"], out["fill_rejected"]) == (9, 2)
        assert "filled" not in out

    @pytest.mark.asyncio
    async def test_every_call_carries_the_callers_token(self, fake_token):
        """The batch's open, the write and the close all go out as the caller."""
        tokens: list = []
        backend = _Backend()

        async def post(client, path, json=None):
            tokens.append(client._token)
            return await backend.post(path, json)

        with patch.object(server.TurboEAClient, "post", autospec=True, side_effect=post):
            await server.submit_translations(locale="nl", translations=TWO)
        assert len(tokens) == 3
        assert set(tokens) == {fake_token}

    @pytest.mark.asyncio
    async def test_filling_can_be_switched_off(self, fake_token):
        backend = _Backend()
        await backend.run(locale="nl", translations=TWO, fill_identical=False)
        assert backend.writes() == [
            ("/custom-locales/nl/strings?dry_run=false", {"strings": TWO, "origin": "mcp"})
        ]
        tool = server.mcp._tool_manager._tools["submit_translations"]
        assert tool.fn_metadata.arg_model.model_fields["fill_identical"].default is True

    @pytest.mark.asyncio
    async def test_a_non_object_answer_reports_zero(self, fake_token):
        backend = _Backend(answer=["odd"])
        out = await backend.run(locale="nl", translations=TWO, dry_run=False)
        assert (out["applied"], out["unchanged"], out["rejected"]) == (0, 0, [])
        assert out["unknown"] is None
        assert out["unknown_keys"] == []
        assert out["accepted"] == {"common": 2}
        assert (out["filled"], out["fill_rejected"]) == (0, 0)
        assert backend.closed_summary() == {"rows": 2, "applied": 0, "rejected": 0}

    @pytest.mark.asyncio
    async def test_only_submit_translations_skips_the_confirm_cycle(
        self, fake_token, threshold_two
    ):
        """Above the threshold it saves on the first call, carrying no token —
        the backend's ``CONFIRMATION_EXEMPT_TOOLS`` holds exactly this tool."""
        backend = _Backend()
        out = await backend.run(locale="nl", translations=THREE)
        assert backend.posts[0] == (
            "/mutation-batches?row_count=3",
            {"tool_name": "submit_translations", "dry_run": False},
        )
        assert out["dry_run"] is False
        assert out["batch_id"] == "B-1"
        assert "confirm_token" not in out
        tool = server.mcp._tool_manager._tools["submit_translations"]
        assert "confirm_token" not in tool.fn_metadata.arg_model.model_fields
        assert tool.fn_metadata.arg_model.model_fields["dry_run"].default is False

    @pytest.mark.asyncio
    async def test_a_dry_run_hands_out_no_token(self, fake_token, threshold_two):
        backend = _Backend()
        out = await backend.run(locale="nl", translations=THREE, dry_run=True)
        assert out["dry_run"] is True
        assert "confirm_token" not in out

    @pytest.mark.asyncio
    async def test_an_older_backend_that_wants_a_token_is_named(self, fake_token):
        async def post(path, json=None):
            raise _http_error(400, "confirm_token_required: a commit above 20 rows needs …")

        with patch.object(server.TurboEAClient, "post", AsyncMock(side_effect=post)):
            out = _parse(await server.submit_translations(locale="nl", translations=TWO))
        assert out["error"] == "backend_needs_update"
        assert "Update the backend" in out["message"]

    @pytest.mark.asyncio
    async def test_any_other_refused_open_is_raised(self, fake_token):
        async def post(path, json=None):
            raise _http_error(500, "boom")

        with patch.object(server.TurboEAClient, "post", AsyncMock(side_effect=post)):
            with pytest.raises(httpx.HTTPStatusError):
                await server.submit_translations(locale="nl", translations=TWO)

    @pytest.mark.parametrize(
        ("status", "detail"),
        [(400, "confirm_token_invalid: expired"), (403, "confirm_token_required"), (400, None)],
    )
    def test_only_a_400_asking_for_a_token_is_an_outdated_backend(self, status, detail):
        assert server._outdated_backend(_http_error(status, detail)) is None
        assert server._outdated_backend(_http_error(400, "confirm_token_required: x")) == {
            "error": "backend_needs_update",
            "message": (
                "This Turbo EA backend still asks for a preview before large "
                "translation submits. Update the backend to the version of this "
                "MCP server, or submit at most 20 strings per call until then."
            ),
        }

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
        assert out["dry_run"] is False

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


# ── The remembered source hashes ────────────────────────────────────────────


class TestRememberedSourceHashes:
    PAGE = {
        "total": 2,
        "items": [
            {
                "namespace": "common",
                "key": "actions.save",
                "source": "Save",
                "source_hash": "aaaaaaaaaaaa",
                "status": "missing",
            },
            {
                "namespace": "metamodel",
                "key": "type.A.label",
                "source": "A",
                "source_hash": "bbbbbbbbbbbb",
                "status": "missing",
            },
        ],
    }

    @pytest.mark.asyncio
    async def test_a_submit_carries_the_hashes_the_page_handed_out(self, fake_token):
        await _Reads(page=self.PAGE).run(locale="nl")
        backend = _Backend()
        await backend.run(locale="nl", translations={"common": {"actions.save": "Opslaan"}})
        # Only the submitted keys' hashes, never the whole page's.
        assert backend.writes()[0][1]["source_hashes"] == {
            "common": {"actions.save": "aaaaaaaaaaaa"}
        }

    @pytest.mark.asyncio
    async def test_explicit_hashes_win(self, fake_token):
        await _Reads(page=self.PAGE).run(locale="nl")
        backend = _Backend()
        mine = {"common": {"actions.save": "cccccccccccc"}}
        await backend.run(
            locale="nl", translations={"common": {"actions.save": "x"}}, source_hashes=mine
        )
        assert backend.writes()[0][1]["source_hashes"] == mine

    @pytest.mark.asyncio
    async def test_another_language_or_user_gets_nothing(self, fake_token, monkeypatch):
        await _Reads(page=self.PAGE).run(locale="nl")
        backend = _Backend()
        await backend.run(locale="fy", translations={"common": {"actions.save": "x"}})
        assert "source_hashes" not in backend.writes()[0][1]
        monkeypatch.setattr(server, "_stdio_token", "someone-else")
        await backend.run(locale="nl", translations={"common": {"actions.save": "x"}})
        assert "source_hashes" not in backend.writes()[1][1]


# ── start_ai_translation / stop_ai_translation ──────────────────────────────

LOCALE_DETAIL = {
    "code": "nl",
    "stats": {"total": 7700, "translated": 2000, "missing": 5000, "stale": 700},
    "job": None,
}


class _JobBackend:
    """Answers the batch, the language read and the job routes; records."""

    def __init__(self, detail=None, answer=None):
        self.detail = LOCALE_DETAIL if detail is None else detail
        default = {"job": {"status": "running", "total": 5700, "done": 0}}
        self.answer = default if answer is None else answer
        self.posts: list[tuple[str, dict | None]] = []
        self.gets: list[str] = []

    async def post(self, path, json=None):
        self.posts.append((path, json))
        if path.endswith("/commit"):
            return {"id": "B-1", "committed_at": "now"}
        if path.startswith("/mutation-batches"):
            return {"id": "B-1", "dry_run": (json or {}).get("dry_run")}
        return self.answer

    async def get(self, path, params=None):
        self.gets.append(path)
        return self.detail

    def writes(self):
        return [(p, b) for p, b in self.posts if not p.startswith("/mutation-batches")]

    async def run(self, tool, **kwargs):
        with (
            patch.object(server.TurboEAClient, "post", AsyncMock(side_effect=self.post)),
            patch.object(server.TurboEAClient, "get", AsyncMock(side_effect=self.get)),
        ):
            return _parse(await getattr(server, tool)(**kwargs))


class TestStartAiTranslation:
    @pytest.mark.asyncio
    async def test_the_preview_counts_new_and_changed_strings_and_starts_nothing(self, fake_token):
        backend = _JobBackend()
        out = await backend.run("start_ai_translation", locale="nl")
        assert out == {
            "dry_run": True,
            "locale": "nl",
            "mode": "missing",
            "include_manual": False,
            "strings": 5700,
            "already_running": False,
            "batch_id": "B-1",
        }
        # The batch counts the strings the job would send, so the confirm
        # cycle of any other write applies above the threshold.
        assert backend.posts[0] == (
            "/mutation-batches?row_count=5700",
            {"tool_name": "start_ai_translation", "dry_run": True},
        )
        assert backend.posts[-1][1]["summary"] == {"status": "preview", "strings": 5700}
        assert backend.writes() == []
        assert backend.gets == ["/custom-locales/nl"]

    @pytest.mark.asyncio
    async def test_a_commit_above_the_threshold_needs_the_preview_token(self, fake_token):
        backend = _JobBackend()
        out = await backend.run("start_ai_translation", locale="nl", dry_run=False)
        assert out["error"] == "confirm_token_required"
        assert backend.posts == []
        out = await backend.run(
            "start_ai_translation", locale="nl", dry_run=False, confirm_token="TOK-1"
        )
        assert backend.posts[0] == (
            "/mutation-batches?row_count=5700",
            {"tool_name": "start_ai_translation", "dry_run": False, "confirm_token": "TOK-1"},
        )
        assert out["dry_run"] is False
        assert backend.posts[-1][1]["summary"] == {"status": "started", "strings": 5700}

    @pytest.mark.asyncio
    async def test_a_small_job_or_an_unknown_count_needs_no_token(self, fake_token):
        small = {**LOCALE_DETAIL, "stats": {"total": 30, "missing": 3, "stale": 2}}
        backend = _JobBackend(detail=small)
        out = await backend.run("start_ai_translation", locale="nl", dry_run=False)
        assert out["dry_run"] is False
        assert backend.posts[0][0] == "/mutation-batches?row_count=5"
        backend = _JobBackend(detail={"code": "nl", "stats": None})
        out = await backend.run("start_ai_translation", locale="nl", dry_run=False)
        assert out["dry_run"] is False
        assert backend.posts[0][0] == "/mutation-batches?row_count=1"

    @pytest.mark.asyncio
    async def test_all_counts_every_string_and_passes_include_manual(self, fake_token):
        backend = _JobBackend()
        preview = await backend.run("start_ai_translation", locale="nl", mode="all")
        assert preview["strings"] == 7700
        out = await backend.run(
            "start_ai_translation",
            locale="nl",
            mode="all",
            include_manual=True,
            dry_run=False,
            confirm_token="TOK-1",
        )
        assert backend.writes() == [
            ("/custom-locales/nl/translate", {"mode": "all", "include_manual": True})
        ]
        # After the start, the job's own count (it skips hand-corrected strings).
        assert out["strings"] == 5700
        assert out["job"] == {"status": "running", "total": 5700, "done": 0}
        assert out["dry_run"] is False
        assert out["batch_id"] == "B-1"
        assert "list_custom_languages" in out["note"]

    @pytest.mark.asyncio
    async def test_include_manual_is_only_for_all(self, fake_token):
        backend = _JobBackend()
        await backend.run(
            "start_ai_translation",
            locale="nl",
            include_manual=True,
            dry_run=False,
            confirm_token="TOK-1",
        )
        assert backend.writes() == [
            ("/custom-locales/nl/translate", {"mode": "missing", "include_manual": False})
        ]

    @pytest.mark.asyncio
    async def test_a_job_without_a_total_reports_the_estimate(self, fake_token):
        backend = _JobBackend(answer={"job": {"status": "running", "total": "?"}})
        out = await backend.run(
            "start_ai_translation", locale="nl", dry_run=False, confirm_token="TOK-1"
        )
        assert out["strings"] == 5700
        backend = _JobBackend(answer=["odd"])
        out = await backend.run(
            "start_ai_translation", locale="nl", dry_run=False, confirm_token="TOK-1"
        )
        assert (out["strings"], out["job"]) == (5700, None)

    @pytest.mark.asyncio
    async def test_a_running_job_is_reported_on_the_preview(self, fake_token):
        backend = _JobBackend(detail={**LOCALE_DETAIL, "job": {"status": "running"}})
        out = await backend.run("start_ai_translation", locale="nl")
        assert out["already_running"] is True

    @pytest.mark.asyncio
    async def test_no_stats_count_as_unknown(self, fake_token):
        backend = _JobBackend(detail={"code": "nl", "stats": None})
        assert (await backend.run("start_ai_translation", locale="nl"))["strings"] is None
        backend = _JobBackend(detail={"stats": {"total": "x", "missing": 1, "stale": None}})
        out = await backend.run("start_ai_translation", locale="nl", mode="all")
        assert out["strings"] is None
        assert (await backend.run("start_ai_translation", locale="nl"))["strings"] is None

    @pytest.mark.asyncio
    @pytest.mark.parametrize(
        ("status", "detail"),
        [(400, "ai_not_configured"), (409, "job_running"), (503, "catalog_unavailable")],
    )
    async def test_a_refusal_on_start_is_readable(self, fake_token, status, detail):
        backend = _JobBackend()
        err = _http_error(status, detail)

        async def post(path, json=None):
            backend.posts.append((path, json))
            if path.endswith("/commit"):
                return {}
            if path.startswith("/mutation-batches"):
                return {"id": "B-1"}
            raise err

        with (
            patch.object(server.TurboEAClient, "post", AsyncMock(side_effect=post)),
            patch.object(server.TurboEAClient, "get", AsyncMock(side_effect=backend.get)),
        ):
            out = _parse(
                await server.start_ai_translation(locale="nl", dry_run=False, confirm_token="T")
            )
        assert backend.posts[-1][1]["summary"] == {"status": "refused"}
        assert out == {
            "error": "start_ai_translation_refused",
            "http_status": status,
            "detail": detail,
            "batch_id": "B-1",
        }

    @pytest.mark.asyncio
    async def test_an_unknown_language_is_refused_before_any_batch(self, fake_token):
        async def get(path, params=None):
            raise _http_error(404, "locale_not_found")

        backend = _JobBackend()
        with (
            patch.object(server.TurboEAClient, "post", AsyncMock(side_effect=backend.post)),
            patch.object(server.TurboEAClient, "get", AsyncMock(side_effect=get)),
        ):
            out = _parse(await server.start_ai_translation(locale="nl"))
        assert out == {
            "error": "start_ai_translation_refused",
            "http_status": 404,
            "detail": "locale_not_found",
        }
        assert backend.posts == []

    @pytest.mark.asyncio
    async def test_an_unknown_mode_and_a_bad_code_are_refused_before_any_call(self, fake_token):
        backend = _JobBackend()
        out = await backend.run("start_ai_translation", locale="nl", mode="everything")
        assert out == {
            "error": "invalid_mode",
            "message": 'mode must be "missing" (new and changed strings) or "all".',
            "mode": "everything",
        }
        out = await backend.run("start_ai_translation", locale="../x")
        assert out["error"] == "invalid_locale"
        assert backend.posts == [] and backend.gets == []
        assert server._AI_TRANSLATION_MODES == ("missing", "all")

    @pytest.mark.asyncio
    async def test_kill_switch(self, fake_token, monkeypatch):
        monkeypatch.setattr(server, "MCP_WRITES_ENABLED", False)
        backend = _JobBackend()
        out = await backend.run("start_ai_translation", locale="nl", dry_run=False)
        assert out["error"] == "writes_disabled"
        assert backend.posts == []

    def test_requires_auth(self, monkeypatch):
        import asyncio

        monkeypatch.setattr(server, "_stdio_token", None)
        assert "Not authenticated" in asyncio.run(server.start_ai_translation(locale="nl"))
        assert "Not authenticated" in asyncio.run(server.stop_ai_translation(locale="nl"))

    def test_annotations(self):
        tools = server.mcp._tool_manager._tools
        # Destructive: with mode "all" and include_manual it replaces strings
        # an admin corrected by hand.
        assert tools["start_ai_translation"].annotations == server._WRITE_DESTRUCTIVE_ANNOT
        assert tools["stop_ai_translation"].annotations == server._WRITE_ADDITIVE_ANNOT


def test_a_rate_limited_refusal_is_named():
    assert server._custom_locale_refusal(_http_error(429, None), "x_refused") == {
        "error": "x_refused",
        "http_status": 429,
        "detail": "rate_limited",
    }
    # Any other status without a detail keeps None; a 429 with one keeps it.
    assert server._custom_locale_refusal(_http_error(500, None), "x")["detail"] is None
    assert server._custom_locale_refusal(_http_error(429, "slow"), "x")["detail"] == "slow"


class TestStopAiTranslation:
    @pytest.mark.asyncio
    async def test_the_preview_says_whether_a_job_runs(self, fake_token):
        backend = _JobBackend(detail={**LOCALE_DETAIL, "job": {"status": "running"}})
        out = await backend.run("stop_ai_translation", locale="nl")
        assert out == {"dry_run": True, "locale": "nl", "running": True, "batch_id": "B-1"}
        assert backend.writes() == []
        backend = _JobBackend(detail={**LOCALE_DETAIL, "job": {"status": "completed"}})
        assert (await backend.run("stop_ai_translation", locale="nl"))["running"] is False

    @pytest.mark.asyncio
    async def test_the_commit_cancels(self, fake_token):
        backend = _JobBackend(answer={"job": {"status": "cancelled"}})
        out = await backend.run("stop_ai_translation", locale="pt-BR", dry_run=False)
        assert backend.writes() == [("/custom-locales/pt-BR/translate/cancel", {})]
        assert backend.posts[0] == (
            "/mutation-batches?row_count=1",
            {"tool_name": "stop_ai_translation", "dry_run": False},
        )
        assert out == {
            "dry_run": False,
            "locale": "pt-BR",
            "job": {"status": "cancelled"},
            "batch_id": "B-1",
        }
        assert backend.posts[-1][1]["summary"] == {"status": "cancelled"}
        backend = _JobBackend(answer="odd")
        await backend.run("stop_ai_translation", locale="nl", dry_run=False)
        assert backend.posts[-1][1]["summary"] == {"status": None}

    @pytest.mark.asyncio
    async def test_a_refusal_is_readable(self, fake_token):
        err = _http_error(404, "locale_not_found")

        async def post(path, json=None):
            if path.startswith("/mutation-batches"):
                return {"id": "B-1"}
            raise err

        with patch.object(server.TurboEAClient, "post", AsyncMock(side_effect=post)):
            out = _parse(await server.stop_ai_translation(locale="nl", dry_run=False))
        assert out == {
            "error": "stop_ai_translation_refused",
            "http_status": 404,
            "detail": "locale_not_found",
            "batch_id": "B-1",
        }

    @pytest.mark.asyncio
    async def test_kill_switch_and_bad_code(self, fake_token, monkeypatch):
        backend = _JobBackend()
        assert (await backend.run("stop_ai_translation", locale="NL"))["error"] == "invalid_locale"
        monkeypatch.setattr(server, "MCP_WRITES_ENABLED", False)
        out = await backend.run("stop_ai_translation", locale="nl", dry_run=False)
        assert out["error"] == "writes_disabled"
        assert backend.posts == []


class TestJobHelpers:
    @pytest.mark.parametrize(
        ("detail", "mode", "count"),
        [
            (LOCALE_DETAIL, "missing", 5700),
            (LOCALE_DETAIL, "all", 7700),
            ({"stats": {"missing": 3, "stale": 0, "total": 9}}, "missing", 3),
            ({"stats": {"missing": 0, "stale": 4, "total": 9}}, "missing", 4),
            ({"stats": {"missing": "3", "stale": 1}}, "missing", None),
            ({"stats": {"missing": 3, "stale": "1"}}, "missing", None),
            ({"stats": {"total": None}}, "all", None),
            ({"stats": None}, "missing", None),
            ({"stats": []}, "all", None),
            (None, "missing", None),
            ([], "all", None),
        ],
    )
    def test_the_count_of_strings_sent(self, detail, mode, count):
        assert server._ai_translation_count(detail, mode) == count

    @pytest.mark.parametrize(
        ("detail", "running"),
        [
            ({"job": {"status": "running"}}, True),
            ({"job": {"status": "completed"}}, False),
            ({"job": {"status": "Running"}}, False),
            ({"job": None}, False),
            ({"job": "running"}, False),
            ({}, False),
            (None, False),
        ],
    )
    def test_a_running_job(self, detail, running):
        assert server._job_running(detail) is running
