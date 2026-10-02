"""``app.services.sso_service`` — provider configuration, JWKS / OIDC
discovery caches, ``id_token`` verification and the authorization-code
exchange every SSO caller shares (user login and SSO-gated portals).

No database: the SSO configuration is read through ``get_sso_config``,
which the exchange tests patch; the two settings readers have their own
small database-backed tests at the end. The identity provider is a
``MockTransport`` and the ``id_token`` is signed with a throwaway RSA key.
"""

from __future__ import annotations

import time
from types import SimpleNamespace

import httpx
import jwt
import pytest
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from fastapi import HTTPException

import app.services.sso_service as sso
from tests.seams import patch_httpx_client

# ---------------------------------------------------------------------------
# get_provider_config
# ---------------------------------------------------------------------------


class TestGetProviderConfig:
    def test_microsoft_defaults_to_the_organizations_tenant(self):
        cfg = sso.get_provider_config({"provider": "microsoft"})
        base = "https://login.microsoftonline.com/organizations"
        assert cfg["authorization_endpoint"] == f"{base}/oauth2/v2.0/authorize"
        assert cfg["token_endpoint"] == f"{base}/oauth2/v2.0/token"
        assert cfg["jwks_uri"] == f"{base}/discovery/v2.0/keys"
        assert cfg["issuer"] == f"{base}/v2.0"
        assert cfg["subject_claim"] == "oid"
        assert cfg["extra_auth_params"] == {}

    def test_microsoft_uses_the_configured_tenant(self):
        cfg = sso.get_provider_config({"provider": "microsoft", "tenant_id": "contoso"})
        assert cfg["issuer"] == "https://login.microsoftonline.com/contoso/v2.0"

    def test_provider_defaults_to_microsoft(self):
        assert sso.get_provider_config({})["subject_claim"] == "oid"

    def test_google_without_domain_sends_no_hd(self):
        cfg = sso.get_provider_config({"provider": "google"})
        assert cfg["issuer"] == "https://accounts.google.com"
        assert cfg["subject_claim"] == "sub"
        assert cfg["extra_auth_params"] == {}

    def test_google_with_domain_pins_hd(self):
        cfg = sso.get_provider_config({"provider": "google", "domain": "acme.com"})
        assert cfg["extra_auth_params"] == {"hd": "acme.com"}

    def test_okta_builds_urls_from_the_domain(self):
        cfg = sso.get_provider_config({"provider": "okta", "domain": "acme.okta.com"})
        assert cfg["issuer"] == "https://acme.okta.com/oauth2/default"
        assert cfg["jwks_uri"] == "https://acme.okta.com/oauth2/default/v1/keys"

    def test_okta_without_domain_raises(self):
        with pytest.raises(ValueError, match="Okta domain is required"):
            sso.get_provider_config({"provider": "okta"})

    def test_oidc_with_manual_endpoints_needs_no_discovery(self):
        cfg = sso.get_provider_config(
            {
                "provider": "oidc",
                "issuer_url": "https://idp.test/realms/x/",
                "authorization_endpoint": "https://idp.test/auth",
                "token_endpoint": "https://idp.test/token",
                "jwks_uri": "https://idp.test/jwks",
            }
        )
        assert cfg["discovery_required"] is False
        assert cfg["issuer"] == "https://idp.test/realms/x"  # trailing slash stripped
        assert cfg["token_endpoint"] == "https://idp.test/token"

    def test_oidc_with_partial_endpoints_requires_discovery(self):
        cfg = sso.get_provider_config(
            {
                "provider": "oidc",
                "issuer_url": "https://idp.test",
                "token_endpoint": "https://idp.test/token",
            }
        )
        assert cfg["discovery_required"] is True
        assert cfg["jwks_uri"] == ""

    def test_oidc_without_issuer_raises(self):
        with pytest.raises(ValueError, match="Issuer URL is required"):
            sso.get_provider_config({"provider": "oidc"})

    def test_unknown_provider_raises(self):
        with pytest.raises(ValueError, match="Unknown SSO provider: saml"):
            sso.get_provider_config({"provider": "saml"})


# ---------------------------------------------------------------------------
# Caches: JWKS clients and OIDC discovery
# ---------------------------------------------------------------------------


class TestGetJwksClient:
    def test_one_client_per_url_cached(self, monkeypatch):
        monkeypatch.setattr(sso, "_jwks_clients", {})
        a = sso.get_jwks_client("https://idp.test/jwks")
        b = sso.get_jwks_client("https://idp.test/jwks")
        c = sso.get_jwks_client("https://other.test/jwks")
        assert a is b and a is not c
        assert set(sso._jwks_clients) == {"https://idp.test/jwks", "https://other.test/jwks"}


class TestDiscoverOidc:
    async def test_fetches_the_well_known_document_once(self, monkeypatch):
        monkeypatch.setattr(sso, "_oidc_discovery_cache", {})
        doc = {"token_endpoint": "https://idp.test/token", "jwks_uri": "https://idp.test/jwks"}
        seen = patch_httpx_client(monkeypatch, sso, lambda req: httpx.Response(200, json=doc))

        first = await sso.discover_oidc("https://idp.test/realms/x/")
        second = await sso.discover_oidc("https://idp.test/realms/x/")

        assert first == doc and second is first
        assert [str(r.url) for r in seen] == [
            "https://idp.test/realms/x/.well-known/openid-configuration"
        ]

    async def test_a_non_200_answer_raises(self, monkeypatch):
        monkeypatch.setattr(sso, "_oidc_discovery_cache", {})
        patch_httpx_client(monkeypatch, sso, lambda req: httpx.Response(503, text="down"))
        with pytest.raises(httpx.HTTPStatusError):
            await sso.discover_oidc("https://idp.test")
        assert sso._oidc_discovery_cache == {}


# ---------------------------------------------------------------------------
# verify_id_token — a real RS256 signature against a stubbed JWKS client
# ---------------------------------------------------------------------------


@pytest.fixture(scope="module")
def rsa_keys():
    private = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    private_pem = private.private_bytes(
        serialization.Encoding.PEM,
        serialization.PrivateFormat.PKCS8,
        serialization.NoEncryption(),
    )
    public_pem = private.public_key().public_bytes(
        serialization.Encoding.PEM, serialization.PublicFormat.SubjectPublicKeyInfo
    )
    return private_pem, public_pem


@pytest.fixture
def jwks_stub(monkeypatch, rsa_keys):
    """``get_jwks_client`` returns a client that knows our public key."""
    _, public_pem = rsa_keys
    stub = SimpleNamespace(
        get_signing_key_from_jwt=lambda token: SimpleNamespace(key=public_pem),
        requested=[],
    )
    monkeypatch.setattr(sso, "get_jwks_client", lambda url: (stub.requested.append(url), stub)[1])
    return stub


def _id_token(private_pem: bytes, **claims) -> str:
    now = int(time.time())
    payload = {"iss": "https://idp.test", "aud": "client-1", "iat": now, "exp": now + 300}
    payload.update(claims)
    return jwt.encode(payload, private_pem, algorithm="RS256", headers={"kid": "k1"})


class TestVerifyIdToken:
    def test_valid_token_returns_claims(self, rsa_keys, jwks_stub):
        private_pem, _ = rsa_keys
        token = _id_token(private_pem, sub="u1", email="a@b.c")
        claims = sso.verify_id_token(token, "client-1", "https://idp.test/jwks", "https://idp.test")
        assert claims["sub"] == "u1" and claims["email"] == "a@b.c"
        assert jwks_stub.requested == ["https://idp.test/jwks"]

    def test_issuer_with_trailing_slash_is_retried(self, rsa_keys, jwks_stub):
        private_pem, _ = rsa_keys
        token = _id_token(private_pem, iss="https://idp.test")
        assert sso.verify_id_token(token, "client-1", "u", "https://idp.test/")["iss"]
        token = _id_token(private_pem, iss="https://idp.test/")
        assert sso.verify_id_token(token, "client-1", "u", "https://idp.test")["iss"]

    def test_other_issuer_still_fails(self, rsa_keys, jwks_stub):
        private_pem, _ = rsa_keys
        token = _id_token(private_pem, iss="https://evil.test")
        with pytest.raises(jwt.InvalidIssuerError):
            sso.verify_id_token(token, "client-1", "u", "https://idp.test")

    def test_wrong_audience_fails(self, rsa_keys, jwks_stub):
        private_pem, _ = rsa_keys
        token = _id_token(private_pem, aud="someone-else")
        with pytest.raises(jwt.InvalidAudienceError):
            sso.verify_id_token(token, "client-1", "u", "https://idp.test")

    def test_expired_token_fails(self, rsa_keys, jwks_stub):
        private_pem, _ = rsa_keys
        token = _id_token(private_pem, exp=int(time.time()) - 10)
        with pytest.raises(jwt.ExpiredSignatureError):
            sso.verify_id_token(token, "client-1", "u", "https://idp.test")


# ---------------------------------------------------------------------------
# exchange_code_for_claims
# ---------------------------------------------------------------------------

_SSO = {
    "enabled": True,
    "provider": "microsoft",
    "tenant_id": "contoso",
    "client_id": "client-1",
    "client_secret": "s3cret",  # decrypt_value passes a plaintext value through
}
_MS_TOKEN = "https://login.microsoftonline.com/contoso/oauth2/v2.0/token"


@pytest.fixture
def sso_config(monkeypatch):
    """Return ``get_sso_config``'s answer from a dict the test can edit."""
    holder = {"sso": dict(_SSO)}

    async def _get(db):
        return holder["sso"]

    monkeypatch.setattr(sso, "get_sso_config", _get)
    return holder["sso"]


@pytest.fixture
def verify(monkeypatch):
    """Record ``verify_id_token`` calls; raise what ``.error`` holds, if set."""
    calls = SimpleNamespace(args=[], error=None, claims={"sub": "u1", "email": "a@b.c"})

    def _verify(token, client_id, jwks_uri, issuer):
        calls.args.append((token, client_id, jwks_uri, issuer))
        if calls.error is not None:
            raise calls.error
        return calls.claims

    monkeypatch.setattr(sso, "verify_id_token", _verify)
    return calls


def _token_endpoint(status=200, body=None, *, json_body=True):
    def handler(request: httpx.Request) -> httpx.Response:
        if json_body:
            return httpx.Response(status, json=body if body is not None else {"id_token": "tok"})
        return httpx.Response(status, text=body or "", headers={"content-type": "text/html"})

    return handler


class TestExchangeCodeForClaims:
    async def _exchange(self):
        return await sso.exchange_code_for_claims(None, "code-1", "https://app.test/cb")

    async def test_disabled_sso_is_400(self, sso_config):
        sso_config["enabled"] = False
        with pytest.raises(HTTPException) as exc:
            await self._exchange()
        assert exc.value.status_code == 400

    @pytest.mark.parametrize("missing", ["client_id", "client_secret"])
    async def test_missing_credentials_is_500(self, sso_config, missing):
        sso_config[missing] = ""
        with pytest.raises(HTTPException) as exc:
            await self._exchange()
        assert exc.value.status_code == 500
        assert "not properly configured" in exc.value.detail

    async def test_provider_misconfiguration_is_500(self, sso_config):
        sso_config.update(provider="okta", domain="")
        with pytest.raises(HTTPException) as exc:
            await self._exchange()
        assert exc.value.status_code == 500
        assert "Okta domain is required" in exc.value.detail

    async def test_discovery_failure_is_502(self, sso_config, monkeypatch):
        sso_config.update(provider="oidc", issuer_url="https://idp.test")
        monkeypatch.setattr(sso, "_oidc_discovery_cache", {})
        patch_httpx_client(monkeypatch, sso, lambda req: httpx.Response(500))
        with pytest.raises(HTTPException) as exc:
            await self._exchange()
        assert exc.value.status_code == 502
        assert "Could not reach identity provider" in exc.value.detail

    async def test_connect_error_is_502_with_networking_hint(self, sso_config, monkeypatch):
        def boom(request):
            raise httpx.ConnectError("refused", request=request)

        patch_httpx_client(monkeypatch, sso, boom)
        with pytest.raises(HTTPException) as exc:
            await self._exchange()
        assert exc.value.status_code == 502
        assert "Cannot reach identity provider" in exc.value.detail

    async def test_other_transport_error_is_502(self, sso_config, monkeypatch):
        def boom(request):
            raise httpx.ReadTimeout("slow", request=request)

        patch_httpx_client(monkeypatch, sso, boom)
        with pytest.raises(HTTPException) as exc:
            await self._exchange()
        assert exc.value.status_code == 502
        assert "unavailable" in exc.value.detail

    async def test_rejected_code_reports_the_providers_description(self, sso_config, monkeypatch):
        patch_httpx_client(
            monkeypatch,
            sso,
            _token_endpoint(
                400, {"error": "invalid_grant", "error_description": "AADSTS70000: expired"}
            ),
        )
        with pytest.raises(HTTPException) as exc:
            await self._exchange()
        assert exc.value.status_code == 401
        assert "AADSTS70000: expired" in exc.value.detail

    async def test_rejected_code_without_json_body_is_generic_401(self, sso_config, monkeypatch):
        patch_httpx_client(
            monkeypatch, sso, _token_endpoint(502, "<html>bad gateway", json_body=False)
        )
        with pytest.raises(HTTPException) as exc:
            await self._exchange()
        assert exc.value.status_code == 401
        assert exc.value.detail == "SSO authentication failed: Token exchange failed"

    async def test_missing_id_token_is_401(self, sso_config, monkeypatch):
        patch_httpx_client(monkeypatch, sso, _token_endpoint(200, {"access_token": "only"}))
        with pytest.raises(HTTPException) as exc:
            await self._exchange()
        assert exc.value.status_code == 401
        assert "No id_token" in exc.value.detail

    async def test_issuer_mismatch_names_both_issuers(self, sso_config, monkeypatch, verify):
        unsigned = jwt.encode({"iss": "https://sts.windows.net/x/"}, "k", algorithm="HS256")
        patch_httpx_client(monkeypatch, sso, _token_endpoint(200, {"id_token": unsigned}))
        verify.error = jwt.InvalidIssuerError("nope")
        with pytest.raises(HTTPException) as exc:
            await self._exchange()
        assert exc.value.status_code == 401
        assert "https://login.microsoftonline.com/contoso/v2.0" in exc.value.detail
        assert "https://sts.windows.net/x/" in exc.value.detail

    async def test_audience_mismatch_is_401(self, sso_config, monkeypatch, verify):
        unsigned = jwt.encode({"aud": "other-app"}, "k", algorithm="HS256")
        patch_httpx_client(monkeypatch, sso, _token_endpoint(200, {"id_token": unsigned}))
        verify.error = jwt.InvalidAudienceError("nope")
        with pytest.raises(HTTPException) as exc:
            await self._exchange()
        assert exc.value.status_code == 401
        assert "audience mismatch" in exc.value.detail

    async def test_any_other_verification_error_is_401(self, sso_config, monkeypatch, verify):
        patch_httpx_client(monkeypatch, sso, _token_endpoint())
        verify.error = RuntimeError("jwks unreachable")
        with pytest.raises(HTTPException) as exc:
            await self._exchange()
        assert exc.value.status_code == 401
        assert "Failed to verify SSO token signature" in exc.value.detail

    async def test_happy_path_posts_the_code_and_returns_verified_claims(
        self, sso_config, monkeypatch, verify
    ):
        seen = patch_httpx_client(monkeypatch, sso, _token_endpoint())

        claims, cfg, provider = await self._exchange()

        assert claims == verify.claims and cfg is sso_config and provider == "microsoft"
        (request,) = seen
        assert request.method == "POST" and str(request.url) == _MS_TOKEN
        form = dict(p.split("=", 1) for p in request.content.decode().split("&"))
        assert form["grant_type"] == "authorization_code"
        assert form["client_id"] == "client-1" and form["client_secret"] == "s3cret"
        assert form["code"] == "code-1"
        assert form["redirect_uri"] == "https%3A%2F%2Fapp.test%2Fcb"
        assert verify.args == [
            (
                "tok",
                "client-1",
                "https://login.microsoftonline.com/contoso/discovery/v2.0/keys",
                "https://login.microsoftonline.com/contoso/v2.0",
            )
        ]

    async def test_generic_oidc_resolves_endpoints_from_discovery(
        self, sso_config, monkeypatch, verify
    ):
        sso_config.update(provider="oidc", issuer_url="https://idp.test/realms/x")
        monkeypatch.setattr(sso, "_oidc_discovery_cache", {})
        doc = {
            "token_endpoint": "https://idp.test/realms/x/token",
            "jwks_uri": "https://idp.test/realms/x/certs",
            "issuer": "https://idp.test/realms/x",
        }

        def handler(request: httpx.Request) -> httpx.Response:
            if request.url.path.endswith("/.well-known/openid-configuration"):
                return httpx.Response(200, json=doc)
            return httpx.Response(200, json={"id_token": "tok"})

        seen = patch_httpx_client(monkeypatch, sso, handler)

        _, _, provider = await self._exchange()

        assert provider == "oidc"
        assert [str(r.url) for r in seen] == [
            "https://idp.test/realms/x/.well-known/openid-configuration",
            "https://idp.test/realms/x/token",
        ]
        assert verify.args == [("tok", "client-1", doc["jwks_uri"], doc["issuer"])]


# ---------------------------------------------------------------------------
# Settings readers (database)
# ---------------------------------------------------------------------------


class TestSettingsReaders:
    async def test_no_row_means_empty(self, db):
        assert await sso.get_general_settings(db) == {}
        assert await sso.get_sso_config(db) == {}

    async def test_sso_block_is_returned_only_when_it_is_a_dict(self, db):
        from tests.seams import ai_settings

        await ai_settings(db, general={"sso": {"enabled": True, "provider": "google"}})
        assert (await sso.get_sso_config(db))["provider"] == "google"

        await ai_settings(db, general={"sso": "not-a-dict"})
        assert await sso.get_sso_config(db) == {}
