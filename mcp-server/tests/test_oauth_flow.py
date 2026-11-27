"""The OAuth authorization server end to end, one decision per test.

``test_oauth.py`` pins the redirect-URI fix (1.64.4) and the data shapes. This
file pins every branch the flow takes — exact error bodies, the parameters the
SSO redirect carries, what each failure removes from the store, the tokens the
token endpoint issues from a backend session (and without one), their rotation
and how a sealed access token opens — so that a mutation of any of them fails a
test.
Nothing here talks to a network: the backend is replaced at ``api_client``.
"""

from __future__ import annotations

import base64
import hashlib
import json
import logging
import time
from types import SimpleNamespace
from unittest.mock import AsyncMock
from urllib.parse import parse_qsl, urlsplit

import pytest
from cryptography.fernet import Fernet
from starlette.applications import Starlette
from starlette.routing import Route
from starlette.testclient import TestClient

from tests.refresh_tokens import KEY as REFRESH_KEY
from tests.refresh_tokens import signed_refresh
from turbo_ea_mcp import api_client, config, oauth
from turbo_ea_mcp.api_client import McpSessionTokens, RefreshUnavailableError
from turbo_ea_mcp.oauth import (
    AUTH_CODE_TTL,
    DEFAULT_CLIENT_NAME,
    AuthCode,
    OAuthStore,
    PendingAuth,
    RegisteredClient,
    _estimate_jwt_expiry,
    _handle_code_exchange,
    _handle_refresh,
    _verify_pkce,
    resolve_token,
)

PUBLIC = "https://mcp.example.com"
CB = "http://127.0.0.1:5000/cb"


def jwt_with(payload: dict) -> str:
    body = base64.urlsafe_b64encode(json.dumps(payload).encode()).rstrip(b"=").decode()
    return f"h.{body}.s"


def challenge_of(verifier: str) -> str:
    digest = hashlib.sha256(verifier.encode("ascii")).digest()
    return base64.urlsafe_b64encode(digest).rstrip(b"=").decode("ascii")


@pytest.fixture
def store(monkeypatch):
    fresh = OAuthStore()
    monkeypatch.setattr(oauth, "store", fresh)
    monkeypatch.setattr(oauth, "MCP_PUBLIC_URL", PUBLIC + "/")
    monkeypatch.setattr(oauth, "MCP_OAUTH_ALLOWED_REDIRECT_URIS", [])
    return fresh


@pytest.fixture
def app(store):
    return TestClient(
        Starlette(
            routes=[
                Route("/rs", oauth.protected_resource_metadata),
                Route("/as", oauth.authorization_server_metadata),
                Route("/oauth/authorize", oauth.authorize, methods=["GET"]),
                Route("/oauth/callback", oauth.sso_callback, methods=["GET"]),
                Route("/oauth/token", oauth.token_endpoint, methods=["POST"]),
                Route("/oauth/register", oauth.register_client, methods=["POST"]),
            ]
        )
    )


def body(resp) -> dict:
    return json.loads(resp.body)


def test_lifetimes():
    assert AUTH_CODE_TTL == 600


def test_the_default_client_name():
    assert DEFAULT_CLIENT_NAME == "MCP Client"


# ── Metadata ────────────────────────────────────────────────────────────────


class TestMetadata:
    def test_protected_resource(self, app):
        assert app.get("/rs").json() == {
            "resource": PUBLIC + "/",
            "authorization_servers": [PUBLIC + "/"],
            "scopes_supported": ["mcp:read"],
            "bearer_methods_supported": ["header"],
            "resource_name": "Turbo EA",
        }

    def test_authorization_server(self, app):
        assert app.get("/as").json() == {
            "issuer": PUBLIC,
            "authorization_endpoint": f"{PUBLIC}/oauth/authorize",
            "token_endpoint": f"{PUBLIC}/oauth/token",
            "registration_endpoint": f"{PUBLIC}/oauth/register",
            "response_types_supported": ["code"],
            "grant_types_supported": ["authorization_code", "refresh_token"],
            "code_challenge_methods_supported": ["S256"],
            "scopes_supported": ["mcp:read"],
            "token_endpoint_auth_methods_supported": ["none"],
        }


# ── SSO config cache ────────────────────────────────────────────────────────


class TestSsoConfigCache:
    @pytest.fixture(autouse=True)
    def _reset(self, monkeypatch):
        monkeypatch.setattr(oauth, "_sso_config_cache", None)
        monkeypatch.setattr(oauth, "_sso_config_ts", 0.0)

    @pytest.mark.asyncio
    async def test_fetched_once_within_the_ttl(self, monkeypatch):
        fetch = AsyncMock(side_effect=[{"n": 1}, {"n": 2}])
        monkeypatch.setattr(api_client, "get_sso_config", fetch)
        assert await oauth._get_sso_config() == {"n": 1}
        monkeypatch.setattr(oauth, "_sso_config_ts", time.time() - 290)
        assert await oauth._get_sso_config() == {"n": 1}
        assert fetch.await_count == 1

    @pytest.mark.asyncio
    async def test_refetched_after_the_ttl(self, monkeypatch):
        fetch = AsyncMock(side_effect=[{"n": 1}, {"n": 2}])
        monkeypatch.setattr(api_client, "get_sso_config", fetch)
        await oauth._get_sso_config()
        monkeypatch.setattr(oauth, "_sso_config_ts", time.time() - 310)
        assert await oauth._get_sso_config() == {"n": 2}
        assert oauth._sso_config_ts > time.time() - 5


# ── Store cleanup ───────────────────────────────────────────────────────────


class TestCleanup:
    def test_only_entries_older_than_the_code_ttl_are_dropped(self, store):
        now = time.time()

        def pending(age):
            return PendingAuth("c", CB, "s", "st", "ch", "S256", created_at=now - age)

        def code(age):
            return AuthCode("x", "c", CB, "s", "ch", "j", created_at=now - age)

        store.pending.update(old=pending(AUTH_CODE_TTL + 5), young=pending(AUTH_CODE_TTL - 5))
        store.codes.update(old=code(AUTH_CODE_TTL + 5), young=code(AUTH_CODE_TTL - 5))
        store.cleanup_expired()
        assert set(store.pending) == {"young"}
        assert set(store.codes) == {"young"}


# ── Registration ────────────────────────────────────────────────────────────


class TestRegister:
    def test_a_client_is_recorded_with_what_it_registered(self, app, store):
        resp = app.post("/oauth/register", json={"client_name": "Tool", "redirect_uris": [CB]})
        assert resp.status_code == 201
        data = resp.json()
        cid = data.pop("client_id")
        assert oauth.client_from_id(cid).redirect_uris == [CB]
        issued_at = data.pop("client_id_issued_at")
        assert isinstance(issued_at, int) and abs(issued_at - time.time()) < 5
        assert data == {
            "client_name": "Tool",
            "redirect_uris": [CB],
            "grant_types": ["authorization_code", "refresh_token"],
            "response_types": ["code"],
            "token_endpoint_auth_method": "none",
        }
        client = store.clients[cid]
        assert (client.client_id, client.client_name, client.redirect_uris) == (cid, "Tool", [CB])

    def test_the_name_defaults(self, app, store):
        data = app.post("/oauth/register", json={"redirect_uris": [CB]}).json()
        assert data["client_name"] == "MCP Client"
        assert store.clients[data["client_id"]].client_name == "MCP Client"

    def test_each_registration_gets_its_own_id(self, app, store):
        a = app.post("/oauth/register", json={"redirect_uris": [CB]}).json()["client_id"]
        b = app.post("/oauth/register", json={"redirect_uris": [CB]}).json()["client_id"]
        assert a != b
        assert set(store.clients) == {a, b}

    def test_a_body_that_is_not_json_is_refused(self, app, store):
        resp = app.post("/oauth/register", content=b"not json")
        assert resp.status_code == 400
        assert resp.json() == {"error": "invalid_request"}
        assert store.clients == {}

    @pytest.mark.parametrize("uris", ["http://x/cb", [""], [CB, ""], [CB, 7], [None]])
    def test_malformed_redirect_uris_are_refused(self, app, store, uris):
        resp = app.post("/oauth/register", json={"redirect_uris": uris})
        assert resp.status_code == 400
        assert resp.json() == {
            "error": "invalid_client_metadata",
            "error_description": "redirect_uris must be a non-empty list of strings",
        }
        assert store.clients == {}

    @pytest.mark.parametrize("payload", [{}, {"redirect_uris": []}])
    def test_at_least_one_redirect_uri_is_required(self, app, store, payload):
        resp = app.post("/oauth/register", json=payload)
        assert resp.status_code == 400
        assert resp.json() == {
            "error": "invalid_client_metadata",
            "error_description": "at least one redirect_uri is required",
        }
        assert store.clients == {}


# ── Authorize ───────────────────────────────────────────────────────────────

SSO = {
    "enabled": True,
    "client_id": "sso-cid",
    "authorization_endpoint": "https://sso.example.com/authorize",
}


def authorize_params(**overrides) -> dict:
    params = {
        "response_type": "code",
        "client_id": "good",
        "redirect_uri": CB,
        "scope": "mcp:read",
        "state": "client-state",
        "code_challenge": "chal",
        "code_challenge_method": "S256",
    }
    params.update(overrides)
    return {k: v for k, v in params.items() if v is not None}


class TestAuthorize:
    @pytest.fixture(autouse=True)
    def _client(self, store, monkeypatch):
        store.clients["good"] = RegisteredClient(client_id="good", redirect_uris=[CB])
        self.sso = AsyncMock(return_value=SSO)
        monkeypatch.setattr(oauth, "_get_sso_config", self.sso)

    def get(self, app, **overrides):
        return app.get(
            "/oauth/authorize", params=authorize_params(**overrides), follow_redirects=False
        )

    @pytest.mark.parametrize("response_type", [None, "token", "CODE"])
    def test_only_the_code_flow(self, app, response_type):
        resp = self.get(app, response_type=response_type)
        assert resp.status_code == 400
        assert resp.json() == {"error": "unsupported_response_type"}

    @pytest.mark.parametrize(
        "overrides",
        [
            {"code_challenge": None},
            {"code_challenge": ""},
            {"code_challenge_method": None},
            {"code_challenge_method": "plain"},
        ],
    )
    def test_pkce_s256_is_required(self, app, store, overrides):
        resp = self.get(app, **overrides)
        assert resp.status_code == 400
        assert resp.json() == {
            "error": "invalid_request",
            "error_description": "PKCE S256 required",
        }
        assert store.pending == {}

    @pytest.mark.parametrize(
        "overrides",
        [
            {"redirect_uri": None},
            {"redirect_uri": CB + "/"},
            {"redirect_uri": CB + "?x=1"},
            {"redirect_uri": "http://127.0.0.1:5001/cb"},
            {"client_id": "someone-else"},
            {"client_id": None},
        ],
    )
    def test_an_unregistered_redirect_is_a_direct_400(self, app, store, overrides):
        resp = self.get(app, **overrides)
        assert resp.status_code == 400
        assert "location" not in resp.headers
        assert resp.json() == {
            "error": "invalid_request",
            "error_description": "redirect_uri is not registered for this client",
        }
        assert store.pending == {}
        self.sso.assert_not_awaited()

    def test_the_operator_allowlist_admits_a_static_uri(self, app, monkeypatch):
        monkeypatch.setattr(oauth, "MCP_OAUTH_ALLOWED_REDIRECT_URIS", ["https://fixed/cb"])
        resp = self.get(app, client_id="unregistered", redirect_uri="https://fixed/cb")
        assert resp.status_code == 302

    @pytest.mark.parametrize("sso", [{"enabled": False}, {}])
    def test_sso_must_be_configured(self, app, store, sso):
        self.sso.return_value = sso
        resp = self.get(app)
        assert resp.status_code == 503
        assert resp.json() == {"error": "server_error", "error_description": "SSO not configured"}
        assert store.pending == {}

    def test_redirects_to_the_idp_and_remembers_the_request(self, app, store):
        resp = self.get(app)
        assert resp.status_code == 302
        url = urlsplit(resp.headers["location"])
        assert f"{url.scheme}://{url.netloc}{url.path}" == SSO["authorization_endpoint"]
        query = dict(parse_qsl(url.query))
        [internal] = store.pending
        assert query == {
            "client_id": "sso-cid",
            "response_type": "code",
            "redirect_uri": f"{PUBLIC}/oauth/callback",
            "scope": "openid email profile",
            "response_mode": "query",
            "state": internal,
        }
        assert len(internal) == 43
        pending = store.pending[internal]
        assert (
            pending.client_id,
            pending.redirect_uri,
            pending.scope,
            pending.state,
            pending.code_challenge,
            pending.code_challenge_method,
        ) == ("good", CB, "mcp:read", "client-state", "chal", "S256")

    def test_the_request_remembers_the_registered_client_name(self, app, store):
        store.clients["good"].client_name = "Copilot Studio"
        self.get(app)
        [pending] = store.pending.values()
        assert pending.client_name == "Copilot Studio"

    def test_a_client_known_only_to_the_allowlist_gets_the_default_name(self, app, monkeypatch):
        monkeypatch.setattr(oauth, "MCP_OAUTH_ALLOWED_REDIRECT_URIS", ["https://fixed/cb"])
        self.get(app, client_id="unregistered", redirect_uri="https://fixed/cb")
        [pending] = oauth.store.pending.values()
        assert pending.client_name == "MCP Client"

    def test_the_idp_is_asked_for_the_configured_scopes(self, app, store):
        """The backend's ``/auth/sso/config`` scopes, extra scopes included, so an MCP
        sign-in carries the same groups claim as the app's own login."""
        self.sso.return_value = {**SSO, "scopes": "openid email profile groups"}
        resp = self.get(app)
        assert resp.status_code == 302
        query = dict(parse_qsl(urlsplit(resp.headers["location"]).query))
        assert query["scope"] == "openid email profile groups"

    @pytest.mark.parametrize("scopes", ["", None])
    def test_empty_scopes_fall_back_to_the_base_set(self, app, store, scopes):
        self.sso.return_value = {**SSO, "scopes": scopes}
        resp = self.get(app)
        query = dict(parse_qsl(urlsplit(resp.headers["location"]).query))
        assert query["scope"] == "openid email profile"

    def test_scope_and_state_default(self, app, store):
        self.get(app, scope=None, state=None)
        [pending] = store.pending.values()
        assert pending.scope == "mcp:read"
        assert pending.state == ""

    def test_expired_requests_are_swept_on_the_way_in(self, app, store):
        store.pending["stale"] = PendingAuth(
            "good", CB, "s", "st", "ch", "S256", created_at=time.time() - AUTH_CODE_TTL - 1
        )
        self.get(app)
        assert "stale" not in store.pending
        assert len(store.pending) == 1


# ── SSO callback ────────────────────────────────────────────────────────────


class TestSsoCallback:
    @pytest.fixture(autouse=True)
    def _pending(self, store, monkeypatch):
        store.pending["st8"] = PendingAuth(
            client_id="good",
            redirect_uri=CB,
            scope="mcp:read",
            state="client-state",
            code_challenge="chal",
            code_challenge_method="S256",
            client_name="Claude",
        )
        self.exchange = AsyncMock(return_value={"access_token": "turbo.jwt.value"})
        monkeypatch.setattr(api_client, "exchange_sso_code", self.exchange)

    def get(self, app, **params):
        return app.get("/oauth/callback", params=params, follow_redirects=False)

    def test_an_idp_error_is_403(self, app, store, caplog):
        resp = self.get(app, error="access_denied", error_description="nope", state="st8")
        assert resp.status_code == 403
        assert resp.json() == {
            "error": "access_denied",
            "error_description": "SSO authentication failed",
        }
        assert "SSO callback error: access_denied" in caplog.text
        assert "nope" in caplog.text
        assert "st8" in store.pending

    @pytest.mark.parametrize("params", [{"state": "st8"}, {"code": "c"}, {}])
    def test_code_and_state_are_both_required(self, app, store, params):
        resp = self.get(app, **params)
        assert resp.status_code == 400
        assert resp.json() == {"error": "invalid_request"}
        assert "st8" in store.pending

    def test_an_unknown_state_is_refused(self, app):
        resp = self.get(app, code="c", state="forged")
        assert resp.status_code == 400
        assert resp.json() == {
            "error": "invalid_request",
            "error_description": "Unknown or expired state",
        }
        self.exchange.assert_not_awaited()

    def _redirect_query(self, resp) -> dict:
        assert resp.status_code == 302
        location = resp.headers["location"]
        assert location.startswith(CB + "?")
        return dict(parse_qsl(urlsplit(location).query))

    def test_a_failed_exchange_returns_to_the_client_with_an_error(self, app, store):
        self.exchange.side_effect = RuntimeError("backend down")
        query = self._redirect_query(self.get(app, code="c", state="st8"))
        assert query == {
            "error": "server_error",
            "error_description": "Token exchange failed",
            "state": "client-state",
        }
        assert store.pending == {}
        assert store.codes == {}

    @pytest.mark.parametrize("data", [{}, {"access_token": ""}])
    def test_an_exchange_without_a_token_returns_an_error(self, app, store, data):
        self.exchange.return_value = data
        query = self._redirect_query(self.get(app, code="c", state="st8"))
        assert query == {
            "error": "server_error",
            "error_description": "No token received",
            "state": "client-state",
        }
        assert store.codes == {}

    def test_success_issues_a_one_time_code_bound_to_the_request(self, app, store):
        query = self._redirect_query(self.get(app, code="idp-code", state="st8"))
        self.exchange.assert_awaited_once_with("idp-code", f"{PUBLIC}/oauth/callback")
        assert query["state"] == "client-state"
        code = query["code"]
        assert len(code) == 64
        issued = store.codes[code]
        assert (
            issued.code,
            issued.client_id,
            issued.redirect_uri,
            issued.scope,
            issued.code_challenge,
            issued.turbo_jwt,
            issued.used,
            issued.client_name,
        ) == (code, "good", CB, "mcp:read", "chal", "turbo.jwt.value", False, "Claude")
        assert store.pending == {}
        # The state is single-use.
        again = self.get(app, code="idp-code", state="st8")
        assert again.status_code == 400


# ── JWT expiry estimate ─────────────────────────────────────────────────────


class TestEstimateExpiry:
    def test_reads_exp(self):
        assert _estimate_jwt_expiry(jwt_with({"exp": 1234567890})) == 1234567890.0

    def test_payload_length_not_a_multiple_of_four(self):
        for extra in ("", "a", "ab", "abc"):
            token = jwt_with({"exp": 42, "pad": extra})
            assert _estimate_jwt_expiry(token) == 42.0

    @pytest.mark.parametrize(
        "token",
        ["a.b", "a.b.c.d", "", "h.!!!.s", jwt_with({"sub": "x"}), "h.bm90IGpzb24.s"],
    )
    def test_falls_back_to_one_hour(self, token):
        before = time.time()
        estimate = _estimate_jwt_expiry(token)
        assert before + 3590 <= estimate <= time.time() + 3610


# ── Token endpoint ──────────────────────────────────────────────────────────

NOW = 1_700_000_000.0


@pytest.fixture
def frozen(monkeypatch):
    monkeypatch.setattr(oauth.time, "time", lambda: NOW)
    return NOW


# The SSO JWT a sign-in gets, and the one a backend session is bound to.
SSO_JWT = jwt_with({"exp": NOW + 86_400})
SESSION_JWT = jwt_with({"exp": NOW + 3600, "msid": "s1"})
# Signed with the key ``tests/conftest.py`` gives the process, as the backend
# signs them: the refresh grant checks the signature before it relays one.
REFRESH_1 = signed_refresh("a1" * 16, 1)
REFRESH_2 = signed_refresh("a1" * 16, 2)


def session(**overrides) -> McpSessionTokens:
    data = {
        "access_token": SESSION_JWT,
        "refresh_token": REFRESH_1,
        "expires_in": 3600,
        "scope": "mcp:read",
    }
    data.update(overrides)
    return McpSessionTokens(**data)


@pytest.fixture
def backend(monkeypatch):
    """The two backend session calls, replaced: nothing reaches a network."""
    calls = SimpleNamespace(
        create=AsyncMock(return_value=session()),
        refresh=AsyncMock(return_value=session(refresh_token=REFRESH_2)),
    )
    monkeypatch.setattr(api_client, "create_mcp_session", calls.create)
    monkeypatch.setattr(api_client, "refresh_mcp_session", calls.refresh)
    return calls


def seal(claims) -> str:
    """An access token sealed with this process's key around ``claims``."""
    return "tea1a." + oauth._token_fernet.encrypt(json.dumps(claims).encode()).decode()


async def opens_at(moment: float, token: str, monkeypatch) -> str | None:
    monkeypatch.setattr(oauth.time, "time", lambda: moment)
    return await resolve_token(token)


def seed_code(
    store,
    *,
    verifier="v-123",
    client_id="good",
    used=False,
    code="code1",
    scope="mcp:read",
    turbo_jwt=SSO_JWT,
    client_name="Claude",
):
    store.codes[code] = AuthCode(
        code=code,
        client_id=client_id,
        redirect_uri=CB,
        scope=scope,
        code_challenge=challenge_of(verifier),
        turbo_jwt=turbo_jwt,
        used=used,
        client_name=client_name,
    )


def exchange_body(**overrides) -> dict:
    data = {
        "grant_type": "authorization_code",
        "code": "code1",
        "code_verifier": "v-123",
        "redirect_uri": CB,
    }
    data.update(overrides)
    return {k: v for k, v in data.items() if v is not None}


UNAVAILABLE = (
    b'{"error":"temporarily_unavailable",'
    b'"error_description":"Turbo EA is not reachable, retry shortly"}'
)


class TestTokenEndpointRoute:
    def test_unsupported_grant(self, app):
        resp = app.post("/oauth/token", data={"grant_type": "password"})
        assert resp.status_code == 400
        assert resp.json() == {"error": "unsupported_grant_type"}

    @pytest.mark.asyncio
    async def test_the_form_code_grant_issues_tokens(self, app, store, backend, frozen):
        seed_code(store)
        resp = app.post("/oauth/token", data=exchange_body())
        assert resp.status_code == 200
        assert await resolve_token(resp.json()["access_token"]) == SESSION_JWT

    @pytest.mark.asyncio
    async def test_the_form_refresh_grant_rotates(self, app, backend):
        resp = app.post(
            "/oauth/token", data={"grant_type": "refresh_token", "refresh_token": REFRESH_1}
        )
        assert resp.status_code == 200
        assert resp.json()["refresh_token"] == REFRESH_2
        backend.refresh.assert_awaited_once_with(REFRESH_1)


class TestCodeExchange:
    @pytest.mark.asyncio
    async def test_opens_a_session_and_issues_its_tokens(self, store, backend, frozen):
        seed_code(store)
        resp = await _handle_code_exchange(exchange_body(client_id="good"))
        assert resp.status_code == 200
        assert resp.headers["cache-control"] == "no-store"
        assert resp.headers["pragma"] == "no-cache"
        data = body(resp)
        access = data.pop("access_token")
        assert data == {
            "token_type": "Bearer",
            "expires_in": 3600,
            "refresh_token": REFRESH_1,
            "scope": "mcp:read",
        }
        assert access.startswith("tea1a.")
        assert await resolve_token(access) == SESSION_JWT
        backend.create.assert_awaited_once_with(SSO_JWT, "Claude", "mcp:read")
        assert store.codes == {}

    @pytest.mark.asyncio
    async def test_the_session_scope_is_the_one_answered(self, store, backend, frozen):
        backend.create.return_value = session(scope="mcp:other")
        seed_code(store, scope="mcp:custom")
        resp = await _handle_code_exchange(exchange_body())
        assert body(resp)["scope"] == "mcp:other"
        backend.create.assert_awaited_once_with(SSO_JWT, "Claude", "mcp:custom")

    @pytest.mark.asyncio
    async def test_the_access_token_lasts_the_backends_lifetime(
        self, store, backend, frozen, monkeypatch
    ):
        backend.create.return_value = session(expires_in=600)
        seed_code(store)
        data = body(await _handle_code_exchange(exchange_body()))
        assert data["expires_in"] == 600
        assert await opens_at(NOW + 599, data["access_token"], monkeypatch) == SESSION_JWT
        assert await opens_at(NOW + 600, data["access_token"], monkeypatch) is None

    @pytest.mark.asyncio
    async def test_the_access_token_never_outlives_its_jwt(
        self, store, backend, frozen, monkeypatch
    ):
        short = jwt_with({"exp": NOW + 100})
        backend.create.return_value = session(access_token=short, expires_in=3600)
        seed_code(store)
        data = body(await _handle_code_exchange(exchange_body()))
        assert data["expires_in"] == 100
        assert await opens_at(NOW + 99, data["access_token"], monkeypatch) == short
        assert await opens_at(NOW + 100, data["access_token"], monkeypatch) is None

    @pytest.mark.asyncio
    async def test_without_a_session_the_sso_jwt_is_sealed_and_no_refresh_token_issued(
        self, store, backend, frozen
    ):
        backend.create.return_value = None
        seed_code(store, scope="mcp:custom")
        resp = await _handle_code_exchange(exchange_body())
        assert resp.status_code == 200
        assert resp.headers["cache-control"] == "no-store"
        data = body(resp)
        access = data.pop("access_token")
        # The SSO JWT lives 24 h, but nothing can revoke it: an hour at most.
        assert data == {"token_type": "Bearer", "expires_in": 3600, "scope": "mcp:custom"}
        assert await resolve_token(access) == SSO_JWT
        assert store.codes == {}

    def test_a_degraded_connection_lasts_an_hour_at_most(self):
        assert oauth.DEGRADED_ACCESS_TOKEN_SECONDS == 3600

    @pytest.mark.asyncio
    async def test_a_degraded_token_for_a_long_jwt_closes_after_an_hour(
        self, store, backend, frozen, monkeypatch
    ):
        backend.create.return_value = None
        seed_code(store)
        data = body(await _handle_code_exchange(exchange_body()))
        assert data["expires_in"] == 3600
        assert await opens_at(NOW + 3599, data["access_token"], monkeypatch) == SSO_JWT
        assert await opens_at(NOW + 3600, data["access_token"], monkeypatch) is None

    @pytest.mark.asyncio
    async def test_a_degraded_token_for_a_short_jwt_closes_with_it(
        self, store, backend, frozen, monkeypatch
    ):
        backend.create.return_value = None
        short = jwt_with({"exp": NOW + 1200})
        seed_code(store, turbo_jwt=short)
        data = body(await _handle_code_exchange(exchange_body()))
        assert data["expires_in"] == 1200
        assert await opens_at(NOW + 1199, data["access_token"], monkeypatch) == short
        assert await opens_at(NOW + 1200, data["access_token"], monkeypatch) is None

    @pytest.mark.asyncio
    async def test_an_outage_answers_503_and_keeps_the_code_for_the_retry(
        self, store, backend, caplog
    ):
        backend.create.side_effect = [RefreshUnavailableError("backend answered 502"), session()]
        seed_code(store)
        with caplog.at_level(logging.WARNING, logger=oauth.logger.name):
            resp = await _handle_code_exchange(exchange_body())
        assert resp.status_code == 503
        assert resp.headers["retry-after"] == "5"
        assert resp.body == UNAVAILABLE
        assert store.codes["code1"].used is False
        (record,) = [r for r in caplog.records if r.name == oauth.logger.name]
        assert record.getMessage() == "Turbo EA backend unavailable while opening an MCP session"
        assert record.exc_info[0] is RefreshUnavailableError
        # The client's retry signs in.
        retry = await _handle_code_exchange(exchange_body())
        assert retry.status_code == 200
        assert body(retry)["refresh_token"] == REFRESH_1
        assert store.codes == {}

    @pytest.mark.asyncio
    async def test_a_code_dropped_while_the_session_opens_still_answers(self, store, backend):
        seed_code(store)

        async def racing(*args):
            store.codes.clear()  # a replayed exchange dropped it meanwhile
            return session()

        backend.create.side_effect = racing
        resp = await _handle_code_exchange(exchange_body())
        assert resp.status_code == 200

    @pytest.mark.asyncio
    async def test_unknown_code(self, store, backend):
        resp = await _handle_code_exchange(exchange_body())
        assert resp.status_code == 400
        assert body(resp) == {
            "error": "invalid_grant",
            "error_description": "Unknown or expired code",
        }
        backend.create.assert_not_awaited()

    @pytest.mark.asyncio
    async def test_a_replayed_code_is_refused_and_dropped(self, store, backend):
        seed_code(store, used=True)
        resp = await _handle_code_exchange(exchange_body())
        assert resp.status_code == 400
        assert body(resp) == {"error": "invalid_grant", "error_description": "Code already used"}
        assert store.codes == {}
        backend.create.assert_not_awaited()

    @pytest.mark.parametrize(
        "overrides, description",
        [
            ({"redirect_uri": "http://attacker/cb"}, "redirect_uri mismatch"),
            ({"redirect_uri": None}, "redirect_uri mismatch"),
            ({"client_id": "evil"}, "client_id mismatch"),
            ({"code_verifier": "wrong"}, "PKCE verification failed"),
            ({"code_verifier": None}, "PKCE verification failed"),
        ],
    )
    @pytest.mark.asyncio
    async def test_each_binding_failure_burns_the_code(
        self, store, backend, overrides, description
    ):
        seed_code(store)
        resp = await _handle_code_exchange(exchange_body(**overrides))
        assert resp.status_code == 400
        assert body(resp) == {"error": "invalid_grant", "error_description": description}
        assert store.codes == {}
        backend.create.assert_not_awaited()

    @pytest.mark.asyncio
    async def test_an_empty_verifier_never_passes_even_against_its_own_hash(self, store):
        seed_code(store, verifier="")
        resp = await _handle_code_exchange(exchange_body(code_verifier=""))
        assert resp.status_code == 400
        assert body(resp)["error_description"] == "PKCE verification failed"

    @pytest.mark.asyncio
    async def test_a_code_is_marked_used_before_the_checks(self, store):
        # Two concurrent exchanges: the first fails a check after marking the
        # code used; a stale reference must read it as used.
        seed_code(store)
        held = store.codes["code1"]
        await _handle_code_exchange(exchange_body(client_id="evil"))
        assert held.used is True


class TestVerifyPkce:
    def test_rfc7636_appendix_b_vector(self):
        assert _verify_pkce(
            "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk",
            "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
        )

    def test_padding_is_not_accepted(self):
        assert not _verify_pkce(
            "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk",
            "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM=",
        )

    def test_the_plain_method_is_not_accepted(self):
        assert not _verify_pkce("verifier", "verifier")


class TestRefresh:
    @pytest.mark.asyncio
    async def test_relays_to_the_backend_and_issues_the_rotated_pair(self, backend, frozen):
        resp = await _handle_refresh({"refresh_token": REFRESH_1})
        assert resp.status_code == 200
        assert resp.headers["cache-control"] == "no-store"
        assert resp.headers["pragma"] == "no-cache"
        backend.refresh.assert_awaited_once_with(REFRESH_1)
        data = body(resp)
        access = data.pop("access_token")
        assert data == {
            "token_type": "Bearer",
            "expires_in": 3600,
            "refresh_token": REFRESH_2,
            "scope": "mcp:read",
        }
        assert await resolve_token(access) == SESSION_JWT

    @pytest.mark.asyncio
    async def test_the_renewed_token_lasts_the_backends_lifetime(self, backend, frozen):
        backend.refresh.return_value = session(refresh_token=REFRESH_2, expires_in=900)
        data = body(await _handle_refresh({"refresh_token": REFRESH_1}))
        assert data["expires_in"] == 900

    @pytest.mark.asyncio
    async def test_the_answered_scope_is_the_sessions(self, backend):
        backend.refresh.return_value = session(refresh_token=REFRESH_2, scope="mcp:other")
        assert body(await _handle_refresh({"refresh_token": REFRESH_1}))["scope"] == "mcp:other"

    @pytest.mark.asyncio
    async def test_a_refused_session_must_sign_in_again(self, backend):
        backend.refresh.return_value = None
        resp = await _handle_refresh({"refresh_token": REFRESH_1})
        assert resp.status_code == 400
        assert body(resp) == {
            "error": "invalid_grant",
            "error_description": "Session expired, re-authenticate",
        }

    @pytest.mark.asyncio
    async def test_an_outage_answers_503(self, backend):
        backend.refresh.side_effect = RefreshUnavailableError("backend answered 502")
        resp = await _handle_refresh({"refresh_token": REFRESH_1})
        assert resp.status_code == 503
        assert resp.headers["retry-after"] == "5"
        assert resp.body == UNAVAILABLE

    @pytest.mark.parametrize(
        "token",
        [
            "",
            "r1",
            "tea1r",
            "TEA1R.s1.1.sig",
            "tea1.s1.1.sig",
            "tea1a.s1.1.sig",
            " " + REFRESH_1,
            REFRESH_1 + " ",
            None,
            123,
            [REFRESH_1],
            {"refresh_token": REFRESH_1},
        ],
    )
    @pytest.mark.asyncio
    async def test_anything_but_a_backend_refresh_token_is_refused_here(self, backend, token):
        resp = await _handle_refresh({"refresh_token": token})
        assert resp.status_code == 400
        assert body(resp) == {
            "error": "invalid_grant",
            "error_description": "Unknown refresh token",
        }
        backend.refresh.assert_not_awaited()

    @pytest.mark.asyncio
    async def test_an_absent_refresh_token_is_refused_here(self, backend):
        resp = await _handle_refresh({})
        assert body(resp)["error_description"] == "Unknown refresh token"
        backend.refresh.assert_not_awaited()

    @pytest.mark.asyncio
    async def test_an_access_token_is_not_a_refresh_token(self, store, backend):
        seed_code(store)
        access = body(await _handle_code_exchange(exchange_body()))["access_token"]
        resp = await _handle_refresh({"refresh_token": access})
        assert body(resp)["error_description"] == "Unknown refresh token"
        backend.refresh.assert_not_awaited()


class TestRefreshTokenSignatureIsCheckedHere:
    """A refresh token is verified with the backend's key before it is relayed:
    a flood of junk tokens on /oauth/token never reaches the backend, whose
    per-address rate limit would count it against this container and turn
    the real renewals away with it (#1449)."""

    @staticmethod
    async def refused(backend, token) -> None:
        resp = await _handle_refresh({"refresh_token": token})
        assert resp.status_code == 400
        assert body(resp) == {
            "error": "invalid_grant",
            "error_description": "Unknown refresh token",
        }
        backend.refresh.assert_not_awaited()

    def test_the_key_is_the_backends(self):
        # The same derivation as ``REFRESH_KEY_CONTEXT`` in the backend's
        # mcp_session_service.py; the known-answer vector is in test_config.py.
        assert REFRESH_KEY == config.refresh_token_key("known-answer-secret")
        assert oauth._refresh_token_key == REFRESH_KEY

    @pytest.mark.asyncio
    async def test_a_signed_token_is_relayed_unchanged(self, backend):
        token = signed_refresh("0f" * 16, 7)
        assert (await _handle_refresh({"refresh_token": token})).status_code == 200
        backend.refresh.assert_awaited_once_with(token)

    @pytest.mark.asyncio
    async def test_a_token_signed_with_another_key_is_refused(self, backend):
        other = config.refresh_token_key("another-secret")
        await self.refused(backend, signed_refresh("a1" * 16, 1, key=other))

    @pytest.mark.asyncio
    async def test_a_junk_token_with_the_prefix_is_refused(self, backend):
        await self.refused(backend, "tea1r.x")

    @pytest.mark.asyncio
    async def test_a_tampered_signature_is_refused(self, backend):
        flipped = REFRESH_1[:-1] + ("A" if REFRESH_1[-1] != "A" else "B")
        await self.refused(backend, flipped)

    @pytest.mark.asyncio
    async def test_a_signature_moved_to_another_generation_is_refused(self, backend):
        signature = REFRESH_1.rpartition(".")[2]
        await self.refused(backend, f"tea1r.{'a1' * 16}.2.{signature}")

    @pytest.mark.asyncio
    async def test_a_padded_signature_is_refused(self, backend):
        await self.refused(backend, REFRESH_1 + "=")

    @pytest.mark.asyncio
    async def test_a_signed_body_under_another_prefix_is_refused(self, backend):
        await self.refused(backend, "tea1a." + REFRESH_1[len("tea1r.") :])

    @pytest.mark.asyncio
    async def test_a_token_of_exactly_200_characters_is_relayed(self, backend):
        token = signed_refresh("b" * 148, 1)
        assert len(token) == oauth.MAX_REFRESH_TOKEN_LENGTH == 200
        assert (await _handle_refresh({"refresh_token": token})).status_code == 200
        backend.refresh.assert_awaited_once_with(token)

    @pytest.mark.asyncio
    async def test_a_signed_token_over_200_characters_is_refused(self, backend):
        token = signed_refresh("b" * 149, 1)
        assert len(token) == 201
        await self.refused(backend, token)

    @pytest.mark.asyncio
    async def test_a_signed_non_ascii_token_is_refused(self, backend):
        await self.refused(backend, signed_refresh("é" * 32, 1))

    @pytest.mark.parametrize("token", ["tea1r.\ud800.1.sig", "tea1r.é.1.ü", "tea1r.名前"])
    @pytest.mark.asyncio
    async def test_non_ascii_junk_is_refused_without_raising(self, backend, token):
        await self.refused(backend, token)

    @pytest.mark.asyncio
    async def test_without_secret_key_even_a_signed_token_is_refused(self, backend, monkeypatch):
        monkeypatch.setattr(oauth, "_refresh_token_key", None)
        await self.refused(backend, REFRESH_1)

    def test_the_comparison_is_constant_time(self, monkeypatch):
        compared = []

        def compare(a, b):
            compared.append((a, b))
            return False

        monkeypatch.setattr(oauth.hmac, "compare_digest", compare)
        assert oauth._refresh_token_signed(REFRESH_1) is False
        signature = REFRESH_1.rpartition(".")[2].encode()
        assert compared == [(signature, signature)]


class TestSealAccessToken:
    def test_seals_exactly_the_type_the_jwt_and_the_expiry(self):
        token = oauth.seal_access_token("the.jwt.x", 1234.5)
        assert token.startswith("tea1a.")
        plain = oauth._token_fernet.decrypt(token[len("tea1a.") :])
        assert plain == b'{"typ":"access","jwt":"the.jwt.x","exp":1234.5}'

    def test_two_seals_of_the_same_jwt_differ(self):
        assert oauth.seal_access_token("j", 5.0) != oauth.seal_access_token("j", 5.0)


class TestResolveToken:
    @pytest.mark.asyncio
    async def test_a_sealed_token_opens_to_its_jwt(self, frozen):
        assert await resolve_token(oauth.seal_access_token("the.jwt.x", NOW + 60)) == "the.jwt.x"

    @pytest.mark.asyncio
    async def test_an_integer_expiry_is_read(self, frozen):
        assert await resolve_token(seal({"typ": "access", "jwt": "j", "exp": int(NOW) + 1})) == "j"

    @pytest.mark.asyncio
    async def test_it_never_asks_the_backend(self, backend, frozen, monkeypatch):
        monkeypatch.setattr(api_client, "TurboEAClient", None)
        assert await resolve_token(oauth.seal_access_token("j", NOW + 60)) == "j"
        backend.create.assert_not_awaited()
        backend.refresh.assert_not_awaited()

    @pytest.mark.asyncio
    async def test_it_expires_at_exactly_its_expiry(self, frozen, monkeypatch):
        token = oauth.seal_access_token("j", NOW + 10)
        assert await opens_at(NOW + 9.999, token, monkeypatch) == "j"
        assert await opens_at(NOW + 10, token, monkeypatch) is None
        assert await opens_at(NOW + 11, token, monkeypatch) is None

    @pytest.mark.parametrize(
        "token",
        [
            "",
            "nope",
            SESSION_JWT,
            REFRESH_1,
            "tea1a.",
            "tea1a.garbage",
            "tea1a.été",
            "tea1.x.y",
        ],
    )
    @pytest.mark.asyncio
    async def test_anything_not_sealed_here_does_not_resolve(self, frozen, token):
        assert await resolve_token(token) is None

    @pytest.mark.asyncio
    async def test_the_prefix_is_required(self, frozen):
        token = oauth.seal_access_token("j", NOW + 60)
        assert await resolve_token(token[len("tea1a.") :]) is None
        assert await resolve_token("tea1r." + token[len("tea1a.") :]) is None

    @pytest.mark.asyncio
    async def test_a_token_sealed_with_another_key_does_not_resolve(self, frozen):
        claims = json.dumps({"typ": "access", "jwt": "j", "exp": NOW + 60}).encode()
        other = Fernet(Fernet.generate_key()).encrypt(claims).decode()
        assert await resolve_token("tea1a." + other) is None

    @pytest.mark.parametrize(
        "claims",
        [
            ["access", "j", NOW + 60],
            "access",
            {"jwt": "j", "exp": NOW + 60},
            {"typ": "refresh", "jwt": "j", "exp": NOW + 60},
            {"typ": "ACCESS", "jwt": "j", "exp": NOW + 60},
            {"typ": "access", "exp": NOW + 60},
            {"typ": "access", "jwt": "", "exp": NOW + 60},
            {"typ": "access", "jwt": 7, "exp": NOW + 60},
            {"typ": "access", "jwt": "j"},
            {"typ": "access", "jwt": "j", "exp": str(NOW + 60)},
            {"typ": "access", "jwt": "j", "exp": None},
            {"typ": "access", "jwt": "j", "exp": NOW - 1},
        ],
    )
    @pytest.mark.asyncio
    async def test_a_malformed_seal_does_not_resolve(self, frozen, claims):
        assert await resolve_token(seal(claims)) is None

    @pytest.mark.asyncio
    async def test_a_seal_that_is_not_json_does_not_resolve(self, frozen):
        assert await resolve_token("tea1a." + oauth._token_fernet.encrypt(b"\xff").decode()) is None


# ── Exact boundaries and absent parameters ──────────────────────────────────


class TestBoundaries:
    def test_an_entry_exactly_one_ttl_old_survives_cleanup(self, store, frozen):
        store.pending["edge"] = PendingAuth(
            "c", CB, "s", "st", "ch", "S256", created_at=NOW - AUTH_CODE_TTL
        )
        store.codes["edge"] = AuthCode("x", "c", CB, "s", "ch", "j", created_at=NOW - AUTH_CODE_TTL)
        store.cleanup_expired()
        assert "edge" in store.pending
        assert "edge" in store.codes

    @pytest.mark.asyncio
    async def test_the_sso_config_is_still_cached_at_exactly_the_ttl(self, monkeypatch, frozen):
        monkeypatch.setattr(oauth, "_sso_config_cache", {"n": 1})
        monkeypatch.setattr(oauth, "_sso_config_ts", NOW - 300)
        fetch = AsyncMock(return_value={"n": 2})
        monkeypatch.setattr(api_client, "get_sso_config", fetch)
        assert await oauth._get_sso_config() == {"n": 1}
        fetch.assert_not_awaited()

    @pytest.mark.parametrize("token", ["a.b", jwt_with({"sub": "x"}), "h.!!!.s"])
    def test_the_fallback_is_exactly_one_hour(self, frozen, token):
        assert _estimate_jwt_expiry(token) == NOW + 3600


class TestPublicUrlEndingInX:
    """``rstrip("/")`` must strip only slashes — a URL may end in any letter."""

    BASE = "https://mcp.example.com/MCPX"

    @pytest.fixture(autouse=True)
    def _url(self, monkeypatch, store):
        monkeypatch.setattr(oauth, "MCP_PUBLIC_URL", self.BASE + "/")

    def test_metadata(self, app):
        data = app.get("/as").json()
        assert data["issuer"] == self.BASE
        assert data["token_endpoint"] == f"{self.BASE}/oauth/token"

    def test_authorize_callback_url(self, app, store, monkeypatch):
        store.clients["good"] = RegisteredClient(client_id="good", redirect_uris=[CB])
        monkeypatch.setattr(oauth, "_get_sso_config", AsyncMock(return_value=SSO))
        resp = app.get("/oauth/authorize", params=authorize_params(), follow_redirects=False)
        query = dict(parse_qsl(urlsplit(resp.headers["location"]).query))
        assert query["redirect_uri"] == f"{self.BASE}/oauth/callback"

    def test_sso_callback_exchange_url(self, app, store, monkeypatch):
        store.pending["st8"] = PendingAuth("good", CB, "s", "st", "ch", "S256")
        exchange = AsyncMock(return_value={"access_token": "j"})
        monkeypatch.setattr(api_client, "exchange_sso_code", exchange)
        app.get("/oauth/callback", params={"code": "c", "state": "st8"}, follow_redirects=False)
        exchange.assert_awaited_once_with("c", f"{self.BASE}/oauth/callback")


class TestAbsentParameters:
    """What an omitted parameter reads as — the empty string, never a stand-in."""

    def test_authorize_records_an_absent_client_id_as_empty(self, app, store, monkeypatch):
        monkeypatch.setattr(oauth, "MCP_OAUTH_ALLOWED_REDIRECT_URIS", [CB])
        monkeypatch.setattr(oauth, "_get_sso_config", AsyncMock(return_value=SSO))
        app.get(
            "/oauth/authorize",
            params=authorize_params(client_id=None, scope="mcp:custom"),
            follow_redirects=False,
        )
        [pending] = store.pending.values()
        assert pending.client_id == ""
        assert pending.scope == "mcp:custom"

    @pytest.mark.asyncio
    async def test_an_absent_code_is_the_empty_code(self, store, backend):
        seed_code(store, code="")
        resp = await _handle_code_exchange(exchange_body(code=None))
        assert resp.status_code == 200

    @pytest.mark.asyncio
    async def test_an_absent_code_matches_no_other_code(self, store):
        seed_code(store, code="XXXX")
        resp = await _handle_code_exchange(exchange_body(code=None))
        assert body(resp)["error_description"] == "Unknown or expired code"

    @pytest.mark.asyncio
    async def test_an_absent_verifier_never_verifies(self, store):
        seed_code(store, verifier="XXXX")
        resp = await _handle_code_exchange(exchange_body(code_verifier=None))
        assert body(resp)["error_description"] == "PKCE verification failed"

    @pytest.mark.asyncio
    async def test_an_absent_redirect_uri_is_the_empty_uri(self, store, backend):
        seed_code(store)
        store.codes["code1"].redirect_uri = ""
        resp = await _handle_code_exchange(exchange_body(redirect_uri=None))
        assert resp.status_code == 200

    @pytest.mark.asyncio
    async def test_an_absent_redirect_uri_matches_no_other_uri(self, store):
        seed_code(store)
        store.codes["code1"].redirect_uri = "XXXX"
        resp = await _handle_code_exchange(exchange_body(redirect_uri=None))
        assert body(resp)["error_description"] == "redirect_uri mismatch"

    def test_an_auth_code_names_the_default_client_unless_told(self):
        assert AuthCode("c", "cid", CB, "s", "ch", "j").client_name == "MCP Client"
        assert PendingAuth("cid", CB, "s", "st", "ch", "S256").client_name == "MCP Client"


class TestTokenEndpointBodies:
    @pytest.mark.asyncio
    async def test_falls_back_to_json_when_the_form_cannot_be_parsed(
        self, app, store, backend, frozen
    ):
        # A multipart body without a boundary makes the form parser raise.
        seed_code(store)
        resp = app.post(
            "/oauth/token",
            content=json.dumps(exchange_body()).encode(),
            headers={"content-type": "multipart/form-data"},
        )
        assert resp.status_code == 200
        assert await resolve_token(resp.json()["access_token"]) == SESSION_JWT

    def test_a_body_that_is_neither_form_nor_json_is_refused(self, app):
        resp = app.post(
            "/oauth/token", content=b"garbage", headers={"content-type": "multipart/form-data"}
        )
        assert resp.status_code == 400
        assert resp.json() == {"error": "invalid_request"}
