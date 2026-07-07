"""Tests for the TurboLens shared AI caller (turbolens_ai.py).

These tests do NOT require a database — they test the provider config mapping,
the "is configured" gate, and request construction with mocked HTTP calls.
Focus: the Azure Hosted OpenAI provider (issue #776), which the other providers
already covered.
"""

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

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
        db = _fake_db(
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
            patch("app.services.turbolens_ai._get_llm_client") as mock_get,
        ):
            mock_client = AsyncMock()
            mock_get.return_value = mock_client
            mock_client.post = AsyncMock(return_value=mock_resp)

            out = await call_ai(db, "prompt text", max_tokens=512, system_prompt="be nice")

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
