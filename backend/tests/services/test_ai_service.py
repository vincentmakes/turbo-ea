"""Unit tests for the AI service — web search + LLM description generation.

These tests do NOT require a database — they test pure logic and mock HTTP calls.
"""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import httpx
import pytest

from app.services import bedrock
from app.services.ai_service import (
    _call_anthropic,
    _call_azure_openai,
    _call_bedrock,
    _call_openai_compatible,
    _get_llm_item_description,
    _get_search_suffix,
    _parse_llm_content,
    _search_duckduckgo,
    _search_google,
    _search_searxng,
    build_llm_prompt,
    call_llm,
    check_provider_connection,
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


# ---------------------------------------------------------------------------
# _parse_llm_content
# ---------------------------------------------------------------------------


class TestParseLlmContent:
    def test_valid_json(self):
        result = _parse_llm_content('{"description": "hello"}')
        assert result == {"description": "hello"}

    def test_markdown_code_block(self):
        result = _parse_llm_content('```json\n{"description": "hello"}\n```')
        assert result == {"description": "hello"}

    def test_non_json_returns_empty(self):
        result = _parse_llm_content("This is not JSON")
        assert result == {}


# ---------------------------------------------------------------------------
# _call_openai_compatible
# ---------------------------------------------------------------------------


class TestCallOpenAICompatible:
    @pytest.mark.asyncio
    async def test_successful_response(self):
        mock_resp = MagicMock()
        mock_resp.json.return_value = {
            "choices": [{"message": {"content": '{"description": {"value": "A tool"}}'}}]
        }
        mock_resp.raise_for_status = MagicMock()

        with patch("app.services.ai_service._get_llm_client") as mock_get:
            mock_client = AsyncMock()
            mock_get.return_value = mock_client
            mock_client.post = AsyncMock(return_value=mock_resp)

            result = await _call_openai_compatible(
                "https://api.openai.com",
                "sk-test",
                "gpt-4o-mini",
                [{"role": "user", "content": "test"}],
            )
            assert result == {"description": {"value": "A tool"}}

    @pytest.mark.asyncio
    async def test_sends_bearer_auth(self):
        mock_resp = MagicMock()
        mock_resp.json.return_value = {"choices": [{"message": {"content": "{}"}}]}
        mock_resp.raise_for_status = MagicMock()

        with patch("app.services.ai_service._get_llm_client") as mock_get:
            mock_client = AsyncMock()
            mock_get.return_value = mock_client
            mock_client.post = AsyncMock(return_value=mock_resp)

            await _call_openai_compatible(
                "https://api.openai.com",
                "sk-test-key",
                "gpt-4o",
                [{"role": "user", "content": "test"}],
            )

            call_args = mock_client.post.call_args
            assert call_args[0][0] == "https://api.openai.com/v1/chat/completions"
            headers = call_args[1]["headers"]
            assert headers["Authorization"] == "Bearer sk-test-key"

    @pytest.mark.asyncio
    async def test_sends_response_format(self):
        mock_resp = MagicMock()
        mock_resp.json.return_value = {"choices": [{"message": {"content": "{}"}}]}
        mock_resp.raise_for_status = MagicMock()

        with patch("app.services.ai_service._get_llm_client") as mock_get:
            mock_client = AsyncMock()
            mock_get.return_value = mock_client
            mock_client.post = AsyncMock(return_value=mock_resp)

            await _call_openai_compatible(
                "https://api.openai.com",
                "sk-test",
                "gpt-4o",
                [{"role": "user", "content": "test"}],
            )

            payload = mock_client.post.call_args[1]["json"]
            assert payload["response_format"] == {"type": "json_object"}
            assert payload["temperature"] == 0.1

    @pytest.mark.asyncio
    async def test_http_error_raises(self):
        with patch("app.services.ai_service._get_llm_client") as mock_get:
            mock_client = AsyncMock()
            mock_get.return_value = mock_client
            mock_client.post = AsyncMock(side_effect=httpx.HTTPError("Unauthorized"))

            with pytest.raises(httpx.HTTPError):
                await _call_openai_compatible(
                    "https://api.openai.com",
                    "sk-bad",
                    "gpt-4o",
                    [{"role": "user", "content": "test"}],
                )


# ---------------------------------------------------------------------------
# _call_anthropic
# ---------------------------------------------------------------------------


class TestCallAnthropic:
    @pytest.mark.asyncio
    async def test_successful_response(self):
        mock_resp = MagicMock()
        mock_resp.json.return_value = {
            "content": [{"type": "text", "text": '{"description": {"value": "A tool"}}'}]
        }
        mock_resp.raise_for_status = MagicMock()

        with patch("app.services.ai_service._get_llm_client") as mock_get:
            mock_client = AsyncMock()
            mock_get.return_value = mock_client
            mock_client.post = AsyncMock(return_value=mock_resp)

            result = await _call_anthropic(
                "https://api.anthropic.com",
                "sk-ant-test",
                "claude-sonnet-4-20250514",
                [{"role": "system", "content": "sys"}, {"role": "user", "content": "test"}],
            )
            assert result == {"description": {"value": "A tool"}}

    @pytest.mark.asyncio
    async def test_separates_system_message(self):
        mock_resp = MagicMock()
        mock_resp.json.return_value = {"content": [{"type": "text", "text": "{}"}]}
        mock_resp.raise_for_status = MagicMock()

        with patch("app.services.ai_service._get_llm_client") as mock_get:
            mock_client = AsyncMock()
            mock_get.return_value = mock_client
            mock_client.post = AsyncMock(return_value=mock_resp)

            await _call_anthropic(
                "https://api.anthropic.com",
                "sk-ant-test",
                "claude-sonnet-4-20250514",
                [
                    {"role": "system", "content": "You are helpful"},
                    {"role": "user", "content": "Hi"},
                ],
            )

            payload = mock_client.post.call_args[1]["json"]
            assert payload["system"] == "You are helpful"
            assert len(payload["messages"]) == 1
            assert payload["messages"][0]["role"] == "user"

    @pytest.mark.asyncio
    async def test_sends_correct_headers(self):
        mock_resp = MagicMock()
        mock_resp.json.return_value = {"content": [{"type": "text", "text": "{}"}]}
        mock_resp.raise_for_status = MagicMock()

        with patch("app.services.ai_service._get_llm_client") as mock_get:
            mock_client = AsyncMock()
            mock_get.return_value = mock_client
            mock_client.post = AsyncMock(return_value=mock_resp)

            await _call_anthropic(
                "https://api.anthropic.com",
                "sk-ant-key",
                "claude-sonnet-4-20250514",
                [{"role": "user", "content": "test"}],
            )

            call_args = mock_client.post.call_args
            assert call_args[0][0] == "https://api.anthropic.com/v1/messages"
            headers = call_args[1]["headers"]
            assert headers["x-api-key"] == "sk-ant-key"
            assert headers["anthropic-version"] == "2023-06-01"

    @pytest.mark.asyncio
    async def test_http_error_raises(self):
        with patch("app.services.ai_service._get_llm_client") as mock_get:
            mock_client = AsyncMock()
            mock_get.return_value = mock_client
            mock_client.post = AsyncMock(side_effect=httpx.HTTPError("Unauthorized"))

            with pytest.raises(httpx.HTTPError):
                await _call_anthropic(
                    "https://api.anthropic.com",
                    "bad-key",
                    "claude-sonnet-4-20250514",
                    [{"role": "user", "content": "test"}],
                )


# ---------------------------------------------------------------------------
# call_llm dispatcher
# ---------------------------------------------------------------------------


class TestCallLLMDispatcher:
    @pytest.mark.asyncio
    async def test_defaults_to_ollama(self):
        with patch("app.services.ai_service._call_ollama") as mock_ollama:
            mock_ollama.return_value = {"description": "test"}
            result = await call_llm(
                "http://ollama:11434",
                "mistral",
                [{"role": "user", "content": "test"}],
            )
            mock_ollama.assert_called_once()
            assert result == {"description": "test"}

    @pytest.mark.asyncio
    async def test_routes_to_openai(self):
        with patch("app.services.ai_service._call_openai_compatible") as mock_openai:
            mock_openai.return_value = {"description": "test"}
            result = await call_llm(
                "https://api.openai.com",
                "gpt-4o",
                [{"role": "user", "content": "test"}],
                provider_type="openai",
                api_key="sk-test",
            )
            mock_openai.assert_called_once_with(
                "https://api.openai.com",
                "sk-test",
                "gpt-4o",
                [{"role": "user", "content": "test"}],
            )
            assert result == {"description": "test"}

    @pytest.mark.asyncio
    async def test_routes_to_anthropic(self):
        with patch("app.services.ai_service._call_anthropic") as mock_anthropic:
            mock_anthropic.return_value = {"description": "test"}
            result = await call_llm(
                "https://api.anthropic.com",
                "claude-sonnet-4-20250514",
                [{"role": "user", "content": "test"}],
                provider_type="anthropic",
                api_key="sk-ant-test",
            )
            mock_anthropic.assert_called_once_with(
                "https://api.anthropic.com",
                "sk-ant-test",
                "claude-sonnet-4-20250514",
                [{"role": "user", "content": "test"}],
            )
            assert result == {"description": "test"}


# ---------------------------------------------------------------------------
# suggest_metadata — always searches with DuckDuckGo
# ---------------------------------------------------------------------------


class TestSuggestMetadataAlwaysSearches:
    @pytest.mark.asyncio
    async def test_uses_duckduckgo_for_openai_provider(self):
        with (
            patch("app.services.ai_service.web_search") as mock_search,
            patch("app.services.ai_service.call_llm") as mock_llm,
        ):
            mock_search.return_value = [
                {"url": "https://example.com", "title": "Example", "snippet": "Info"},
            ]
            mock_llm.return_value = {
                "description": {"value": "A product", "confidence": 0.8},
            }

            result = await suggest_metadata(
                name="Test App",
                type_key="Application",
                type_label="Application",
                subtype=None,
                provider_url="https://api.openai.com",
                model="gpt-4o-mini",
                provider_type="openai",
                api_key="sk-test",
            )

            # Verify DuckDuckGo search was called
            mock_search.assert_called_once()
            search_call = mock_search.call_args
            assert search_call[0][1] == "duckduckgo"

            # Verify LLM was called with provider_type and api_key
            llm_call = mock_llm.call_args
            assert llm_call[1]["provider_type"] == "openai"
            assert llm_call[1]["api_key"] == "sk-test"

            assert result["search_provider"] == "duckduckgo"

    @pytest.mark.asyncio
    async def test_uses_duckduckgo_for_anthropic_provider(self):
        with (
            patch("app.services.ai_service.web_search") as mock_search,
            patch("app.services.ai_service.call_llm") as mock_llm,
        ):
            mock_search.return_value = []
            mock_llm.return_value = {
                "description": {"value": "A product", "confidence": 0.6},
            }

            await suggest_metadata(
                name="Test App",
                type_key="Application",
                type_label="Application",
                subtype=None,
                provider_url="https://api.anthropic.com",
                model="claude-sonnet-4-20250514",
                provider_type="anthropic",
                api_key="sk-ant-test",
            )

            mock_search.assert_called_once()
            assert mock_search.call_args[0][1] == "duckduckgo"


# ---------------------------------------------------------------------------
# check_provider_connection
# ---------------------------------------------------------------------------


class TestProviderConnection:
    @pytest.mark.asyncio
    async def test_ollama_uses_api_tags(self):
        mock_resp = MagicMock()
        mock_resp.json.return_value = {
            "models": [{"name": "gemma3:4b"}, {"name": "mistral:latest"}]
        }
        mock_resp.raise_for_status = MagicMock()

        with patch("app.services.ai_service._get_llm_client") as mock_get:
            mock_client = AsyncMock()
            mock_get.return_value = mock_client
            mock_client.get = AsyncMock(return_value=mock_resp)

            result = await check_provider_connection(
                "http://ollama:11434",
                provider_type="ollama",
                model="gemma3:4b",
            )
            assert result["ok"] is True
            assert result["model_found"] is True
            assert "gemma3:4b" in result["available_models"]

            # Verify correct endpoint
            call_url = mock_client.get.call_args[0][0]
            assert "/api/tags" in call_url

    @pytest.mark.asyncio
    async def test_openai_uses_v1_models(self):
        mock_resp = MagicMock()
        mock_resp.json.return_value = {"data": [{"id": "gpt-4o"}, {"id": "gpt-4o-mini"}]}
        mock_resp.raise_for_status = MagicMock()

        with patch("app.services.ai_service._get_llm_client") as mock_get:
            mock_client = AsyncMock()
            mock_get.return_value = mock_client
            mock_client.get = AsyncMock(return_value=mock_resp)

            result = await check_provider_connection(
                "https://api.openai.com",
                provider_type="openai",
                api_key="sk-test",
                model="gpt-4o-mini",
            )
            assert result["ok"] is True
            assert result["model_found"] is True

            # Verify Bearer auth header
            call_args = mock_client.get.call_args
            assert "/v1/models" in call_args[0][0]
            assert call_args[1]["headers"]["Authorization"] == "Bearer sk-test"

    @pytest.mark.asyncio
    async def test_anthropic_makes_test_call(self):
        mock_resp = MagicMock()
        mock_resp.json.return_value = {"content": [{"type": "text", "text": "Hi"}]}
        mock_resp.raise_for_status = MagicMock()

        with patch("app.services.ai_service._get_llm_client") as mock_get:
            mock_client = AsyncMock()
            mock_get.return_value = mock_client
            mock_client.post = AsyncMock(return_value=mock_resp)

            result = await check_provider_connection(
                "https://api.anthropic.com",
                provider_type="anthropic",
                api_key="sk-ant-test",
                model="claude-sonnet-4-20250514",
            )
            assert result["ok"] is True

            # Verify correct headers
            call_args = mock_client.post.call_args
            assert "/v1/messages" in call_args[0][0]
            headers = call_args[1]["headers"]
            assert headers["x-api-key"] == "sk-ant-test"


# ---------------------------------------------------------------------------
# _call_azure_openai
# ---------------------------------------------------------------------------


class TestCallAzureOpenAI:
    @pytest.mark.asyncio
    async def test_successful_response(self):
        mock_resp = MagicMock()
        mock_resp.json.return_value = {
            "choices": [{"message": {"content": '{"description": {"value": "A tool"}}'}}]
        }
        mock_resp.raise_for_status = MagicMock()

        with patch("app.services.ai_service._get_llm_client") as mock_get:
            mock_client = AsyncMock()
            mock_get.return_value = mock_client
            mock_client.post = AsyncMock(return_value=mock_resp)

            result = await _call_azure_openai(
                "https://my-resource.openai.azure.com",
                "azure-api-key",
                "my-gpt4o-deployment",
                [{"role": "user", "content": "test"}],
            )
            assert result == {"description": {"value": "A tool"}}

    @pytest.mark.asyncio
    async def test_uses_api_key_header_not_bearer(self):
        """Azure uses 'api-key' header, NOT 'Authorization: Bearer'."""
        mock_resp = MagicMock()
        mock_resp.json.return_value = {"choices": [{"message": {"content": "{}"}}]}
        mock_resp.raise_for_status = MagicMock()

        with patch("app.services.ai_service._get_llm_client") as mock_get:
            mock_client = AsyncMock()
            mock_get.return_value = mock_client
            mock_client.post = AsyncMock(return_value=mock_resp)

            await _call_azure_openai(
                "https://my-resource.openai.azure.com",
                "my-azure-key",
                "my-gpt4o-deployment",
                [{"role": "user", "content": "test"}],
            )

            call_args = mock_client.post.call_args
            headers = call_args[1]["headers"]
            assert headers["api-key"] == "my-azure-key"
            assert "Authorization" not in headers

    @pytest.mark.asyncio
    async def test_deployment_name_in_url_not_payload(self):
        """Azure embeds the deployment name in the URL, not the request body."""
        mock_resp = MagicMock()
        mock_resp.json.return_value = {"choices": [{"message": {"content": "{}"}}]}
        mock_resp.raise_for_status = MagicMock()

        with patch("app.services.ai_service._get_llm_client") as mock_get:
            mock_client = AsyncMock()
            mock_get.return_value = mock_client
            mock_client.post = AsyncMock(return_value=mock_resp)

            await _call_azure_openai(
                "https://my-resource.openai.azure.com",
                "my-azure-key",
                "my-gpt4o-deployment",
                [{"role": "user", "content": "test"}],
            )

            call_args = mock_client.post.call_args
            url = call_args[0][0]
            assert "/openai/deployments/my-gpt4o-deployment/chat/completions" in url
            payload = call_args[1]["json"]
            assert "model" not in payload

    @pytest.mark.asyncio
    async def test_sends_api_version_query_param(self):
        """Azure requires an api-version query parameter."""
        mock_resp = MagicMock()
        mock_resp.json.return_value = {"choices": [{"message": {"content": "{}"}}]}
        mock_resp.raise_for_status = MagicMock()

        with patch("app.services.ai_service._get_llm_client") as mock_get:
            mock_client = AsyncMock()
            mock_get.return_value = mock_client
            mock_client.post = AsyncMock(return_value=mock_resp)

            await _call_azure_openai(
                "https://my-resource.openai.azure.com",
                "my-azure-key",
                "my-gpt4o-deployment",
                [{"role": "user", "content": "test"}],
                api_version="2024-05-01-preview",
            )

            call_args = mock_client.post.call_args
            params = call_args[1]["params"]
            assert params["api-version"] == "2024-05-01-preview"

    @pytest.mark.asyncio
    async def test_default_api_version(self):
        mock_resp = MagicMock()
        mock_resp.json.return_value = {"choices": [{"message": {"content": "{}"}}]}
        mock_resp.raise_for_status = MagicMock()

        with patch("app.services.ai_service._get_llm_client") as mock_get:
            mock_client = AsyncMock()
            mock_get.return_value = mock_client
            mock_client.post = AsyncMock(return_value=mock_resp)

            await _call_azure_openai(
                "https://my-resource.openai.azure.com",
                "my-azure-key",
                "my-gpt4o-deployment",
                [{"role": "user", "content": "test"}],
            )

            params = mock_client.post.call_args[1]["params"]
            assert params["api-version"] == "2025-01-01"

    @pytest.mark.asyncio
    async def test_sends_response_format_json(self):
        mock_resp = MagicMock()
        mock_resp.json.return_value = {"choices": [{"message": {"content": "{}"}}]}
        mock_resp.raise_for_status = MagicMock()

        with patch("app.services.ai_service._get_llm_client") as mock_get:
            mock_client = AsyncMock()
            mock_get.return_value = mock_client
            mock_client.post = AsyncMock(return_value=mock_resp)

            await _call_azure_openai(
                "https://my-resource.openai.azure.com",
                "my-azure-key",
                "my-gpt4o-deployment",
                [{"role": "user", "content": "test"}],
            )

            payload = mock_client.post.call_args[1]["json"]
            assert payload["response_format"] == {"type": "json_object"}
            assert payload["temperature"] == 0.1

    @pytest.mark.asyncio
    async def test_http_error_raises(self):
        with patch("app.services.ai_service._get_llm_client") as mock_get:
            mock_client = AsyncMock()
            mock_get.return_value = mock_client
            mock_client.post = AsyncMock(side_effect=httpx.HTTPError("Unauthorized"))

            with pytest.raises(httpx.HTTPError):
                await _call_azure_openai(
                    "https://my-resource.openai.azure.com",
                    "bad-key",
                    "my-gpt4o-deployment",
                    [{"role": "user", "content": "test"}],
                )


# ---------------------------------------------------------------------------
# call_llm dispatcher — Azure
# ---------------------------------------------------------------------------


class TestCallLLMDispatcherAzure:
    @pytest.mark.asyncio
    async def test_routes_to_azure_openai(self):
        with patch("app.services.ai_service._call_azure_openai") as mock_azure:
            mock_azure.return_value = {"description": "test"}
            result = await call_llm(
                "https://my-resource.openai.azure.com",
                "my-gpt4o-deployment",
                [{"role": "user", "content": "test"}],
                provider_type="azure_openai",
                api_key="azure-key",
                api_version="2025-01-01",
            )
            mock_azure.assert_called_once_with(
                "https://my-resource.openai.azure.com",
                "azure-key",
                "my-gpt4o-deployment",
                [{"role": "user", "content": "test"}],
                "2025-01-01",
            )
            assert result == {"description": "test"}

    @pytest.mark.asyncio
    async def test_azure_does_not_route_to_openai(self):
        with (
            patch("app.services.ai_service._call_azure_openai") as mock_azure,
            patch("app.services.ai_service._call_openai_compatible") as mock_openai,
        ):
            mock_azure.return_value = {}
            await call_llm(
                "https://my-resource.openai.azure.com",
                "my-gpt4o-deployment",
                [{"role": "user", "content": "test"}],
                provider_type="azure_openai",
                api_key="azure-key",
            )
            mock_azure.assert_called_once()
            mock_openai.assert_not_called()


# ---------------------------------------------------------------------------
# check_provider_connection — Azure
# ---------------------------------------------------------------------------


class TestProviderConnectionAzure:
    @pytest.mark.asyncio
    async def test_azure_makes_test_chat_call(self):
        mock_resp = MagicMock()
        mock_resp.json.return_value = {"choices": [{"message": {"content": "Hi"}}]}
        mock_resp.raise_for_status = MagicMock()

        with patch("app.services.ai_service._get_llm_client") as mock_get:
            mock_client = AsyncMock()
            mock_get.return_value = mock_client
            mock_client.post = AsyncMock(return_value=mock_resp)

            result = await check_provider_connection(
                "https://my-resource.openai.azure.com",
                provider_type="azure_openai",
                api_key="azure-key",
                model="my-gpt4o-deployment",
            )
            assert result["ok"] is True
            assert result["model_found"] is True
            assert result["available_models"] == []

    @pytest.mark.asyncio
    async def test_azure_url_contains_deployment(self):
        mock_resp = MagicMock()
        mock_resp.raise_for_status = MagicMock()
        mock_resp.json.return_value = {}

        with patch("app.services.ai_service._get_llm_client") as mock_get:
            mock_client = AsyncMock()
            mock_get.return_value = mock_client
            mock_client.post = AsyncMock(return_value=mock_resp)

            await check_provider_connection(
                "https://my-resource.openai.azure.com",
                provider_type="azure_openai",
                api_key="azure-key",
                model="my-gpt4o-deployment",
            )

            url = mock_client.post.call_args[0][0]
            assert "/openai/deployments/my-gpt4o-deployment/chat/completions" in url

    @pytest.mark.asyncio
    async def test_azure_uses_api_key_header(self):
        mock_resp = MagicMock()
        mock_resp.raise_for_status = MagicMock()
        mock_resp.json.return_value = {}

        with patch("app.services.ai_service._get_llm_client") as mock_get:
            mock_client = AsyncMock()
            mock_get.return_value = mock_client
            mock_client.post = AsyncMock(return_value=mock_resp)

            await check_provider_connection(
                "https://my-resource.openai.azure.com",
                provider_type="azure_openai",
                api_key="my-azure-key",
                model="my-gpt4o-deployment",
            )

            headers = mock_client.post.call_args[1]["headers"]
            assert headers["api-key"] == "my-azure-key"
            assert "Authorization" not in headers

    @pytest.mark.asyncio
    async def test_azure_sends_api_version_param(self):
        mock_resp = MagicMock()
        mock_resp.raise_for_status = MagicMock()
        mock_resp.json.return_value = {}

        with patch("app.services.ai_service._get_llm_client") as mock_get:
            mock_client = AsyncMock()
            mock_get.return_value = mock_client
            mock_client.post = AsyncMock(return_value=mock_resp)

            await check_provider_connection(
                "https://my-resource.openai.azure.com",
                provider_type="azure_openai",
                api_key="azure-key",
                model="my-gpt4o-deployment",
                api_version="2024-05-01-preview",
            )

            params = mock_client.post.call_args[1]["params"]
            assert params["api-version"] == "2024-05-01-preview"

    @pytest.mark.asyncio
    async def test_azure_401_raises_invalid_key_error(self):
        with patch("app.services.ai_service._get_llm_client") as mock_get:
            mock_client = AsyncMock()
            mock_get.return_value = mock_client
            mock_response = MagicMock()
            mock_response.status_code = 401
            mock_client.post = AsyncMock(
                side_effect=httpx.HTTPStatusError(
                    "401", request=MagicMock(), response=mock_response
                )
            )

            with pytest.raises(httpx.HTTPError, match="Invalid Azure OpenAI API key"):
                await check_provider_connection(
                    "https://my-resource.openai.azure.com",
                    provider_type="azure_openai",
                    api_key="bad-key",
                    model="my-gpt4o-deployment",
                )

    @pytest.mark.asyncio
    async def test_azure_404_raises_deployment_not_found(self):
        with patch("app.services.ai_service._get_llm_client") as mock_get:
            mock_client = AsyncMock()
            mock_get.return_value = mock_client
            mock_response = MagicMock()
            mock_response.status_code = 404
            mock_client.post = AsyncMock(
                side_effect=httpx.HTTPStatusError(
                    "404", request=MagicMock(), response=mock_response
                )
            )

            with pytest.raises(httpx.HTTPError, match="not found"):
                await check_provider_connection(
                    "https://my-resource.openai.azure.com",
                    provider_type="azure_openai",
                    api_key="azure-key",
                    model="nonexistent-deployment",
                )

    @pytest.mark.asyncio
    async def test_azure_missing_model_raises(self):
        with pytest.raises(httpx.HTTPError, match="Deployment name"):
            await check_provider_connection(
                "https://my-resource.openai.azure.com",
                provider_type="azure_openai",
                api_key="azure-key",
                model="",
            )


# ---------------------------------------------------------------------------
# suggest_metadata — Azure provider
# ---------------------------------------------------------------------------


class TestSuggestMetadataAzure:
    @pytest.mark.asyncio
    async def test_uses_duckduckgo_for_azure_provider(self):
        with (
            patch("app.services.ai_service.web_search") as mock_search,
            patch("app.services.ai_service.call_llm") as mock_llm,
        ):
            mock_search.return_value = [
                {"url": "https://example.com", "title": "Example", "snippet": "Info"},
            ]
            mock_llm.return_value = {
                "description": {"value": "A product", "confidence": 0.8},
            }

            result = await suggest_metadata(
                name="Test App",
                type_key="Application",
                type_label="Application",
                subtype=None,
                provider_url="https://my-resource.openai.azure.com",
                model="my-gpt4o-deployment",
                provider_type="azure_openai",
                api_key="azure-key",
                api_version="2025-01-01",
            )

            mock_search.assert_called_once()
            assert mock_search.call_args[0][1] == "duckduckgo"

            llm_call = mock_llm.call_args
            assert llm_call[1]["provider_type"] == "azure_openai"
            assert llm_call[1]["api_key"] == "azure-key"
            assert llm_call[1]["api_version"] == "2025-01-01"

            assert result["search_provider"] == "duckduckgo"

    @pytest.mark.asyncio
    async def test_passes_api_version_to_call_llm(self):
        with (
            patch("app.services.ai_service.web_search") as mock_search,
            patch("app.services.ai_service.call_llm") as mock_llm,
        ):
            mock_search.return_value = []
            mock_llm.return_value = {"description": {"value": "Test", "confidence": 0.7}}

            await suggest_metadata(
                name="Test App",
                type_key="Application",
                type_label="Application",
                subtype=None,
                provider_url="https://my-resource.openai.azure.com",
                model="my-gpt4o-deployment",
                provider_type="azure_openai",
                api_key="azure-key",
                api_version="2024-05-01-preview",
            )

            assert mock_llm.call_args[1]["api_version"] == "2024-05-01-preview"


# ---------------------------------------------------------------------------
# Amazon Bedrock
# ---------------------------------------------------------------------------


class TestCallBedrock:
    @pytest.mark.asyncio
    async def test_parses_json_from_converse_text(self):
        with patch("app.services.bedrock.converse", new=AsyncMock()) as mock_converse:
            mock_converse.return_value = {
                "text": '{"description": {"value": "An ERP suite"}}',
                "truncated": False,
            }
            result = await _call_bedrock(
                "eu-central-1",
                "",
                "eu.anthropic.claude-sonnet-4",
                [
                    {"role": "system", "content": "reply in json"},
                    {"role": "user", "content": "SAP"},
                ],
            )

        assert result == {"description": {"value": "An ERP suite"}}
        kwargs = mock_converse.call_args.kwargs
        assert kwargs["api_key"] == ""
        assert kwargs["max_tokens"] == 4096
        args = mock_converse.call_args.args
        assert args[0] == "eu-central-1"
        assert args[1] == "eu.anthropic.claude-sonnet-4"

    @pytest.mark.asyncio
    async def test_strips_a_markdown_fence(self):
        with patch("app.services.bedrock.converse", new=AsyncMock()) as mock_converse:
            mock_converse.return_value = {
                "text": '```json\n{"description": {"value": "x"}}\n```',
                "truncated": False,
            }
            result = await _call_bedrock(
                "eu-central-1", "", "m", [{"role": "user", "content": "q"}]
            )
        assert result == {"description": {"value": "x"}}

    @pytest.mark.asyncio
    async def test_bedrock_error_becomes_an_httpx_error(self):
        """Callers already map httpx.HTTPError to a 'cannot reach the provider' 502."""
        with patch("app.services.bedrock.converse", new=AsyncMock()) as mock_converse:
            mock_converse.side_effect = bedrock.BedrockError(
                "AccessDeniedException: nope", kind="credentials_invalid", code="AccessDenied"
            )
            with pytest.raises(httpx.HTTPError) as exc:
                await _call_bedrock("eu-central-1", "", "m", [{"role": "user", "content": "q"}])
        assert "Bedrock" in str(exc.value)


class TestCallLLMDispatcherBedrock:
    @pytest.mark.asyncio
    async def test_routes_to_bedrock(self):
        with patch("app.services.ai_service._call_bedrock") as mock_bedrock:
            mock_bedrock.return_value = {"description": "test"}
            result = await call_llm(
                "eu-central-1",
                "eu.anthropic.claude-sonnet-4",
                [{"role": "user", "content": "test"}],
                provider_type="bedrock",
                api_key="",
            )
            mock_bedrock.assert_called_once_with(
                "eu-central-1",
                "",
                "eu.anthropic.claude-sonnet-4",
                [{"role": "user", "content": "test"}],
            )
            assert result == {"description": "test"}


class TestProviderConnectionBedrock:
    @pytest.mark.asyncio
    async def test_lists_models_and_inference_profiles(self):
        with patch("app.services.bedrock.list_model_ids", new=AsyncMock()) as mock_list:
            mock_list.return_value = ["eu.anthropic.claude-sonnet-4", "amazon.nova-lite"]
            result = await check_provider_connection(
                "eu-central-1",
                provider_type="bedrock",
                model="eu.anthropic.claude-sonnet-4",
            )

        assert result["ok"] is True
        assert result["model_found"] is True
        assert "amazon.nova-lite" in result["available_models"]
        mock_list.assert_called_once_with("eu-central-1", api_key="")

    @pytest.mark.asyncio
    async def test_foundation_model_id_matches_its_inference_profile(self):
        """A model only callable through a profile must not read as 'not found'."""
        with patch("app.services.bedrock.list_model_ids", new=AsyncMock()) as mock_list:
            mock_list.return_value = ["eu.anthropic.claude-sonnet-4-20250514-v1:0"]
            result = await check_provider_connection(
                "eu-central-1",
                provider_type="bedrock",
                model="anthropic.claude-sonnet-4-20250514-v1:0",
            )
        assert result["model_found"] is True

    @pytest.mark.asyncio
    async def test_unknown_model_is_not_found(self):
        with patch("app.services.bedrock.list_model_ids", new=AsyncMock()) as mock_list:
            mock_list.return_value = ["amazon.nova-lite"]
            result = await check_provider_connection(
                "eu-central-1", provider_type="bedrock", model="mistral.large"
            )
        assert result["model_found"] is False

    @pytest.mark.asyncio
    async def test_caps_the_returned_list(self):
        with patch("app.services.bedrock.list_model_ids", new=AsyncMock()) as mock_list:
            mock_list.return_value = [f"model-{i}" for i in range(50)]
            result = await check_provider_connection(
                "eu-central-1", provider_type="bedrock", model="model-49"
            )
        assert len(result["available_models"]) == 30
        # Matched against the full list, not the truncated one.
        assert result["model_found"] is True

    @pytest.mark.asyncio
    async def test_missing_region_raises(self):
        with pytest.raises(httpx.HTTPError) as exc:
            await check_provider_connection("", provider_type="bedrock", model="m")
        assert "region" in str(exc.value).lower()

    @pytest.mark.asyncio
    async def test_bedrock_error_becomes_an_httpx_error(self):
        with patch("app.services.bedrock.list_model_ids", new=AsyncMock()) as mock_list:
            mock_list.side_effect = bedrock.BedrockError(
                "NoCredentials", kind="credentials_missing", code="NoCredentialsError"
            )
            with pytest.raises(httpx.HTTPError) as exc:
                await check_provider_connection("eu-central-1", provider_type="bedrock", model="m")
        assert "Cannot reach Bedrock" in str(exc.value)

    @pytest.mark.asyncio
    async def test_passes_explicit_credentials_through(self):
        with patch("app.services.bedrock.list_model_ids", new=AsyncMock()) as mock_list:
            mock_list.return_value = []
            await check_provider_connection(
                "eu-central-1", provider_type="bedrock", api_key="AKIA:secret", model=""
            )
        mock_list.assert_called_once_with("eu-central-1", api_key="AKIA:secret")
