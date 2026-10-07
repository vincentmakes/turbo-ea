"""OAuth token acquisition for the email backends (``email_backends/oauth.py``).

``test_email_backends.py`` covers the client-credentials cache through a mock
client. These pin what goes over the wire — the endpoint, every form field,
the Google JWT-bearer assertion and its claims — and the error and cache-key
rules, through a real ``httpx.AsyncClient`` on a ``MockTransport``.
"""

from __future__ import annotations

import json
import time
import urllib.parse

import httpx
import jwt
import pytest
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa

from app.services.email_backends import oauth

_KEY = rsa.generate_private_key(public_exponent=65537, key_size=2048)
PRIVATE_PEM = _KEY.private_bytes(
    serialization.Encoding.PEM,
    serialization.PrivateFormat.PKCS8,
    serialization.NoEncryption(),
).decode()
PUBLIC_KEY = _KEY.public_key()


@pytest.fixture(autouse=True)
def _clean_cache():
    oauth.reset_cache()
    yield
    oauth.reset_cache()


@pytest.fixture
def wire(monkeypatch):
    """Route every AsyncClient the module opens to a recording MockTransport."""
    state = {"requests": [], "responses": [], "timeouts": []}

    def handler(request: httpx.Request) -> httpx.Response:
        state["requests"].append(request)
        status, body = state["responses"].pop(0)
        if isinstance(body, str):
            return httpx.Response(status, text=body)
        return httpx.Response(status, json=body)

    real = httpx.AsyncClient

    def client(*args, **kwargs):
        state["timeouts"].append(kwargs.get("timeout"))
        return real(transport=httpx.MockTransport(handler))

    monkeypatch.setattr(oauth.httpx, "AsyncClient", client)

    def respond(*responses):
        state["responses"].extend(responses)
        return state

    return respond


def form(request: httpx.Request) -> dict:
    return dict(urllib.parse.parse_qsl(request.content.decode()))


def service_account(**overrides) -> str:
    sa = {
        "client_email": "mailer@proj.iam.gserviceaccount.com",
        "private_key": PRIVATE_PEM,
        "token_uri": "https://oauth2.example/token",
    }
    sa.update(overrides)
    return json.dumps({k: v for k, v in sa.items() if v is not None})


# ── microsoft_token_endpoint ────────────────────────────────────────────────


@pytest.mark.parametrize(
    "tenant, expected",
    [
        ("contoso", "contoso"),
        ("  contoso  ", "contoso"),
        ("", "organizations"),
        ("   ", "organizations"),
        (None, "organizations"),
    ],
)
def test_microsoft_endpoint(tenant, expected):
    assert (
        oauth.microsoft_token_endpoint(tenant)
        == f"https://login.microsoftonline.com/{expected}/oauth2/v2.0/token"
    )


# ── client credentials ──────────────────────────────────────────────────────


async def test_client_credentials_posts_every_field_to_the_tenant_endpoint(wire):
    state = wire((200, {"access_token": "tok-1", "expires_in": 3600}))
    token = await oauth.get_client_credentials_token(
        tenant_id="contoso", client_id="cid", client_secret="csecret", scope="sc/.default"
    )
    assert token == "tok-1"
    (req,) = state["requests"]
    assert req.method == "POST"
    assert str(req.url) == "https://login.microsoftonline.com/contoso/oauth2/v2.0/token"
    assert form(req) == {
        "client_id": "cid",
        "client_secret": "csecret",
        "scope": "sc/.default",
        "grant_type": "client_credentials",
    }
    assert state["timeouts"] == [20.0]


async def test_an_explicit_endpoint_overrides_the_tenant(wire):
    state = wire((200, {"access_token": "t"}))
    await oauth.get_client_credentials_token(
        tenant_id="contoso",
        client_id="c",
        client_secret="s",
        scope="x",
        token_endpoint="  https://idp.example/token  ",
    )
    assert str(state["requests"][0].url) == "https://idp.example/token"


async def test_a_blank_endpoint_falls_back_to_the_tenant(wire):
    state = wire((200, {"access_token": "t"}))
    await oauth.get_client_credentials_token(
        tenant_id="t1", client_id="c", client_secret="s", scope="x", token_endpoint="   "
    )
    assert str(state["requests"][0].url).startswith("https://login.microsoftonline.com/t1/")


@pytest.mark.parametrize(
    "changed",
    [
        {"tenant_id": "other"},
        {"client_id": "other"},
        {"scope": "other"},
        {"token_endpoint": "https://other.example/token"},
    ],
)
async def test_the_cache_is_keyed_on_every_identity_field(wire, changed):
    state = wire((200, {"access_token": "first"}), (200, {"access_token": "second"}))
    base = dict(tenant_id="t", client_id="c", client_secret="s", scope="x")
    assert await oauth.get_client_credentials_token(**base) == "first"
    assert await oauth.get_client_credentials_token(**base) == "first"  # cached
    assert await oauth.get_client_credentials_token(**{**base, **changed}) == "second"
    assert len(state["requests"]) == 2


async def test_the_secret_is_not_part_of_the_cache_key(wire):
    state = wire((200, {"access_token": "first"}))
    base = dict(tenant_id="t", client_id="c", scope="x")
    await oauth.get_client_credentials_token(**base, client_secret="a")
    assert await oauth.get_client_credentials_token(**base, client_secret="b") == "first"
    assert len(state["requests"]) == 1


async def test_a_token_is_refreshed_a_minute_before_it_expires(wire, monkeypatch):
    now = [1000.0]
    monkeypatch.setattr(oauth.time, "monotonic", lambda: now[0])
    state = wire((200, {"access_token": "a", "expires_in": 120}), (200, {"access_token": "b"}))
    args = dict(tenant_id="t", client_id="c", client_secret="s", scope="x")
    assert await oauth.get_client_credentials_token(**args) == "a"
    now[0] = 1059.0  # 120 - 60 skew = 60 s of life
    assert await oauth.get_client_credentials_token(**args) == "a"
    now[0] = 1060.0
    assert await oauth.get_client_credentials_token(**args) == "b"
    assert len(state["requests"]) == 2


async def test_a_missing_expiry_means_an_hour(wire, monkeypatch):
    now = [0.0]
    monkeypatch.setattr(oauth.time, "monotonic", lambda: now[0])
    wire((200, {"access_token": "a"}), (200, {"access_token": "b"}))
    args = dict(tenant_id="t", client_id="c", client_secret="s", scope="x")
    await oauth.get_client_credentials_token(**args)
    now[0] = 3539.0
    assert await oauth.get_client_credentials_token(**args) == "a"
    now[0] = 3540.0
    assert await oauth.get_client_credentials_token(**args) == "b"


async def test_a_short_lived_token_is_never_cached_into_the_past(wire, monkeypatch):
    now = [50.0]
    monkeypatch.setattr(oauth.time, "monotonic", lambda: now[0])
    state = wire((200, {"access_token": "a", "expires_in": 30}), (200, {"access_token": "b"}))
    args = dict(tenant_id="t", client_id="c", client_secret="s", scope="x")
    await oauth.get_client_credentials_token(**args)
    assert oauth._token_cache[f"cc:t:c:x:{oauth.microsoft_token_endpoint('t')}"][1] == 50.0
    assert await oauth.get_client_credentials_token(**args) == "b"
    assert len(state["requests"]) == 2


async def test_an_error_status_names_the_status_and_the_provider_reason(wire):
    wire((401, {"error": "invalid_client", "error_description": "AADSTS7000215: bad secret"}))
    with pytest.raises(RuntimeError) as exc:
        await oauth.get_client_credentials_token(
            tenant_id="t", client_id="c", client_secret="s", scope="x"
        )
    assert str(exc.value) == "OAuth token request failed (401): AADSTS7000215: bad secret"
    assert oauth._token_cache == {}


@pytest.mark.parametrize("payload", [{}, {"access_token": ""}, {"access_token": 5}])
async def test_a_response_without_a_token_is_an_error(wire, payload):
    wire((200, payload))
    with pytest.raises(RuntimeError) as exc:
        await oauth.get_client_credentials_token(
            tenant_id="t", client_id="c", client_secret="s", scope="x"
        )
    assert str(exc.value) == "OAuth token request failed: response did not contain an access_token"


# ── Google service account ──────────────────────────────────────────────────


async def test_service_account_posts_a_signed_jwt_bearer_assertion(wire, monkeypatch):
    monkeypatch.setattr(oauth.time, "time", lambda: 1_700_000_000.4)
    state = wire((200, {"access_token": "g-tok", "expires_in": 3600}))
    token = await oauth.get_service_account_token(
        service_account_json=service_account(),
        subject="noreply@corp.example",
        scope="https://mail.google.com/",
    )
    assert token == "g-tok"
    (req,) = state["requests"]
    assert str(req.url) == "https://oauth2.example/token"
    body = form(req)
    assert body["grant_type"] == "urn:ietf:params:oauth:grant-type:jwt-bearer"
    assert set(body) == {"grant_type", "assertion"}
    assert jwt.get_unverified_header(body["assertion"])["alg"] == "RS256"
    claims = jwt.decode(
        body["assertion"],
        PUBLIC_KEY,
        algorithms=["RS256"],
        audience="https://oauth2.example/token",
        options={"verify_exp": False, "verify_iat": False},
    )
    assert claims == {
        "iss": "mailer@proj.iam.gserviceaccount.com",
        "sub": "noreply@corp.example",
        "scope": "https://mail.google.com/",
        "aud": "https://oauth2.example/token",
        "iat": 1_700_000_000,
        "exp": 1_700_003_600,
    }
    assert state["timeouts"] == [20.0]


async def test_an_empty_subject_is_left_out_of_the_assertion(wire):
    state = wire((200, {"access_token": "g"}))
    await oauth.get_service_account_token(
        service_account_json=service_account(), subject="", scope="s"
    )
    assertion = form(state["requests"][0])["assertion"]
    assert "sub" not in jwt.decode(assertion, options={"verify_signature": False})


@pytest.mark.parametrize("token_uri", [None, ""])
async def test_the_default_google_token_uri(wire, token_uri):
    state = wire((200, {"access_token": "g"}))
    await oauth.get_service_account_token(
        service_account_json=service_account(token_uri=token_uri), subject="u", scope="s"
    )
    assert str(state["requests"][0].url) == "https://oauth2.googleapis.com/token"


async def test_service_account_tokens_are_cached_per_subject_and_scope(wire):
    state = wire(
        (200, {"access_token": "one"}),
        (200, {"access_token": "two"}),
        (200, {"access_token": "three"}),
    )
    sa = service_account()
    assert (
        await oauth.get_service_account_token(service_account_json=sa, subject="a", scope="s")
        == "one"
    )
    assert (
        await oauth.get_service_account_token(service_account_json=sa, subject="a", scope="s")
        == "one"
    )
    assert (
        await oauth.get_service_account_token(service_account_json=sa, subject="b", scope="s")
        == "two"
    )
    assert (
        await oauth.get_service_account_token(service_account_json=sa, subject="a", scope="t")
        == "three"
    )
    assert len(state["requests"]) == 3
    assert "sa:mailer@proj.iam.gserviceaccount.com:a:s" in oauth._token_cache


@pytest.mark.parametrize("raw", ["not json", None, "{", ""])
async def test_invalid_service_account_json_is_refused(wire, raw):
    with pytest.raises(RuntimeError) as exc:
        await oauth.get_service_account_token(service_account_json=raw, subject="u", scope="s")
    assert str(exc.value) == "Service-account JSON is not valid JSON"


@pytest.mark.parametrize("missing", ["client_email", "private_key"])
async def test_a_service_account_without_its_keys_is_refused(wire, missing):
    with pytest.raises(RuntimeError) as exc:
        await oauth.get_service_account_token(
            service_account_json=service_account(**{missing: None}), subject="u", scope="s"
        )
    assert str(exc.value) == "Service-account JSON missing client_email or private_key"


async def test_a_google_error_is_prefixed_as_google(wire):
    wire((400, {"error": "invalid_grant", "error_description": "Not a valid email."}))
    with pytest.raises(RuntimeError) as exc:
        await oauth.get_service_account_token(
            service_account_json=service_account(), subject="u", scope="s"
        )
    assert str(exc.value) == "Google token request failed (400): Not a valid email."


# ── safe_error ──────────────────────────────────────────────────────────────


@pytest.mark.parametrize(
    "response, expected",
    [
        (httpx.Response(400, json={"error": {"message": "Graph says no"}}), "Graph says no"),
        (httpx.Response(400, json={"error": {"code": "x"}}), "{'code': 'x'}"),
        (httpx.Response(400, json={"error": "e", "error_description": "desc"}), "desc"),
        (httpx.Response(400, json={"error": "only_error"}), "only_error"),
        (httpx.Response(400, json={"other": 1}), "{'other': 1}"),
        # a JSON list has no .get: the raw-text fallback
        (httpx.Response(400, json=["a", "list"]), '["a","list"]'),
        (httpx.Response(502, text="<html>Bad gateway</html>"), "<html>Bad gateway</html>"),
    ],
)
def test_safe_error_shapes(response, expected):
    assert oauth.safe_error(response) == expected


def test_safe_error_truncates():
    assert oauth.safe_error(httpx.Response(400, json={"error_description": "x" * 500})) == "x" * 300
    assert oauth.safe_error(httpx.Response(500, text="y" * 500)) == "y" * 200


# ── XOAUTH2 strings ─────────────────────────────────────────────────────────


def test_xoauth2_raw_and_encoded():
    raw = oauth.build_xoauth2_raw("u@x.com", "TOK")
    assert raw == "user=u@x.com\x01auth=Bearer TOK\x01\x01"
    import base64

    assert base64.b64decode(oauth.build_xoauth2_string("u@x.com", "TOK")).decode() == raw


def test_reset_cache_empties_it():
    oauth._cache_put("k", "v", 3600)
    assert oauth._cache_get("k") == "v"
    oauth.reset_cache()
    assert oauth._cache_get("k") is None


def test_an_expired_entry_is_evicted(monkeypatch):
    now = [0.0]
    monkeypatch.setattr(oauth.time, "monotonic", lambda: now[0])
    oauth._cache_put("k", "v", 61)  # 1 s of life
    now[0] = 1.0
    assert oauth._cache_get("k") is None
    assert "k" not in oauth._token_cache
    _ = time  # time is patched per test; keep the import explicit
