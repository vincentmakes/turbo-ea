"""The shared access layer for published, account-less resources.

``public_access`` is where a divergence becomes a security bug, so each check
is pinned on its own: the email comes from the verified claims, an explicit
``email_verified: false`` is refused, Google's hosted domain is enforced only
for Google, the allowlist folds case, and the session cookie carries exactly
the attributes its resource kind needs (CHIPS for the framed diagram, Lax for
a portal). No database: ``sso_service`` is replaced at its seams.
"""

from __future__ import annotations

import logging

import pytest
from fastapi import HTTPException, Response

from app.config import settings
from app.services import public_access, sso_service
from app.services.public_access import (
    PUBLIC_ACCESS_COOKIE,
    _mark_partitioned,
    build_sso_gate_config,
    clear_access_cookie,
    normalise_access_mode,
    normalise_email_domains,
    resolve_sso_visitor_email,
    set_access_cookie,
)

DENIED = "This page is restricted to approved domains."


def _exchange(claims: dict, sso: dict | None = None, provider: str = "microsoft"):
    calls: list[tuple] = []

    async def fake(db, code, redirect_uri):
        calls.append((db, code, redirect_uri))
        return claims, sso or {}, provider

    fake.calls = calls
    return fake


async def _resolve(monkeypatch, claims, *, sso=None, provider="microsoft", domains=None):
    fake = _exchange(claims, sso, provider)
    monkeypatch.setattr(sso_service, "exchange_code_for_claims", fake)
    email = await resolve_sso_visitor_email(
        "DB",
        code="the-code",
        redirect_uri="https://ea.example.com/auth/callback",
        allowed_email_domains=domains,
        denied_message=DENIED,
    )
    return email, fake.calls


async def _refused(monkeypatch, claims, **kwargs) -> HTTPException:
    with pytest.raises(HTTPException) as exc:
        await _resolve(monkeypatch, claims, **kwargs)
    return exc.value


class TestResolveSsoVisitorEmail:
    async def test_passes_the_code_through_and_returns_the_normalised_email(self, monkeypatch):
        email, calls = await _resolve(monkeypatch, {"email": "  Ada@Example.COM "})
        assert email == "ada@example.com"
        assert calls == [("DB", "the-code", "https://ea.example.com/auth/callback")]

    async def test_falls_back_to_preferred_username(self, monkeypatch):
        email, _ = await _resolve(monkeypatch, {"preferred_username": "Bob@Example.com"})
        assert email == "bob@example.com"

    async def test_email_claim_wins_over_preferred_username(self, monkeypatch):
        claims = {"email": "a@example.com", "preferred_username": "b@example.com"}
        email, _ = await _resolve(monkeypatch, claims)
        assert email == "a@example.com"

    @pytest.mark.parametrize("claims", [{}, {"email": ""}, {"email": None}, {"email": "   "}])
    async def test_no_email_claim_is_401(self, monkeypatch, claims):
        err = await _refused(monkeypatch, claims)
        assert err.status_code == 401
        assert err.detail == "No email claim in SSO token. Ensure email scope is granted."

    async def test_explicitly_unverified_email_is_403(self, monkeypatch):
        err = await _refused(monkeypatch, {"email": "a@example.com", "email_verified": False})
        assert err.status_code == 403
        assert err.detail == "Your email address is not verified with the identity provider."

    @pytest.mark.parametrize("verified", [True, None, "false", 0])
    async def test_only_an_explicit_false_is_refused(self, monkeypatch, verified):
        # Many providers omit the claim, and a non-boolean is not an explicit false.
        claims = {"email": "a@example.com", "email_verified": verified}
        email, _ = await _resolve(monkeypatch, claims)
        assert email == "a@example.com"

    async def test_google_hosted_domain_mismatch_is_403(self, monkeypatch):
        err = await _refused(
            monkeypatch,
            {"email": "a@other.com", "hd": "other.com"},
            sso={"domain": "example.com"},
            provider="google",
        )
        assert err.status_code == 403
        assert err.detail == "Sign-in restricted to example.com accounts."

    async def test_google_without_hd_claim_is_refused_when_a_domain_is_set(self, monkeypatch):
        err = await _refused(
            monkeypatch, {"email": "a@gmail.com"}, sso={"domain": "example.com"}, provider="google"
        )
        assert err.status_code == 403

    async def test_google_matching_hosted_domain_is_admitted(self, monkeypatch):
        email, _ = await _resolve(
            monkeypatch,
            {"email": "a@example.com", "hd": "example.com"},
            sso={"domain": "example.com"},
            provider="google",
        )
        assert email == "a@example.com"

    async def test_google_without_a_configured_domain_skips_the_check(self, monkeypatch):
        email, _ = await _resolve(
            monkeypatch, {"email": "a@gmail.com"}, sso={"domain": ""}, provider="google"
        )
        assert email == "a@gmail.com"

    @pytest.mark.parametrize("provider", ["microsoft", "okta", "oidc"])
    async def test_hosted_domain_is_only_enforced_for_google(self, monkeypatch, provider):
        email, _ = await _resolve(
            monkeypatch,
            {"email": "a@other.com", "hd": "other.com"},
            sso={"domain": "example.com"},
            provider=provider,
        )
        assert email == "a@other.com"

    async def test_allowlist_admits_a_listed_domain_folding_case_and_space(self, monkeypatch):
        email, _ = await _resolve(
            monkeypatch,
            {"email": "a@Example.com"},
            domains=[None, "", "  EXAMPLE.com ", "other.org"],
        )
        assert email == "a@example.com"

    async def test_allowlist_refuses_an_unlisted_domain_with_the_callers_message(self, monkeypatch):
        err = await _refused(
            monkeypatch, {"email": "a@evil.com"}, domains=["example.com", "other.org"]
        )
        assert err.status_code == 403
        assert err.detail == DENIED

    async def test_allowlist_matches_the_whole_domain_not_a_suffix(self, monkeypatch):
        err = await _refused(monkeypatch, {"email": "a@notexample.com"}, domains=["example.com"])
        assert err.status_code == 403

    async def test_allowlist_uses_the_part_after_the_last_at(self, monkeypatch):
        err = await _refused(
            monkeypatch, {"email": "example.com@evil.com"}, domains=["example.com"]
        )
        assert err.status_code == 403

    @pytest.mark.parametrize("domains", [None, []])
    async def test_empty_allowlist_admits_anyone_the_idp_authenticates(self, monkeypatch, domains):
        email, _ = await _resolve(monkeypatch, {"email": "a@anywhere.io"}, domains=domains)
        assert email == "a@anywhere.io"


class TestBuildSsoGateConfig:
    def _sso(self, monkeypatch, sso: dict) -> None:
        async def fake(db):
            return sso

        monkeypatch.setattr(sso_service, "get_sso_config", fake)

    async def test_disabled_sso_returns_none(self, monkeypatch):
        self._sso(monkeypatch, {"enabled": False, "provider": "microsoft"})
        assert await build_sso_gate_config("DB", context="portal x") is None

    async def test_missing_enabled_flag_returns_none(self, monkeypatch):
        self._sso(monkeypatch, {"provider": "microsoft"})
        assert await build_sso_gate_config("DB", context="portal x") is None

    async def test_microsoft_config(self, monkeypatch):
        self._sso(
            monkeypatch,
            {"enabled": True, "provider": "microsoft", "client_id": "cid", "tenant_id": "t1"},
        )
        assert await build_sso_gate_config("DB", context="portal x") == {
            "provider": "microsoft",
            "provider_name": "Microsoft",
            "client_id": "cid",
            "authorization_endpoint": (
                "https://login.microsoftonline.com/t1/oauth2/v2.0/authorize"
            ),
            "scopes": "openid email profile",
        }

    async def test_provider_defaults_to_microsoft_and_client_id_to_empty(self, monkeypatch):
        self._sso(monkeypatch, {"enabled": True})
        out = await build_sso_gate_config("DB", context="portal x")
        assert out["provider"] == "microsoft"
        assert out["provider_name"] == "Microsoft"
        assert out["client_id"] == ""

    async def test_google_with_a_domain_carries_extra_auth_params(self, monkeypatch):
        self._sso(
            monkeypatch,
            {"enabled": True, "provider": "google", "client_id": "g", "domain": "example.com"},
        )
        out = await build_sso_gate_config("DB", context="diagram y")
        assert out["provider_name"] == "Google"
        assert out["authorization_endpoint"] == "https://accounts.google.com/o/oauth2/v2/auth"
        assert out["extra_auth_params"] == {"hd": "example.com"}

    async def test_empty_extra_auth_params_are_left_out(self, monkeypatch):
        self._sso(monkeypatch, {"enabled": True, "provider": "google", "client_id": "g"})
        out = await build_sso_gate_config("DB", context="diagram y")
        assert "extra_auth_params" not in out

    async def test_oidc_with_manual_endpoints_needs_no_discovery(self, monkeypatch):
        async def boom(url):
            raise AssertionError("discovery must not run")

        monkeypatch.setattr(sso_service, "discover_oidc", boom)
        self._sso(
            monkeypatch,
            {
                "enabled": True,
                "provider": "oidc",
                "issuer_url": "https://idp.example.com/",
                "authorization_endpoint": "https://idp.example.com/auth",
                "token_endpoint": "https://idp.example.com/token",
                "jwks_uri": "https://idp.example.com/jwks",
            },
        )
        out = await build_sso_gate_config("DB", context="portal x")
        assert out["provider_name"] == "SSO"
        assert out["authorization_endpoint"] == "https://idp.example.com/auth"

    async def test_oidc_discovery_supplies_the_authorization_endpoint(self, monkeypatch):
        seen: list[str] = []

        async def discover(url):
            seen.append(url)
            return {"authorization_endpoint": "https://idp.example.com/discovered"}

        monkeypatch.setattr(sso_service, "discover_oidc", discover)
        self._sso(
            monkeypatch,
            {"enabled": True, "provider": "oidc", "issuer_url": "https://idp.example.com"},
        )
        out = await build_sso_gate_config("DB", context="portal x")
        assert seen == ["https://idp.example.com"]
        assert out["authorization_endpoint"] == "https://idp.example.com/discovered"

    async def test_unlabelled_provider_falls_back_to_its_key(self, monkeypatch):
        monkeypatch.setattr(
            sso_service,
            "get_provider_config",
            lambda sso: {"authorization_endpoint": "https://x/auth", "scopes": "openid"},
        )
        self._sso(monkeypatch, {"enabled": True, "provider": "keycloak"})
        out = await build_sso_gate_config("DB", context="portal x")
        assert out["provider"] == "keycloak"
        assert out["provider_name"] == "keycloak"

    @pytest.mark.parametrize(
        "sso",
        [
            {"enabled": True, "provider": "okta"},  # okta without a domain
            {"enabled": True, "provider": "nope"},  # unknown provider
        ],
    )
    async def test_misconfiguration_returns_none_and_logs(self, monkeypatch, caplog, sso):
        self._sso(monkeypatch, sso)
        with caplog.at_level(logging.ERROR, logger=public_access.__name__):
            assert await build_sso_gate_config("DB", context="portal x") is None
        assert "Failed to build SSO gate config for portal x" in caplog.text

    async def test_failed_discovery_returns_none(self, monkeypatch):
        async def discover(url):
            raise RuntimeError("idp down")

        monkeypatch.setattr(sso_service, "discover_oidc", discover)
        self._sso(
            monkeypatch,
            {"enabled": True, "provider": "oidc", "issuer_url": "https://idp.example.com"},
        )
        assert await build_sso_gate_config("DB", context="portal x") is None


def _cookie_headers(response: Response) -> list[str]:
    return [v.decode() for k, v in response.raw_headers if k == b"set-cookie"]


def _attrs(header: str) -> dict[str, str]:
    """``a=b; HttpOnly; Path=/x`` → ``{"a": "b", "httponly": "", "path": "/x"}``."""
    out: dict[str, str] = {}
    for i, part in enumerate(header.split("; ")):
        key, _, value = part.partition("=")
        out[key if i == 0 else key.lower()] = value
    return out


class TestSetAccessCookie:
    def test_portal_cookie_is_lax_httponly_and_path_scoped(self):
        response = Response()
        set_access_cookie(response, "tok", path="/api/v1/web-portals/public/x", secure=True)
        [header] = _cookie_headers(response)
        assert _attrs(header) == {
            PUBLIC_ACCESS_COOKIE: "tok",
            "httponly": "",
            "max-age": str(settings.PORTAL_TOKEN_EXPIRE_MINUTES * 60),
            "path": "/api/v1/web-portals/public/x",
            "samesite": "lax",
            "secure": "",
        }

    def test_insecure_portal_cookie_is_not_marked_secure(self):
        response = Response()
        set_access_cookie(response, "tok", path="/p", secure=False)
        attrs = _attrs(_cookie_headers(response)[0])
        assert "secure" not in attrs
        assert attrs["samesite"] == "lax"

    def test_cross_site_cookie_over_https_is_chips(self, caplog):
        response = Response()
        with caplog.at_level(logging.WARNING, logger=public_access.__name__):
            set_access_cookie(response, "tok", path="/d", secure=True, cross_site=True)
        [header] = _cookie_headers(response)
        attrs = _attrs(header)
        assert attrs["samesite"] == "none"
        assert "secure" in attrs
        assert header.endswith("; Partitioned")
        assert caplog.text == ""

    def test_cross_site_cookie_over_http_degrades_to_lax_and_says_so(self, caplog):
        response = Response()
        with caplog.at_level(logging.WARNING, logger=public_access.__name__):
            set_access_cookie(response, "tok", path="/d", secure=False, cross_site=True)
        [header] = _cookie_headers(response)
        attrs = _attrs(header)
        assert attrs["samesite"] == "lax"
        assert "secure" not in attrs
        assert "partitioned" not in header.lower()
        assert "falling back to SameSite=Lax" in caplog.text
        assert "/d" in caplog.text


class TestMarkPartitioned:
    def test_only_the_access_cookie_is_marked(self):
        response = Response()
        response.set_cookie("other", "x", path="/")
        response.set_cookie(PUBLIC_ACCESS_COOKIE, "tok", path="/d")
        response.set_cookie(PUBLIC_ACCESS_COOKIE + "_x", "y", path="/")
        _mark_partitioned(response)
        other, access, lookalike = _cookie_headers(response)
        assert "partitioned" not in other.lower()
        assert access.endswith("; Partitioned")
        assert "partitioned" not in lookalike.lower()

    def test_is_idempotent(self):
        response = Response()
        response.set_cookie(PUBLIC_ACCESS_COOKIE, "tok", path="/d")
        _mark_partitioned(response)
        _mark_partitioned(response)
        [header] = _cookie_headers(response)
        assert header.lower().count("partitioned") == 1

    def test_only_the_first_access_cookie_is_touched(self):
        response = Response()
        response.set_cookie(PUBLIC_ACCESS_COOKIE, "a", path="/a")
        response.set_cookie(PUBLIC_ACCESS_COOKIE, "b", path="/b")
        _mark_partitioned(response)
        first, second = _cookie_headers(response)
        assert first.endswith("; Partitioned")
        assert "partitioned" not in second.lower()

    def test_non_cookie_headers_are_left_alone(self):
        response = Response()
        response.headers["x-portal"] = f"{PUBLIC_ACCESS_COOKIE}=x"
        _mark_partitioned(response)
        assert response.headers["x-portal"] == f"{PUBLIC_ACCESS_COOKIE}=x"


class TestClearAccessCookie:
    def test_expires_the_cookie_on_its_own_path(self):
        response = Response()
        clear_access_cookie(response, path="/api/v1/diagrams/public/s")
        [header] = _cookie_headers(response)
        attrs = _attrs(header)
        assert attrs[PUBLIC_ACCESS_COOKIE] == '""'
        assert attrs["max-age"] == "0"
        assert attrs["path"] == "/api/v1/diagrams/public/s"


class TestNormalise:
    @pytest.mark.parametrize(
        "mode, expected",
        [("sso", "sso"), ("public", "public"), (None, "public"), ("", "public"), ("x", "public")],
    )
    def test_access_mode(self, mode, expected):
        assert normalise_access_mode(mode) == expected

    @pytest.mark.parametrize("domains", [None, [], ["", "  "], [None]])
    def test_empty_domains_become_none(self, domains):
        assert normalise_email_domains(domains) is None

    def test_domains_are_lowercased_stripped_deduplicated_and_sorted(self):
        assert normalise_email_domains(["@B.com", " a.org ", "b.com", "", "A.ORG"]) == [
            "a.org",
            "b.com",
        ]
