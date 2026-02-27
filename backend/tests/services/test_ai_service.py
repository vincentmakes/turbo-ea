"""Unit tests for the AI service — web search + LLM description generation.

These tests do NOT require a database — they test pure logic and mock HTTP calls.
"""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import httpx
import pytest

from app.services.ai_service import (
    _get_llm_item_description,
    _get_search_suffix,
    _search_duckduckgo,
    _search_google,
    _search_searxng,
    build_llm_prompt,
    call_llm,
    fetch_running_models,
    suggest_metadata,
    validate_suggestions,
    web_search,
)

# ---------------------------------------------------------------------------
# Type-aware search & prompt context
# ---------------------------------------------------------------------------


class TestTypeAwareContext:
    def test_application_search_suffix(self):
        suffix = _get_search_suffix("Application", None)
        assert "software" in suffix

    def test_organization_search_suffix(self):
        suffix = _get_search_suffix("Organization", None)
        assert "company" in suffix or "organization" in suffix

    def test_provider_search_suffix(self):
        suffix = _get_search_suffix("Provider", None)
        assert "vendor" in suffix

    def test_unknown_type_falls_back(self):
        suffix = _get_search_suffix("CustomType", None)
        assert suffix == "customtype"

    def test_llm_description_application(self):
        desc = _get_llm_item_description("Application", "Application")
        assert "software" in desc

    def test_llm_description_organization(self):
        desc = _get_llm_item_description("Organization", "Organization")
        assert "company" in desc or "organizational" in desc

    def test_llm_description_unknown_type(self):
        desc = _get_llm_item_description("CustomWidget", "Custom Widget")
        assert "custom widget" in desc


# ---------------------------------------------------------------------------
# validate_suggestions (description-only)
# ---------------------------------------------------------------------------


class TestValidateSuggestions:
    def test_valid_description(self):
        raw = {"description": {"value": "A great tool", "confidence": 0.8, "source": "acme.com"}}
        result = validate_suggestions(raw)
        assert result["description"]["value"] == "A great tool"
        assert result["description"]["confidence"] == 0.8
        assert result["description"]["source"] == "acme.com"

    def test_null_value_skipped(self):
        raw = {"description": {"value": None, "confidence": 0.5}}
        result = validate_suggestions(raw)
        assert "description" not in result

    def test_empty_string_skipped(self):
        raw = {"description": {"value": "  ", "confidence": 0.5}}
        result = validate_suggestions(raw)
        assert "description" not in result

    def test_plain_value_normalized(self):
        raw = {"description": "Plain String"}
        result = validate_suggestions(raw)
        assert result["description"]["value"] == "Plain String"
        assert result["description"]["confidence"] == 0.5

    def test_non_description_keys_ignored(self):
        raw = {
            "vendor": {"value": "Acme Corp", "confidence": 0.9},
            "description": {"value": "A great tool", "confidence": 0.8},
        }
        result = validate_suggestions(raw)
        assert "vendor" not in result
        assert "description" in result

    def test_confidence_clamped(self):
        raw = {"description": {"value": "Test", "confidence": 1.5}}
        result = validate_suggestions(raw)
        assert result["description"]["confidence"] == 1.0

    def test_confidence_floor(self):
        raw = {"description": {"value": "Test", "confidence": -0.3}}
        result = validate_suggestions(raw)
        assert result["description"]["confidence"] == 0.0

    def test_missing_description_returns_empty(self):
        raw = {"vendor": {"value": "Acme", "confidence": 0.8}}
        result = validate_suggestions(raw)
        assert result == {}

    def test_value_stripped(self):
        raw = {"description": {"value": "  Trimmed text  ", "confidence": 0.7}}
        result = validate_suggestions(raw)
        assert result["description"]["value"] == "Trimmed text"


# ---------------------------------------------------------------------------
# build_llm_prompt (description-only)
# ---------------------------------------------------------------------------


class TestBuildLLMPrompt:
    def test_returns_system_and_user_messages(self):
        messages = build_llm_prompt(
            name="PostgreSQL",
            type_key="ITComponent",
            type_label="IT Component",
            subtype=None,
            search_results=[],
        )
        assert len(messages) == 2
        assert messages[0]["role"] == "system"
        assert messages[1]["role"] == "user"

    def test_name_in_user_message(self):
        messages = build_llm_prompt(
            name="PostgreSQL",
            type_key="ITComponent",
            type_label="IT Component",
            subtype=None,
            search_results=[],
        )
        assert "PostgreSQL" in messages[1]["content"]

    def test_subtype_in_user_message(self):
        messages = build_llm_prompt(
            name="Kafka",
            type_key="ITComponent",
            type_label="IT Component",
            subtype="SaaS",
            search_results=[],
        )
        assert "SaaS" in messages[1]["content"]

    def test_context_in_user_message(self):
        messages = build_llm_prompt(
            name="Kafka",
            type_key="ITComponent",
            type_label="IT Component",
            subtype=None,
            search_results=[],
            context="Used for event streaming",
        )
        assert "Used for event streaming" in messages[1]["content"]

    def test_search_results_included(self):
        search_results = [
            {"url": "https://kafka.apache.org", "title": "Apache Kafka", "snippet": "Streaming"},
        ]
        messages = build_llm_prompt(
            name="Kafka",
            type_key="ITComponent",
            type_label="IT Component",
            subtype=None,
            search_results=search_results,
        )
        assert "Apache Kafka" in messages[1]["content"]
        assert "Streaming" in messages[1]["content"]

    def test_no_search_results_fallback(self):
        messages = build_llm_prompt(
            name="Kafka",
            type_key="ITComponent",
            type_label="IT Component",
            subtype=None,
            search_results=[],
        )
        assert "general knowledge" in messages[0]["content"]

    def test_description_focus_in_system_prompt(self):
        messages = build_llm_prompt(
            name="Test",
            type_key="Application",
            type_label="Application",
            subtype=None,
            search_results=[],
        )
        assert "description" in messages[0]["content"].lower()

    def test_type_aware_system_prompt_application(self):
        messages = build_llm_prompt(
            name="SAP",
            type_key="Application",
            type_label="Application",
            subtype=None,
            search_results=[],
        )
        assert "software application" in messages[0]["content"]

    def test_type_aware_system_prompt_organization(self):
        messages = build_llm_prompt(
            name="Acme Corp",
            type_key="Organization",
            type_label="Organization",
            subtype=None,
            search_results=[],
        )
        system = messages[0]["content"]
        assert "company" in system or "organizational" in system

    def test_type_aware_system_prompt_custom_type(self):
        messages = build_llm_prompt(
            name="Something",
            type_key="CustomWidget",
            type_label="Custom Widget",
            subtype=None,
            search_results=[],
        )
        assert "custom widget" in messages[0]["content"]

    def test_no_field_schema_in_prompt(self):
        """Prompt should NOT contain field schema details — only asks for description."""
        messages = build_llm_prompt(
            name="Test",
            type_key="Application",
            type_label="Application",
            subtype=None,
            search_results=[],
        )
        system = messages[0]["content"]
        assert "Available fields:" not in system
        assert "select fields" not in system


# ---------------------------------------------------------------------------
# Web search providers (mocked HTTP)
# ---------------------------------------------------------------------------


class TestSearchDuckDuckGo:
    @pytest.mark.asyncio
    async def test_parses_html_results(self):
        html = (
            '<a class="result__a" href="https://example.com">Example Title</a>'
            '<a class="result__snippet">Example snippet text</a>'
        )
        mock_resp = MagicMock()
        mock_resp.text = html
        mock_resp.raise_for_status = MagicMock()

        with patch("app.services.ai_service._get_search_client") as mock_get:
            mock_client = AsyncMock()
            mock_get.return_value = mock_client
            mock_client.get = AsyncMock(return_value=mock_resp)

            results = await _search_duckduckgo("test query")
            assert len(results) >= 1
            assert results[0]["url"] == "https://example.com"
            assert results[0]["title"] == "Example Title"
            assert results[0]["snippet"] == "Example snippet text"

    @pytest.mark.asyncio
    async def test_http_error_returns_empty(self):
        with patch("app.services.ai_service._get_search_client") as mock_get:
            mock_client = AsyncMock()
            mock_get.return_value = mock_client
            mock_client.get = AsyncMock(side_effect=httpx.HTTPError("Network error"))

            results = await _search_duckduckgo("test query")
            assert results == []

    @pytest.mark.asyncio
    async def test_respects_limit(self):
        # Build HTML with many results
        html = ""
        for i in range(20):
            html += (
                f'<a class="result__a" href="https://example.com/{i}">Title {i}</a>'
                f'<a class="result__snippet">Snippet {i}</a>'
            )
        mock_resp = MagicMock()
        mock_resp.text = html
        mock_resp.raise_for_status = MagicMock()

        with patch("app.services.ai_service._get_search_client") as mock_get:
            mock_client = AsyncMock()
            mock_get.return_value = mock_client
            mock_client.get = AsyncMock(return_value=mock_resp)

            results = await _search_duckduckgo("test query", limit=3)
            assert len(results) == 3


class TestSearchSearXNG:
    @pytest.mark.asyncio
    async def test_parses_json_results(self):
        mock_resp = MagicMock()
        mock_resp.json.return_value = {
            "results": [
                {"url": "https://example.com", "title": "Example", "content": "Snippet"},
            ]
        }
        mock_resp.raise_for_status = MagicMock()

        with patch("app.services.ai_service._get_search_client") as mock_get:
            mock_client = AsyncMock()
            mock_get.return_value = mock_client
            mock_client.get = AsyncMock(return_value=mock_resp)

            results = await _search_searxng("http://searxng:8080", "test query")
            assert len(results) == 1
            assert results[0]["url"] == "https://example.com"
            assert results[0]["snippet"] == "Snippet"

    @pytest.mark.asyncio
    async def test_http_error_returns_empty(self):
        with patch("app.services.ai_service._get_search_client") as mock_get:
            mock_client = AsyncMock()
            mock_get.return_value = mock_client
            mock_client.get = AsyncMock(side_effect=httpx.HTTPError("Error"))

            results = await _search_searxng("http://searxng:8080", "test")
            assert results == []


class TestSearchGoogle:
    @pytest.mark.asyncio
    async def test_parses_json_results(self):
        mock_resp = MagicMock()
        mock_resp.json.return_value = {
            "items": [
                {"link": "https://example.com", "title": "Example", "snippet": "Info"},
            ]
        }
        mock_resp.raise_for_status = MagicMock()

        with patch("app.services.ai_service._get_search_client") as mock_get:
            mock_client = AsyncMock()
            mock_get.return_value = mock_client
            mock_client.get = AsyncMock(return_value=mock_resp)

            results = await _search_google("APIKEY", "CX123", "test query")
            assert len(results) == 1
            assert results[0]["url"] == "https://example.com"
            assert results[0]["snippet"] == "Info"

    @pytest.mark.asyncio
    async def test_http_error_returns_empty(self):
        with patch("app.services.ai_service._get_search_client") as mock_get:
            mock_client = AsyncMock()
            mock_get.return_value = mock_client
            mock_client.get = AsyncMock(side_effect=httpx.HTTPError("Error"))

            results = await _search_google("KEY", "CX", "test")
            assert results == []


# ---------------------------------------------------------------------------
# web_search dispatcher
# ---------------------------------------------------------------------------


class TestWebSearch:
    @pytest.mark.asyncio
    async def test_duckduckgo_default(self):
        with patch("app.services.ai_service._search_duckduckgo") as mock_ddg:
            mock_ddg.return_value = [{"url": "ddg.com", "title": "DDG", "snippet": ""}]
            results = await web_search("test")
            mock_ddg.assert_called_once()
            assert results[0]["url"] == "ddg.com"

    @pytest.mark.asyncio
    async def test_searxng_provider(self):
        with patch("app.services.ai_service._search_searxng") as mock_sx:
            mock_sx.return_value = [{"url": "sx.com", "title": "SX", "snippet": ""}]
            await web_search("test", provider="searxng", search_url="http://sx:8080")
            mock_sx.assert_called_once_with("http://sx:8080", "test", 8)

    @pytest.mark.asyncio
    async def test_google_provider(self):
        with patch("app.services.ai_service._search_google") as mock_g:
            mock_g.return_value = [{"url": "g.com", "title": "G", "snippet": ""}]
            await web_search("test", provider="google", search_url="KEY:CX")
            mock_g.assert_called_once_with("KEY", "CX", "test", 8)

    @pytest.mark.asyncio
    async def test_google_bad_format_returns_empty(self):
        results = await web_search("test", provider="google", search_url="no_colon")
        assert results == []

    @pytest.mark.asyncio
    async def test_searxng_without_url_falls_back_to_duckduckgo(self):
        with patch("app.services.ai_service._search_duckduckgo") as mock_ddg:
            mock_ddg.return_value = []
            await web_search("test", provider="searxng", search_url="")
            mock_ddg.assert_called_once()


# ---------------------------------------------------------------------------
# call_llm
# ---------------------------------------------------------------------------


class TestCallLLM:
    @pytest.mark.asyncio
    async def test_successful_json_response(self):
        mock_resp = MagicMock()
        mock_resp.json.return_value = {
            "message": {"content": '{"description": {"value": "A great tool"}}'}
        }
        mock_resp.raise_for_status = MagicMock()

        with patch("app.services.ai_service._get_llm_client") as mock_get:
            mock_client = AsyncMock()
            mock_get.return_value = mock_client
            mock_client.post = AsyncMock(return_value=mock_resp)

            result = await call_llm(
                "http://ollama:11434", "mistral", [{"role": "user", "content": "test"}]
            )
            assert result == {"description": {"value": "A great tool"}}

    @pytest.mark.asyncio
    async def test_json_in_markdown_code_block(self):
        mock_resp = MagicMock()
        mock_resp.json.return_value = {
            "message": {"content": '```json\n{"description": "A tool"}\n```'}
        }
        mock_resp.raise_for_status = MagicMock()

        with patch("app.services.ai_service._get_llm_client") as mock_get:
            mock_client = AsyncMock()
            mock_get.return_value = mock_client
            mock_client.post = AsyncMock(return_value=mock_resp)

            result = await call_llm(
                "http://ollama:11434", "mistral", [{"role": "user", "content": "test"}]
            )
            assert result == {"description": "A tool"}

    @pytest.mark.asyncio
    async def test_non_json_returns_empty(self):
        mock_resp = MagicMock()
        mock_resp.json.return_value = {"message": {"content": "This is not JSON at all"}}
        mock_resp.raise_for_status = MagicMock()

        with patch("app.services.ai_service._get_llm_client") as mock_get:
            mock_client = AsyncMock()
            mock_get.return_value = mock_client
            mock_client.post = AsyncMock(return_value=mock_resp)

            result = await call_llm(
                "http://ollama:11434", "mistral", [{"role": "user", "content": "test"}]
            )
            assert result == {}

    @pytest.mark.asyncio
    async def test_http_error_raises(self):
        with patch("app.services.ai_service._get_llm_client") as mock_get:
            mock_client = AsyncMock()
            mock_get.return_value = mock_client
            mock_client.post = AsyncMock(side_effect=httpx.HTTPError("Connection refused"))

            with pytest.raises(httpx.HTTPError):
                await call_llm(
                    "http://ollama:11434", "mistral", [{"role": "user", "content": "test"}]
                )

    @pytest.mark.asyncio
    async def test_sends_correct_payload(self):
        mock_resp = MagicMock()
        mock_resp.json.return_value = {"message": {"content": "{}"}}
        mock_resp.raise_for_status = MagicMock()

        with patch("app.services.ai_service._get_llm_client") as mock_get:
            mock_client = AsyncMock()
            mock_get.return_value = mock_client
            mock_client.post = AsyncMock(return_value=mock_resp)

            messages = [{"role": "system", "content": "sys"}, {"role": "user", "content": "usr"}]
            await call_llm("http://ollama:11434", "llama3", messages)

            call_args = mock_client.post.call_args
            assert call_args[0][0] == "http://ollama:11434/api/chat"
            payload = call_args[1]["json"]
            assert payload["model"] == "llama3"
            assert payload["messages"] == messages
            assert payload["stream"] is False
            assert payload["format"] == "json"


# ---------------------------------------------------------------------------
# fetch_running_models
# ---------------------------------------------------------------------------


class TestFetchRunningModels:
    @pytest.mark.asyncio
    async def test_returns_model_list(self):
        mock_resp = MagicMock()
        mock_resp.json.return_value = {
            "models": [
                {"name": "mistral:latest", "size": 4_000_000_000},
                {"name": "llama3:8b", "size": 8_000_000_000},
            ]
        }
        mock_resp.raise_for_status = MagicMock()

        with patch("app.services.ai_service._get_llm_client") as mock_get:
            mock_client = AsyncMock()
            mock_get.return_value = mock_client
            mock_client.get = AsyncMock(return_value=mock_resp)

            result = await fetch_running_models("http://ollama:11434")
            assert len(result) == 2
            assert result[0]["name"] == "mistral:latest"
            assert result[1]["name"] == "llama3:8b"

    @pytest.mark.asyncio
    async def test_empty_on_error(self):
        with patch("app.services.ai_service._get_llm_client") as mock_get:
            mock_client = AsyncMock()
            mock_get.return_value = mock_client
            mock_client.get = AsyncMock(side_effect=httpx.HTTPError("Connection refused"))

            result = await fetch_running_models("http://ollama:11434")
            assert result == []

    @pytest.mark.asyncio
    async def test_empty_when_no_models(self):
        mock_resp = MagicMock()
        mock_resp.json.return_value = {"models": []}
        mock_resp.raise_for_status = MagicMock()

        with patch("app.services.ai_service._get_llm_client") as mock_get:
            mock_client = AsyncMock()
            mock_get.return_value = mock_client
            mock_client.get = AsyncMock(return_value=mock_resp)

            result = await fetch_running_models("http://ollama:11434")
            assert result == []


# ---------------------------------------------------------------------------
# suggest_metadata (full pipeline, all HTTP mocked)
# ---------------------------------------------------------------------------


class TestSuggestMetadata:
    @pytest.mark.asyncio
    async def test_full_pipeline(self):
        with (
            patch("app.services.ai_service.web_search") as mock_search,
            patch("app.services.ai_service.call_llm") as mock_llm,
        ):
            mock_search.return_value = [
                {"url": "https://example.com", "title": "Example", "snippet": "Info"},
            ]
            mock_llm.return_value = {
                "description": {
                    "value": "A great product for enterprise use.",
                    "confidence": 0.8,
                    "source": "example.com",
                },
            }

            result = await suggest_metadata(
                name="Test App",
                type_key="Application",
                type_label="Application",
                subtype=None,
                provider_url="http://ollama:11434",
                model="mistral",
            )

            assert "suggestions" in result
            assert "sources" in result
            assert result["model"] == "mistral"
            assert result["search_provider"] == "duckduckgo"

            suggestions = result["suggestions"]
            assert suggestions["description"]["value"] == "A great product for enterprise use."
            assert suggestions["description"]["confidence"] == 0.8

            assert len(result["sources"]) == 1
            assert result["sources"][0]["url"] == "https://example.com"

    @pytest.mark.asyncio
    async def test_only_description_returned(self):
        """Non-description fields from LLM response are dropped."""
        with (
            patch("app.services.ai_service.web_search") as mock_search,
            patch("app.services.ai_service.call_llm") as mock_llm,
        ):
            mock_search.return_value = []
            mock_llm.return_value = {
                "vendor": {"value": "Example Corp", "confidence": 0.9},
                "status": {"value": "active", "confidence": 0.7},
                "description": {"value": "A great product", "confidence": 0.8},
            }

            result = await suggest_metadata(
                name="Test App",
                type_key="Application",
                type_label="Application",
                subtype=None,
                provider_url="http://ollama:11434",
                model="mistral",
            )

            suggestions = result["suggestions"]
            assert "description" in suggestions
            assert "vendor" not in suggestions
            assert "status" not in suggestions

    @pytest.mark.asyncio
    async def test_search_query_includes_subtype(self):
        with (
            patch("app.services.ai_service.web_search") as mock_search,
            patch("app.services.ai_service.call_llm") as mock_llm,
        ):
            mock_search.return_value = []
            mock_llm.return_value = {}

            await suggest_metadata(
                name="Redis",
                type_key="ITComponent",
                type_label="IT Component",
                subtype="SaaS",
                provider_url="http://ollama:11434",
                model="mistral",
            )

            # Verify search query is type-aware and includes subtype
            search_call = mock_search.call_args
            query = search_call[0][0]
            assert "Redis" in query
            assert "SaaS" in query
            assert "technology product" in query

    @pytest.mark.asyncio
    async def test_search_query_type_aware_application(self):
        with (
            patch("app.services.ai_service.web_search") as mock_search,
            patch("app.services.ai_service.call_llm") as mock_llm,
        ):
            mock_search.return_value = []
            mock_llm.return_value = {}

            await suggest_metadata(
                name="SAP S/4HANA",
                type_key="Application",
                type_label="Application",
                subtype=None,
                provider_url="http://ollama:11434",
                model="mistral",
            )

            query = mock_search.call_args[0][0]
            assert "SAP S/4HANA" in query
            assert "software application" in query

    @pytest.mark.asyncio
    async def test_search_query_type_aware_organization(self):
        with (
            patch("app.services.ai_service.web_search") as mock_search,
            patch("app.services.ai_service.call_llm") as mock_llm,
        ):
            mock_search.return_value = []
            mock_llm.return_value = {}

            await suggest_metadata(
                name="Acme Corp",
                type_key="Organization",
                type_label="Organization",
                subtype=None,
                provider_url="http://ollama:11434",
                model="mistral",
            )

            query = mock_search.call_args[0][0]
            assert "Acme Corp" in query
            assert "company" in query or "organization" in query
