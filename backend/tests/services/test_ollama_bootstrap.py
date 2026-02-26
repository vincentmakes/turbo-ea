"""Unit tests for the Ollama auto-configure and model pull logic in main.py.

These tests do NOT require a database — they mock all external dependencies.
"""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import httpx
import pytest

from app.main import _auto_configure_ai, _ensure_ollama_model

# ---------------------------------------------------------------------------
# _auto_configure_ai
# ---------------------------------------------------------------------------


class TestAutoConfigureAi:
    @pytest.mark.asyncio
    async def test_skips_when_no_provider_url(self):
        with patch("app.main.settings") as mock_settings:
            mock_settings.AI_PROVIDER_URL = ""
            mock_settings.AI_MODEL = "gemma3:4b"
            await _auto_configure_ai()
            # Should return without touching DB

    @pytest.mark.asyncio
    async def test_skips_when_no_model(self):
        with patch("app.main.settings") as mock_settings:
            mock_settings.AI_PROVIDER_URL = "http://ollama:11434"
            mock_settings.AI_MODEL = ""
            await _auto_configure_ai()

    @pytest.mark.asyncio
    async def test_skips_when_already_configured(self):
        mock_row = MagicMock()
        mock_row.general_settings = {
            "ai": {"enabled": True, "providerUrl": "http://other:11434", "model": "llama3"}
        }
        mock_result = MagicMock()
        mock_result.scalar_one_or_none.return_value = mock_row

        mock_db = AsyncMock()
        mock_db.execute = AsyncMock(return_value=mock_result)
        mock_db.commit = AsyncMock()

        mock_session = AsyncMock()
        mock_session.__aenter__ = AsyncMock(return_value=mock_db)
        mock_session.__aexit__ = AsyncMock(return_value=False)

        with (
            patch("app.main.settings") as mock_settings,
            patch("app.database.async_session", return_value=mock_session),
        ):
            mock_settings.AI_PROVIDER_URL = "http://ollama:11434"
            mock_settings.AI_MODEL = "gemma3:4b"
            mock_settings.AI_SEARCH_PROVIDER = ""
            mock_settings.AI_SEARCH_URL = ""

            await _auto_configure_ai()
            # Should NOT have committed (already configured)
            mock_db.commit.assert_not_called()

    @pytest.mark.asyncio
    async def test_writes_config_when_not_configured(self):
        mock_row = MagicMock()
        mock_row.general_settings = {}
        mock_result = MagicMock()
        mock_result.scalar_one_or_none.return_value = mock_row

        mock_db = AsyncMock()
        mock_db.execute = AsyncMock(return_value=mock_result)
        mock_db.commit = AsyncMock()

        mock_session = AsyncMock()
        mock_session.__aenter__ = AsyncMock(return_value=mock_db)
        mock_session.__aexit__ = AsyncMock(return_value=False)

        with (
            patch("app.main.settings") as mock_settings,
            patch("app.database.async_session", return_value=mock_session),
        ):
            mock_settings.AI_PROVIDER_URL = "http://ollama:11434"
            mock_settings.AI_MODEL = "gemma3:4b"
            mock_settings.AI_SEARCH_PROVIDER = "duckduckgo"
            mock_settings.AI_SEARCH_URL = ""

            await _auto_configure_ai()

            mock_db.commit.assert_called_once()
            assert mock_row.general_settings["ai"]["enabled"] is True
            assert mock_row.general_settings["ai"]["providerUrl"] == "http://ollama:11434"
            assert mock_row.general_settings["ai"]["model"] == "gemma3:4b"


# ---------------------------------------------------------------------------
# _ensure_ollama_model
# ---------------------------------------------------------------------------


class TestEnsureOllamaModel:
    @pytest.mark.asyncio
    async def test_skips_when_no_provider(self):
        with patch("app.main.settings") as mock_settings:
            mock_settings.AI_PROVIDER_URL = ""
            mock_settings.AI_MODEL = "gemma3:4b"
            await _ensure_ollama_model()

    @pytest.mark.asyncio
    async def test_skips_when_model_exists(self):
        tags_resp = MagicMock()
        tags_resp.json.return_value = {"models": [{"name": "gemma3:4b"}]}
        tags_resp.raise_for_status = MagicMock()

        mock_client = AsyncMock()
        mock_client.get = AsyncMock(return_value=tags_resp)
        mock_client.post = AsyncMock()
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=False)

        with (
            patch("app.main.settings") as mock_settings,
            patch("httpx.AsyncClient", return_value=mock_client),
        ):
            mock_settings.AI_PROVIDER_URL = "http://ollama:11434"
            mock_settings.AI_MODEL = "gemma3:4b"

            await _ensure_ollama_model()
            # Should NOT have called post (model already present)
            mock_client.post.assert_not_called()

    @pytest.mark.asyncio
    async def test_pulls_model_when_missing(self):
        tags_resp = MagicMock()
        tags_resp.json.return_value = {"models": []}
        tags_resp.raise_for_status = MagicMock()

        pull_resp = MagicMock()
        pull_resp.raise_for_status = MagicMock()

        # We need two separate clients for the two `async with` blocks
        tags_client = AsyncMock()
        tags_client.get = AsyncMock(return_value=tags_resp)
        tags_client.__aenter__ = AsyncMock(return_value=tags_client)
        tags_client.__aexit__ = AsyncMock(return_value=False)

        pull_client = AsyncMock()
        pull_client.post = AsyncMock(return_value=pull_resp)
        pull_client.__aenter__ = AsyncMock(return_value=pull_client)
        pull_client.__aexit__ = AsyncMock(return_value=False)

        with (
            patch("app.main.settings") as mock_settings,
            patch("httpx.AsyncClient", side_effect=[tags_client, pull_client]),
        ):
            mock_settings.AI_PROVIDER_URL = "http://ollama:11434"
            mock_settings.AI_MODEL = "gemma3:4b"

            await _ensure_ollama_model()
            pull_client.post.assert_called_once()

    @pytest.mark.asyncio
    async def test_handles_unreachable_ollama(self):
        mock_client = AsyncMock()
        mock_client.get = AsyncMock(side_effect=httpx.HTTPError("Connection refused"))
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=False)

        with (
            patch("app.main.settings") as mock_settings,
            patch("httpx.AsyncClient", return_value=mock_client),
        ):
            mock_settings.AI_PROVIDER_URL = "http://ollama:11434"
            mock_settings.AI_MODEL = "gemma3:4b"

            # Should not raise
            await _ensure_ollama_model()
