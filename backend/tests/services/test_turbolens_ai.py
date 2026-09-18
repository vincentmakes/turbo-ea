"""Tests for the TurboLens shared AI caller (turbolens_ai.py).

These tests do NOT require a database — they test the provider config mapping,
the "is configured" gate, and request construction with mocked HTTP calls.
Focus: the Azure Hosted OpenAI provider (issue #776), which the other providers
already covered.
"""

from contextlib import asynccontextmanager
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.services import bedrock
from app.services.ai_service import DEFAULT_AZURE_API_VERSION
from app.services.turbolens_ai import call_ai, get_ai_config, is_ai_configured


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
