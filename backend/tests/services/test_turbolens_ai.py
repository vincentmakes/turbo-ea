"""Tests for the TurboLens shared AI caller (turbolens_ai.py).

These tests do NOT require a database — they test the provider config mapping,
the "is configured" gate, and request construction with mocked HTTP calls.
Focus: the Azure Hosted OpenAI provider (issue #776), which the other providers
already covered.
"""

from contextlib import asynccontextmanager
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

import app.services.turbolens_ai as turbolens_ai
from app.services import bedrock
from app.services.ai_service import DEFAULT_AZURE_API_VERSION
from app.services.turbolens_ai import (
    _get_llm_client,
    call_ai,
    get_ai_config,
    is_ai_configured,
)


def _fake_db(ai_cfg: dict):
    """Build a mock AsyncSession whose single AppSettings row carries ai_cfg."""
    settings = MagicMock()
    settings.general_settings = {"ai": ai_cfg}
    result = MagicMock()
    result.scalar_one_or_none.return_value = settings
    db = MagicMock()
    db.execute = AsyncMock(return_value=result)
    return db


def _fake_session_factory(ai_cfg: dict):
    """Patch target for ``turbolens_ai.async_session``.

    ``call_ai`` opens its own short-lived session for the config read rather
    than borrowing the caller's, so tests supply the session this way instead
    of passing one in.
    """

    @asynccontextmanager
    async def _factory():
        yield _fake_db(ai_cfg)

    return _factory


# ---------------------------------------------------------------------------
# get_ai_config — provider mapping
# ---------------------------------------------------------------------------


class TestGetAiConfig:
    @pytest.mark.asyncio
    async def test_azure_openai_maps_to_azure_and_reads_api_version(self):
        db = _fake_db(
            {
                "providerType": "azure_openai",
                "apiKey": "enc:whatever",
                "providerUrl": "https://my-resource.openai.azure.com",
                "model": "my-gpt4o-deployment",
                "apiVersion": "2024-10-21",
            }
        )
        with patch("app.services.turbolens_ai.decrypt_value", return_value="azure-key"):
            config = await get_ai_config(db)

        assert config["provider"] == "azure"
        assert config["api_key"] == "azure-key"
        assert config["provider_url"] == "https://my-resource.openai.azure.com"
        assert config["model"] == "my-gpt4o-deployment"
        assert config["api_version"] == "2024-10-21"

    @pytest.mark.asyncio
    async def test_azure_api_version_falls_back_to_default(self):
        db = _fake_db(
            {
                "providerType": "azure_openai",
                "apiKey": "",
                "providerUrl": "https://my-resource.openai.azure.com",
                "model": "dep",
            }
        )
        config = await get_ai_config(db)
        assert config["api_version"] == DEFAULT_AZURE_API_VERSION

    @pytest.mark.asyncio
    async def test_anthropic_still_maps_to_claude(self):
        db = _fake_db({"providerType": "anthropic", "apiKey": "enc:x"})
        with patch("app.services.turbolens_ai.decrypt_value", return_value="k"):
            config = await get_ai_config(db)
        assert config["provider"] == "claude"


# ---------------------------------------------------------------------------
# is_ai_configured — Azure gate
# ---------------------------------------------------------------------------


class TestIsAiConfigured:
    def test_azure_configured_with_url_and_key(self):
        assert is_ai_configured(
            {
                "provider": "azure",
                "api_key": "azure-key",
                "provider_url": "https://my-resource.openai.azure.com",
                "model": "dep",
            }
        )

    def test_azure_missing_url_not_configured(self):
        assert not is_ai_configured(
            {"provider": "azure", "api_key": "azure-key", "provider_url": "", "model": "dep"}
        )

    def test_azure_missing_key_not_configured(self):
        assert not is_ai_configured(
            {
                "provider": "azure",
                "api_key": "",
                "provider_url": "https://my-resource.openai.azure.com",
                "model": "dep",
            }
        )

    def test_claude_still_configured_with_key(self):
        assert is_ai_configured(
            {"provider": "claude", "api_key": "k", "provider_url": "", "model": ""}
        )


# ---------------------------------------------------------------------------
# call_ai — Azure request construction
# ---------------------------------------------------------------------------


class TestCallAiAzure:
    @pytest.mark.asyncio
    async def test_azure_request_shape(self):
        session_factory = _fake_session_factory(
            {
                "providerType": "azure_openai",
                "apiKey": "enc:x",
                "providerUrl": "https://my-resource.openai.azure.com",
                "model": "my-gpt4o-deployment",
                "apiVersion": "2024-10-21",
            }
        )
        mock_resp = MagicMock()
        mock_resp.is_success = True
        mock_resp.json.return_value = {
            "choices": [{"message": {"content": "hello"}, "finish_reason": "stop"}]
        }

        with (
            patch("app.services.turbolens_ai.decrypt_value", return_value="azure-key"),
            patch("app.services.turbolens_ai.async_session", session_factory),
            patch("app.services.turbolens_ai._get_llm_client") as mock_get,
        ):
            mock_client = AsyncMock()
            mock_get.return_value = mock_client
            mock_client.post = AsyncMock(return_value=mock_resp)

            out = await call_ai("prompt text", max_tokens=512, system_prompt="be nice")

        assert out == {"text": "hello", "truncated": False}

        args, kwargs = mock_client.post.call_args
        url = args[0]
        # Deployment name in the path, api-version query param present
        assert "/openai/deployments/my-gpt4o-deployment/chat/completions" in url
        assert "api-version=2024-10-21" in url
        # Azure auth header, not Bearer; model NOT in body
        assert kwargs["headers"]["api-key"] == "azure-key"
        assert "Authorization" not in kwargs["headers"]
        assert "model" not in kwargs["json"]
        # System prompt threaded as a system message
        assert kwargs["json"]["messages"][0] == {"role": "system", "content": "be nice"}
        assert kwargs["json"]["max_tokens"] == 512


# ---------------------------------------------------------------------------
# Amazon Bedrock (issue #1120)
# ---------------------------------------------------------------------------


class TestGetAiConfigBedrock:
    @pytest.mark.asyncio
    async def test_bedrock_maps_to_itself_and_keeps_the_region(self):
        db = _fake_db(
            {
                "providerType": "bedrock",
                "apiKey": "",
                "providerUrl": "eu-central-1",
                "model": "eu.anthropic.claude-sonnet-4",
            }
        )
        config = await get_ai_config(db)
        assert config["provider"] == "bedrock"
        assert config["provider_url"] == "eu-central-1"
        assert config["api_key"] == ""


class TestIsAiConfiguredBedrock:
    def test_region_and_model_without_a_key_is_configured(self):
        """Bedrock authenticates through the container's IAM role — no key needed."""
        assert is_ai_configured(
            {
                "provider": "bedrock",
                "api_key": "",
                "provider_url": "eu-central-1",
                "model": "eu.anthropic.claude-sonnet-4",
            }
        )

    def test_explicit_credentials_also_configured(self):
        assert is_ai_configured(
            {
                "provider": "bedrock",
                "api_key": "AKIA:secret",
                "provider_url": "eu-central-1",
                "model": "m",
            }
        )

    def test_missing_region_not_configured(self):
        assert not is_ai_configured(
            {"provider": "bedrock", "api_key": "", "provider_url": "", "model": "m"}
        )

    def test_missing_model_not_configured(self):
        assert not is_ai_configured(
            {"provider": "bedrock", "api_key": "", "provider_url": "eu-central-1", "model": ""}
        )


class TestCallAiBedrock:
    def _session(self, **overrides):
        cfg = {
            "providerType": "bedrock",
            "apiKey": "",
            "providerUrl": "eu-central-1",
            "model": "eu.anthropic.claude-sonnet-4",
        }
        cfg.update(overrides)
        return _fake_session_factory(cfg)

    @pytest.mark.asyncio
    async def test_no_api_key_does_not_raise_key_missing(self):
        """The missing-key guard is for HTTP providers; Bedrock uses the IAM role."""
        with (
            patch("app.services.turbolens_ai.async_session", self._session()),
            patch("app.services.bedrock.converse", new=AsyncMock()) as mock_converse,
        ):
            mock_converse.return_value = {"text": "hello", "truncated": False}
            out = await call_ai("prompt text", max_tokens=512, system_prompt="be nice")

        assert out == {"text": "hello", "truncated": False}

    @pytest.mark.asyncio
    async def test_request_shape(self):
        with (
            patch("app.services.turbolens_ai.async_session", self._session()),
            patch("app.services.bedrock.converse", new=AsyncMock()) as mock_converse,
        ):
            mock_converse.return_value = {"text": "hello", "truncated": False}
            await call_ai("prompt text", max_tokens=512, system_prompt="be nice")

        args = mock_converse.call_args.args
        kwargs = mock_converse.call_args.kwargs
        assert args[0] == "eu-central-1"
        assert args[1] == "eu.anthropic.claude-sonnet-4"
        # System prompt threaded as a system message; bedrock.py lifts it into
        # the Converse `system` parameter.
        assert args[2] == [
            {"role": "system", "content": "be nice"},
            {"role": "user", "content": "prompt text"},
        ]
        assert kwargs["max_tokens"] == 512

    @pytest.mark.asyncio
    async def test_no_system_prompt_sends_only_the_user_message(self):
        with (
            patch("app.services.turbolens_ai.async_session", self._session()),
            patch("app.services.bedrock.converse", new=AsyncMock()) as mock_converse,
        ):
            mock_converse.return_value = {"text": "hello", "truncated": False}
            await call_ai("prompt text")

        assert mock_converse.call_args.args[2] == [{"role": "user", "content": "prompt text"}]

    @pytest.mark.asyncio
    async def test_explicit_credentials_are_forwarded(self):
        with (
            patch("app.services.turbolens_ai.async_session", self._session(apiKey="enc:x")),
            patch("app.services.turbolens_ai.decrypt_value", return_value="AKIA:secret"),
            patch("app.services.bedrock.converse", new=AsyncMock()) as mock_converse,
        ):
            mock_converse.return_value = {"text": "hello", "truncated": False}
            await call_ai("prompt text")

        assert mock_converse.call_args.kwargs["api_key"] == "AKIA:secret"

    @pytest.mark.asyncio
    async def test_truncation_is_surfaced(self):
        with (
            patch("app.services.turbolens_ai.async_session", self._session()),
            patch("app.services.bedrock.converse", new=AsyncMock()) as mock_converse,
        ):
            mock_converse.return_value = {"text": "cut", "truncated": True}
            out = await call_ai("prompt text", max_tokens=16)

        assert out == {"text": "cut", "truncated": True}

    @pytest.mark.asyncio
    async def test_missing_model_is_refused(self):
        with (
            patch("app.services.turbolens_ai.async_session", self._session(model="")),
            patch("app.services.bedrock.converse", new=AsyncMock()) as mock_converse,
        ):
            with pytest.raises(ValueError, match="model"):
                await call_ai("prompt text")
            mock_converse.assert_not_called()

    @pytest.mark.asyncio
    @pytest.mark.parametrize(
        "kind,token",
        [
            ("credentials_missing", "AI_KEY_MISSING"),
            ("credentials_invalid", "AI_KEY_INVALID:bedrock"),
            ("quota", "AI_QUOTA_EXCEEDED:bedrock"),
        ],
    )
    async def test_errors_map_to_the_shared_tokens(self, kind, token):
        with (
            patch("app.services.turbolens_ai.async_session", self._session()),
            patch("app.services.bedrock.converse", new=AsyncMock()) as mock_converse,
        ):
            mock_converse.side_effect = bedrock.BedrockError("boom", kind=kind, code="X")
            with pytest.raises(ValueError) as exc:
                await call_ai("prompt text")

        assert str(exc.value) == token

    @pytest.mark.asyncio
    async def test_other_errors_keep_their_message(self):
        """A ValidationException message is what names the inference profile fix."""
        with (
            patch("app.services.turbolens_ai.async_session", self._session()),
            patch("app.services.bedrock.converse", new=AsyncMock()) as mock_converse,
        ):
            mock_converse.side_effect = bedrock.BedrockError(
                "ValidationException: use an inference profile",
                kind="other",
                code="ValidationException",
            )
            with pytest.raises(ValueError, match="inference profile"):
                await call_ai("prompt text")


# ---------------------------------------------------------------------------
# The HTTP providers — request shape, truncation and the error tokens
# ---------------------------------------------------------------------------


def _patched_http(session_factory, *, status=200, payload=None, text="", key="k"):
    """Patch the config session, the key decrypt and the LLM client; return
    the patch context and the client whose ``post`` records the request."""
    mock_resp = MagicMock()
    mock_resp.is_success = 200 <= status < 300
    mock_resp.status_code = status
    mock_resp.text = text
    mock_resp.json.return_value = payload or {}
    mock_client = AsyncMock()
    mock_client.post = AsyncMock(return_value=mock_resp)
    ctx = patch.multiple(
        "app.services.turbolens_ai",
        decrypt_value=MagicMock(return_value=key),
        async_session=session_factory,
        _get_llm_client=AsyncMock(return_value=mock_client),
    )
    return ctx, mock_client


class TestCallAiProviders:
    async def test_claude_request_and_truncation(self):
        factory = _fake_session_factory({"providerType": "anthropic", "apiKey": "enc:x"})
        ctx, client = _patched_http(
            factory, payload={"content": [{"text": "hi"}], "stop_reason": "max_tokens"}
        )
        with ctx:
            out = await call_ai("p", max_tokens=100, system_prompt="sys")
        assert out == {"text": "hi", "truncated": True}
        args, kwargs = client.post.call_args
        assert args[0] == "https://api.anthropic.com/v1/messages"
        assert kwargs["headers"]["x-api-key"] == "k"
        assert kwargs["headers"]["anthropic-version"] == "2023-06-01"
        assert kwargs["json"] == {
            "model": "claude-sonnet-4-20250514",
            "max_tokens": 100,
            "messages": [{"role": "user", "content": "p"}],
            "system": "sys",
        }

    async def test_openai_defaults_and_a_custom_base_url(self):
        factory = _fake_session_factory({"providerType": "openai", "apiKey": "enc:x"})
        ctx, client = _patched_http(
            factory,
            payload={"choices": [{"message": {"content": "ok"}, "finish_reason": "length"}]},
        )
        with ctx:
            out = await call_ai("p")
        assert out == {"text": "ok", "truncated": True}
        args, kwargs = client.post.call_args
        assert args[0] == "https://api.openai.com/v1/chat/completions"
        assert kwargs["headers"]["Authorization"] == "Bearer k"
        assert kwargs["json"] == {
            "model": "gpt-4o",
            "max_tokens": 2048,
            "messages": [{"role": "user", "content": "p"}],
        }

        factory = _fake_session_factory(
            {
                "providerType": "openai_compatible",
                "apiKey": "enc:x",
                "model": "m",
                "providerUrl": "https://llm.local/",
            }
        )
        ctx, client = _patched_http(factory, payload={"choices": [{"message": {"content": "ok"}}]})
        with ctx:
            out = await call_ai("p", system_prompt="s")
        assert out["truncated"] is False
        args, kwargs = client.post.call_args
        assert args[0] == "https://llm.local/v1/chat/completions"
        assert kwargs["json"]["model"] == "m"
        assert kwargs["json"]["messages"][0] == {"role": "system", "content": "s"}

    async def test_deepseek(self):
        factory = _fake_session_factory({"providerType": "deepseek", "apiKey": "enc:x"})
        ctx, client = _patched_http(
            factory, payload={"choices": [{"message": {"content": "d"}, "finish_reason": "stop"}]}
        )
        with ctx:
            assert await call_ai("p") == {"text": "d", "truncated": False}
        args, kwargs = client.post.call_args
        assert args[0] == "https://api.deepseek.com/v1/chat/completions"
        assert kwargs["json"]["model"] == "deepseek-chat"

    async def test_gemini(self):
        factory = _fake_session_factory({"providerType": "gemini", "apiKey": "enc:x"})
        payload = {"candidates": [{"content": {"parts": [{"text": "g"}]}}]}
        ctx, client = _patched_http(factory, payload=payload)
        with ctx:
            assert await call_ai("p", max_tokens=300, system_prompt="s") == {
                "text": "g",
                "truncated": False,
            }
        args, kwargs = client.post.call_args
        assert args[0] == (
            "https://generativelanguage.googleapis.com/v1beta/models/"
            "gemini-1.5-pro:generateContent?key=k"
        )
        assert kwargs["headers"] == {"Content-Type": "application/json"}
        assert kwargs["json"] == {
            "contents": [{"parts": [{"text": "s\n\np"}]}],
            "generationConfig": {"maxOutputTokens": 300, "temperature": 0.2},
        }

    async def test_ollama_needs_no_key(self):
        factory = _fake_session_factory({"providerType": "ollama", "apiKey": "", "model": "llama3"})
        ctx, client = _patched_http(
            factory, payload={"message": {"content": "o"}, "done": False}, key=""
        )
        with ctx:
            assert await call_ai("p") == {"text": "o", "truncated": True}
        args, kwargs = client.post.call_args
        assert args[0] == "http://localhost:11434/api/chat"
        assert kwargs["json"] == {
            "model": "llama3",
            "messages": [{"role": "user", "content": "p"}],
            "stream": False,
        }

    async def test_unknown_provider_is_refused(self):
        factory = _fake_session_factory({"providerType": "weird", "apiKey": "enc:x"})
        ctx, _ = _patched_http(factory)
        with ctx, pytest.raises(ValueError, match="Unknown AI provider: weird"):
            await call_ai("p")

    async def test_a_missing_key_is_the_shared_token(self):
        factory = _fake_session_factory({"providerType": "openai", "apiKey": ""})
        ctx, client = _patched_http(factory, key="")
        with ctx, pytest.raises(ValueError, match="AI_KEY_MISSING"):
            await call_ai("p")
        client.post.assert_not_called()

    @pytest.mark.parametrize(
        "status,token",
        [
            (401, "AI_KEY_INVALID:openai"),
            (403, "AI_KEY_INVALID:openai"),
            (429, "AI_QUOTA_EXCEEDED:openai"),
            (402, "AI_QUOTA_EXCEEDED:openai"),
        ],
    )
    async def test_auth_and_quota_errors_map_to_tokens(self, status, token):
        factory = _fake_session_factory({"providerType": "openai", "apiKey": "enc:x"})
        ctx, _ = _patched_http(factory, status=status, text="denied")
        with ctx, pytest.raises(ValueError, match=token):
            await call_ai("p")

    async def test_other_http_errors_carry_status_and_text(self):
        factory = _fake_session_factory({"providerType": "openai", "apiKey": "enc:x"})
        ctx, _ = _patched_http(factory, status=500, text="boom")
        with ctx, pytest.raises(ValueError, match="openai API error 500: boom"):
            await call_ai("p")


class TestLlmClient:
    async def test_the_client_is_reused_until_closed(self, monkeypatch):
        monkeypatch.setattr(turbolens_ai, "_llm_client", None)
        first = await _get_llm_client()
        assert await _get_llm_client() is first
        await first.aclose()
        fresh = await _get_llm_client()
        assert fresh is not first
        await fresh.aclose()


class TestGetAiConfigEmpty:
    async def test_no_settings_row_is_an_empty_config(self):
        result = MagicMock()
        result.scalar_one_or_none.return_value = None
        db = MagicMock()
        db.execute = AsyncMock(return_value=result)
        assert await get_ai_config(db) == {
            "provider": "",
            "api_key": "",
            "provider_url": "",
            "model": "",
        }

    async def test_a_row_without_general_settings_is_an_empty_config(self):
        settings = MagicMock()
        settings.general_settings = None
        result = MagicMock()
        result.scalar_one_or_none.return_value = settings
        db = MagicMock()
        db.execute = AsyncMock(return_value=result)
        assert (await get_ai_config(db))["provider"] == ""
