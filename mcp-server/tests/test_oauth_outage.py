"""A Turbo EA outage must not end MCP sessions (review of #1307, #1449).

Only a refusal ends a connection. While the backend is down an access token
still opens (it is sealed, so resolving it asks nobody), and the refresh grant
and the code exchange answer ``temporarily_unavailable`` so the client retries
rather than signing in again.
"""

from __future__ import annotations

import logging
import time
from unittest.mock import AsyncMock

import pytest

from turbo_ea_mcp import api_client, oauth, server
from turbo_ea_mcp.api_client import RefreshUnavailableError
from turbo_ea_mcp.oauth import _handle_refresh, resolve_token


@pytest.fixture
def down(monkeypatch):
    """Every backend session call fails as an outage would."""
    failing = AsyncMock(side_effect=RefreshUnavailableError("backend answered 502"))
    monkeypatch.setattr(api_client, "create_mcp_session", failing)
    monkeypatch.setattr(api_client, "refresh_mcp_session", failing)
    return failing


class TestResolveDuringAnOutage:
    @pytest.mark.asyncio
    async def test_an_unexpired_access_token_still_opens(self, down):
        token = oauth.seal_access_token("jwt", time.time() + 60)
        assert await resolve_token(token) == "jwt"
        down.assert_not_awaited()


class TestRefreshGrantDuringAnOutage:
    @pytest.mark.asyncio
    async def test_answers_503_so_the_client_retries(self, down):
        resp = await _handle_refresh({"refresh_token": "tea1r.s.1.sig"})
        assert resp.status_code == 503
        assert resp.headers["retry-after"] == "5"
        assert resp.body == (
            b'{"error":"temporarily_unavailable",'
            b'"error_description":"Turbo EA is not reachable, retry shortly"}'
        )
        down.assert_awaited_once_with("tea1r.s.1.sig")


class TestEphemeralKeyWarning:
    def test_create_app_warns_when_no_secret_key_reached_it(self, monkeypatch, caplog):
        monkeypatch.setattr(oauth, "CLIENT_KEY_IS_EPHEMERAL", True)
        with caplog.at_level(logging.WARNING, logger="turbo_ea_mcp"):
            server.create_app()
        assert any("SECRET_KEY is not set" in r.getMessage() for r in caplog.records)

    def test_create_app_is_quiet_with_a_secret_key(self, monkeypatch, caplog):
        monkeypatch.setattr(oauth, "CLIENT_KEY_IS_EPHEMERAL", False)
        with caplog.at_level(logging.WARNING, logger="turbo_ea_mcp"):
            server.create_app()
        assert not any("SECRET_KEY is not set" in r.getMessage() for r in caplog.records)

    def test_the_flag_follows_the_configured_key(self):
        assert oauth.CLIENT_KEY_IS_EPHEMERAL is (oauth.MCP_OAUTH_CLIENT_KEY is None)
