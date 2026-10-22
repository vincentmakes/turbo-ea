"""Registered client ids survive a restart of the MCP server (#1307).

Copilot Studio registers through RFC 7591 once, keeps the client id in its
connector and never registers again. A registration held only in this
process's memory was gone after any restart, and every later sign-in failed
at ``/oauth/authorize`` with "redirect_uri is not registered for this client".
The id now carries its redirect URIs under an HMAC, so an empty store still
knows them, and the exact-match redirect check still decides every request.
"""

from __future__ import annotations

import base64
import json
from unittest.mock import AsyncMock

import pytest
from starlette.applications import Starlette
from starlette.routing import Route
from starlette.testclient import TestClient

from turbo_ea_mcp import config, oauth
from turbo_ea_mcp.oauth import (
    MAX_CACHED_CLIENTS,
    MAX_CLIENT_ID_LENGTH,
    MAX_CLIENT_NAME_LENGTH,
    MAX_REDIRECT_URI_LENGTH,
    MAX_REDIRECT_URIS,
    OAuthStore,
    client_from_id,
    mint_client_id,
)

CB = "https://global.consent.azure-apim.net/redirect/connector-1"
SSO = {
    "enabled": True,
    "client_id": "sso-cid",
    "authorization_endpoint": "https://sso.example.com/authorize",
}


@pytest.fixture
def store(monkeypatch):
    fresh = OAuthStore()
    monkeypatch.setattr(oauth, "store", fresh)
    monkeypatch.setattr(oauth, "MCP_PUBLIC_URL", "https://ea.example.com/mcp")
    monkeypatch.setattr(oauth, "MCP_OAUTH_ALLOWED_REDIRECT_URIS", [])
    monkeypatch.setattr(oauth, "_get_sso_config", AsyncMock(return_value=SSO))
    return fresh


@pytest.fixture
def app(store):
    return TestClient(
        Starlette(
            routes=[
                Route("/oauth/register", oauth.register_client, methods=["POST"]),
                Route("/oauth/authorize", oauth.authorize, methods=["GET"]),
                Route("/oauth/token", oauth.token_endpoint, methods=["POST"]),
            ]
        )
    )


def authorize(app, client_id, redirect_uri=CB):
    return app.get(
        "/oauth/authorize",
        params={
            "response_type": "code",
            "client_id": client_id,
            "redirect_uri": redirect_uri,
            "state": "s",
            "code_challenge": "chal",
            "code_challenge_method": "S256",
        },
        follow_redirects=False,
    )


def resign(client_id: str, claims: dict) -> str:
    """The id with its claims replaced and signed again with the live key."""
    payload = base64.urlsafe_b64encode(json.dumps(claims).encode()).rstrip(b"=").decode()
    return f"tea1.{payload}.{oauth._client_id_signature(payload)}"


class TestSurvivesARestart:
    def test_an_id_registered_before_the_store_was_lost_still_authorizes(
        self, app, store
    ):
        cid = app.post("/oauth/register", json={"redirect_uris": [CB]}).json()["client_id"]
        store.clients.clear()  # what a restart does to the in-memory store
        resp = authorize(app, cid)
        assert resp.status_code == 302
        assert resp.headers["location"].startswith(SSO["authorization_endpoint"] + "?")
        (pending,) = store.pending.values()
        assert (pending.client_id, pending.redirect_uri) == (cid, CB)

    def test_the_rebuilt_registration_still_matches_redirects_exactly(self, app, store):
        cid = app.post("/oauth/register", json={"redirect_uris": [CB]}).json()["client_id"]
        store.clients.clear()
        for other in (CB + "/", CB + "?x=1", CB.upper(), "https://evil.example/cb"):
            resp = authorize(app, cid, redirect_uri=other)
            assert resp.status_code == 400
            assert "location" not in resp.headers
        assert store.pending == {}

    def test_every_registered_uri_is_carried(self):
        uris = [CB, "http://127.0.0.1:5000/cb"]
        client = client_from_id(mint_client_id(uris))
        assert client.redirect_uris == uris
        assert client.client_id.startswith("tea1.")


class TestForgedIds:
    @pytest.fixture
    def cid(self):
        return mint_client_id([CB])

    def test_a_tampered_payload_is_refused(self, cid):
        prefix, payload, signature = cid.split(".")
        claims = json.loads(base64.urlsafe_b64decode(payload + "=="))
        claims["r"] = ["https://evil.example/cb"]
        forged_payload = (
            base64.urlsafe_b64encode(json.dumps(claims).encode()).rstrip(b"=").decode()
        )
        assert client_from_id(f"{prefix}.{forged_payload}.{signature}") is None

    def test_a_tampered_signature_is_refused(self, cid):
        flipped = cid[:-1] + ("A" if cid[-1] != "A" else "B")
        assert client_from_id(flipped) is None

    def test_an_id_signed_with_another_key_is_refused(self, cid, monkeypatch):
        monkeypatch.setattr(oauth, "_client_id_key", b"another instance's key")
        assert client_from_id(cid) is None

    def test_a_forged_id_cannot_authorize(self, app, store):
        forged = f"tea1.{mint_client_id([CB]).split('.')[1]}.not-the-signature"
        assert authorize(app, forged).status_code == 400
        assert store.pending == {}

    @pytest.mark.parametrize(
        "client_id",
        ["", "tea1.", "tea1..", "tea1.abc", "abc.def.ghi", "tea2.x.y", "tea1.é.ü"],
    )
    def test_malformed_ids_are_refused(self, client_id):
        assert client_from_id(client_id) is None

    @pytest.mark.parametrize(
        "claims",
        [
            [CB],
            {},
            {"r": CB},
            {"r": []},
            {"r": [""]},
            {"r": [CB, 7]},
            {"r": [CB] * (MAX_REDIRECT_URIS + 1)},
            {"r": ["x" * (MAX_REDIRECT_URI_LENGTH + 1)]},
        ],
    )
    def test_signed_claims_of_the_wrong_shape_are_refused(self, claims):
        assert client_from_id(resign("", claims)) is None

    def test_a_signed_payload_that_is_not_json_is_refused(self):
        payload = base64.urlsafe_b64encode(b"not json").rstrip(b"=").decode()
        assert client_from_id(f"tea1.{payload}.{oauth._client_id_signature(payload)}") is None

    def test_the_per_uri_bounds_themselves_are_accepted(self):
        for uris in (["x" * MAX_REDIRECT_URI_LENGTH], ["u"] * MAX_REDIRECT_URIS):
            assert client_from_id(resign("", {"r": uris})).redirect_uris == uris

    def test_an_id_over_the_length_cap_is_refused_before_it_is_verified(self, monkeypatch):
        cid = resign("", {"r": ["x" * MAX_CLIENT_ID_LENGTH]})
        assert len(cid) > MAX_CLIENT_ID_LENGTH
        signed = []
        monkeypatch.setattr(oauth, "_client_id_signature", lambda p: signed.append(p) or "")
        assert client_from_id(cid) is None
        assert signed == []


class TestRegistrationBounds:
    def test_two_registrations_of_the_same_uris_get_different_ids(self):
        assert mint_client_id([CB]) != mint_client_id([CB])

    def test_too_many_redirect_uris_are_refused(self, app, store):
        resp = app.post(
            "/oauth/register", json={"redirect_uris": [CB] * (MAX_REDIRECT_URIS + 1)}
        )
        assert resp.status_code == 400
        assert resp.json() == {
            "error": "invalid_client_metadata",
            "error_description": (
                f"at most {MAX_REDIRECT_URIS} redirect_uris of at most "
                f"{MAX_REDIRECT_URI_LENGTH} characters each"
            ),
        }
        assert store.clients == {}

    def test_an_over_long_redirect_uri_is_refused(self, app, store):
        resp = app.post(
            "/oauth/register",
            json={"redirect_uris": ["https://x/" + "a" * MAX_REDIRECT_URI_LENGTH]},
        )
        assert resp.status_code == 400
        assert store.clients == {}

    def test_the_per_uri_bounds_are_accepted_at_registration(self, app, store):
        for uris in (["x" * MAX_REDIRECT_URI_LENGTH], [CB] * MAX_REDIRECT_URIS):
            resp = app.post("/oauth/register", json={"redirect_uris": uris})
            assert resp.status_code == 201
            assert len(resp.json()["client_id"]) <= MAX_CLIENT_ID_LENGTH

    def test_uris_too_long_together_are_refused(self, app, store):
        # Each URI is within its own bound; together the id would not fit the
        # authorize request line the edge nginx accepts.
        uris = ["https://x/" + "a" * (MAX_REDIRECT_URI_LENGTH - 10)] * 3
        resp = app.post("/oauth/register", json={"redirect_uris": uris})
        assert resp.status_code == 400
        assert resp.json() == {
            "error": "invalid_client_metadata",
            "error_description": "redirect_uris are too long in total",
        }
        assert store.clients == {}

    def test_the_longest_accepted_id_fits_an_authorize_request_line(self, app, store):
        # nginx's default large_client_header_buffers is 8 KB per request line.
        cid = "tea1." + "x" * (MAX_CLIENT_ID_LENGTH - 5)
        query = "&".join(
            [
                "response_type=code",
                f"client_id={cid}",
                "redirect_uri=" + "%2F" * MAX_REDIRECT_URI_LENGTH,
                "state=" + "s" * 256,
                "code_challenge=" + "c" * 43,
                "code_challenge_method=S256",
                "scope=mcp%3Aread",
            ]
        )
        assert len(f"GET /mcp/oauth/authorize?{query} HTTP/1.1") < 8192

    @pytest.mark.parametrize("payload", [[CB], "text", 7, None])
    def test_a_body_that_is_not_an_object_is_refused(self, app, store, payload):
        resp = app.post("/oauth/register", json=payload)
        assert resp.status_code == 400
        assert resp.json() == {"error": "invalid_request"}
        assert store.clients == {}

    @pytest.mark.parametrize("name", [{"a": 1}, 7, ["n"], "", "   ", None])
    def test_a_client_name_that_is_not_text_takes_the_default(self, app, store, name):
        resp = app.post("/oauth/register", json={"client_name": name, "redirect_uris": [CB]})
        assert resp.status_code == 201
        assert resp.json()["client_name"] == "MCP Client"

    def test_a_long_client_name_is_cut(self, app, store):
        resp = app.post(
            "/oauth/register",
            json={"client_name": "n" * (MAX_CLIENT_NAME_LENGTH + 50), "redirect_uris": [CB]},
        )
        assert resp.json()["client_name"] == "n" * MAX_CLIENT_NAME_LENGTH
        assert store.clients[resp.json()["client_id"]].client_name == resp.json()["client_name"]

    def test_the_in_memory_cache_is_bounded_and_drops_the_oldest(self, app, store):
        for i in range(MAX_CACHED_CLIENTS):
            store.clients[f"c{i}"] = oauth.RegisteredClient(client_id=f"c{i}", redirect_uris=[CB])
        cid = app.post("/oauth/register", json={"redirect_uris": [CB]}).json()["client_id"]
        assert len(store.clients) == MAX_CACHED_CLIENTS
        assert "c0" not in store.clients and "c1" in store.clients
        assert cid in store.clients
        # An evicted registration still authorizes from its id alone.
        del store.clients[cid]
        assert authorize(app, cid).status_code == 302


class TestSigningKey:
    def test_the_key_is_derived_not_the_raw_secret(self):
        key = config.oauth_client_key("s3cret")
        assert len(key) == 32
        assert b"s3cret" not in key
        assert key == config.oauth_client_key("s3cret")

    def test_different_secrets_give_different_keys(self):
        assert config.oauth_client_key("a") != config.oauth_client_key("b")

    def test_the_key_is_bound_to_its_context(self):
        import hashlib
        import hmac

        assert config.oauth_client_key("s") == hmac.new(
            b"s", b"turbo-ea-mcp/oauth-client-id/v1", hashlib.sha256
        ).digest()

    def test_no_secret_gives_no_key(self):
        assert config.oauth_client_key("") is None


class TestTokenEndpoint:
    def _seed(self, store):
        import hashlib

        verifier = "v" * 43
        challenge = (
            base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest())
            .rstrip(b"=")
            .decode()
        )
        store.codes["code"] = oauth.AuthCode("code", "cid", CB, "mcp:read", challenge, "h.e30.s")
        return {
            "grant_type": "authorization_code",
            "code": "code",
            "code_verifier": verifier,
            "redirect_uri": CB,
            "client_id": "cid",
        }

    def test_a_json_body_is_read_as_json(self, app, store):
        resp = app.post("/oauth/token", json=self._seed(store))
        assert resp.status_code == 200
        assert resp.json()["access_token"] in store.tokens

    def test_a_json_media_type_with_parameters_is_read_as_json(self, app, store):
        resp = app.post(
            "/oauth/token",
            content=json.dumps(self._seed(store)).encode(),
            headers={"content-type": "Application/JSON; charset=utf-8"},
        )
        assert resp.status_code == 200

    @pytest.mark.parametrize("content", [b"[1, 2]", b"not json", b'"text"'])
    def test_a_json_body_that_is_not_an_object_is_refused(self, app, content):
        resp = app.post(
            "/oauth/token", content=content, headers={"content-type": "application/json"}
        )
        assert resp.status_code == 400
        assert resp.json() == {"error": "invalid_request"}

    def test_a_token_response_is_never_cached(self, app, store):
        resp = app.post("/oauth/token", data=self._seed(store))
        assert resp.headers["cache-control"] == "no-store"
        assert resp.headers["pragma"] == "no-cache"

    def test_a_refreshed_token_response_is_never_cached(self, app, store, monkeypatch):
        import time

        from turbo_ea_mcp.api_client import TurboEAClient

        store.tokens["old"] = oauth.TokenEntry("jwt", time.time() + 99999, "r1", "mcp:read")
        store.refresh_tokens["r1"] = "old"
        monkeypatch.setattr(
            TurboEAClient, "refresh_token", AsyncMock(return_value="h.eyJleHAiOjV9.s")
        )
        resp = app.post("/oauth/token", data={"grant_type": "refresh_token", "refresh_token": "r1"})
        assert resp.status_code == 200
        assert resp.headers["cache-control"] == "no-store"
        assert resp.headers["pragma"] == "no-cache"
