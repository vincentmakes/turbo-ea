"""The parts of the AI service the description tests leave untouched: the
type-specific extra fields in the prompt and in validation, the provider
connection check's error paths, the lazily created HTTP clients and the
portfolio-insights prompt and normalisation. No database."""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import httpx
import pytest

from app.services import ai_service
from app.services.ai_service import (
    _get_client,
    _get_extra_fields,
    _get_llm_client,
    _get_search_client,
    build_llm_prompt,
    check_provider_connection,
    generate_portfolio_insights,
    validate_suggestions,
)

SCHEMA = [
    {"section": "Info", "fields": [{"key": "commercialApplication"}, {"key": "hostingType"}]},
    {"section": "Other", "fields": [{"key": "costTotalAnnual"}]},
]


# ── Extra fields ──────────────────────────────────────────────────────────


class TestExtraFields:
    def test_only_fields_the_type_declares_and_the_schema_carries(self):
        assert _get_extra_fields("Organization", SCHEMA) == []
        assert _get_extra_fields("Application", None) == []
        assert _get_extra_fields("Application", []) == []
        only_hosting = [{"section": "Info", "fields": [{"key": "hostingType"}, {}]}]
        assert [f["key"] for f in _get_extra_fields("Application", only_hosting)] == ["hostingType"]
        assert [f["key"] for f in _get_extra_fields("Application", SCHEMA)] == [
            "commercialApplication",
            "hostingType",
        ]

    def test_the_prompt_asks_for_them_with_a_typed_example(self):
        messages = build_llm_prompt(
            "Jira", "Application", "Application", None, [], fields_schema=SCHEMA
        )
        text = "\n".join(m["content"] for m in messages)
        assert "You MUST also include these fields in your JSON response:" in text
        assert '"commercialApplication": { "value": true, "confidence": 0.8' in text
        assert '"hostingType": { "value": "onPremise", "confidence": 0.8' in text

        plain = build_llm_prompt("Jira", "Application", "Application", None, [])
        assert "MUST also include" not in "\n".join(m["content"] for m in plain)

    def test_validation_coerces_booleans_and_checks_options(self):
        raw = {
            "description": {"value": " A tool ", "confidence": 0.9, "source": "x.com"},
            "commercialApplication": {"value": "yes", "confidence": 2, "source": "x.com"},
            "hostingType": "cloudSaaS",
        }
        out = validate_suggestions(raw, "Application", SCHEMA)
        assert out["description"] == {"value": "A tool", "confidence": 0.9, "source": "x.com"}
        assert out["commercialApplication"] == {"value": True, "confidence": 1.0, "source": "x.com"}
        assert out["hostingType"] == {"value": "cloudSaaS", "confidence": 0.5}

        assert validate_suggestions({"commercialApplication": 1}, "Application", SCHEMA) == {
            "commercialApplication": {"value": True, "confidence": 0.5}
        }
        assert validate_suggestions({"commercialApplication": "no"}, "Application", SCHEMA) == {
            "commercialApplication": {"value": False, "confidence": 0.5}
        }
        for rejected in (
            {"commercialApplication": "maybe"},
            {"commercialApplication": {"value": None}},
            {"commercialApplication": None},
            {"hostingType": "mars"},
        ):
            assert validate_suggestions(rejected, "Application", SCHEMA) == {}
        # Without the schema the type's extra fields are not expected at all.
        assert validate_suggestions({"hostingType": "cloudSaaS"}, "Application") == {}


# ── HTTP clients ──────────────────────────────────────────────────────────


class TestClients:
    async def test_clients_are_created_once_and_recreated_after_close(self, monkeypatch):
        monkeypatch.setattr(ai_service, "_llm_client", None)
        monkeypatch.setattr(ai_service, "_search_client", None)
        llm = await _get_llm_client()
        try:
            assert llm.timeout.read == 120.0
            assert await _get_llm_client() is llm
            await llm.aclose()
            fresh = await _get_llm_client()
            assert fresh is not llm
            await fresh.aclose()

            search = await _get_search_client()
            assert search.timeout.read == 20.0 and search is not llm
            assert await _get_client() is search  # the legacy alias
            await search.aclose()
        finally:
            for c in (llm, ai_service._llm_client, ai_service._search_client):
                if c is not None and not c.is_closed:
                    await c.aclose()


# ── Provider connection: error paths ──────────────────────────────────────


def _status_error(code: int) -> httpx.HTTPStatusError:
    request = httpx.Request("POST", "https://llm.test")
    return httpx.HTTPStatusError(
        str(code), request=request, response=httpx.Response(code, request=request)
    )


def _client(*, get=None, post=None):
    client = AsyncMock()
    if get is not None:
        client.get = AsyncMock(side_effect=get)
    if post is not None:
        client.post = AsyncMock(side_effect=post)
    return client


class TestProviderConnectionErrors:
    @pytest.mark.parametrize(
        ("provider", "method", "exc", "message"),
        [
            ("openai", "get", httpx.ConnectError("x"), "Cannot reach provider: ConnectError"),
            ("anthropic", "post", _status_error(401), "Invalid API key"),
            ("anthropic", "post", _status_error(500), "Cannot reach Anthropic: HTTPStatusError"),
            ("anthropic", "post", httpx.ReadTimeout("x"), "Cannot reach Anthropic: ReadTimeout"),
            (
                "azure_openai",
                "post",
                _status_error(500),
                "Cannot reach Azure OpenAI: HTTPStatusError",
            ),
            (
                "azure_openai",
                "post",
                httpx.ConnectError("x"),
                "Cannot reach Azure OpenAI: ConnectError",
            ),
            ("ollama", "get", httpx.ConnectError("x"), "Cannot reach Ollama: ConnectError"),
        ],
    )
    async def test_every_failure_is_an_http_error_naming_the_provider(
        self, provider, method, exc, message
    ):
        client = _client(**{method: exc})
        with patch("app.services.ai_service._get_llm_client", AsyncMock(return_value=client)):
            with pytest.raises(httpx.HTTPError, match=message):
                await check_provider_connection(
                    "https://llm.test", provider_type=provider, api_key="k", model="m"
                )

    async def test_openai_without_a_model_reports_nothing_found(self):
        resp = MagicMock()
        resp.json.return_value = {"data": [{"id": "gpt-4o"}, {"id": "o3"}]}
        resp.raise_for_status = MagicMock()
        client = AsyncMock()
        client.get = AsyncMock(return_value=resp)
        with patch("app.services.ai_service._get_llm_client", AsyncMock(return_value=client)):
            out = await check_provider_connection("https://llm.test/", provider_type="openai")
        assert out == {"ok": True, "available_models": ["gpt-4o", "o3"], "model_found": False}
        assert client.get.call_args[0][0] == "https://llm.test/v1/models"

    async def test_anthropic_defaults_the_probe_model(self):
        resp = MagicMock()
        resp.raise_for_status = MagicMock()
        client = AsyncMock()
        client.post = AsyncMock(return_value=resp)
        with patch("app.services.ai_service._get_llm_client", AsyncMock(return_value=client)):
            out = await check_provider_connection(
                "https://llm.test", provider_type="anthropic", api_key="k"
            )
        assert out == {"ok": True, "available_models": [], "model_found": True}
        payload = client.post.call_args.kwargs["json"]
        assert payload["model"] == "claude-haiku-4-5-20251001" and payload["max_tokens"] == 1


# ── Portfolio insights ────────────────────────────────────────────────────


SUMMARY = {
    "total_apps": 5,
    "group_by": "capability",
    "color_by": "hostingType",
    "active_filters": ["lifecycle = active"],
    "groups": [
        {"name": "HR", "count": 2},
        {"name": "Sales", "count": 3, "breakdown": {"cloud": 2, "on": 1}},
    ],
    "attribute_summary": {
        "hostingType": {"on": 1, "cloud": 2},
        "empty": {},
        "ignored": "not a dict",
    },
    "lifecycle_summary": {"active": 2, "Unknown": 1, "custom": 0},
}


class TestGeneratePortfolioInsights:
    async def test_the_prompt_describes_the_portfolio_and_the_principles(self):
        answer = {
            "insights": [
                {"title": " T1 ", "observation": "O1", "recommendation": "R1"},
                "plain string",
                None,
                {"title": "no observation"},
                {"title": "T5", "observation": "O5", "recommendation": "R5"},
                {"title": "T6", "observation": "O6", "recommendation": "R6"},
            ]
        }
        call_llm = AsyncMock(return_value=answer)
        principles = [
            {"title": "Reuse", "description": "d", "rationale": "r", "implications": "i"},
            {"title": "Buy"},
        ]
        with patch("app.services.ai_service.call_llm", call_llm):
            out = await generate_portfolio_insights(
                SUMMARY,
                "https://llm.test",
                "gpt-4o",
                provider_type="openai",
                api_key="k",
                api_version="v1",
                principles=principles,
            )
        assert out == {
            "model": "gpt-4o",
            "insights": [
                {"title": "T1", "observation": "O1", "recommendation": "R1"},
                "plain string",
                "{'title': 'no observation'}",
                # Five are taken BEFORE empty items are dropped, so the sixth never lands.
                {"title": "T5", "observation": "O5", "recommendation": "R5"},
            ],
        }
        assert call_llm.call_args.kwargs == {
            "provider_type": "openai",
            "api_key": "k",
            "api_version": "v1",
        }
        url, model, messages = call_llm.call_args.args
        assert (url, model) == ("https://llm.test", "gpt-4o")
        system, user = messages[0]["content"], messages[1]["content"]
        assert messages[0]["role"] == "system" and messages[1]["role"] == "user"
        assert "produce exactly 5 advisory findings" in system
        assert "CRITICAL: The EA principles above OVERRIDE" in system
        assert user.startswith("Portfolio summary:\nTotal applications in scope: 5\n")
        assert (
            "Active filters (this is a filtered subset" in user and "  - lifecycle = active" in user
        )
        assert "Grouped by: capability\nColored by: hostingType\n" in user
        assert "  - Sales: 3 apps (60.0%)  [cloud=2, on=1]\n  - HR: 2 apps (40.0%)\n" in user
        assert "  hostingType: cloud: 2 (67%), on: 1 (33%)\n" in user
        assert "  empty: \n" in user and "ignored" not in user
        assert (
            "Lifecycle distribution: Active: 2 (67%), Unknown phase: 1 (33%), custom: 0 (0%)"
            in user
        )
        assert "EA PRINCIPLES (defined by the organisation):" in user
        assert "  1. Reuse — d (Rationale: r) [Implications: i]\n  2. Buy\n" in user

    async def test_an_empty_portfolio_and_a_malformed_answer(self):
        call_llm = AsyncMock(return_value={"insights": "nope"})
        with patch("app.services.ai_service.call_llm", call_llm):
            out = await generate_portfolio_insights(
                {"total_apps": 0, "groups": [{"name": "X", "count": 0}]}, "u", "m"
            )
        assert out == {"insights": [], "model": "m"}
        system, user = (m["content"] for m in call_llm.call_args.args[2])
        assert "CRITICAL" not in system and "EA PRINCIPLES" not in user
        assert "  - X: 0 apps (0%)" in user
        assert call_llm.call_args.kwargs["provider_type"] == "ollama"
