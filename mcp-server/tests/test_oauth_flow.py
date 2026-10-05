"""The OAuth authorization server end to end, one decision per test.

``test_oauth.py`` pins the redirect-URI fix (1.64.4) and the data shapes. This
file pins every branch the flow takes — exact error bodies, the parameters the
SSO redirect carries, what each failure removes from the store, token rotation
and the proactive JWT refresh — so that a mutation of any of them fails a test.
Nothing here talks to a network: the backend is replaced at ``api_client``.
"""

from __future__ import annotations

import base64
import hashlib
import json
import time
from typing import ClassVar
from unittest.mock import AsyncMock, patch
from urllib.parse import parse_qsl, urlsplit

import pytest
from starlette.applications import Starlette
from starlette.routing import Route
from starlette.testclient import TestClient

from turbo_ea_mcp import api_client, oauth
from turbo_ea_mcp.oauth import (
    ACCESS_TOKEN_TTL,
    AUTH_CODE_TTL,
    REFRESH_TOKEN_TTL,
    TURBO_JWT_REFRESH_BUFFER,
    AuthCode,
    OAuthStore,
    PendingAuth,
    RegisteredClient,
    TokenEntry,
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
    assert ACCESS_TOKEN_TTL == 3600
    assert REFRESH_TOKEN_TTL == 30 * 24 * 3600
    assert AUTH_CODE_TTL == 600
    assert TURBO_JWT_REFRESH_BUFFER == 3600


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
        assert len(cid) == 32
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
        ) == (code, "good", CB, "mcp:read", "chal", "turbo.jwt.value", False)
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


def seed_code(store, *, verifier="v-123", client_id="good", used=False, code="code1"):
    store.codes[code] = AuthCode(
        code=code,
        client_id=client_id,
        redirect_uri=CB,
        scope="mcp:read",
        code_challenge=challenge_of(verifier),
        turbo_jwt=jwt_with({"exp": 4102444800}),
        used=used,
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


class TestTokenEndpointRoute:
    def test_unsupported_grant(self, app):
        resp = app.post("/oauth/token", data={"grant_type": "password"})
        assert resp.status_code == 400
        assert resp.json() == {"error": "unsupported_grant_type"}

    def test_the_form_code_grant_issues_tokens(self, app, store):
        seed_code(store)
        resp = app.post("/oauth/token", data=exchange_body())
        assert resp.status_code == 200
        assert resp.json()["access_token"] in store.tokens

    def test_the_form_refresh_grant_rotates(self, app, store):
        store.tokens["old"] = TokenEntry("jwt", time.time() + 99999, "r1", "mcp:read")
        store.refresh_tokens["r1"] = "old"
        with patch.object(
            api_client.TurboEAClient, "refresh_token", AsyncMock(return_value=jwt_with({"exp": 5}))
        ):
            resp = app.post(
                "/oauth/token", data={"grant_type": "refresh_token", "refresh_token": "r1"}
            )
        assert resp.status_code == 200
        assert "old" not in store.tokens


class TestCodeExchange:
    @pytest.mark.asyncio
    async def test_issues_tokens_and_consumes_the_code(self, store):
        seed_code(store)
        resp = await _handle_code_exchange(exchange_body(client_id="good"))
        assert resp.status_code == 200
        data = body(resp)
        access, refresh = data.pop("access_token"), data.pop("refresh_token")
        assert data == {"token_type": "Bearer", "expires_in": 3600, "scope": "mcp:read"}
        assert len(access) == len(refresh) == 64
        assert access != refresh
        entry = store.tokens[access]
        assert entry.turbo_jwt == jwt_with({"exp": 4102444800})
        assert entry.turbo_jwt_exp == 4102444800.0
        assert entry.refresh_token == refresh
        assert entry.scope == "mcp:read"
        assert store.refresh_tokens == {refresh: access}
        assert store.codes == {}

    @pytest.mark.asyncio
    async def test_unknown_code(self, store):
        resp = await _handle_code_exchange(exchange_body())
        assert resp.status_code == 400
        assert body(resp) == {
            "error": "invalid_grant",
            "error_description": "Unknown or expired code",
        }

    @pytest.mark.asyncio
    async def test_a_replayed_code_is_refused_and_dropped(self, store):
        seed_code(store, used=True)
        resp = await _handle_code_exchange(exchange_body())
        assert resp.status_code == 400
        assert body(resp) == {"error": "invalid_grant", "error_description": "Code already used"}
        assert store.codes == {}
        assert store.tokens == {}

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
    async def test_each_binding_failure_burns_the_code(self, store, overrides, description):
        seed_code(store)
        resp = await _handle_code_exchange(exchange_body(**overrides))
        assert resp.status_code == 400
        assert body(resp) == {"error": "invalid_grant", "error_description": description}
        assert store.codes == {}
        assert store.tokens == {}

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


class FakeTurboClient:
    """Stands in for ``TurboEAClient``: records the JWT it was built with."""

    built_with: ClassVar[list[str]] = []
    result: str | None = None

    def __init__(self, token: str) -> None:
        FakeTurboClient.built_with.append(token)

    async def refresh_token(self) -> str | None:
        return FakeTurboClient.result


@pytest.fixture
def turbo(monkeypatch):
    FakeTurboClient.built_with = []
    FakeTurboClient.result = None
    monkeypatch.setattr(api_client, "TurboEAClient", FakeTurboClient)
    return FakeTurboClient


class TestRefresh:
    def _seed(self, store):
        store.tokens["old"] = TokenEntry("old-jwt", time.time() + 99999, "r1", "mcp:read")
        store.refresh_tokens["r1"] = "old"

    @pytest.mark.asyncio
    async def test_rotates_both_tokens_with_a_fresh_jwt(self, store, turbo):
        self._seed(store)
        turbo.result = jwt_with({"exp": 4102444800})
        resp = await _handle_refresh({"refresh_token": "r1"})
        assert resp.status_code == 200
        assert turbo.built_with == ["old-jwt"]
        data = body(resp)
        access, refresh = data.pop("access_token"), data.pop("refresh_token")
        assert data == {"token_type": "Bearer", "expires_in": 3600, "scope": "mcp:read"}
        assert len(access) == len(refresh) == 64
        assert set(store.tokens) == {access}
        assert store.refresh_tokens == {refresh: access}
        entry = store.tokens[access]
        assert entry.turbo_jwt == turbo.result
        assert entry.turbo_jwt_exp == 4102444800.0
        assert entry.refresh_token == refresh
        assert entry.scope == "mcp:read"

    @pytest.mark.asyncio
    async def test_an_unknown_refresh_token(self, store, turbo):
        resp = await _handle_refresh({})
        assert resp.status_code == 400
        assert body(resp) == {
            "error": "invalid_grant",
            "error_description": "Unknown refresh token",
        }
        assert turbo.built_with == []

    @pytest.mark.asyncio
    async def test_a_dangling_refresh_token_is_dropped(self, store, turbo):
        store.refresh_tokens["r1"] = "gone"
        store.refresh_tokens["r2"] = "other"
        resp = await _handle_refresh({"refresh_token": "r1"})
        assert resp.status_code == 400
        assert body(resp) == {
            "error": "invalid_grant",
            "error_description": "Token entry not found",
        }
        assert store.refresh_tokens == {"r2": "other"}

    @pytest.mark.asyncio
    async def test_an_unrenewable_session_is_revoked(self, store, turbo):
        self._seed(store)
        store.tokens["keep"] = TokenEntry("k", time.time() + 99999, "r2", "mcp:read")
        store.refresh_tokens["r2"] = "keep"
        resp = await _handle_refresh({"refresh_token": "r1"})
        assert resp.status_code == 400
        assert body(resp) == {
            "error": "invalid_grant",
            "error_description": "Session expired, re-authenticate",
        }
        assert set(store.tokens) == {"keep"}
        assert store.refresh_tokens == {"r2": "keep"}


class TestResolveToken:
    @pytest.mark.asyncio
    async def test_unknown_token(self, store, turbo):
        assert await resolve_token("nope") is None

    @pytest.mark.asyncio
    async def test_a_jwt_far_from_expiry_is_returned_as_is(self, store, turbo):
        store.tokens["a"] = TokenEntry("jwt", time.time() + TURBO_JWT_REFRESH_BUFFER + 60, "r", "s")
        assert await resolve_token("a") == "jwt"
        assert turbo.built_with == []

    @pytest.mark.asyncio
    async def test_a_jwt_near_expiry_is_renewed_in_place(self, store, turbo):
        store.tokens["a"] = TokenEntry("jwt", time.time() + TURBO_JWT_REFRESH_BUFFER - 60, "r", "s")
        turbo.result = jwt_with({"exp": 4102444800})
        assert await resolve_token("a") == turbo.result
        assert turbo.built_with == ["jwt"]
        assert store.tokens["a"].turbo_jwt == turbo.result
        assert store.tokens["a"].turbo_jwt_exp == 4102444800.0

    @pytest.mark.asyncio
    async def test_an_unrenewable_jwt_revokes_the_token(self, store, turbo):
        store.tokens["a"] = TokenEntry("jwt", time.time() - 1, "r", "s")
        store.refresh_tokens["r"] = "a"
        store.refresh_tokens["r2"] = "b"
        assert await resolve_token("a") is None
        assert store.tokens == {}
        assert store.refresh_tokens == {"r2": "b"}


# ── Exact boundaries and absent parameters ──────────────────────────────────

NOW = 1_700_000_000.0


@pytest.fixture
def frozen(monkeypatch):
    monkeypatch.setattr(oauth.time, "time", lambda: NOW)
    return NOW


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

    @pytest.mark.asyncio
    async def test_a_jwt_exactly_one_buffer_from_expiry_is_not_refreshed(
        self, store, turbo, frozen
    ):
        store.tokens["a"] = TokenEntry("jwt", NOW + TURBO_JWT_REFRESH_BUFFER, "r", "s")
        assert await resolve_token("a") == "jwt"
        assert turbo.built_with == []

    @pytest.mark.asyncio
    async def test_revoking_tolerates_an_already_dropped_refresh_token(self, store, turbo):
        store.tokens["a"] = TokenEntry("jwt", time.time() - 1, "gone", "s")
        assert await resolve_token("a") is None
        assert store.tokens == {}

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
    async def test_an_absent_code_is_the_empty_code(self, store):
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
    async def test_an_absent_redirect_uri_is_the_empty_uri(self, store):
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

    @pytest.mark.asyncio
    async def test_an_absent_refresh_token_is_the_empty_token(self, store, turbo):
        store.tokens["old"] = TokenEntry("jwt", time.time() + 99999, "", "s")
        store.refresh_tokens[""] = "old"
        turbo.result = jwt_with({"exp": 5})
        resp = await _handle_refresh({})
        assert resp.status_code == 200

    @pytest.mark.asyncio
    async def test_an_absent_refresh_token_matches_no_other_token(self, store, turbo):
        store.tokens["old"] = TokenEntry("jwt", time.time() + 99999, "XXXX", "s")
        store.refresh_tokens["XXXX"] = "old"
        resp = await _handle_refresh({})
        assert body(resp)["error_description"] == "Unknown refresh token"


class TestTokenEndpointBodies:
    def test_falls_back_to_json_when_the_form_cannot_be_parsed(self, app, store):
        # A multipart body without a boundary makes the form parser raise.
        seed_code(store)
        resp = app.post(
            "/oauth/token",
            content=json.dumps(exchange_body()).encode(),
            headers={"content-type": "multipart/form-data"},
        )
        assert resp.status_code == 200
        assert resp.json()["access_token"] in store.tokens

    def test_a_body_that_is_neither_form_nor_json_is_refused(self, app):
        resp = app.post(
            "/oauth/token", content=b"garbage", headers={"content-type": "multipart/form-data"}
        )
        assert resp.status_code == 400
        assert resp.json() == {"error": "invalid_request"}
