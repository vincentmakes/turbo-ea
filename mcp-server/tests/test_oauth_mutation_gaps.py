"""Assertions the #1307 OAuth changes owed the mutation gate.

Each test pins one behaviour a surviving mutant showed nothing checked: the
exact shape of a minted client id, the length bounds at their edges, a dot
smuggled into a signed payload, the clock boundary of an expired JWT, and the
log lines an operator reads during an outage.
"""

from __future__ import annotations

import base64
import json
import logging

import httpx
import pytest
from starlette.applications import Starlette
from starlette.routing import Route
from starlette.testclient import TestClient

from turbo_ea_mcp import api_client, oauth, server
from turbo_ea_mcp.api_client import RefreshUnavailable, TurboEAClient
from turbo_ea_mcp.oauth import (
    MAX_CLIENT_ID_LENGTH,
    OAuthStore,
    RegisteredClient,
    TokenEntry,
    _b64encode,
    _client_id_signature,
    _handle_refresh,
    _lookup_client,
    client_from_id,
    mint_client_id,
    resolve_token,
)

CB = "https://global.consent.azure-apim.net/redirect/connector-1"


@pytest.fixture
def store(monkeypatch):
    fresh = OAuthStore()
    monkeypatch.setattr(oauth, "store", fresh)
    return fresh


@pytest.fixture
def app(store):
    return TestClient(
        Starlette(
            routes=[
                Route("/oauth/register", oauth.register_client, methods=["POST"]),
                Route("/oauth/token", oauth.token_endpoint, methods=["POST"]),
            ]
        )
    )


def signed(payload: str) -> str:
    return f"tea1.{payload}.{_client_id_signature(payload)}"


def compact_payload(claims: dict) -> str:
    raw = json.dumps(claims, separators=(",", ":")).encode()
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode()


class TestEncoding:
    @pytest.mark.parametrize(
        ("data", "encoded"),
        [(b"a", "YQ"), (b"ab", "YWI"), (b"ab\x17", "YWIX"), (b"", "")],
    )
    def test_base64url_without_padding(self, data, encoded):
        assert _b64encode(data) == encoded

    def test_a_minted_id_carries_exactly_the_uris_and_a_nonce(self):
        cid = mint_client_id([CB])
        prefix, payload, signature = cid.split(".")
        raw = base64.urlsafe_b64decode(payload + "==")
        assert b", " not in raw and b": " not in raw  # compact JSON
        claims = json.loads(raw)
        assert set(claims) == {"r", "n"}
        assert claims["r"] == [CB]
        assert len(claims["n"]) == 11  # secrets.token_urlsafe(8)
        assert (prefix, signature) == ("tea1", _client_id_signature(payload))


class TestIdLengthBoundary:
    @staticmethod
    def claims_of_length(target: int) -> dict:
        """Signed-id claims whose id is exactly ``target`` characters long."""
        for pad in range(1000):
            claims = {"r": [CB, "https://x/" + "a" * 1000, "https://y/" + "b" * pad]}
            if len(signed(compact_payload(claims))) == target:
                return claims
        raise AssertionError("no padding reaches the target length")

    def test_an_id_of_exactly_the_cap_is_accepted(self):
        claims = self.claims_of_length(MAX_CLIENT_ID_LENGTH)
        cid = signed(compact_payload(claims))
        assert len(cid) == MAX_CLIENT_ID_LENGTH
        assert client_from_id(cid).redirect_uris == claims["r"]

    def test_a_registration_minting_exactly_the_cap_is_accepted(self, app, store):
        # The nonce has a fixed length, so the minted id's length is a function
        # of the URIs alone: find the URIs that land exactly on the cap.
        for pad in range(1000):
            uris = [CB, "https://x/" + "a" * 1000, "https://y/" + "b" * pad]
            if len(mint_client_id(uris)) == MAX_CLIENT_ID_LENGTH:
                break
        else:
            raise AssertionError("no padding reaches the cap")
        resp = app.post("/oauth/register", json={"redirect_uris": uris})
        assert resp.status_code == 201
        assert len(resp.json()["client_id"]) == MAX_CLIENT_ID_LENGTH


class TestNonCanonicalIds:
    def test_a_dot_inserted_into_a_signed_payload_is_refused(self):
        # base64 decoding drops characters outside its alphabet, so a payload
        # "AB.CD" would decode like "ABCD". An id must name one payload and one
        # signature; the first dot after the prefix ends the payload.
        payload = compact_payload({"r": [CB]})
        dotted = payload[:4] + "." + payload[4:]
        assert client_from_id(signed(dotted)) is None
        assert client_from_id(signed(payload)).redirect_uris == [CB]


class TestLookup:
    def test_the_in_memory_record_wins_over_the_ids_own_claims(self, store):
        cid = mint_client_id([CB])
        store.clients[cid] = RegisteredClient(client_id=cid, redirect_uris=["https://other/cb"])
        assert _lookup_client(cid).redirect_uris == ["https://other/cb"]

    def test_an_id_unknown_to_the_store_falls_back_to_its_claims(self, store):
        cid = mint_client_id([CB])
        assert _lookup_client(cid).redirect_uris == [CB]


class TestRegisteredTime:
    def test_the_record_is_stamped_with_the_issued_time(self, app, store, monkeypatch):
        monkeypatch.setattr(oauth.time, "time", lambda: 1_700_000_000.75)
        data = app.post("/oauth/register", json={"redirect_uris": [CB]}).json()
        assert data["client_id_issued_at"] == 1_700_000_000
        assert store.clients[data["client_id"]].created_at == 1_700_000_000.75


class TestTokenBodyWithoutContentType:
    def test_is_read_as_an_empty_form_not_a_crash(self, app):
        resp = app.post("/oauth/token", content=b"")
        assert resp.status_code == 400
        assert resp.json() == {"error": "unsupported_grant_type"}


class Down:
    def __init__(self, token: str) -> None:
        pass

    async def refresh_token(self):
        raise RefreshUnavailable("backend answered 502")


class TestOutageBoundaries:
    @pytest.mark.asyncio
    async def test_a_jwt_expiring_this_instant_counts_as_expired(self, store, monkeypatch):
        monkeypatch.setattr(api_client, "TurboEAClient", Down)
        monkeypatch.setattr(oauth.time, "time", lambda: 5_000.0)
        store.tokens["acc"] = TokenEntry("jwt", 5_000.0, "ref", "mcp:read")
        with pytest.raises(RefreshUnavailable):
            await resolve_token("acc")

    @pytest.mark.asyncio
    async def test_the_refresh_grant_logs_the_outage_with_its_cause(
        self, store, monkeypatch, caplog
    ):
        monkeypatch.setattr(api_client, "TurboEAClient", Down)
        store.tokens["acc"] = TokenEntry("jwt", 0.0, "ref", "mcp:read")
        store.refresh_tokens["ref"] = "acc"
        with caplog.at_level(logging.WARNING, logger=oauth.logger.name):
            await _handle_refresh({"refresh_token": "ref"})
        (record,) = [r for r in caplog.records if r.name == oauth.logger.name]
        assert record.getMessage() == "Turbo EA backend unavailable during token refresh"
        assert record.exc_info is not None and record.exc_info[0] is RefreshUnavailable


class TestGateLogging:
    def test_a_failed_resolution_is_logged_with_its_cause(self, caplog):
        async def failing(token):
            raise RefreshUnavailable("backend answered 503")

        sent = []

        async def receive():
            return {"type": "http.request", "body": b"", "more_body": False}

        async def send(message):
            sent.append(message)

        gate = server.RequireBearerForMcp(
            lambda *a: None, resource_metadata_url="https://x/prm", resolve=failing
        )
        scope = {
            "type": "http",
            "path": "/mcp",
            "method": "POST",
            "headers": [(b"authorization", b"Bearer abc")],
            "query_string": b"",
        }
        import asyncio

        with caplog.at_level(logging.WARNING, logger="turbo_ea_mcp"):
            asyncio.run(gate(scope, receive, send))
        (record,) = [r for r in caplog.records if r.name == "turbo_ea_mcp"]
        assert record.getMessage() == "Could not resolve an MCP token"
        assert record.exc_info is not None and record.exc_info[0] is RefreshUnavailable
        assert sent[0]["status"] == 503


class TestEphemeralKeyMessage:
    def test_the_warning_says_what_to_do(self, monkeypatch, caplog):
        monkeypatch.setattr(oauth, "CLIENT_KEY_IS_EPHEMERAL", True)
        with caplog.at_level(logging.WARNING, logger="turbo_ea_mcp"):
            server.create_app()
        messages = [r.getMessage() for r in caplog.records if r.name == "turbo_ea_mcp"]
        assert messages == [
            (
                "SECRET_KEY is not set for the MCP server: dynamically registered "
                "OAuth clients will not survive a restart. Pass the instance's "
                "SECRET_KEY to the mcp-server container."
            )
        ]


class TestRefreshUnavailableMessage:
    @pytest.mark.asyncio
    async def test_carries_the_transport_error_text(self, monkeypatch):
        error = httpx.ConnectError("connection refused")

        def handler(request):
            raise error

        transport = httpx.MockTransport(handler)
        real = httpx.AsyncClient
        monkeypatch.setattr(
            api_client.httpx,
            "AsyncClient",
            lambda *a, **k: real(transport=transport, timeout=k.get("timeout")),
        )
        with pytest.raises(RefreshUnavailable) as excinfo:
            await TurboEAClient("old").refresh_token()
        assert str(excinfo.value) == "connection refused"
