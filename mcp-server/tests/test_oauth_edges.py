"""OAuth server edges ``test_oauth_flow.py`` leaves open.

A token request whose PKCE verifier is not ASCII, the exact expiry a JWT
without ``exp`` gets, and the log lines an operator debugging a sign-in reads.
A refresh racing another request for the same session is the backend's to
settle now (its rotation grace window): this process keeps no session.
"""

from __future__ import annotations

import base64
import hashlib
import json
import logging
from unittest.mock import AsyncMock

import pytest
from starlette.applications import Starlette
from starlette.routing import Route
from starlette.testclient import TestClient

from turbo_ea_mcp import api_client, oauth
from turbo_ea_mcp.oauth import (
    AuthCode,
    OAuthStore,
    PendingAuth,
    _estimate_jwt_expiry,
    _handle_code_exchange,
    _verify_pkce,
)

CB = "http://127.0.0.1:5000/cb"


@pytest.fixture
def store(monkeypatch):
    fresh = OAuthStore()
    monkeypatch.setattr(oauth, "store", fresh)
    monkeypatch.setattr(oauth, "MCP_PUBLIC_URL", "https://mcp.example.com/")
    monkeypatch.setattr(oauth, "MCP_OAUTH_ALLOWED_REDIRECT_URIS", [])
    return fresh


def _challenge(verifier: str) -> str:
    digest = hashlib.sha256(verifier.encode()).digest()
    return base64.urlsafe_b64encode(digest).rstrip(b"=").decode()


def _payload(data) -> str:
    return base64.urlsafe_b64encode(json.dumps(data).encode()).rstrip(b"=").decode()


class TestVerifyPkce:
    def test_a_non_ascii_verifier_is_refused_instead_of_raising(self):
        verifier = "vérifier-ünïcode"
        assert _verify_pkce(verifier, _challenge("verifier-unicode")) is False
        # not even a challenge computed over its own UTF-8 bytes lets it in
        assert _verify_pkce(verifier, _challenge(verifier)) is False

    @pytest.mark.parametrize("verifier", ["with space", "plus+sign", "slash/ed", "", "a=b"])
    def test_a_verifier_outside_the_rfc_alphabet_never_matches(self, verifier):
        assert _verify_pkce(verifier, _challenge(verifier)) is False

    def test_the_whole_unreserved_alphabet_is_allowed(self):
        verifier = "AZaz09-._~" * 5
        assert _verify_pkce(verifier, _challenge(verifier)) is True
        assert _verify_pkce(verifier, _challenge(verifier + "x")) is False

    def test_a_non_ascii_challenge_fails_to_match_instead_of_raising(self):
        assert _verify_pkce("verifier", "chällenge") is False

    @pytest.mark.asyncio
    async def test_the_token_request_answers_400_not_500(self, store):
        store.codes["c1"] = AuthCode(
            code="c1",
            client_id="good",
            redirect_uri=CB,
            scope="mcp:read",
            code_challenge=_challenge("plain-verifier"),
            turbo_jwt="h.e30.s",
        )
        resp = await _handle_code_exchange(
            {"code": "c1", "code_verifier": "vérifier", "redirect_uri": CB}
        )
        assert resp.status_code == 400
        assert json.loads(resp.body) == {
            "error": "invalid_grant",
            "error_description": "PKCE verification failed",
        }
        assert "c1" not in store.codes


class TestEstimateJwtExpiry:
    @pytest.fixture
    def now(self, monkeypatch):
        monkeypatch.setattr(oauth.time, "time", lambda: 1_000_000.0)
        return 1_000_000.0

    @pytest.mark.parametrize("pad", ["", "a", "ab", "abc"])
    def test_exp_is_read_whatever_the_padding(self, pad):
        assert _estimate_jwt_expiry(f"h.{_payload({'exp': 7, 'p': pad})}.s") == 7.0

    @pytest.mark.parametrize(
        "token",
        [
            f"h.{_payload({'sub': 'u'})}.s",  # no exp
            f"h.{_payload([1, 2])}.s",  # not an object
            f"h.{_payload({'exp': 'soon'})}.s",  # not a number
            f"{_payload({'exp': 7})}",  # one part
            f"h.{_payload({'exp': 7})}",  # two parts
            f"h.{_payload({'exp': 7})}.s.x",  # four parts
        ],
    )
    def test_anything_unreadable_is_an_hour_from_now(self, now, token):
        assert _estimate_jwt_expiry(token) == now + 3600


class TestSsoCallbackLogs:
    @pytest.fixture
    def app(self, store, monkeypatch):
        store.pending["st8"] = PendingAuth(
            client_id="good",
            redirect_uri=CB,
            scope="mcp:read",
            state="client-state",
            code_challenge="chal",
            code_challenge_method="S256",
        )
        return TestClient(
            Starlette(routes=[Route("/oauth/callback", oauth.sso_callback)]),
        )

    def test_an_idp_error_without_a_description(self, app, caplog):
        with caplog.at_level(logging.WARNING, logger="turbo_ea_mcp.oauth"):
            resp = app.get("/oauth/callback", params={"error": "access_denied"})
        assert resp.status_code == 403
        assert [(r.levelname, r.getMessage()) for r in caplog.records] == [
            ("WARNING", "SSO callback error: access_denied — ")
        ]

    def test_an_idp_error_with_its_description(self, app, caplog):
        with caplog.at_level(logging.WARNING, logger="turbo_ea_mcp.oauth"):
            app.get("/oauth/callback", params={"error": "e", "error_description": "why"})
        assert [r.getMessage() for r in caplog.records] == ["SSO callback error: e — why"]

    def test_a_failed_exchange_is_logged_with_its_traceback(self, app, caplog, monkeypatch):
        monkeypatch.setattr(
            api_client, "exchange_sso_code", AsyncMock(side_effect=OSError("backend down"))
        )
        with caplog.at_level(logging.WARNING, logger="turbo_ea_mcp.oauth"):
            resp = app.get(
                "/oauth/callback", params={"code": "c", "state": "st8"}, follow_redirects=False
            )
        assert resp.status_code == 302
        (record,) = caplog.records
        assert (record.levelname, record.getMessage()) == (
            "ERROR",
            "Failed to exchange SSO code with Turbo EA backend",
        )
        assert record.exc_info[1].args == ("backend down",)
