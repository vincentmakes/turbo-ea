"""Unit tests for the MCP server OAuth module."""

from __future__ import annotations

import hashlib
import base64
import secrets
import time
from unittest.mock import AsyncMock, patch

import pytest
from starlette.applications import Starlette
from starlette.routing import Route
from starlette.testclient import TestClient

from turbo_ea_mcp import oauth
from turbo_ea_mcp.oauth import (
    OAuthStore,
    PendingAuth,
    AuthCode,
    RegisteredClient,
    TokenEntry,
    _handle_code_exchange,
    _redirect_uri_registered,
    _verify_pkce,
    _estimate_jwt_expiry,
)


def _pkce_pair() -> tuple[str, str]:
    """Return (verifier, challenge) for a valid PKCE S256 pair."""
    verifier = secrets.token_urlsafe(48)
    digest = hashlib.sha256(verifier.encode("ascii")).digest()
    challenge = base64.urlsafe_b64encode(digest).rstrip(b"=").decode("ascii")
    return verifier, challenge


@pytest.fixture
def fresh_store():
    """Replace the module-level singleton store with a clean one per test."""
    original = oauth.store
    oauth.store = OAuthStore()
    try:
        yield oauth.store
    finally:
        oauth.store = original


# ── PKCE verification ──────────────────────────────────────────────────────


class TestPKCE:
    def test_valid_pkce(self):
        """Valid PKCE S256 verifier matches challenge."""
        verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"
        digest = hashlib.sha256(verifier.encode("ascii")).digest()
        challenge = base64.urlsafe_b64encode(digest).rstrip(b"=").decode("ascii")
        assert _verify_pkce(verifier, challenge) is True

    def test_invalid_pkce(self):
        """Wrong verifier does not match challenge."""
        verifier = "correct-verifier"
        digest = hashlib.sha256(verifier.encode("ascii")).digest()
        challenge = base64.urlsafe_b64encode(digest).rstrip(b"=").decode("ascii")
        assert _verify_pkce("wrong-verifier", challenge) is False

    def test_random_pkce_roundtrip(self):
        """Random verifier/challenge roundtrip works."""
        verifier = secrets.token_urlsafe(32)
        digest = hashlib.sha256(verifier.encode("ascii")).digest()
        challenge = base64.urlsafe_b64encode(digest).rstrip(b"=").decode("ascii")
        assert _verify_pkce(verifier, challenge) is True


# ── JWT expiry estimation ───────────────────────────────────────────────────


class TestJwtExpiry:
    def test_estimate_valid_jwt(self):
        """Extracts exp from a valid JWT payload."""
        import json
        import base64

        header = base64.urlsafe_b64encode(b'{"alg":"HS256"}').rstrip(b"=").decode()
        exp = int(time.time()) + 3600
        payload = (
            base64.urlsafe_b64encode(
                json.dumps({"sub": "user-id", "exp": exp}).encode()
            )
            .rstrip(b"=")
            .decode()
        )
        sig = base64.urlsafe_b64encode(b"fake-signature").rstrip(b"=").decode()
        token = f"{header}.{payload}.{sig}"

        result = _estimate_jwt_expiry(token)
        assert result == float(exp)

    def test_estimate_invalid_token(self):
        """Returns fallback for invalid token."""
        result = _estimate_jwt_expiry("not-a-jwt")
        assert result > time.time()  # Should be in the future (fallback)


# ── OAuthStore ──────────────────────────────────────────────────────────────


class TestOAuthStore:
    def test_store_pending_auth(self):
        """Can store and retrieve pending auth."""
        store = OAuthStore()
        pending = PendingAuth(
            client_id="test-client",
            redirect_uri="http://localhost/callback",
            scope="mcp:read",
            state="original-state",
            code_challenge="challenge123",
            code_challenge_method="S256",
        )
        store.pending["state-key"] = pending
        assert store.pending["state-key"].client_id == "test-client"

    def test_store_auth_code(self):
        """Can store and retrieve auth code."""
        store = OAuthStore()
        code = AuthCode(
            code="test-code",
            client_id="test-client",
            redirect_uri="http://localhost/callback",
            scope="mcp:read",
            code_challenge="challenge123",
            turbo_jwt="fake-jwt",
        )
        store.codes["test-code"] = code
        assert store.codes["test-code"].turbo_jwt == "fake-jwt"

    def test_store_token_entry(self):
        """Can store and retrieve token entry."""
        store = OAuthStore()
        entry = TokenEntry(
            turbo_jwt="fake-jwt",
            turbo_jwt_exp=time.time() + 3600,
            refresh_token="refresh-123",
            scope="mcp:read",
        )
        store.tokens["access-123"] = entry
        store.refresh_tokens["refresh-123"] = "access-123"
        assert store.tokens["access-123"].turbo_jwt == "fake-jwt"
        assert store.refresh_tokens["refresh-123"] == "access-123"

    def test_cleanup_expired_pending(self):
        """Cleanup removes expired pending auths."""
        store = OAuthStore()
        store.pending["old"] = PendingAuth(
            client_id="c",
            redirect_uri="r",
            scope="s",
            state="st",
            code_challenge="ch",
            code_challenge_method="S256",
            created_at=time.time() - 700,  # Older than 600s AUTH_CODE_TTL
        )
        store.pending["fresh"] = PendingAuth(
            client_id="c",
            redirect_uri="r",
            scope="s",
            state="st",
            code_challenge="ch",
            code_challenge_method="S256",
            created_at=time.time(),
        )
        store.cleanup_expired()
        assert "old" not in store.pending
        assert "fresh" in store.pending

    def test_cleanup_expired_codes(self):
        """Cleanup removes expired auth codes."""
        store = OAuthStore()
        store.codes["old-code"] = AuthCode(
            code="old-code",
            client_id="c",
            redirect_uri="r",
            scope="s",
            code_challenge="ch",
            turbo_jwt="jwt",
            created_at=time.time() - 700,
        )
        store.codes["fresh-code"] = AuthCode(
            code="fresh-code",
            client_id="c",
            redirect_uri="r",
            scope="s",
            code_challenge="ch",
            turbo_jwt="jwt",
            created_at=time.time(),
        )
        store.cleanup_expired()
        assert "old-code" not in store.codes
        assert "fresh-code" in store.codes

    def test_code_one_time_use(self):
        """Auth codes can be marked as used."""
        store = OAuthStore()
        code = AuthCode(
            code="once",
            client_id="c",
            redirect_uri="r",
            scope="s",
            code_challenge="ch",
            turbo_jwt="jwt",
        )
        store.codes["once"] = code
        assert code.used is False
        code.used = True
        assert store.codes["once"].used is True

    def test_store_registered_client(self):
        """Can store and retrieve a registered client with its redirect URIs."""
        store = OAuthStore()
        store.clients["cid"] = RegisteredClient(
            client_id="cid",
            redirect_uris=["http://127.0.0.1:5000/cb"],
            client_name="Test Client",
        )
        assert store.clients["cid"].redirect_uris == ["http://127.0.0.1:5000/cb"]

    def test_registered_client_survives_cleanup(self):
        """Registrations are long-lived — cleanup_expired must not evict them
        even if their created_at is far in the past."""
        store = OAuthStore()
        store.clients["old"] = RegisteredClient(
            client_id="old",
            redirect_uris=["http://127.0.0.1:5000/cb"],
            created_at=time.time() - 10_000,  # well past AUTH_CODE_TTL
        )
        store.cleanup_expired()
        assert "old" in store.clients


# ── redirect_uri validation (the core of the fix) ───────────────────────────


class TestRedirectValidation:
    def _client(self, *uris: str) -> RegisteredClient:
        return RegisteredClient(client_id="cid", redirect_uris=list(uris))

    def test_exact_match_accepted(self):
        client = self._client("http://127.0.0.1:5000/cb")
        assert _redirect_uri_registered(client, "http://127.0.0.1:5000/cb") is True

    def test_unregistered_uri_rejected(self):
        client = self._client("http://127.0.0.1:5000/cb")
        assert _redirect_uri_registered(client, "http://attacker/cb") is False

    def test_unknown_client_rejected(self):
        # No registration at all → nothing is allowed (absent an env allowlist).
        with patch.object(oauth, "MCP_OAUTH_ALLOWED_REDIRECT_URIS", []):
            assert _redirect_uri_registered(None, "http://attacker/cb") is False

    def test_empty_redirect_uri_rejected(self):
        client = self._client("http://127.0.0.1:5000/cb")
        assert _redirect_uri_registered(client, "") is False

    def test_env_allowlist_uri_accepted_without_client(self):
        with patch.object(
            oauth, "MCP_OAUTH_ALLOWED_REDIRECT_URIS", ["https://gw.example.com/cb"]
        ):
            assert _redirect_uri_registered(None, "https://gw.example.com/cb") is True

    def test_prefix_or_substring_not_matched(self):
        """Guards against an accidental startswith/`in` implementation."""
        client = self._client("http://good.example.com/cb")
        assert _redirect_uri_registered(client, "http://good.example.com") is False
        assert (
            _redirect_uri_registered(client, "http://good.example.com/cb/extra")
            is False
        )
        assert (
            _redirect_uri_registered(client, "http://good.example.com.evil/cb") is False
        )


# ── Token exchange binding ──────────────────────────────────────────────────


class TestCodeExchange:
    def _seed_code(self, store, verifier, redirect_uri, client_id="cid"):
        digest = hashlib.sha256(verifier.encode("ascii")).digest()
        challenge = base64.urlsafe_b64encode(digest).rstrip(b"=").decode("ascii")
        store.codes["code123"] = AuthCode(
            code="code123",
            client_id=client_id,
            redirect_uri=redirect_uri,
            scope="mcp:read",
            code_challenge=challenge,
            turbo_jwt="header.eyJleHAiOjk5OTk5OTk5OTl9.sig",
        )

    @pytest.mark.asyncio
    async def test_happy_path(self, fresh_store):
        verifier, _ = _pkce_pair_from("verifier-happy")
        self._seed_code(fresh_store, verifier, "http://127.0.0.1:5000/cb")
        resp = await _handle_code_exchange(
            {
                "grant_type": "authorization_code",
                "code": "code123",
                "code_verifier": verifier,
                "redirect_uri": "http://127.0.0.1:5000/cb",
            }
        )
        assert resp.status_code == 200
        import json

        data = json.loads(resp.body)
        assert data["token_type"] == "Bearer"
        assert data["access_token"]

    @pytest.mark.asyncio
    async def test_rejects_mismatched_redirect_uri(self, fresh_store):
        verifier, _ = _pkce_pair_from("verifier-mismatch")
        self._seed_code(fresh_store, verifier, "http://127.0.0.1:5000/cb")
        resp = await _handle_code_exchange(
            {
                "grant_type": "authorization_code",
                "code": "code123",
                "code_verifier": verifier,
                "redirect_uri": "http://attacker/cb",  # stolen-code attempt
            }
        )
        assert resp.status_code == 400
        # Code must be consumed so it can't be retried.
        assert "code123" not in fresh_store.codes

    @pytest.mark.asyncio
    async def test_rejects_missing_redirect_uri(self, fresh_store):
        verifier, _ = _pkce_pair_from("verifier-missing")
        self._seed_code(fresh_store, verifier, "http://127.0.0.1:5000/cb")
        resp = await _handle_code_exchange(
            {
                "grant_type": "authorization_code",
                "code": "code123",
                "code_verifier": verifier,
                # redirect_uri intentionally omitted
            }
        )
        assert resp.status_code == 400

    @pytest.mark.asyncio
    async def test_rejects_client_id_mismatch(self, fresh_store):
        verifier, _ = _pkce_pair_from("verifier-client")
        self._seed_code(
            fresh_store, verifier, "http://127.0.0.1:5000/cb", client_id="real"
        )
        resp = await _handle_code_exchange(
            {
                "grant_type": "authorization_code",
                "code": "code123",
                "code_verifier": verifier,
                "redirect_uri": "http://127.0.0.1:5000/cb",
                "client_id": "evil",
            }
        )
        assert resp.status_code == 400


def _pkce_pair_from(verifier: str) -> tuple[str, str]:
    digest = hashlib.sha256(verifier.encode("ascii")).digest()
    challenge = base64.urlsafe_b64encode(digest).rstrip(b"=").decode("ascii")
    return verifier, challenge


# ── Route-level: /oauth/authorize must reject unregistered redirect_uri ──────


def _oauth_app() -> Starlette:
    return Starlette(
        routes=[
            Route("/oauth/authorize", oauth.authorize, methods=["GET"]),
            Route("/oauth/callback", oauth.sso_callback, methods=["GET"]),
            Route("/oauth/token", oauth.token_endpoint, methods=["POST"]),
            Route("/oauth/register", oauth.register_client, methods=["POST"]),
        ]
    )


class TestAuthorizeRoute:
    def test_unregistered_redirect_uri_returns_400_not_302(self, fresh_store):
        """The CVE: an attacker-supplied redirect_uri for an unknown client
        must be rejected with a direct 400, never a 302 to that URI."""
        _, challenge = _pkce_pair()
        client = TestClient(_oauth_app())
        resp = client.get(
            "/oauth/authorize",
            params={
                "response_type": "code",
                "client_id": "evil-client",
                "redirect_uri": "http://attacker/cb",
                "scope": "mcp:read",
                "state": "s",
                "code_challenge": challenge,
                "code_challenge_method": "S256",
            },
            follow_redirects=False,
        )
        assert resp.status_code == 400
        # And crucially, no Location header pointing at the attacker.
        assert "attacker" not in resp.headers.get("location", "")

    def test_registered_redirect_uri_redirects_to_sso(self, fresh_store):
        """A properly registered redirect_uri proceeds to the SSO provider."""
        _, challenge = _pkce_pair()
        fresh_store.clients["good-client"] = RegisteredClient(
            client_id="good-client",
            redirect_uris=["http://127.0.0.1:5000/cb"],
        )
        sso_config = {
            "enabled": True,
            "client_id": "sso-cid",
            "authorization_endpoint": "https://sso.example.com/authorize",
        }
        with patch.object(oauth, "_get_sso_config", AsyncMock(return_value=sso_config)):
            client = TestClient(_oauth_app())
            resp = client.get(
                "/oauth/authorize",
                params={
                    "response_type": "code",
                    "client_id": "good-client",
                    "redirect_uri": "http://127.0.0.1:5000/cb",
                    "scope": "mcp:read",
                    "state": "s",
                    "code_challenge": challenge,
                    "code_challenge_method": "S256",
                },
                follow_redirects=False,
            )
        assert resp.status_code == 302
        assert resp.headers["location"].startswith("https://sso.example.com/authorize")


class TestRegisterClientRoute:
    def test_register_persists_redirect_uris(self, fresh_store):
        client = TestClient(_oauth_app())
        resp = client.post(
            "/oauth/register",
            json={
                "client_name": "My Tool",
                "redirect_uris": ["http://127.0.0.1:5000/cb"],
            },
        )
        assert resp.status_code == 201
        cid = resp.json()["client_id"]
        assert cid in fresh_store.clients
        assert fresh_store.clients[cid].redirect_uris == ["http://127.0.0.1:5000/cb"]

    def test_register_rejects_empty_redirect_uris(self, fresh_store):
        client = TestClient(_oauth_app())
        resp = client.post(
            "/oauth/register",
            json={"client_name": "My Tool", "redirect_uris": []},
        )
        assert resp.status_code == 400
