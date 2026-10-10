"""``sso_service`` pinned to exact values.

``test_sso_service.py`` walks every branch; these tests pin what each branch
produces in full, because the nightly mutation run showed most of its
survivors were values no test compared: the provider configurations, the
JWKS client's arguments, every accepted signing algorithm, the form and
headers of the code exchange, and the messages an operator reads (in the
HTTP error and in the log) when SSO is misconfigured.
"""

from __future__ import annotations

import logging
import time
from types import SimpleNamespace

import httpx
import jwt
import pytest
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ec, rsa
from fastapi import HTTPException

import app.services.sso_service as sso

LOGGER = sso.logger.name


def logged(caplog) -> list[str]:
    """This module's log lines only: under mutmut the root logger runs at
    INFO, so httpx's own ``HTTP Request: …`` line is captured too."""
    return [r.getMessage() for r in caplog.records if r.name == LOGGER]


# ── get_provider_config ─────────────────────────────────────────────────────

MS = "https://login.microsoftonline.com"


@pytest.mark.parametrize(
    "config, tenant",
    [({}, "organizations"), ({"provider": "microsoft", "tenant_id": "contoso"}, "contoso")],
)
def test_microsoft_config(config, tenant):
    assert sso.get_provider_config(config) == {
        "authorization_endpoint": f"{MS}/{tenant}/oauth2/v2.0/authorize",
        "token_endpoint": f"{MS}/{tenant}/oauth2/v2.0/token",
        "jwks_uri": f"{MS}/{tenant}/discovery/v2.0/keys",
        "issuer": f"{MS}/{tenant}/v2.0",
        "scopes": "openid email profile",
        "extra_auth_params": {},
        "subject_claim": "oid",
    }


GOOGLE = {
    "authorization_endpoint": "https://accounts.google.com/o/oauth2/v2/auth",
    "token_endpoint": "https://oauth2.googleapis.com/token",
    "jwks_uri": "https://www.googleapis.com/oauth2/v3/certs",
    "issuer": "https://accounts.google.com",
    "scopes": "openid email profile",
    "extra_auth_params": {},
    "subject_claim": "sub",
}


@pytest.mark.parametrize("config", [{"provider": "google"}, {"provider": "google", "domain": ""}])
def test_google_config(config):
    assert sso.get_provider_config(config) == GOOGLE


def test_google_config_with_a_domain_pins_hd():
    assert sso.get_provider_config({"provider": "google", "domain": "corp.example"}) == {
        **GOOGLE,
        "extra_auth_params": {"hd": "corp.example"},
    }


def test_google_hd_is_never_shared_between_calls():
    sso.get_provider_config({"provider": "google", "domain": "a.example"})
    assert sso.get_provider_config({"provider": "google"})["extra_auth_params"] == {}


def test_okta_config():
    base = "https://corp.okta.com/oauth2/default"
    assert sso.get_provider_config({"provider": "okta", "domain": "corp.okta.com"}) == {
        "authorization_endpoint": f"{base}/v1/authorize",
        "token_endpoint": f"{base}/v1/token",
        "jwks_uri": f"{base}/v1/keys",
        "issuer": base,
        "scopes": "openid email profile",
        "extra_auth_params": {},
        "subject_claim": "sub",
    }


@pytest.mark.parametrize("config", [{"provider": "okta"}, {"provider": "okta", "domain": ""}])
def test_okta_without_a_domain(config):
    with pytest.raises(ValueError) as exc:
        sso.get_provider_config(config)
    assert str(exc.value) == "Okta domain is required"


def test_oidc_with_manual_endpoints():
    config = {
        "provider": "oidc",
        "issuer_url": "https://idp.example/realmX/",  # only the slash is stripped
        "authorization_endpoint": "https://idp.example/auth",
        "token_endpoint": "https://idp.example/token",
        "jwks_uri": "https://idp.example/certs",
    }
    assert sso.get_provider_config(config) == {
        "authorization_endpoint": "https://idp.example/auth",
        "token_endpoint": "https://idp.example/token",
        "jwks_uri": "https://idp.example/certs",
        "issuer": "https://idp.example/realmX",
        "scopes": "openid email profile",
        "extra_auth_params": {},
        "subject_claim": "sub",
        "discovery_required": False,
    }


@pytest.mark.parametrize("missing", ["authorization_endpoint", "token_endpoint", "jwks_uri"])
def test_oidc_with_any_endpoint_missing_needs_discovery(missing):
    config = {
        "provider": "oidc",
        "issuer_url": "https://idp.example",
        "authorization_endpoint": "a",
        "token_endpoint": "t",
        "jwks_uri": "j",
    }
    del config[missing]
    got = sso.get_provider_config(config)
    assert got["discovery_required"] is True
    assert got[missing] == ""


@pytest.mark.parametrize("config", [{"provider": "oidc"}, {"provider": "oidc", "issuer_url": ""}])
def test_oidc_without_an_issuer(config):
    with pytest.raises(ValueError) as exc:
        sso.get_provider_config(config)
    assert str(exc.value) == "Issuer URL is required for Generic OIDC"


def test_an_unknown_provider():
    with pytest.raises(ValueError) as exc:
        sso.get_provider_config({"provider": "saml"})
    assert str(exc.value) == "Unknown SSO provider: saml"


# ── get_jwks_client / discover_oidc ─────────────────────────────────────────


def test_the_jwks_client_sends_its_own_user_agent_and_caches_keys(monkeypatch):
    made = []
    monkeypatch.setattr(sso, "_jwks_clients", {})
    monkeypatch.setattr(sso, "PyJWKClient", lambda *a, **k: made.append((a, k)) or object())
    first = sso.get_jwks_client("https://idp.example/jwks")
    assert sso.get_jwks_client("https://idp.example/jwks") is first
    assert made == [
        (
            ("https://idp.example/jwks",),
            {"cache_keys": True, "headers": {"User-Agent": "turbo-ea/jwks-client"}},
        )
    ]


@pytest.fixture
def client_kwargs(monkeypatch):
    """Record the kwargs of every AsyncClient sso_service opens; serve ``handler``."""
    state = SimpleNamespace(kwargs=[], requests=[], handler=None)
    real = httpx.AsyncClient

    def factory(*args, **kwargs):
        state.kwargs.append(kwargs)

        def recording(request):
            state.requests.append(request)
            return state.handler(request)

        return real(transport=httpx.MockTransport(recording))

    monkeypatch.setattr(sso.httpx, "AsyncClient", factory)
    return state


async def test_discovery_url_and_timeout(monkeypatch, client_kwargs):
    monkeypatch.setattr(sso, "_oidc_discovery_cache", {})
    client_kwargs.handler = lambda r: httpx.Response(200, json={"issuer": "i"})
    # only the trailing slash is stripped, not a trailing X
    doc = await sso.discover_oidc("https://idp.example/realmX/")
    assert doc == {"issuer": "i"}
    assert [str(r.url) for r in client_kwargs.requests] == [
        "https://idp.example/realmX/.well-known/openid-configuration"
    ]
    assert client_kwargs.kwargs == [{"timeout": 10.0}]


# ── verify_id_token: every accepted algorithm ───────────────────────────────


def _pem_pair(private):
    private_pem = private.private_bytes(
        serialization.Encoding.PEM,
        serialization.PrivateFormat.PKCS8,
        serialization.NoEncryption(),
    )
    public_pem = private.public_key().public_bytes(
        serialization.Encoding.PEM, serialization.PublicFormat.SubjectPublicKeyInfo
    )
    return private_pem, public_pem


@pytest.fixture(scope="module")
def keys():
    rsa_key = _pem_pair(rsa.generate_private_key(public_exponent=65537, key_size=2048))
    return {
        "RS256": rsa_key,
        "RS384": rsa_key,
        "RS512": rsa_key,
        "PS256": rsa_key,
        "ES256": _pem_pair(ec.generate_private_key(ec.SECP256R1())),
        "ES384": _pem_pair(ec.generate_private_key(ec.SECP384R1())),
        "ES512": _pem_pair(ec.generate_private_key(ec.SECP521R1())),
    }


def _sign(private_pem, alg="RS256", **claims):
    now = int(time.time())
    payload = {"iss": "https://idp.test", "aud": "client-1", "iat": now, "exp": now + 300}
    payload.update(claims)
    return jwt.encode(payload, private_pem, algorithm=alg, headers={"kid": "k"})


def _stub_jwks(monkeypatch, public_pem, expected_token):
    seen = []

    def signing_key(token):
        seen.append(token)
        assert token == expected_token
        return SimpleNamespace(key=public_pem)

    monkeypatch.setattr(
        sso, "get_jwks_client", lambda url: SimpleNamespace(get_signing_key_from_jwt=signing_key)
    )
    return seen


@pytest.mark.parametrize("alg", ["RS256", "RS384", "RS512", "PS256", "ES256", "ES384", "ES512"])
def test_every_listed_algorithm_verifies(monkeypatch, keys, alg):
    private_pem, public_pem = keys[alg]
    token = _sign(private_pem, alg, sub="u1")
    seen = _stub_jwks(monkeypatch, public_pem, token)
    assert sso.verify_id_token(token, "client-1", "jwks", "https://idp.test")["sub"] == "u1"
    assert seen == [token]


def test_the_issuer_retry_only_toggles_the_slash(monkeypatch, keys):
    private_pem, public_pem = keys["RS256"]
    token = _sign(private_pem, iss="https://idp.test/realmX")
    _stub_jwks(monkeypatch, public_pem, token)
    claims = sso.verify_id_token(token, "client-1", "jwks", "https://idp.test/realmX/")
    assert claims["iss"] == "https://idp.test/realmX"


# ── exchange_code_for_claims ────────────────────────────────────────────────

BASE_SSO = {
    "enabled": True,
    "provider": "microsoft",
    "tenant_id": "contoso",
    "client_id": "client-1",
    "client_secret": "s3cret",
}
TOKEN_URL = f"{MS}/contoso/oauth2/v2.0/token"


@pytest.fixture
def config(monkeypatch):
    holder = {"sso": dict(BASE_SSO), "db": []}

    async def get(db):
        holder["db"].append(db)
        return holder["sso"]

    monkeypatch.setattr(sso, "get_sso_config", get)
    return holder


@pytest.fixture
def verified(monkeypatch):
    calls = SimpleNamespace(args=[], error=None)

    def verify(token, client_id, jwks_uri, issuer):
        calls.args.append((token, client_id, jwks_uri, issuer))
        if calls.error is not None:
            raise calls.error
        return {"sub": "u1"}

    monkeypatch.setattr(sso, "verify_id_token", verify)
    return calls


async def exchange(db="DB"):
    return await sso.exchange_code_for_claims(db, "code-1", "https://app.test/cb")


async def expect(status, detail):
    with pytest.raises(HTTPException) as exc:
        await exchange()
    assert (exc.value.status_code, exc.value.detail) == (status, detail)


async def test_the_config_is_read_from_the_callers_session(config, client_kwargs, verified):
    client_kwargs.handler = lambda r: httpx.Response(200, json={"id_token": "tok"})
    await exchange(db="the-session")
    assert config["db"] == ["the-session"]


async def test_disabled(config):
    config["sso"]["enabled"] = False
    await expect(400, "SSO is not enabled")


@pytest.mark.parametrize("missing", ["client_id", "client_secret"])
async def test_a_missing_credential_key(config, missing):
    del config["sso"][missing]
    await expect(500, "SSO is not properly configured")


async def test_a_misconfigured_provider(config):
    config["sso"]["provider"] = "okta"
    await expect(500, "SSO provider misconfigured: Okta domain is required")


async def test_the_exchange_request(config, client_kwargs, verified, caplog):
    client_kwargs.handler = lambda r: httpx.Response(200, json={"id_token": "tok"})
    with caplog.at_level(logging.INFO, logger=LOGGER):
        claims, cfg, provider = await exchange()
    assert (claims, provider) == ({"sub": "u1"}, "microsoft")
    assert cfg is config["sso"]
    (req,) = client_kwargs.requests
    assert client_kwargs.kwargs == [{"timeout": 15.0}]
    assert req.headers["content-type"] == "application/x-www-form-urlencoded"
    form = {
        "grant_type": "authorization_code",
        "client_id": "client-1",
        "client_secret": "s3cret",
        "code": "code-1",
        "redirect_uri": "https://app.test/cb",
        "scope": "openid email profile",
    }
    assert dict(httpx.QueryParams(req.content.decode())) == form
    # no header beyond the ones httpx sends with any form post
    with httpx.Client() as plain:
        expected = plain.build_request("POST", TOKEN_URL, data=form).headers
    assert sorted(req.headers.keys()) == sorted(expected.keys())
    assert logged(caplog) == [f"SSO token exchange: POST {TOKEN_URL} (provider=microsoft)"]


async def test_no_provider_key_means_microsoft(config, client_kwargs, verified):
    del config["sso"]["provider"]
    client_kwargs.handler = lambda r: httpx.Response(200, json={"id_token": "tok"})
    assert (await exchange())[2] == "microsoft"


async def test_discovery_supplies_endpoints_and_falls_back_to_the_configured_issuer(
    config, client_kwargs, verified, monkeypatch
):
    config["sso"].update(provider="oidc", issuer_url="https://idp.example/")
    monkeypatch.setattr(sso, "_oidc_discovery_cache", {})
    seen = []

    async def discover(url):
        seen.append(url)
        return {"token_endpoint": "https://idp.example/token", "jwks_uri": "https://idp.example/k"}

    monkeypatch.setattr(sso, "discover_oidc", discover)
    client_kwargs.handler = lambda r: httpx.Response(200, json={"id_token": "tok"})
    await exchange()
    assert seen == ["https://idp.example/"]
    assert [str(r.url) for r in client_kwargs.requests] == ["https://idp.example/token"]
    # no issuer in the document: the configured one, slash-stripped
    assert verified.args == [("tok", "client-1", "https://idp.example/k", "https://idp.example")]


async def test_an_issuer_in_the_discovery_document_wins(
    config, client_kwargs, verified, monkeypatch
):
    config["sso"].update(provider="oidc", issuer_url="https://idp.example/")

    async def discover(url):
        return {
            "token_endpoint": "https://idp.example/token",
            "jwks_uri": "https://idp.example/k",
            "issuer": "https://issuer.example/tenant",
        }

    monkeypatch.setattr(sso, "discover_oidc", discover)
    client_kwargs.handler = lambda r: httpx.Response(200, json={"id_token": "tok"})
    await exchange()
    assert verified.args == [
        ("tok", "client-1", "https://idp.example/k", "https://issuer.example/tenant")
    ]


async def test_a_discovery_failure(config, monkeypatch, caplog):
    config["sso"].update(provider="oidc", issuer_url="https://idp.example")

    async def discover(url):
        raise httpx.ConnectError("down")

    monkeypatch.setattr(sso, "discover_oidc", discover)
    with caplog.at_level(logging.INFO, logger=LOGGER):
        await expect(502, "SSO authentication failed. Could not reach identity provider.")
    assert logged(caplog) == ["Failed to fetch OIDC discovery document"]


async def test_a_connect_error(config, client_kwargs, caplog):
    def refuse(request):
        raise httpx.ConnectError("refused")

    client_kwargs.handler = refuse
    with caplog.at_level(logging.INFO, logger=LOGGER):
        await expect(
            502,
            "Cannot reach identity provider for token exchange. "
            "Check that the backend container can reach the token endpoint.",
        )
    assert logged(caplog)[-1] == (
        f"SSO token exchange: cannot connect to {TOKEN_URL} — check Docker networking"
    )


async def test_another_transport_error(config, client_kwargs, caplog):
    def timeout(request):
        raise httpx.ReadTimeout("slow")

    client_kwargs.handler = timeout
    with caplog.at_level(logging.INFO, logger=LOGGER):
        await expect(502, "SSO authentication failed. Identity provider is unavailable.")
    assert logged(caplog)[-1] == f"SSO token exchange request failed to {TOKEN_URL}"


async def test_a_rejected_code_logs_the_providers_error(config, client_kwargs, caplog):
    client_kwargs.handler = lambda r: httpx.Response(
        400, json={"error": "invalid_grant", "error_description": "Code expired."}
    )
    with caplog.at_level(logging.INFO, logger=LOGGER):
        await expect(401, "SSO authentication failed: Code expired.")
    assert logged(caplog)[-1] == (
        "SSO token exchange failed (microsoft): status=400 error=invalid_grant desc=Code expired."
    )


@pytest.mark.parametrize(
    "response",
    [
        httpx.Response(400, json={}),
        httpx.Response(400, content=b"plain"),  # no content-type at all
        httpx.Response(400, text="<b>x</b>", headers={"content-type": "text/html"}),
        httpx.Response(400, json=["invalid_grant"]),  # JSON, but not an object
        httpx.Response(400, text="400"),  # a bare number parses as JSON
    ],
    ids=["json-without-fields", "no-content-type", "html", "json-list", "plain-number"],
)
async def test_a_rejected_code_without_details(config, client_kwargs, caplog, response):
    client_kwargs.handler = lambda r: response
    with caplog.at_level(logging.INFO, logger=LOGGER):
        await expect(401, "SSO authentication failed: Token exchange failed")
    assert logged(caplog)[-1] == (
        "SSO token exchange failed (microsoft): status=400 error=unknown desc=Token exchange failed"
    )


async def test_no_id_token(config, client_kwargs, caplog):
    client_kwargs.handler = lambda r: httpx.Response(200, json={"access_token": "a", "x": 1})
    with caplog.at_level(logging.INFO, logger=LOGGER):
        await expect(401, "No id_token received from identity provider")
    assert logged(caplog)[-1] == (
        "SSO token response missing id_token (microsoft). Keys received: ['access_token', 'x']"
    )


def _unsigned(**claims):
    return jwt.encode(claims, "k" * 32, algorithm="HS256")


@pytest.mark.parametrize(
    "claims, actual",
    [({"iss": "https://evil.example"}, "'https://evil.example'"), ({}, "'unknown'")],
)
async def test_an_issuer_mismatch(config, client_kwargs, verified, caplog, claims, actual):
    token = _unsigned(**claims)
    client_kwargs.handler = lambda r: httpx.Response(200, json={"id_token": token})
    verified.error = jwt.InvalidIssuerError("bad iss")
    expected_issuer = f"{MS}/contoso/v2.0"
    with caplog.at_level(logging.INFO, logger=LOGGER):
        await expect(
            401,
            f"SSO token issuer mismatch: expected {expected_issuer!r}, "
            f"got {actual}. Check issuer URL in SSO settings.",
        )
    assert logged(caplog)[-1] == (
        f"SSO id_token issuer mismatch (microsoft): expected={expected_issuer} "
        f"actual={actual.strip(chr(39))}"
    )


@pytest.mark.parametrize("claims, actual", [({"aud": "other"}, "other"), ({}, "unknown")])
async def test_an_audience_mismatch(config, client_kwargs, verified, caplog, claims, actual):
    token = _unsigned(**claims)
    client_kwargs.handler = lambda r: httpx.Response(200, json={"id_token": token})
    verified.error = jwt.InvalidAudienceError("bad aud")
    with caplog.at_level(logging.INFO, logger=LOGGER):
        await expect(401, "SSO token audience mismatch. Check Client ID in SSO settings.")
    assert logged(caplog)[-1] == (
        f"SSO id_token audience mismatch (microsoft): expected=client-1 actual={actual}"
    )


async def test_any_other_verification_failure(config, client_kwargs, verified, caplog):
    client_kwargs.handler = lambda r: httpx.Response(200, json={"id_token": "tok"})
    verified.error = ValueError("no key")
    with caplog.at_level(logging.INFO, logger=LOGGER):
        await expect(
            401,
            "Failed to verify SSO token signature. "
            "Check JWKS URI and that the backend can reach it.",
        )
    assert logged(caplog)[-1] == (
        f"Failed to verify SSO id_token (microsoft, jwks={MS}/contoso/discovery/v2.0/keys)"
    )
