"""Tests for trusted reverse-proxy authentication (#1006).

The security-relevant assertions here are the ones about what an *unverified*
header may do. The seeded default role is ``member``, which can create, edit and
archive across the whole inventory, so "a forged header only gets you a member"
is not a mitigation — hence the tests that no user row is written on the
unverified path, and that a pending invitation confers nothing.

Gated features are enabled by patching the settings attribute rather than the env
var, because settings are read at class-definition time (same pattern as
``test_ops.py``).
"""

from __future__ import annotations

import base64
import json

import pytest
from sqlalchemy import func, select

from app.config import settings
from app.models.user import User
from tests.conftest import create_role, create_user


async def create_federated_user(db, *, email, role="member", subject_id=None):
    """An already-provisioned federated account.

    ``create_user`` seeds ``auth_provider="local"``, which correctly trips the
    no-auto-merge rule, so it cannot stand in for a user who already signs in
    through the proxy.
    """
    user = await create_user(db, email=email, role=role)
    user.auth_provider = "sso"
    user.password_hash = None
    user.sso_subject_id = subject_id
    return user


SECRET = "proxy-shared-secret-value"
SECRET_HEADER = "X-Turbo-EA-Proxy-Secret"
ENDPOINT = "/api/v1/auth/proxy/session"


def azure_principal(**claims: str) -> str:
    """Build an App Service style base64 principal header."""
    payload = {
        "auth_typ": "aad",
        "claims": [{"typ": typ, "val": val} for typ, val in claims.items()],
    }
    return base64.b64encode(json.dumps(payload).encode()).decode()


@pytest.fixture
def proxy_enabled(monkeypatch):
    """Turn on proxy auth in header mode with a shared secret and an allowlist."""
    monkeypatch.setattr(settings, "PROXY_AUTH_ENABLED", True)
    monkeypatch.setattr(settings, "PROXY_AUTH_MODE", "header")
    monkeypatch.setattr(settings, "PROXY_AUTH_SHARED_SECRET", SECRET)
    monkeypatch.setattr(settings, "PROXY_AUTH_SECRET_HEADER", SECRET_HEADER)
    monkeypatch.setattr(settings, "PROXY_AUTH_VERIFY_ID_TOKEN", False)
    monkeypatch.setattr(settings, "PROXY_AUTH_ALLOWED_DOMAINS", ["example.com"])
    monkeypatch.setattr(settings, "PROXY_AUTH_ALLOW_ANY_DOMAIN", False)
    monkeypatch.setattr(settings, "PROXY_AUTH_BOOTSTRAP_ADMIN_EMAIL", "")
    monkeypatch.setattr(settings, "PROXY_AUTH_TRUST_PLATFORM_HEADERS", False)


def hdrs(email: str = "alice@example.com", **extra: str) -> dict:
    base = {SECRET_HEADER: SECRET, "X-Forwarded-Email": email}
    base.update(extra)
    return base


# ---------------------------------------------------------------------------
# Gating
# ---------------------------------------------------------------------------


async def test_404_when_feature_disabled(client, monkeypatch):
    """Off by default, and invisible when off — same posture as the ops API."""
    monkeypatch.setattr(settings, "PROXY_AUTH_ENABLED", False)
    response = await client.post(ENDPOINT, headers=hdrs())
    assert response.status_code == 404


async def test_missing_shared_secret_is_rejected(client, proxy_enabled):
    response = await client.post(ENDPOINT, headers={"X-Forwarded-Email": "alice@example.com"})
    assert response.status_code == 401


async def test_wrong_shared_secret_is_rejected(client, proxy_enabled):
    response = await client.post(
        ENDPOINT,
        headers={SECRET_HEADER: "not-the-secret", "X-Forwarded-Email": "alice@example.com"},
    )
    assert response.status_code == 401


async def test_secret_is_checked_before_any_identity_is_parsed(client, db, proxy_enabled):
    """A forged principal must not even reach the decoder, let alone the database."""
    before = (await db.execute(select(func.count(User.id)))).scalar()
    response = await client.post(
        ENDPOINT,
        headers={SECRET_HEADER: "wrong", "X-Forwarded-Email": "attacker@example.com"},
    )
    assert response.status_code == 401
    assert (await db.execute(select(func.count(User.id)))).scalar() == before


async def test_enabled_without_any_secret_is_a_configuration_error(client, monkeypatch):
    """Enabling the feature without securing it must fail loudly, not fail open."""
    monkeypatch.setattr(settings, "PROXY_AUTH_ENABLED", True)
    monkeypatch.setattr(settings, "PROXY_AUTH_MODE", "header")
    monkeypatch.setattr(settings, "PROXY_AUTH_SHARED_SECRET", "")
    monkeypatch.setattr(settings, "PROXY_AUTH_TRUST_PLATFORM_HEADERS", False)
    response = await client.post(ENDPOINT, headers={"X-Forwarded-Email": "alice@example.com"})
    assert response.status_code == 500


async def test_no_identity_headers_is_rejected(client, proxy_enabled):
    response = await client.post(ENDPOINT, headers={SECRET_HEADER: SECRET})
    assert response.status_code == 401


# ---------------------------------------------------------------------------
# The core guarantee: an unverified header cannot create an account
# ---------------------------------------------------------------------------


async def test_unverified_header_cannot_create_a_user(client, db, proxy_enabled):
    await create_role(db, key="member")
    await create_federated_user(db, email="someone@example.com")
    await db.commit()
    before = (await db.execute(select(func.count(User.id)))).scalar()

    response = await client.post(ENDPOINT, headers=hdrs("brand-new@example.com"))

    assert response.status_code == 403
    assert (await db.execute(select(func.count(User.id)))).scalar() == before


async def test_unverified_header_signs_in_an_existing_user(client, db, proxy_enabled):
    await create_role(db, key="member")
    await create_federated_user(db, email="alice@example.com")
    await db.commit()

    response = await client.post(ENDPOINT, headers=hdrs("alice@example.com"))

    assert response.status_code == 200
    assert response.json()["access_token"]
    assert "access_token" in response.cookies


async def test_pending_invitation_confers_no_role_on_the_proxy_path(client, db, proxy_enabled):
    """Guessing one invited address must not hand over that invitation's role."""
    from app.models.sso_invitation import SsoInvitation

    await create_role(db, key="member")
    db.add(SsoInvitation(email="incoming-admin@example.com", role="admin"))
    await db.commit()
    before = (await db.execute(select(func.count(User.id)))).scalar()

    response = await client.post(ENDPOINT, headers=hdrs("incoming-admin@example.com"))

    assert response.status_code == 403
    assert (await db.execute(select(func.count(User.id)))).scalar() == before


async def test_local_account_is_not_auto_merged(client, db, proxy_enabled):
    await create_role(db, key="member")
    await create_user(db, email="local@example.com", role="member")
    await db.commit()
    # create_user seeds auth_provider="local"
    response = await client.post(ENDPOINT, headers=hdrs("local@example.com"))
    assert response.status_code == 409


# ---------------------------------------------------------------------------
# Domain and address checks
# ---------------------------------------------------------------------------


async def test_domain_allowlist_rejects_an_outside_domain(client, db, proxy_enabled):
    await create_role(db, key="member")
    await create_federated_user(db, email="guest@partner.example")
    await db.commit()

    response = await client.post(ENDPOINT, headers=hdrs("guest@partner.example"))
    assert response.status_code == 403


async def test_missing_allowlist_is_a_configuration_error(client, monkeypatch, proxy_enabled):
    """No allowlist and no explicit opt-out means refuse, not accept everyone."""
    monkeypatch.setattr(settings, "PROXY_AUTH_ALLOWED_DOMAINS", [])
    monkeypatch.setattr(settings, "PROXY_AUTH_ALLOW_ANY_DOMAIN", False)
    response = await client.post(ENDPOINT, headers=hdrs("alice@example.com"))
    assert response.status_code == 500


async def test_email_is_lowercased_before_matching(client, db, proxy_enabled):
    await create_role(db, key="member")
    await create_federated_user(db, email="mixed@example.com")
    await db.commit()

    response = await client.post(ENDPOINT, headers=hdrs("Mixed@Example.com"))
    assert response.status_code == 200


# ---------------------------------------------------------------------------
# Account state
# ---------------------------------------------------------------------------


async def test_disabled_account_is_refused(client, db, proxy_enabled):
    await create_role(db, key="member")
    user = await create_federated_user(db, email="alice@example.com")
    user.is_active = False
    await db.commit()

    response = await client.post(ENDPOINT, headers=hdrs("alice@example.com"))
    assert response.status_code == 403


async def test_expired_access_does_not_mint_a_doomed_token(client, db, proxy_enabled):
    """``get_current_user`` rejects on ``access_expires_at``.

    Minting a token here anyway would 401 on the very next call, and with an
    auto-signin frontend that is a tight mint/401/retry loop. Refuse up front.
    """
    from datetime import datetime, timedelta, timezone

    await create_role(db, key="member")
    user = await create_federated_user(db, email="alice@example.com")
    user.access_expires_at = datetime.now(timezone.utc) - timedelta(days=1)
    await db.commit()

    response = await client.post(ENDPOINT, headers=hdrs("alice@example.com"))
    assert response.status_code == 403


# ---------------------------------------------------------------------------
# Bootstrap
# ---------------------------------------------------------------------------


async def test_bootstrap_admin_email_creates_the_first_admin(
    client, db, monkeypatch, proxy_enabled
):
    """The configured address is the *only* way this path grants admin.

    Deliberately not "first user on an empty instance": on the proxy path the
    identity can be an unverified header, so that rule would hand admin to
    whoever arrived first.
    """
    monkeypatch.setattr(settings, "PROXY_AUTH_BOOTSTRAP_ADMIN_EMAIL", "founder@example.com")
    await create_role(db, key="member")
    await create_role(db, key="admin")
    await db.commit()

    response = await client.post(ENDPOINT, headers=hdrs("founder@example.com"))

    assert response.status_code == 200
    result = await db.execute(select(User).where(User.email == "founder@example.com"))
    assert result.scalar_one().role == "admin"


async def test_register_is_closed_while_proxy_auth_is_on(client, db, proxy_enabled):
    """Otherwise self-registration stays open, since sso.enabled is false here."""
    await create_role(db, key="member")
    await create_user(db, email="existing@example.com", role="member")
    await db.commit()

    response = await client.post(
        "/api/v1/auth/register",
        json={
            "email": "walkup@example.com",
            "password": "TestPassword1",
            "display_name": "Walk Up",
        },
    )
    assert response.status_code == 403


# ---------------------------------------------------------------------------
# Azure mode
# ---------------------------------------------------------------------------


async def test_azure_principal_header_is_decoded(client, db, monkeypatch):
    monkeypatch.setattr(settings, "PROXY_AUTH_ENABLED", True)
    monkeypatch.setattr(settings, "PROXY_AUTH_MODE", "azure_easyauth")
    monkeypatch.setattr(settings, "PROXY_AUTH_SHARED_SECRET", SECRET)
    monkeypatch.setattr(settings, "PROXY_AUTH_SECRET_HEADER", SECRET_HEADER)
    monkeypatch.setattr(settings, "PROXY_AUTH_VERIFY_ID_TOKEN", False)
    monkeypatch.setattr(settings, "PROXY_AUTH_ALLOWED_DOMAINS", ["example.com"])
    monkeypatch.setattr(settings, "PROXY_AUTH_ALLOW_ANY_DOMAIN", False)
    monkeypatch.setattr(settings, "PROXY_AUTH_BOOTSTRAP_ADMIN_EMAIL", "")

    await create_role(db, key="member")
    await create_federated_user(db, email="alice@example.com", subject_id="oid-123")
    await db.commit()

    principal = azure_principal(email="alice@example.com", name="Alice", oid="oid-123")
    response = await client.post(
        ENDPOINT,
        headers={SECRET_HEADER: SECRET, "X-MS-CLIENT-PRINCIPAL": principal},
    )
    assert response.status_code == 200


async def test_guest_upn_is_not_treated_as_an_email(client, db, monkeypatch):
    """An Entra guest's UPN is not their address; matching on it collides accounts."""
    monkeypatch.setattr(settings, "PROXY_AUTH_ENABLED", True)
    monkeypatch.setattr(settings, "PROXY_AUTH_MODE", "azure_easyauth")
    monkeypatch.setattr(settings, "PROXY_AUTH_SHARED_SECRET", SECRET)
    monkeypatch.setattr(settings, "PROXY_AUTH_SECRET_HEADER", SECRET_HEADER)
    monkeypatch.setattr(settings, "PROXY_AUTH_VERIFY_ID_TOKEN", False)
    monkeypatch.setattr(settings, "PROXY_AUTH_ALLOWED_DOMAINS", ["example.com"])
    monkeypatch.setattr(settings, "PROXY_AUTH_ALLOW_ANY_DOMAIN", False)

    # Principal carrying only a UPN-shaped name header and no email claim.
    response = await client.post(
        ENDPOINT,
        headers={
            SECRET_HEADER: SECRET,
            "X-MS-CLIENT-PRINCIPAL-NAME": "alice_gmail.com#EXT#@tenant.onmicrosoft.com",
            "X-MS-CLIENT-PRINCIPAL-ID": "oid-999",
        },
    )
    assert response.status_code == 401


async def test_verification_enabled_without_a_token_is_refused(client, monkeypatch):
    """Fail-closed: omitting the token must not reach the claims-header path."""
    monkeypatch.setattr(settings, "PROXY_AUTH_ENABLED", True)
    monkeypatch.setattr(settings, "PROXY_AUTH_MODE", "azure_easyauth")
    monkeypatch.setattr(settings, "PROXY_AUTH_SHARED_SECRET", SECRET)
    monkeypatch.setattr(settings, "PROXY_AUTH_SECRET_HEADER", SECRET_HEADER)
    monkeypatch.setattr(settings, "PROXY_AUTH_VERIFY_ID_TOKEN", True)

    principal = azure_principal(email="alice@example.com", oid="oid-123")
    response = await client.post(
        ENDPOINT,
        headers={SECRET_HEADER: SECRET, "X-MS-CLIENT-PRINCIPAL": principal},
    )
    assert response.status_code == 401


async def test_malformed_principal_header_is_rejected(client, proxy_enabled, monkeypatch):
    monkeypatch.setattr(settings, "PROXY_AUTH_MODE", "azure_easyauth")
    response = await client.post(
        ENDPOINT,
        headers={SECRET_HEADER: SECRET, "X-MS-CLIENT-PRINCIPAL": "!!!not-base64!!!"},
    )
    assert response.status_code == 401


# ---------------------------------------------------------------------------
# Advertisement to the login page
# ---------------------------------------------------------------------------


async def test_sso_config_advertises_proxy_auth_when_sso_is_off(client, proxy_enabled):
    """The flag must survive the early return, or the login page never sees it."""
    response = await client.get("/api/v1/auth/sso/config")
    assert response.status_code == 200
    body = response.json()
    assert body["enabled"] is False
    assert body["proxy_auth"] is True
    assert "local_login_available" in body


async def test_sso_config_reports_proxy_auth_off_by_default(client, monkeypatch):
    monkeypatch.setattr(settings, "PROXY_AUTH_ENABLED", False)
    response = await client.get("/api/v1/auth/sso/config")
    body = response.json()
    assert body["proxy_auth"] is False
    assert "proxy_logout_url" not in body


async def test_sso_config_carries_the_proxy_logout_url(client, monkeypatch, proxy_enabled):
    """The frontend redirects here after logout so the proxy session ends too."""
    monkeypatch.setattr(settings, "PROXY_AUTH_LOGOUT_URL", "/.auth/logout")
    response = await client.get("/api/v1/auth/sso/config")
    assert response.json()["proxy_logout_url"] == "/.auth/logout"


async def test_sso_config_omits_logout_url_when_unset(client, monkeypatch, proxy_enabled):
    monkeypatch.setattr(settings, "PROXY_AUTH_LOGOUT_URL", "")
    response = await client.get("/api/v1/auth/sso/config")
    assert "proxy_logout_url" not in response.json()
