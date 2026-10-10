"""Unit tests for the Ollama auto-configure and model pull logic in main.py.

These tests do NOT require a database — they mock all external dependencies.
"""

from __future__ import annotations

import logging
from unittest.mock import AsyncMock, MagicMock, patch

import httpx
import pytest

from app import main as main_mod
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


# ---------------------------------------------------------------------------
# Exact contracts: the settings written, the URLs called, the model match
# ---------------------------------------------------------------------------

LOGGER = "app.main"


def _session_returning(row):
    """An ``async_session()`` stand-in whose one query answers ``row``."""
    result = MagicMock()
    result.scalar_one_or_none.return_value = row
    db = AsyncMock()
    db.execute = AsyncMock(return_value=result)
    db.add = MagicMock()
    session = AsyncMock()
    session.__aenter__ = AsyncMock(return_value=db)
    session.__aexit__ = AsyncMock(return_value=False)
    return session, db


def _http_client(*, get=None, post=None):
    client = AsyncMock()
    client.get = (
        AsyncMock(return_value=get)
        if not isinstance(get, Exception)
        else AsyncMock(side_effect=get)
    )
    client.post = (
        AsyncMock(return_value=post)
        if not isinstance(post, Exception)
        else AsyncMock(side_effect=post)
    )
    client.__aenter__ = AsyncMock(return_value=client)
    client.__aexit__ = AsyncMock(return_value=False)
    return client


def _tags(*names):
    resp = MagicMock()
    resp.json.return_value = {"models": [{"name": n} for n in names]}
    resp.raise_for_status = MagicMock()
    return resp


def _ok():
    resp = MagicMock()
    resp.raise_for_status = MagicMock()
    return resp


def _messages(caplog):
    return [r.getMessage() for r in caplog.records if r.name.startswith(LOGGER)]


class TestOllamaHasModel:
    @pytest.mark.parametrize(
        ("available", "model", "expected"),
        [
            (["gemma3:4b"], "gemma3:4b", True),
            (["gemma3:27b"], "gemma3:4b", False),  # another size is another model
            (["mistral:latest"], "mistral", True),  # no tag means :latest
            (["mistral:7b"], "mistral", False),
            (["llama3.2:latest"], "llama3", False),  # a longer name is another family
            (["codellama:latest"], "llama", False),
            ([], "gemma3:4b", False),
            (["a:1", "gemma3:4b", "b:2"], "gemma3:4b", True),
        ],
    )
    def test_only_the_exact_tag_counts(self, available, model, expected):
        assert main_mod._ollama_has_model(available, model) is expected


class TestAutoConfigureExact:
    @pytest.mark.asyncio
    @pytest.mark.parametrize(("url", "model"), [("", "gemma3:4b"), ("http://o:11434", "")])
    async def test_nothing_is_read_without_url_and_model(self, url, model):
        opened = MagicMock(side_effect=AssertionError("no session expected"))
        with (
            patch("app.main.settings") as s,
            patch("app.database.async_session", opened),
        ):
            s.AI_PROVIDER_URL, s.AI_MODEL = url, model
            await _auto_configure_ai()
        opened.assert_not_called()

    @pytest.mark.asyncio
    async def test_the_whole_ai_block_is_written(self, caplog):
        row = MagicMock()
        row.general_settings = {
            "currency": "EUR",
            "ai": {
                "enabled": True,
                "providerUrl": "",  # not complete: overwritten
                "enabledTypes": ["Application"],
                "portfolioInsightsEnabled": True,
            },
        }
        session, db = _session_returning(row)
        caplog.set_level(logging.INFO)
        with (
            patch("app.main.settings") as s,
            patch("app.database.async_session", return_value=session),
        ):
            s.AI_PROVIDER_URL, s.AI_MODEL = "http://ollama:11434", "gemma3:4b"
            await _auto_configure_ai()

        assert row.general_settings == {
            "currency": "EUR",
            "ai": {
                "enabled": True,
                "providerType": "ollama",
                "providerUrl": "http://ollama:11434",
                "apiKey": "",
                "model": "gemma3:4b",
                "searchProvider": "duckduckgo",
                "searchUrl": "",
                "enabledTypes": ["Application"],
                "portfolioInsightsEnabled": True,
            },
        }
        db.commit.assert_awaited_once()
        db.add.assert_not_called()
        assert "[ai] Auto-configured AI: provider=http://ollama:11434  model=gemma3:4b" in (
            _messages(caplog)
        )

    @pytest.mark.asyncio
    async def test_a_missing_row_is_created(self):
        session, db = _session_returning(None)
        with (
            patch("app.main.settings") as s,
            patch("app.database.async_session", return_value=session),
        ):
            s.AI_PROVIDER_URL, s.AI_MODEL = "http://ollama:11434", "gemma3:4b"
            await _auto_configure_ai()
        (added,), _ = db.add.call_args
        assert added.id == "default"
        assert added.general_settings["ai"]["enabledTypes"] == []
        assert added.general_settings["ai"]["portfolioInsightsEnabled"] is False
        db.commit.assert_awaited_once()

    @pytest.mark.asyncio
    async def test_a_complete_manual_config_is_kept(self, caplog):
        row = MagicMock()
        manual = {"enabled": True, "providerUrl": "http://mine", "model": "llama3"}
        row.general_settings = {"ai": dict(manual)}
        session, db = _session_returning(row)
        caplog.set_level(logging.INFO)
        with (
            patch("app.main.settings") as s,
            patch("app.database.async_session", return_value=session),
        ):
            s.AI_PROVIDER_URL, s.AI_MODEL = "http://ollama:11434", "gemma3:4b"
            await _auto_configure_ai()
        assert row.general_settings == {"ai": manual}
        db.commit.assert_not_called()
        assert "[ai] AI already configured — skipping auto-configure" in _messages(caplog)


class TestEnsureOllamaModelExact:
    URL = "http://ollama:11434/"  # the trailing slash is stripped

    async def _run(self, *, row="none", session=None, clients=()):
        if session is None:
            session, _ = _session_returning(None if row == "none" else row)
        factory = MagicMock(side_effect=list(clients))
        with (
            patch("app.main.settings") as s,
            patch("app.database.async_session", return_value=session),
            patch("httpx.AsyncClient", factory),
        ):
            s.AI_PROVIDER_URL, s.AI_MODEL = self.URL, "gemma3:4b"
            await _ensure_ollama_model()
        return factory

    @pytest.mark.asyncio
    async def test_a_present_model_is_not_pulled(self, caplog):
        tags = _http_client(get=_tags("gemma3:4b"))
        caplog.set_level(logging.INFO)
        factory = await self._run(clients=[tags])
        factory.assert_called_once_with(timeout=10.0)
        tags.get.assert_awaited_once_with("http://ollama:11434/api/tags")
        assert "[ai] Model 'gemma3:4b' already available in Ollama" in _messages(caplog)

    @pytest.mark.asyncio
    async def test_a_missing_model_is_pulled(self, caplog):
        tags = _http_client(get=_tags("gemma3:27b"))
        pull = _http_client(post=_ok())
        caplog.set_level(logging.INFO)
        factory = await self._run(clients=[tags, pull])
        assert factory.call_args_list[1].kwargs == {"timeout": main_mod._OLLAMA_PULL_TIMEOUT}
        pull.post.assert_awaited_once_with(
            "http://ollama:11434/api/pull", json={"name": "gemma3:4b", "stream": False}
        )
        assert _messages(caplog)[-2:] == [
            "[ai] Pulling model 'gemma3:4b' from Ollama (this may take several minutes)...",
            "[ai] Model 'gemma3:4b' pulled successfully",
        ]

    @pytest.mark.asyncio
    async def test_another_provider_type_skips_the_pull(self, caplog):
        row = MagicMock()
        row.general_settings = {"ai": {"providerType": "openai"}}
        caplog.set_level(logging.INFO)
        factory = await self._run(row=row)
        factory.assert_not_called()
        assert _messages(caplog) == ["[ai] Provider type is 'openai' — skipping Ollama model pull"]

    @pytest.mark.asyncio
    @pytest.mark.parametrize("general", [{}, None, {"ai": {}}, {"ai": {"providerType": "ollama"}}])
    async def test_an_ollama_or_unset_type_goes_on(self, general):
        row = MagicMock()
        row.general_settings = general
        tags = _http_client(get=_tags("gemma3:4b"))
        await self._run(row=row, clients=[tags])
        tags.get.assert_awaited_once()

    @pytest.mark.asyncio
    async def test_a_failing_settings_read_goes_on(self):
        session = AsyncMock()
        session.__aenter__ = AsyncMock(side_effect=RuntimeError("db down"))
        session.__aexit__ = AsyncMock(return_value=False)
        tags = _http_client(get=_tags("gemma3:4b"))
        await self._run(session=session, clients=[tags])
        tags.get.assert_awaited_once()

    @pytest.mark.asyncio
    async def test_an_unreachable_server_stops_before_pulling(self, caplog):
        tags = _http_client(get=httpx.ConnectError("refused"))
        factory = await self._run(clients=[tags])
        assert factory.call_count == 1
        assert _messages(caplog) == [
            "[ai] Cannot reach Ollama at http://ollama:11434/api/tags: refused"
        ]

    @pytest.mark.asyncio
    async def test_a_failed_tags_status_stops_before_pulling(self):
        bad = _tags()
        bad.raise_for_status = MagicMock(
            side_effect=httpx.HTTPStatusError("503", request=MagicMock(), response=MagicMock())
        )
        factory = await self._run(clients=[_http_client(get=bad)])
        assert factory.call_count == 1

    @pytest.mark.asyncio
    async def test_a_failed_pull_is_logged(self, caplog):
        pull = _http_client(post=httpx.ReadTimeout("slow"))
        await self._run(clients=[_http_client(get=_tags()), pull])
        assert _messages(caplog)[-1] == "[ai] Failed to pull model 'gemma3:4b': slow"

    @pytest.mark.asyncio
    async def test_an_unexpected_pull_error_is_logged_with_its_trace(self, caplog):
        pull = _http_client(post=ValueError("boom"))
        await self._run(clients=[_http_client(get=_tags()), pull])
        last = [r for r in caplog.records if r.name.startswith(LOGGER)][-1]
        assert last.getMessage() == "[ai] Unexpected error pulling model 'gemma3:4b'"
        assert last.exc_info is not None
