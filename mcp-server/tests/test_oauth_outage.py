"""A Turbo EA outage must not end MCP sessions (review of #1307).

``resolve_token`` and the refresh grant renew the Turbo EA JWT behind an MCP
token. When the backend answered anything but 200 — a 502 while it restarts
included — both used to drop the session, so every user had to sign in again
after a backend restart. Now only a refusal ends a session; an outage keeps
the tokens, serves a JWT that is still valid, and otherwise asks the client to
retry.
"""

from __future__ import annotations

import logging
import time

import pytest

from turbo_ea_mcp import api_client, oauth, server
from turbo_ea_mcp.api_client import RefreshUnavailable
from turbo_ea_mcp.oauth import (
    TURBO_JWT_REFRESH_BUFFER,
    OAuthStore,
    TokenEntry,
    _handle_refresh,
    resolve_token,
)


class Down:
    """A ``TurboEAClient`` whose backend is unreachable."""

    calls = 0

    def __init__(self, token: str) -> None:
        pass

    async def refresh_token(self):
        Down.calls += 1
        raise RefreshUnavailable("backend answered 502")


@pytest.fixture
def store(monkeypatch):
    fresh = OAuthStore()
    monkeypatch.setattr(oauth, "store", fresh)
    monkeypatch.setattr(api_client, "TurboEAClient", Down)
    Down.calls = 0
    return fresh


def seed(store, jwt_exp: float) -> None:
    store.tokens["acc"] = TokenEntry("jwt", jwt_exp, "ref", "mcp:read")
    store.refresh_tokens["ref"] = "acc"


class TestResolveDuringAnOutage:
    @pytest.mark.asyncio
    async def test_a_jwt_still_valid_is_served_and_the_session_kept(self, store):
        seed(store, time.time() + TURBO_JWT_REFRESH_BUFFER / 2)
        assert await resolve_token("acc") == "jwt"
        assert Down.calls == 1
        assert set(store.tokens) == {"acc"}
        assert store.refresh_tokens == {"ref": "acc"}

    @pytest.mark.asyncio
    async def test_a_refresh_is_tried_again_on_the_next_call(self, store):
        seed(store, time.time() + 60)
        await resolve_token("acc")
        await resolve_token("acc")
        assert Down.calls == 2

    @pytest.mark.asyncio
    async def test_an_expired_jwt_raises_and_the_session_is_kept(self, store):
        seed(store, time.time() - 1)
        with pytest.raises(RefreshUnavailable):
            await resolve_token("acc")
        assert set(store.tokens) == {"acc"}
        assert store.refresh_tokens == {"ref": "acc"}

    @pytest.mark.asyncio
    async def test_a_jwt_far_from_expiry_never_asks_the_backend(self, store):
        seed(store, time.time() + TURBO_JWT_REFRESH_BUFFER * 2)
        assert await resolve_token("acc") == "jwt"
        assert Down.calls == 0


class TestRefreshGrantDuringAnOutage:
    @pytest.mark.asyncio
    async def test_answers_503_and_keeps_both_tokens(self, store):
        seed(store, time.time() - 1)
        resp = await _handle_refresh({"refresh_token": "ref"})
        assert resp.status_code == 503
        assert resp.headers["retry-after"] == "5"
        assert resp.body == (
            b'{"error":"temporarily_unavailable",'
            b'"error_description":"Turbo EA is not reachable, retry shortly"}'
        )
        assert set(store.tokens) == {"acc"}
        assert store.refresh_tokens == {"ref": "acc"}


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
