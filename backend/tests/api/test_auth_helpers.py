"""The helpers behind the sign-in routes in ``app/api/v1/auth.py``.

The route handlers are decorated, so mutation testing never reaches them;
everything that decides *who* gets a session, *with which role* and *on what
cookie* lives in these plain functions instead. They are tested directly here,
with exact values: the cookie attributes are the app's XSS and CSRF controls
(CLAUDE.md, "The browser never holds the JWT"), and the provisioning rules are
what stop a forged proxy header from minting or upgrading an account.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone

import pytest
from fastapi import HTTPException, Response
from sqlalchemy import select
from starlette.requests import Request

from app.api.v1 import auth
from app.config import settings
from app.core.security import decode_access_token
from app.models.role import Role
from app.models.sso_invitation import SsoInvitation
from app.models.user import User
from app.services import proxy_auth_service
from tests.conftest import create_role, create_user


def request(scheme: str = "http", host: str = "ea.example", **headers: str) -> Request:
    return Request(
        {
            "type": "http",
            "scheme": scheme,
            "server": (host, 443 if scheme == "https" else 80),
            "path": "/api/v1/auth/login",
            "root_path": "",
            "query_string": b"",
            "headers": [(k.lower().encode(), v.encode()) for k, v in headers.items()],
        }
    )


def set_cookie(response: Response) -> str:
    (header,) = [v for k, v in response.raw_headers if k == b"set-cookie"]
    return header.decode()


# ── secure-request detection and the session cookie ─────────────────────────


@pytest.mark.parametrize(
    "scheme, proto, secure",
    [
        ("http", None, False),
        ("https", None, True),
        ("http", "https", True),
        ("https", "http", True),
        ("http", "http", False),
        ("http", "HTTPS", False),
        ("http", "https, http", False),
    ],
)
def test_is_secure_request(scheme, proto, secure):
    headers = {} if proto is None else {"X-Forwarded-Proto": proto}
    assert auth._is_secure_request(request(scheme, **headers)) is secure


@pytest.mark.parametrize("secure", [True, False])
def test_the_auth_cookie_attributes(monkeypatch, secure):
    monkeypatch.setattr(settings, "ACCESS_TOKEN_EXPIRE_MINUTES", 90)
    response = Response()
    auth._set_auth_cookie(response, "jwt-value", secure=secure)
    expected = "access_token=jwt-value; HttpOnly; Max-Age=5400; Path=/api; SameSite=lax"
    if secure:
        expected += "; Secure"
    assert set_cookie(response) == expected


@pytest.mark.parametrize("secure", [True, False])
def test_clearing_the_auth_cookie_matches_its_attributes(secure):
    response = Response()
    auth._clear_auth_cookie(response, secure=secure)
    header = set_cookie(response)
    assert header.startswith('access_token=""; expires=')
    parts = header.split("; ")
    assert "HttpOnly" in parts and "Max-Age=0" in parts and "Path=/api" in parts
    assert "SameSite=lax" in parts
    assert ("Secure" in parts) is secure


# ── _issue_session ──────────────────────────────────────────────────────────


def user(**overrides) -> User:
    fields = {
        "id": uuid.uuid4(),
        "email": "u@example.com",
        "display_name": "U",
        "role": "member",
        "is_active": True,
        "access_expires_at": None,
    }
    fields.update(overrides)
    return User(**fields)


def test_issue_session_mints_a_token_for_the_user_and_sets_the_cookie():
    person = user(role="viewer")
    response = Response()
    token = auth._issue_session(request("https"), response, person)
    claims = decode_access_token(token.access_token)
    assert claims["sub"] == str(person.id) and claims["role"] == "viewer"
    cookie = set_cookie(response)
    assert cookie.startswith(f"access_token={token.access_token}; ")
    assert cookie.endswith("; Secure")


def test_issue_session_follows_the_request_scheme_for_secure():
    response = Response()
    auth._issue_session(request("http"), response, user())
    assert "Secure" not in set_cookie(response).split("; ")


def test_a_disabled_account_gets_no_session():
    response = Response()
    with pytest.raises(HTTPException) as exc:
        auth._issue_session(request(), response, user(is_active=False))
    assert (exc.value.status_code, exc.value.detail) == (403, "Account disabled")
    assert not [k for k, _ in response.raw_headers if k == b"set-cookie"]


def test_an_expired_account_gets_no_session():
    past = datetime.now(timezone.utc) - timedelta(minutes=1)
    with pytest.raises(HTTPException) as exc:
        auth._issue_session(request(), Response(), user(access_expires_at=past))
    assert (exc.value.status_code, exc.value.detail) == (403, "Account access has expired")


def test_an_account_expiring_later_still_gets_a_session():
    future = datetime.now(timezone.utc) + timedelta(minutes=5)
    assert auth._issue_session(request(), Response(), user(access_expires_at=future)).access_token


def test_the_expiry_instant_itself_still_gets_a_session(monkeypatch):
    """Expired means strictly past, the rule ``get_current_user`` applies to the
    token right after; a stricter check here would refuse a session the rest
    of the app still honours."""
    instant = datetime(2026, 1, 1, 12, 0, tzinfo=timezone.utc)

    class Frozen(datetime):
        @classmethod
        def now(cls, tz=None):
            return instant

    monkeypatch.setattr(auth, "datetime", Frozen)
    assert auth._issue_session(request(), Response(), user(access_expires_at=instant)).access_token


# ── emailed links ───────────────────────────────────────────────────────────


def test_the_base_url_prefers_the_configured_one(monkeypatch):
    monkeypatch.setattr(settings, "_app_base_url", "https://ea.corp.example/", raising=False)
    assert auth._resolve_app_base_url(request()) == "https://ea.corp.example"


@pytest.mark.parametrize("configured", ["", None])
def test_the_base_url_falls_back_to_the_request(monkeypatch, configured):
    monkeypatch.setattr(settings, "_app_base_url", configured, raising=False)
    assert auth._resolve_app_base_url(request("https", host="direct.example")) == (
        "https://direct.example"
    )


def test_the_base_url_strips_only_the_trailing_slash(monkeypatch):
    monkeypatch.setattr(settings, "_app_base_url", "https://ea.exampleX/", raising=False)
    assert auth._resolve_app_base_url(request()) == "https://ea.exampleX"
    monkeypatch.setattr(settings, "_app_base_url", "", raising=False)
    assert auth._resolve_app_base_url(request("http", host="hostX")) == "http://hostX"


RESET_HTML = (
    '<div style="font-family: sans-serif; max-width: 600px; margin: 0 auto">'
    '<div style="background: #1a1a2e; padding: 16px 24px">'
    '<h2 style="color:#64b5f6;margin:0">Turbo &amp; EA</h2></div>'
    '<div style="padding: 24px; border: 1px solid #e0e0e0">'
    '<p style="color:#333">Hi Ann &lt;b&gt;,</p>'
    '<p style="color:#555">We received a request to reset the password for your '
    "Turbo &amp; EA account. Click the button below to choose a new password. "
    "This link is valid for one hour.</p>"
    "<a href='https://ea.example/reset?t=a&amp;b' style='display: inline-block; "
    "margin-top: 12px; padding: 10px 18px; background: #1976d2; color: white; "
    "text-decoration: none; border-radius: 4px;'>Reset password</a>"
    '<p style="color:#777;font-size:12px;margin-top:24px">'
    "If you didn't request a password reset, you can safely ignore this email — "
    "your password will not change.</p>"
    "</div></div>"
)
RESET_TEXT = (
    # the plain-text greeting reuses the HTML-escaped name (as the code stands)
    "Hi Ann &lt;b&gt;,\n\n"
    "We received a request to reset the password for your Turbo & EA account.\n"
    "Open the link below to choose a new password (valid for one hour):\n\n"
    "https://ea.example/reset?t=a&b\n\n"
    "If you didn't request a password reset, you can safely ignore this email."
)


def test_the_reset_email_body():
    """Pinned whole: a change to an email users receive should show in review."""
    body_html, body_text = auth._build_reset_email_body(
        "Ann <b>", "Turbo & EA", "https://ea.example/reset?t=a&b"
    )
    assert body_html == RESET_HTML
    assert body_text == RESET_TEXT


SETUP_HTML = (
    '<div style="font-family: sans-serif; max-width: 600px; margin: 0 auto">'
    '<div style="background: #1a1a2e; padding: 16px 24px">'
    '<h2 style="color:#64b5f6;margin:0">Turbo EA</h2></div>'
    '<div style="padding: 24px; border: 1px solid #e0e0e0">'
    '<p style="color:#333">Hi,</p>'
    '<p style="color:#555">Your Turbo EA account is ready. '
    "Click the button below to set your password and sign in.</p>"
    "<a href='https://ea.example/setup?t=x' style='display: inline-block; "
    "margin-top: 12px; padding: 10px 18px; background: #1976d2; color: white; "
    "text-decoration: none; border-radius: 4px;'>Set password</a>"
    '<p style="color:#777;font-size:12px;margin-top:24px">'
    "If you didn't expect this email, you can safely ignore it.</p>"
    "</div></div>"
)
SETUP_TEXT = (
    "Hi,\n\n"
    "Your Turbo EA account is ready.\n"
    "Open the link below to set your password and sign in:\n\n"
    "https://ea.example/setup?t=x\n\n"
    "If you didn't expect this email, you can safely ignore it."
)


@pytest.mark.parametrize("name", ["", None])
def test_the_setup_email_body_without_a_name(name):
    body_html, body_text = auth._build_setup_email_body(
        name, "Turbo EA", "https://ea.example/setup?t=x"
    )
    assert body_html == SETUP_HTML
    assert body_text == SETUP_TEXT


def test_the_setup_email_greets_by_escaped_name():
    body_html, body_text = auth._build_setup_email_body("<i>Bo</i>", "T", "https://x")
    assert '<p style="color:#333">Hi &lt;i&gt;Bo&lt;/i&gt;,</p>' in body_html
    assert body_text.startswith("Hi &lt;i&gt;Bo&lt;/i&gt;,\n\n")


def test_the_reset_email_without_a_name():
    body_html, body_text = auth._build_reset_email_body("", "T", "https://x")
    assert '<p style="color:#333">Hi,</p>' in body_html
    assert body_text.startswith("Hi,\n\n")


def test_setup_tokens_are_long_and_unique():
    tokens = {auth.generate_setup_token() for _ in range(20)}
    assert len(tokens) == 20
    assert all(len(t) == 64 for t in tokens)  # 48 random bytes, url-safe base64


# ── _provision_federated_user ───────────────────────────────────────────────


async def provision(db, **overrides):
    args = {
        "email": "fed@example.com",
        "subject_id": "sub-1",
        "display_name": "Fed User",
        "allow_create": True,
        "honour_invitation": True,
    }
    args.update(overrides)
    return await auth._provision_federated_user(db, **args)


@pytest.fixture
async def roles(db):
    await create_role(db, key="member", label="Member", permissions={})
    await create_role(db, key="admin", label="Admin", permissions={"*": True})
    await create_role(db, key="viewer", label="Viewer", permissions={})


async def test_a_known_subject_signs_in_its_own_user(db, roles):
    existing = await create_user(db, email="other@example.com")
    existing.auth_provider = "sso"
    existing.sso_subject_id = "sub-1"
    await db.flush()
    assert (await provision(db)).id == existing.id


async def test_a_federated_user_found_by_email_is_linked(db, roles):
    existing = await create_user(db, email="fed@example.com", role="viewer")
    existing.auth_provider = "sso"
    existing.display_name = ""
    existing.password_setup_token = "pending"
    await db.flush()
    db.add(SsoInvitation(email="fed@example.com", role="admin"))
    await db.flush()
    before = datetime.now(timezone.utc)
    linked = await provision(db, subject_id="sub-new")
    assert linked.id == existing.id
    assert linked.sso_subject_id == "sub-new"
    assert linked.display_name == "Fed User"
    assert linked.password_setup_token is None
    assert linked.last_login >= before
    assert linked.role == "viewer"  # linking never takes the invitation's role
    left = (await db.execute(select(SsoInvitation))).scalars().all()
    assert left == []


async def test_linking_keeps_an_existing_display_name(db, roles):
    existing = await create_user(db, email="fed@example.com")
    existing.auth_provider = "sso"
    existing.display_name = "Chosen Name"
    await db.flush()
    assert (await provision(db)).display_name == "Chosen Name"


async def test_a_local_account_is_never_merged(db, roles):
    await create_user(db, email="fed@example.com")  # auth_provider="local"
    with pytest.raises(HTTPException) as exc:
        await provision(db)
    assert exc.value.status_code == 409
    assert exc.value.detail == (
        "A local account with this email already exists. "
        "Contact an administrator to link your SSO account."
    )


async def test_without_allow_create_no_account_is_minted(db, roles):
    with pytest.raises(HTTPException) as exc:
        await provision(db, allow_create=False)
    assert exc.value.status_code == 403
    assert exc.value.detail == (
        "No Turbo EA account exists for this identity, and one cannot be created "
        "automatically from an unverified proxy header. Ask an administrator to "
        "invite you, or enable identity-token verification on this instance."
    )
    assert (await db.execute(select(User))).scalars().all() == []


async def test_a_new_user_gets_the_default_role(db, roles):
    before = datetime.now(timezone.utc)
    created = await provision(db)
    assert (created.email, created.display_name, created.role) == (
        "fed@example.com",
        "Fed User",
        "member",
    )
    assert created.auth_provider == "sso"
    assert created.sso_subject_id == "sub-1"
    assert created.password_hash is None
    assert created.last_login >= before


async def test_a_new_user_without_a_name_is_named_after_the_mailbox(db, roles):
    assert (await provision(db, display_name="")).display_name == "fed"


async def test_the_admin_configured_default_role_is_used(db, roles):
    viewer = (await db.execute(select(Role).where(Role.key == "viewer"))).scalar_one()
    viewer.is_default = True
    await db.flush()
    assert (await provision(db)).role == "viewer"


async def test_an_archived_default_role_falls_back_to_member(db, roles):
    viewer = (await db.execute(select(Role).where(Role.key == "viewer"))).scalar_one()
    viewer.is_default = True
    viewer.is_archived = True
    await db.flush()
    assert (await provision(db)).role == "member"


async def test_an_invitation_sets_the_role_and_is_consumed(db, roles):
    db.add(SsoInvitation(email="fed@example.com", role="admin"))
    await db.flush()
    assert (await provision(db)).role == "admin"
    assert (await db.execute(select(SsoInvitation))).scalars().all() == []


async def test_an_invitation_is_ignored_when_not_honoured(db, roles):
    db.add(SsoInvitation(email="fed@example.com", role="admin"))
    await db.flush()
    assert (await provision(db, honour_invitation=False)).role == "member"
    assert len((await db.execute(select(SsoInvitation))).scalars().all()) == 1


async def test_an_invitation_for_another_address_is_ignored(db, roles):
    db.add(SsoInvitation(email="someone@example.com", role="admin"))
    await db.flush()
    assert (await provision(db)).role == "member"


# ── _is_bootstrap_admin / _resolve_proxy_role ───────────────────────────────


@pytest.mark.parametrize(
    "configured, email, expected",
    [
        ("boss@example.com", "boss@example.com", True),
        ("  Boss@Example.COM ", "boss@example.com", True),
        ("boss@example.com", "Boss@example.com", False),  # callers pass it lower-cased
        ("boss@example.com", "other@example.com", False),
        ("", "", False),
        ("   ", "", False),
    ],
)
def test_is_bootstrap_admin(monkeypatch, configured, email, expected):
    monkeypatch.setattr(settings, "PROXY_AUTH_BOOTSTRAP_ADMIN_EMAIL", configured)
    assert auth._is_bootstrap_admin(email) is expected


def identity(*roles: str, verified: bool = True, email: str = "p@example.com"):
    return proxy_auth_service.ProxyIdentity(
        email=email,
        display_name="P",
        subject_id="s",
        verified=verified,
        email_verified=None,
        roles=roles,
    )


@pytest.fixture
def role_map(monkeypatch):
    monkeypatch.setattr(settings, "PROXY_AUTH_BOOTSTRAP_ADMIN_EMAIL", "")
    monkeypatch.setattr(settings, "PROXY_AUTH_SHARED_SECRET", "")
    monkeypatch.setattr(
        settings, "PROXY_AUTH_ROLE_MAP", [("ea-admins", "admin"), ("ea-gone", "retired")]
    )


async def test_the_bootstrap_admin_always_wins(db, roles, role_map, monkeypatch):
    monkeypatch.setattr(settings, "PROXY_AUTH_BOOTSTRAP_ADMIN_EMAIL", "p@example.com")
    assert await auth._resolve_proxy_role(db, identity(verified=False)) == "admin"


async def test_no_map_or_no_claim_changes_nothing(db, roles, role_map, monkeypatch):
    assert await auth._resolve_proxy_role(db, identity()) is None
    monkeypatch.setattr(settings, "PROXY_AUTH_ROLE_MAP", [])
    assert await auth._resolve_proxy_role(db, identity("ea-admins")) is None


async def test_an_untrusted_identity_is_granted_nothing(db, roles, role_map, caplog):
    with caplog.at_level("WARNING", logger=auth.logger.name):
        assert await auth._resolve_proxy_role(db, identity("ea-admins", verified=False)) is None
    assert [r.getMessage() for r in caplog.records if r.name == auth.logger.name] == [
        "Ignoring TURBO_EA_PROXY_AUTH_ROLE_MAP for p@example.com: the identity was neither "
        "signature-verified nor accompanied by a shared secret."
    ]


async def test_a_shared_secret_makes_the_identity_trusted(db, roles, role_map, monkeypatch):
    monkeypatch.setattr(settings, "PROXY_AUTH_SHARED_SECRET", "s")
    assert await auth._resolve_proxy_role(db, identity("ea-admins", verified=False)) == "admin"


async def test_a_mapped_role_is_returned(db, roles, role_map):
    assert await auth._resolve_proxy_role(db, identity("EA-Admins")) == "admin"


async def test_an_unmatched_value_falls_back_to_the_default_role(db, roles, role_map):
    assert await auth._resolve_proxy_role(db, identity("unknown-group")) == "member"


async def test_an_undefined_target_falls_back_and_says_so(db, roles, role_map, caplog):
    with caplog.at_level("WARNING", logger=auth.logger.name):
        assert await auth._resolve_proxy_role(db, identity("ea-gone")) == "member"
    assert [r.getMessage() for r in caplog.records if r.name == auth.logger.name] == [
        "TURBO_EA_PROXY_AUTH_ROLE_MAP points at role 'retired', which is not defined. "
        "Falling back to the default role."
    ]


async def test_an_archived_target_falls_back_and_says_so(db, roles, role_map, caplog):
    await create_role(db, key="retired", label="Retired", permissions={})
    retired = (await db.execute(select(Role).where(Role.key == "retired"))).scalar_one()
    retired.is_archived = True
    await db.flush()
    with caplog.at_level("WARNING", logger=auth.logger.name):
        assert await auth._resolve_proxy_role(db, identity("ea-gone")) == "member"
    assert [r.getMessage() for r in caplog.records if r.name == auth.logger.name] == [
        "TURBO_EA_PROXY_AUTH_ROLE_MAP points at role 'retired', which is archived. "
        "Falling back to the default role."
    ]


# ── _local_login_available ──────────────────────────────────────────────────


async def test_local_login_is_available_only_with_an_active_local_account(db, roles):
    assert await auth._local_login_available(db) is False
    fed = await create_user(db, email="sso@example.com")
    fed.auth_provider = "sso"
    await db.flush()
    assert await auth._local_login_available(db) is False
    local = await create_user(db, email="local@example.com")
    local.is_active = False
    await db.flush()
    assert await auth._local_login_available(db) is False
    local.is_active = True
    await db.flush()
    assert await auth._local_login_available(db) is True
