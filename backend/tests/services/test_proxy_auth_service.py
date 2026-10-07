"""Unit tests for the trusted reverse-proxy identity resolver.

``tests/api/test_auth_proxy.py`` drives the whole sign-in route; these pin the
resolver itself, branch by branch, because it is the part a forged header
reaches first. Each test names the control it guards: the pre-shared secret,
the principal-header decoder, the fail-closed id-token path and the domain
allowlist (see the module docstring for why each exists).
"""

from __future__ import annotations

import base64
import json

import pytest
from fastapi import HTTPException
from starlette.requests import Request

from app.config import settings
from app.services import proxy_auth_service as pas
from app.services import sso_service

SECRET = "s3cret-value"
SECRET_HEADER = "X-Turbo-EA-Proxy-Secret"


def request(**headers: str) -> Request:
    return Request(
        {
            "type": "http",
            "headers": [(k.lower().encode(), v.encode()) for k, v in headers.items()],
        }
    )


def principal(*claims: tuple[str, str], pad: bool = True) -> str:
    payload = {"auth_typ": "aad", "claims": [{"typ": t, "val": v} for t, v in claims]}
    raw = base64.b64encode(json.dumps(payload).encode()).decode()
    return raw if pad else raw.rstrip("=")


def raises(status: int, fn, *args) -> HTTPException:
    with pytest.raises(HTTPException) as exc:
        fn(*args)
    assert exc.value.status_code == status
    return exc.value


@pytest.fixture
def cfg(monkeypatch):
    """Header mode, a shared secret, one allowed domain; tests override what they test."""
    values = {
        "PROXY_AUTH_ENABLED": True,
        "PROXY_AUTH_MODE": "header",
        "PROXY_AUTH_SHARED_SECRET": SECRET,
        "PROXY_AUTH_SECRET_HEADER": SECRET_HEADER,
        "PROXY_AUTH_TRUST_PLATFORM_HEADERS": False,
        "PROXY_AUTH_VERIFY_ID_TOKEN": False,
        "PROXY_AUTH_ISSUER": "https://issuer.example",
        "PROXY_AUTH_AUDIENCE": "aud-1",
        "PROXY_AUTH_JWKS_URI": "https://issuer.example/jwks",
        "PROXY_AUTH_ALLOWED_DOMAINS": ["example.com"],
        "PROXY_AUTH_ALLOW_ANY_DOMAIN": False,
        "PROXY_AUTH_ROLE_MAP": [],
        "PROXY_AUTH_ROLE_CLAIM": "roles",
        "PROXY_AUTH_ROLE_HEADER": "X-Forwarded-Groups",
        "PROXY_AUTH_EMAIL_HEADER": "X-Forwarded-Email",
        "PROXY_AUTH_NAME_HEADER": "X-Forwarded-User",
        "PROXY_AUTH_SUBJECT_HEADER": "X-Forwarded-Subject",
    }
    for key, value in values.items():
        monkeypatch.setattr(settings, key, value)

    def set_(**overrides):
        for key, value in overrides.items():
            monkeypatch.setattr(settings, key, value)

    return set_


# ── is_enabled / role_mapping_trusted ───────────────────────────────────────


def test_is_enabled_follows_the_setting(cfg):
    assert pas.is_enabled() is True
    cfg(PROXY_AUTH_ENABLED=False)
    assert pas.is_enabled() is False
    cfg(PROXY_AUTH_ENABLED=None)
    assert pas.is_enabled() is False


def identity(verified: bool) -> pas.ProxyIdentity:
    return pas.ProxyIdentity(
        email="a@example.com",
        display_name="a",
        subject_id="s",
        verified=verified,
        email_verified=None,
    )


def test_role_mapping_needs_a_verified_token_or_a_secret(cfg):
    assert pas.role_mapping_trusted(identity(verified=False)) is True  # secret set
    cfg(PROXY_AUTH_SHARED_SECRET="")
    assert pas.role_mapping_trusted(identity(verified=True)) is True
    assert pas.role_mapping_trusted(identity(verified=False)) is False


def test_identity_keeps_every_field_and_defaults_roles_to_empty():
    ident = pas.ProxyIdentity(
        email="e", display_name="n", subject_id="s", verified=True, email_verified=False
    )
    assert (ident.email, ident.display_name, ident.subject_id) == ("e", "n", "s")
    assert ident.verified is True and ident.email_verified is False
    assert ident.roles == ()


# ── check_shared_secret: the primary control ────────────────────────────────


def test_the_right_secret_passes(cfg):
    assert pas.check_shared_secret(request(**{SECRET_HEADER: SECRET})) is None


def test_the_secret_header_name_is_matched_case_insensitively(cfg):
    cfg(PROXY_AUTH_SECRET_HEADER="X-MIXED-Case")
    assert pas.check_shared_secret(request(**{"x-mixed-case": SECRET})) is None


@pytest.mark.parametrize("presented", [None, "", "wrong", SECRET + "x", SECRET.upper()])
def test_a_missing_or_wrong_secret_is_401(cfg, presented):
    headers = {} if presented is None else {SECRET_HEADER: presented}
    err = raises(401, pas.check_shared_secret, request(**headers))
    assert err.detail == "Proxy authentication failed."


def test_a_configured_secret_is_enforced_even_on_trusted_azure(cfg):
    cfg(PROXY_AUTH_MODE="azure_easyauth", PROXY_AUTH_TRUST_PLATFORM_HEADERS=True)
    raises(401, pas.check_shared_secret, request())


def test_azure_may_waive_the_secret_only_by_explicit_opt_in(cfg):
    cfg(
        PROXY_AUTH_SHARED_SECRET="",
        PROXY_AUTH_MODE="azure_easyauth",
        PROXY_AUTH_TRUST_PLATFORM_HEADERS=True,
    )
    assert pas.check_shared_secret(request()) is None


@pytest.mark.parametrize(
    "mode, trust",
    [("azure_easyauth", False), ("header", True), ("header", False)],
)
def test_no_secret_without_the_azure_opt_in_is_a_misconfiguration(cfg, mode, trust):
    cfg(
        PROXY_AUTH_SHARED_SECRET="",
        PROXY_AUTH_MODE=mode,
        PROXY_AUTH_TRUST_PLATFORM_HEADERS=trust,
    )
    err = raises(500, pas.check_shared_secret, request(**{SECRET_HEADER: "anything"}))
    assert err.detail == (
        "Proxy authentication is enabled but not secured. Set "
        "TURBO_EA_PROXY_AUTH_SHARED_SECRET, or (Azure App Service only, where "
        "a custom header cannot be injected) set "
        "TURBO_EA_PROXY_AUTH_TRUST_PLATFORM_HEADERS=true to accept the "
        "platform's own header sanitisation as the control."
    )


def test_a_missing_header_never_equals_a_configured_secret(cfg):
    """Whatever stands in for an absent header must not match any secret."""
    for secret in ("XXXX", "None", " "):
        cfg(PROXY_AUTH_SHARED_SECRET=secret)
        raises(401, pas.check_shared_secret, request())


# ── _decode_azure_principal ─────────────────────────────────────────────────


def test_principal_decodes_with_or_without_padding():
    for pad in (True, False):
        raw = principal(("email", "a@example.com"), ("name", "Alice"), pad=pad)
        assert pas._decode_azure_principal(raw) == {"email": "a@example.com", "name": "Alice"}


def test_a_repeated_claim_becomes_a_list_in_document_order():
    raw = principal(("roles", "a"), ("email", "x@y"), ("roles", "b"), ("roles", "c"))
    assert pas._decode_azure_principal(raw) == {"roles": ["a", "b", "c"], "email": "x@y"}


def test_malformed_claim_entries_are_skipped():
    payload = {
        "claims": [
            "not-a-dict",
            {"typ": 1, "val": "x"},
            {"typ": "a", "val": 2},
            {"typ": "b"},
            {"typ": "ok", "val": "yes"},
        ]
    }
    raw = base64.b64encode(json.dumps(payload).encode()).decode()
    assert pas._decode_azure_principal(raw) == {"ok": "yes"}


@pytest.mark.parametrize("claims", [None, []])
def test_a_principal_without_claims_is_empty(claims):
    raw = base64.b64encode(json.dumps({"claims": claims}).encode()).decode()
    assert pas._decode_azure_principal(raw) == {}


@pytest.mark.parametrize(
    "raw",
    [
        "!!!not base64!!!",
        base64.b64encode(b"not json").decode(),
        base64.b64encode(b"\xff\xfe").decode(),
        base64.b64encode(b"[1, 2]").decode(),
        base64.b64encode(b'"a string"').decode(),
    ],
)
def test_a_malformed_principal_is_401(raw):
    err = raises(401, pas._decode_azure_principal, raw)
    assert err.detail == "Malformed proxy identity header."


# ── _first_claim / _claim_values ────────────────────────────────────────────


def test_first_claim_takes_the_first_usable_candidate_in_order():
    claims = {"b": "  second ", "c": "third"}
    assert pas._first_claim(claims, ("a", "b", "c")) == "second"
    assert pas._first_claim(claims, ("c", "b")) == "third"


def test_first_claim_skips_blank_empty_and_non_string_values():
    claims = {"blank": "   ", "empty": [], "num": 5, "list": ["  x ", "y"], "none": None}
    assert pas._first_claim(claims, ("blank", "empty", "num", "none", "list")) == "x"
    assert pas._first_claim(claims, ("blank", "empty", "num", "none")) == ""
    assert pas._first_claim({}, ()) == ""


def test_first_claim_does_not_look_past_a_list_head():
    assert pas._first_claim({"l": ["  ", "later"]}, ("l",)) == ""


def test_claim_values_normalises_both_shapes():
    claims = {"s": " admin ", "l": [" a ", "", 3, "b", "  "], "blank": "  ", "n": 7}
    assert pas._claim_values(claims, "s") == ("admin",)
    assert pas._claim_values(claims, "l") == ("a", "b")
    assert pas._claim_values(claims, "blank") == ()
    assert pas._claim_values(claims, "n") == ()
    assert pas._claim_values(claims, "missing") == ()
    assert pas._claim_values(claims, "") == ()


# ── map_role ────────────────────────────────────────────────────────────────


def test_map_role_takes_the_first_match_in_map_order(cfg):
    cfg(PROXY_AUTH_ROLE_MAP=[("ea-admins", "admin"), ("ea-users", "member")])
    assert pas.map_role(("EA-Users", "ea-admins")) == "admin"
    assert pas.map_role(("ea-users",)) == "member"
    assert pas.map_role(("other",)) is None
    assert pas.map_role(()) is None


# ── _verify_forwarded_id_token ──────────────────────────────────────────────


@pytest.mark.parametrize(
    "missing", ["PROXY_AUTH_ISSUER", "PROXY_AUTH_AUDIENCE", "PROXY_AUTH_JWKS_URI"]
)
def test_token_verification_needs_all_three_settings(cfg, monkeypatch, missing):
    cfg(**{missing: ""})
    monkeypatch.setattr(sso_service, "verify_id_token", lambda *a: pytest.fail("verified"))
    err = raises(500, pas._verify_forwarded_id_token, "tok")
    assert err.detail == (
        "Proxy id-token verification is enabled but incomplete. Set "
        "TURBO_EA_PROXY_AUTH_ISSUER, TURBO_EA_PROXY_AUTH_AUDIENCE and "
        "TURBO_EA_PROXY_AUTH_JWKS_URI."
    )


def test_token_verification_uses_the_proxy_settings_not_sso(cfg, monkeypatch):
    seen = []
    monkeypatch.setattr(sso_service, "verify_id_token", lambda *a: seen.append(a) or {"email": "x"})
    assert pas._verify_forwarded_id_token("tok") == {"email": "x"}
    assert seen == [("tok", "aud-1", "https://issuer.example/jwks", "https://issuer.example")]


def test_an_http_error_from_verification_passes_through(cfg, monkeypatch):
    def fail(*a):
        raise HTTPException(418, "teapot")

    monkeypatch.setattr(sso_service, "verify_id_token", fail)
    assert raises(418, pas._verify_forwarded_id_token, "tok").detail == "teapot"


def test_any_other_verification_error_is_401_and_logged(cfg, monkeypatch, caplog):
    def fail(*a):
        raise ValueError("bad signature")

    monkeypatch.setattr(sso_service, "verify_id_token", fail)
    with caplog.at_level("WARNING", logger=pas.__name__):
        err = raises(401, pas._verify_forwarded_id_token, "tok")
    assert err.detail == "Proxy identity token could not be verified."
    assert isinstance(err.__cause__, ValueError)
    assert [r.getMessage() for r in caplog.records] == [
        "Proxy id-token verification failed: bad signature"
    ]


# ── _check_domain ───────────────────────────────────────────────────────────


def test_an_allowed_domain_passes_case_insensitively(cfg):
    assert pas._check_domain("alice@EXAMPLE.com") is None
    # only the part after the LAST @ is the domain
    assert pas._check_domain("odd@evil.com@example.com") is None


def test_an_address_without_an_at_sign_is_judged_whole(cfg):
    raises(403, pas._check_domain, "example.com.evil")
    cfg(PROXY_AUTH_ALLOWED_DOMAINS=["localhost"])
    assert pas._check_domain("LOCALHOST") is None


def test_another_domain_is_403(cfg):
    err = raises(403, pas._check_domain, "alice@example.com.evil.net")
    assert err.detail == "Sign-in is restricted to approved email domains."
    raises(403, pas._check_domain, "alice@example.com@evil.net")


def test_no_allowlist_is_a_misconfiguration_unless_waived(cfg):
    cfg(PROXY_AUTH_ALLOWED_DOMAINS=[])
    err = raises(500, pas._check_domain, "alice@example.com")
    assert err.detail == (
        "Proxy authentication is enabled without an email-domain allowlist. Set "
        "TURBO_EA_PROXY_AUTH_ALLOWED_DOMAINS, or "
        "TURBO_EA_PROXY_AUTH_ALLOW_ANY_DOMAIN=true to accept any domain."
    )
    cfg(PROXY_AUTH_ALLOW_ANY_DOMAIN=True)
    assert pas._check_domain("anyone@anywhere.org") is None


# ── resolve_identity: header mode ───────────────────────────────────────────


def test_header_mode_reads_the_configured_headers(cfg):
    ident = pas.resolve_identity(
        request(
            **{
                "X-Forwarded-Email": "  Alice@Example.COM ",
                "X-Forwarded-User": " Alice A ",
                "X-Forwarded-Subject": " sub-1 ",
                "X-Forwarded-Groups": " g1, ,g2 ,",
            }
        )
    )
    assert ident.email == "alice@example.com"
    assert ident.display_name == "Alice A"
    assert ident.subject_id == "sub-1"
    assert ident.roles == ("g1", "g2")
    assert ident.verified is False
    assert ident.email_verified is None


def test_header_mode_defaults_name_and_subject_from_the_email(cfg):
    ident = pas.resolve_identity(request(**{"X-Forwarded-Email": "bob@example.com"}))
    assert ident.display_name == "bob"
    assert ident.subject_id == "proxy:bob@example.com"
    assert ident.roles == ()


def test_header_mode_follows_renamed_headers(cfg):
    cfg(
        PROXY_AUTH_EMAIL_HEADER="X-Mail",
        PROXY_AUTH_NAME_HEADER="X-Nm",
        PROXY_AUTH_SUBJECT_HEADER="X-Sub",
        PROXY_AUTH_ROLE_HEADER="X-Roles",
    )
    ident = pas.resolve_identity(
        request(**{"X-Mail": "c@example.com", "X-Nm": "C", "X-Sub": "9", "X-Roles": "r"})
    )
    assert (ident.email, ident.display_name, ident.subject_id, ident.roles) == (
        "c@example.com",
        "C",
        "9",
        ("r",),
    )


def test_header_mode_refuses_token_verification(cfg):
    cfg(PROXY_AUTH_VERIFY_ID_TOKEN=True)
    err = raises(500, pas.resolve_identity, request(**{"X-Forwarded-Email": "a@example.com"}))
    assert err.detail == (
        "Proxy id-token verification is only supported in azure_easyauth mode. "
        "Turn off TURBO_EA_PROXY_AUTH_VERIFY_ID_TOKEN for header mode."
    )


@pytest.mark.parametrize("email", [None, "", "   "])
def test_no_email_is_401(cfg, email):
    headers = {} if email is None else {"X-Forwarded-Email": email}
    err = raises(401, pas.resolve_identity, request(**headers))
    assert err.detail == "The proxy asserted no email address for this user."


def test_header_mode_applies_the_domain_allowlist(cfg):
    raises(403, pas.resolve_identity, request(**{"X-Forwarded-Email": "a@evil.net"}))


# ── resolve_identity: Azure EasyAuth ────────────────────────────────────────


def test_azure_reads_the_principal_header(cfg):
    cfg(PROXY_AUTH_MODE="azure_easyauth")
    raw = principal(
        ("http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress", "D@Example.com"),
        ("name", "Dee"),
        ("http://schemas.microsoft.com/identity/claims/objectidentifier", "oid-9"),
        ("roles", "r1"),
        ("roles", "r2"),
    )
    ident = pas.resolve_identity(request(**{pas.AZURE_PRINCIPAL_HEADER: raw}))
    assert (ident.email, ident.display_name, ident.subject_id) == ("d@example.com", "Dee", "oid-9")
    assert ident.roles == ("r1", "r2")
    assert ident.verified is False


def test_azure_falls_back_to_the_scalar_headers_for_name_and_subject(cfg):
    cfg(PROXY_AUTH_MODE="azure_easyauth")
    raw = principal(("email", "e@example.com"))
    ident = pas.resolve_identity(
        request(
            **{
                pas.AZURE_PRINCIPAL_HEADER: raw,
                pas.AZURE_ID_HEADER: " id-7 ",
                pas.AZURE_NAME_HEADER: " e@tenant.onmicrosoft.com ",
            }
        )
    )
    assert ident.subject_id == "id-7"
    assert ident.display_name == "e@tenant.onmicrosoft.com"


def test_azure_claims_win_over_the_scalar_headers(cfg):
    cfg(PROXY_AUTH_MODE="azure_easyauth")
    raw = principal(("email", "e@example.com"), ("name", "Claimed"), ("sub", "claimed-sub"))
    ident = pas.resolve_identity(
        request(
            **{
                pas.AZURE_PRINCIPAL_HEADER: raw,
                pas.AZURE_ID_HEADER: "header-id",
                pas.AZURE_NAME_HEADER: "header-name",
            }
        )
    )
    assert (ident.display_name, ident.subject_id) == ("Claimed", "claimed-sub")


def test_azure_never_takes_the_upn_header_as_an_email(cfg):
    cfg(PROXY_AUTH_MODE="azure_easyauth")
    req = request(**{pas.AZURE_NAME_HEADER: "alice@example.com"})
    raises(401, pas.resolve_identity, req)


def test_azure_reads_the_configured_role_claim(cfg):
    cfg(PROXY_AUTH_MODE="azure_easyauth", PROXY_AUTH_ROLE_CLAIM="groups")
    raw = principal(("email", "e@example.com"), ("roles", "ignored"), ("groups", "g"))
    assert pas.resolve_identity(request(**{pas.AZURE_PRINCIPAL_HEADER: raw})).roles == ("g",)


def test_azure_ignores_the_principal_when_verifying(cfg, monkeypatch):
    cfg(PROXY_AUTH_MODE="azure_easyauth", PROXY_AUTH_VERIFY_ID_TOKEN=True)
    seen = []
    monkeypatch.setattr(
        sso_service,
        "verify_id_token",
        lambda *a: (
            seen.append(a)
            or {"email": "V@Example.com", "name": "Verified", "oid": "o1", "roles": ["x"]}
        ),
    )
    forged = principal(("email", "evil@example.com"))
    ident = pas.resolve_identity(
        request(
            **{
                pas.AZURE_ID_TOKEN_HEADER: "tok",
                pas.AZURE_PRINCIPAL_HEADER: forged,
                pas.AZURE_ID_HEADER: "header-id",
                pas.AZURE_NAME_HEADER: "header-name",
            }
        )
    )
    assert ident.email == "v@example.com"
    assert ident.verified is True
    assert (ident.display_name, ident.subject_id, ident.roles) == ("Verified", "o1", ("x",))
    assert [a[0] for a in seen] == ["tok"]  # the forwarded token is what gets verified


def test_verified_identity_does_not_borrow_the_scalar_headers(cfg, monkeypatch):
    cfg(PROXY_AUTH_MODE="azure_easyauth", PROXY_AUTH_VERIFY_ID_TOKEN=True)
    monkeypatch.setattr(sso_service, "verify_id_token", lambda *a: {"email": "v@example.com"})
    ident = pas.resolve_identity(
        request(
            **{
                pas.AZURE_ID_TOKEN_HEADER: "tok",
                pas.AZURE_ID_HEADER: "header-id",
                pas.AZURE_NAME_HEADER: "header-name",
            }
        )
    )
    assert ident.subject_id == "proxy:v@example.com"
    assert ident.display_name == "v"


def test_verification_without_a_token_fails_closed(cfg, monkeypatch):
    cfg(PROXY_AUTH_MODE="azure_easyauth", PROXY_AUTH_VERIFY_ID_TOKEN=True)
    monkeypatch.setattr(sso_service, "verify_id_token", lambda *a: pytest.fail("verified"))
    forged = principal(("email", "evil@example.com"))
    err = raises(401, pas.resolve_identity, request(**{pas.AZURE_PRINCIPAL_HEADER: forged}))
    assert err.detail == (
        "Proxy id-token verification is enabled but the proxy forwarded no "
        "token. Enable the App Service token store, or turn off "
        "TURBO_EA_PROXY_AUTH_VERIFY_ID_TOKEN."
    )


@pytest.mark.parametrize("value, refused", [(False, True), (True, False), ("false", False)])
def test_an_unverified_email_claim_is_refused(cfg, monkeypatch, value, refused):
    """Only a literal False refuses; the claim is passed on as found."""
    cfg(PROXY_AUTH_MODE="azure_easyauth", PROXY_AUTH_VERIFY_ID_TOKEN=True)
    monkeypatch.setattr(
        sso_service,
        "verify_id_token",
        lambda *a: {"email": "v@example.com", "email_verified": value},
    )
    req = request(**{pas.AZURE_ID_TOKEN_HEADER: "tok"})
    if refused:
        err = raises(403, pas.resolve_identity, req)
        assert err.detail == "Your email address is not verified with the identity provider."
    else:
        assert pas.resolve_identity(req).email_verified == value


def test_azure_without_any_principal_has_no_email(cfg):
    cfg(PROXY_AUTH_MODE="azure_easyauth")
    err = raises(401, pas.resolve_identity, request())
    assert err.detail == "The proxy asserted no email address for this user."


def test_azure_without_scalar_headers_derives_name_and_subject_from_the_email(cfg):
    cfg(PROXY_AUTH_MODE="azure_easyauth")
    raw = principal(("email", "e@example.com"))
    ident = pas.resolve_identity(request(**{pas.AZURE_PRINCIPAL_HEADER: raw}))
    assert ident.subject_id == "proxy:e@example.com"
    assert ident.display_name == "e"
