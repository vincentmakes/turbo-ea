"""The two backend calls behind an AI tool's connection (#1449).

``create_mcp_session`` opens the durable session at sign-in and
``refresh_mcp_session`` renews it. Both carry the service proof — a one-minute
HS256 token signed with the key derived from SECRET_KEY — and both must tell an
outage (raise, the client retries) from a refusal (``None``). Pinned against an
``httpx.MockTransport``: nothing reaches a network.
"""

from __future__ import annotations

import json
import logging

import httpx
import jwt
import pytest

from turbo_ea_mcp import api_client, config
from turbo_ea_mcp.api_client import (
    McpSessionTokens,
    RefreshUnavailableError,
    create_mcp_session,
    refresh_mcp_session,
    service_token,
)

BASE = "http://backend:8000"
KEY = config.service_auth_key("known-answer-secret")
NOW = 1_700_000_000
TOKENS = {
    "access_token": "session.jwt.x",
    "token_type": "bearer",
    "expires_in": 3600,
    "refresh_token": "tea1r.s1.1.sig",
    "scope": "mcp:read",
}
EXPECTED = McpSessionTokens(
    access_token="session.jwt.x", refresh_token="tea1r.s1.1.sig", expires_in=3600, scope="mcp:read"
)


class Wire:
    def __init__(self) -> None:
        self.requests: list[httpx.Request] = []
        self.timeouts: list = []
        self.reply = lambda request: httpx.Response(201, json=TOKENS)

    def handler(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        return self.reply(request)

    @property
    def last(self) -> httpx.Request:
        return self.requests[-1]


@pytest.fixture
def wire(monkeypatch):
    w = Wire()
    real = httpx.AsyncClient

    def client(*args, timeout=None, **kwargs):
        w.timeouts.append(timeout)
        return real(*args, transport=httpx.MockTransport(w.handler), timeout=timeout, **kwargs)

    monkeypatch.setattr(api_client.httpx, "AsyncClient", client)
    monkeypatch.setattr(api_client, "TURBO_EA_URL", BASE)
    monkeypatch.setattr(api_client, "MCP_SERVICE_AUTH_KEY", KEY)
    monkeypatch.setattr(api_client.time, "time", lambda: NOW + 0.75)
    return w


def header_names(request: httpx.Request) -> set[bytes]:
    """The header names exactly as sent: httpx keeps their case on the wire."""
    return {name for name, _ in request.headers.raw}


def proof_claims(request: httpx.Request) -> dict:
    return jwt.decode(
        request.headers["x-turbo-ea-service"],
        KEY,
        algorithms=["HS256"],
        issuer="turbo-ea-mcp",
        audience="turbo-ea-backend",
        options={"verify_exp": False, "verify_iat": False},
    )


class TestServiceToken:
    def test_none_without_a_key(self, monkeypatch):
        monkeypatch.setattr(api_client, "MCP_SERVICE_AUTH_KEY", None)
        assert service_token() is None

    def test_a_one_minute_hs256_token_for_the_backend(self, wire):
        token = service_token()
        assert jwt.get_unverified_header(token)["alg"] == "HS256"
        claims = jwt.decode(
            token,
            KEY,
            algorithms=["HS256"],
            issuer="turbo-ea-mcp",
            audience="turbo-ea-backend",
            options={"verify_exp": False, "verify_iat": False},
        )
        assert claims == {
            "iss": "turbo-ea-mcp",
            "aud": "turbo-ea-backend",
            "iat": NOW,
            "exp": NOW + 60,
        }

    def test_another_key_does_not_verify_it(self, wire):
        with pytest.raises(jwt.InvalidSignatureError):
            jwt.decode(
                service_token(),
                config.service_auth_key("another-secret"),
                algorithms=["HS256"],
                audience="turbo-ea-backend",
                options={"verify_exp": False, "verify_iat": False},
            )


class TestCreateMcpSession:
    @pytest.mark.asyncio
    async def test_opens_a_session_with_the_users_jwt_and_the_proof(self, wire):
        assert await create_mcp_session("user.jwt", "Claude", "mcp:read") == EXPECTED
        request = wire.last
        assert request.method == "POST"
        assert str(request.url) == f"{BASE}/api/v1/auth/mcp/sessions"
        assert request.headers["authorization"] == "Bearer user.jwt"
        assert {b"Authorization", b"X-Turbo-EA-Service"} <= header_names(request)
        assert proof_claims(request)["exp"] == NOW + 60
        assert json.loads(request.content) == {"client_name": "Claude", "scope": "mcp:read"}
        assert wire.timeouts == [10.0]

    @pytest.mark.asyncio
    async def test_a_200_is_read_like_a_201(self, wire):
        wire.reply = lambda request: httpx.Response(200, json=TOKENS)
        assert await create_mcp_session("user.jwt", "Claude", "mcp:read") == EXPECTED

    @pytest.mark.asyncio
    async def test_name_and_scope_are_cut_to_what_the_backend_takes(self, wire):
        await create_mcp_session("user.jwt", "n" * 250, "s" * 201)
        assert json.loads(wire.last.content) == {"client_name": "n" * 200, "scope": "s" * 200}
        await create_mcp_session("user.jwt", "n" * 200, "s" * 199)
        assert json.loads(wire.last.content) == {"client_name": "n" * 200, "scope": "s" * 199}

    @pytest.mark.asyncio
    async def test_without_a_key_nothing_is_sent_and_the_operator_is_told(
        self, wire, monkeypatch, caplog
    ):
        monkeypatch.setattr(api_client, "MCP_SERVICE_AUTH_KEY", None)
        with caplog.at_level(logging.WARNING, logger=api_client.logger.name):
            assert await create_mcp_session("user.jwt", "Claude", "mcp:read") is None
        assert wire.requests == []
        assert [r.getMessage() for r in caplog.records] == [
            "SECRET_KEY is not set for the MCP server: AI tool connections will "
            "not renew. Pass the instance's SECRET_KEY to the mcp-server container."
        ]

    @pytest.mark.parametrize("status", [401, 404, 405])
    @pytest.mark.asyncio
    async def test_a_backend_that_cannot_open_one_degrades_with_a_warning(
        self, wire, status, caplog
    ):
        wire.reply = lambda request: httpx.Response(status, json={"detail": "no"})
        with caplog.at_level(logging.WARNING, logger=api_client.logger.name):
            assert await create_mcp_session("user.jwt", "Claude", "mcp:read") is None
        assert [r.getMessage() for r in caplog.records] == [
            f"Turbo EA did not open an MCP session (HTTP {status}): AI tool connections "
            "will not renew until the MCP server's SECRET_KEY matches the backend's "
            "and the backend is upgraded to this MCP server's version."
        ]

    @pytest.mark.parametrize("status", [400, 403, 422, 429, 500, 502, 503])
    @pytest.mark.asyncio
    async def test_any_other_failure_is_an_outage_to_retry(self, wire, status):
        wire.reply = lambda request: httpx.Response(status, json={"detail": "no"})
        with pytest.raises(RefreshUnavailableError) as excinfo:
            await create_mcp_session("user.jwt", "Claude", "mcp:read")
        assert str(excinfo.value) == f"backend answered {status}"

    @pytest.mark.asyncio
    async def test_an_unreachable_backend_is_an_outage(self, wire):
        def refuse(request):
            raise httpx.ConnectError("connection refused", request=request)

        wire.reply = refuse
        with pytest.raises(RefreshUnavailableError) as excinfo:
            await create_mcp_session("user.jwt", "Claude", "mcp:read")
        assert str(excinfo.value) == "connection refused"
        assert isinstance(excinfo.value.__cause__, httpx.ConnectError)


UNREADABLE = [
    httpx.Response(201, content=b"not json"),
    httpx.Response(201, json={}),
    httpx.Response(201, json=[TOKENS]),
    httpx.Response(201, json={**TOKENS, "access_token": ""}),
    httpx.Response(201, json={**TOKENS, "refresh_token": ""}),
    httpx.Response(201, json={**TOKENS, "expires_in": "soon"}),
    httpx.Response(201, json={k: v for k, v in TOKENS.items() if k != "scope"}),
]


@pytest.mark.parametrize("response", UNREADABLE)
@pytest.mark.parametrize("call", ["create", "refresh"])
@pytest.mark.asyncio
async def test_an_unreadable_session_is_an_outage_not_a_crash(wire, response, call):
    wire.reply = lambda request: response
    with pytest.raises(RefreshUnavailableError) as excinfo:
        if call == "create":
            await create_mcp_session("user.jwt", "Claude", "mcp:read")
        else:
            await refresh_mcp_session("tea1r.s1.0.sig")
    assert str(excinfo.value) == "backend sent an unreadable MCP session"


def test_one_character_tokens_are_tokens():
    tokens = McpSessionTokens(access_token="a", refresh_token="r", expires_in=0, scope="")
    assert (tokens.access_token, tokens.refresh_token) == ("a", "r")


class TestRefreshMcpSession:
    @pytest.mark.asyncio
    async def test_relays_the_refresh_token_with_the_proof_only(self, wire):
        wire.reply = lambda request: httpx.Response(200, json=TOKENS)
        assert await refresh_mcp_session("tea1r.s1.0.sig") == EXPECTED
        request = wire.last
        assert request.method == "POST"
        assert str(request.url) == f"{BASE}/api/v1/auth/mcp/sessions/refresh"
        assert "authorization" not in request.headers
        assert b"X-Turbo-EA-Service" in header_names(request)
        assert proof_claims(request)["iss"] == "turbo-ea-mcp"
        assert json.loads(request.content) == {"refresh_token": "tea1r.s1.0.sig"}
        assert wire.timeouts == [10.0]

    @pytest.mark.asyncio
    async def test_without_a_key_it_is_refused_unasked(self, wire, monkeypatch):
        monkeypatch.setattr(api_client, "MCP_SERVICE_AUTH_KEY", None)
        assert await refresh_mcp_session("tea1r.s1.0.sig") is None
        assert wire.requests == []

    @pytest.mark.parametrize("status", [400, 401, 403, 404, 422, 428, 430, 499])
    @pytest.mark.asyncio
    async def test_a_4xx_is_a_refusal(self, wire, status):
        wire.reply = lambda request: httpx.Response(status, json={"detail": "invalid_grant"})
        assert await refresh_mcp_session("tea1r.s1.0.sig") is None

    @pytest.mark.parametrize("status", [429, 500, 502, 503, 504])
    @pytest.mark.asyncio
    async def test_a_5xx_or_a_rate_limit_is_an_outage(self, wire, status):
        wire.reply = lambda request: httpx.Response(status, json={"detail": "down"})
        with pytest.raises(RefreshUnavailableError) as excinfo:
            await refresh_mcp_session("tea1r.s1.0.sig")
        assert str(excinfo.value) == f"backend answered {status}"

    @pytest.mark.asyncio
    async def test_an_unreachable_backend_is_an_outage(self, wire):
        def refuse(request):
            raise httpx.ReadTimeout("slow", request=request)

        wire.reply = refuse
        with pytest.raises(RefreshUnavailableError) as excinfo:
            await refresh_mcp_session("tea1r.s1.0.sig")
        assert isinstance(excinfo.value.__cause__, httpx.ReadTimeout)
