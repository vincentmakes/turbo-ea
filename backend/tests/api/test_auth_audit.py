"""The auth routes write the security audit log — and the row outlives the error.

``get_db`` never commits, so a row recorded on a path that then raises would be
rolled back with the request. The ``db`` fixture shares one session with the app,
so a row that was only *flushed* is still visible to a plain read afterwards and
would prove nothing. Every read here therefore goes through ``_committed``, which
rolls the session back first: what survives is exactly what the route committed.

DB-backed: skipped locally without PostgreSQL, run in CI.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock, patch

import pytest
from fastapi import HTTPException
from sqlalchemy import select

import app.services.sso_service as sso
from app.config import settings
from app.core.permissions import MEMBER_PERMISSIONS
from app.core.security import create_access_token
from app.models.audit_log import AuditLogEntry
from app.models.user import User
from tests.conftest import auth_headers, create_role, create_user

LOGIN = "/api/v1/auth/login"
LOGOUT = "/api/v1/auth/logout"
SSO_CALLBACK = "/api/v1/auth/sso/callback"
SSO_BODY = {"code": "authz-code", "redirect_uri": "http://test/auth/callback"}
PROXY = "/api/v1/auth/proxy/session"
PROXY_SECRET = "proxy-shared-secret-value"
PROXY_SECRET_HEADER = "X-Turbo-EA-Proxy-Secret"
STRONG = "BrandNewPass1"


async def _committed(db, prefix: str = "auth.") -> list[AuditLogEntry]:
    """Discard whatever the request flushed but never committed, then read the log.

    ORM instances loaded before this call are expired by the rollback, so tests
    capture ids and emails *before* the request.
    """
    await db.rollback()
    result = await db.execute(
        select(AuditLogEntry)
        .where(AuditLogEntry.action.like(f"{prefix}%"))
        .order_by(AuditLogEntry.created_at)
    )
    return list(result.scalars().all())


async def _login(client, email: str, password: str = "TestPassword1", **kwargs):
    return await client.post(LOGIN, json={"email": email, "password": password}, **kwargs)


# ---------------------------------------------------------------------------
# Password sign-in: one test per reason code
# ---------------------------------------------------------------------------


class TestLoginFailures:
    async def test_unknown_user(self, client, db):
        resp = await _login(client, "nobody@test.com", "Whatever123")
        assert resp.status_code == 401
        assert resp.json() == {"detail": "Invalid credentials"}

        [row] = await _committed(db)
        assert (row.category, row.action, row.outcome) == ("auth", "auth.login.failed", "failure")
        assert row.subject_email == "nobody@test.com"
        assert row.actor_user_id is None and row.actor_email is None
        assert row.details == {"reason": "unknown_user"}

    async def test_sso_account(self, client, db):
        user = await create_user(db, email="sso@test.com", role="member")
        user.auth_provider = "sso"
        await db.flush()
        uid = user.id

        resp = await _login(client, "sso@test.com")
        assert resp.status_code == 403
        assert resp.json() == {
            "detail": "This account uses SSO authentication. Please sign in via SSO."
        }

        [row] = await _committed(db)
        assert row.action == "auth.login.failed" and row.outcome == "failure"
        assert row.actor_user_id == uid and row.actor_email == "sso@test.com"
        assert row.subject_email == "sso@test.com"
        assert row.details == {"reason": "sso_account"}

    async def test_no_password(self, client, db):
        user = await create_user(db, email="nopass@test.com", role="member")
        user.password_hash = None
        await db.flush()
        uid = user.id

        resp = await _login(client, "nopass@test.com")
        assert resp.status_code == 401
        assert resp.json() == {"detail": "Invalid credentials"}

        [row] = await _committed(db)
        assert row.action == "auth.login.failed" and row.actor_user_id == uid
        assert row.details == {"reason": "no_password"}

    async def test_locked(self, client, db):
        until = datetime.now(timezone.utc) + timedelta(minutes=10)
        user = await create_user(db, email="locked@test.com", role="member")
        user.locked_until = until
        await db.flush()

        resp = await _login(client, "locked@test.com")
        assert resp.status_code == 423
        assert resp.json() == {"detail": "Account temporarily locked. Try again later."}

        [row] = await _committed(db)
        assert row.action == "auth.login.failed" and row.outcome == "failure"
        assert row.details["reason"] == "locked"
        assert datetime.fromisoformat(row.details["locked_until"]) == until

    async def test_bad_password(self, client, db):
        user = await create_user(db, email="typo@test.com", role="member")
        uid = user.id

        resp = await _login(client, "typo@test.com", "WrongPassword9")
        assert resp.status_code == 401
        assert resp.json() == {"detail": "Invalid credentials"}

        [row] = await _committed(db)
        assert row.action == "auth.login.failed" and row.actor_user_id == uid
        assert row.details == {"reason": "bad_password", "attempts": 1}
        # The failed-attempt counter is committed with it, as it always was.
        attempts = (
            await db.execute(select(User.failed_login_attempts).where(User.id == uid))
        ).scalar_one()
        assert attempts == 1

    async def test_inactive(self, client, db):
        user = await create_user(db, email="gone@test.com", role="member")
        user.is_active = False
        await db.flush()
        uid = user.id

        resp = await _login(client, "gone@test.com")
        assert resp.status_code == 403
        assert resp.json() == {"detail": "Account disabled"}

        [row] = await _committed(db)
        assert row.action == "auth.login.failed" and row.actor_user_id == uid
        assert row.details == {"reason": "inactive"}


class TestLockoutAndSuccess:
    async def test_lockout_records_locked(self, client, db):
        user = await create_user(db, email="guess@test.com", role="member")
        user.failed_login_attempts = 4
        await db.flush()
        uid = user.id

        resp = await _login(client, "guess@test.com", "WrongPassword9")
        assert resp.status_code == 401
        assert resp.json() == {"detail": "Invalid credentials"}

        failed, locked = await _committed(db)
        assert failed.action == "auth.login.failed"
        assert failed.details == {"reason": "bad_password", "attempts": 5}
        assert locked.action == "auth.login.locked" and locked.outcome == "failure"
        assert locked.actor_user_id == uid and locked.subject_email == "guess@test.com"
        assert locked.details["attempts"] == 5
        lock_end = datetime.fromisoformat(locked.details["locked_until"])
        assert lock_end > datetime.now(timezone.utc)
        stored = (await db.execute(select(User.locked_until).where(User.id == uid))).scalar_one()
        assert stored == lock_end

    async def test_attempt_while_locked_records_the_locked_reason(self, client, db):
        user = await create_user(db, email="guess2@test.com", role="member")
        user.failed_login_attempts = 4
        await db.flush()

        assert (await _login(client, "guess2@test.com", "WrongPassword9")).status_code == 401
        assert (await _login(client, "guess2@test.com")).status_code == 423

        rows = await _committed(db)
        assert [r.action for r in rows] == [
            "auth.login.failed",
            "auth.login.locked",
            "auth.login.failed",
        ]
        assert rows[-1].details["reason"] == "locked"

    async def test_login_success_records_ip_from_x_real_ip(self, client, db, monkeypatch):
        monkeypatch.setattr(settings, "TRUST_PROXY_HEADERS", True)
        user = await create_user(db, email="ok@test.com", role="member")
        uid = user.id

        resp = await _login(
            client,
            "ok@test.com",
            headers={"X-Real-IP": "203.0.113.7", "User-Agent": "audit-test/1.0"},
        )
        assert resp.status_code == 200

        [row] = await _committed(db)
        assert (row.action, row.outcome) == ("auth.login.succeeded", "success")
        assert row.actor_user_id == uid and row.actor_email == "ok@test.com"
        assert row.ip == "203.0.113.7"
        assert row.user_agent == "audit-test/1.0"
        assert row.details == {"first_login": True}

    async def test_x_real_ip_is_ignored_when_proxy_headers_are_not_trusted(
        self, client, db, monkeypatch
    ):
        monkeypatch.setattr(settings, "TRUST_PROXY_HEADERS", False)
        user = await create_user(db, email="ok2@test.com", role="member")
        user.last_login = datetime.now(timezone.utc) - timedelta(days=1)
        await db.flush()

        resp = await _login(client, "ok2@test.com", headers={"X-Real-IP": "203.0.113.7"})
        assert resp.status_code == 200

        [row] = await _committed(db)
        assert row.action == "auth.login.succeeded"
        assert row.ip != "203.0.113.7"
        assert row.details == {"first_login": False}


# ---------------------------------------------------------------------------
# Sign-out
# ---------------------------------------------------------------------------


class TestLogout:
    async def test_logout_with_cookie_records_actor(self, client, db):
        user = await create_user(db, email="bye@test.com", role="member")
        uid, token = user.id, create_access_token(user.id, user.role)

        resp = await client.post(LOGOUT, headers={"Cookie": f"access_token={token}"})
        assert resp.status_code == 200
        assert resp.json() == {"ok": True}
        assert "access_token=" in resp.headers.get("set-cookie", "")

        [row] = await _committed(db)
        assert (row.action, row.outcome) == ("auth.logout", "success")
        assert row.actor_user_id == uid and row.actor_email == "bye@test.com"

    async def test_logout_without_session_records_nothing(self, client, db):
        resp = await client.post(LOGOUT)
        assert resp.status_code == 200
        assert resp.json() == {"ok": True}

        resp = await client.post(LOGOUT, headers={"Cookie": "access_token=not-a-jwt"})
        assert resp.status_code == 200
        # The cookie is cleared even when nobody could be identified.
        assert "access_token=" in resp.headers.get("set-cookie", "")

        assert await _committed(db) == []


# ---------------------------------------------------------------------------
# SSO
# ---------------------------------------------------------------------------


@pytest.fixture
async def sso_roles(db):
    await create_role(db, key="admin", label="Admin", permissions={"*": True})
    await create_role(db, key="member", label="Member", permissions=MEMBER_PERMISSIONS)


def _exchange(monkeypatch, claims: dict, *, provider="microsoft", sso_cfg: dict | None = None):
    cfg = {"enabled": True, "provider": provider, **(sso_cfg or {})}

    async def fake(db, code, redirect_uri):
        return claims, cfg, provider

    monkeypatch.setattr(sso, "exchange_code_for_claims", fake)


class TestSso:
    async def test_sso_failure_records_provider_and_reason(
        self, client, db, sso_roles, monkeypatch
    ):
        _exchange(
            monkeypatch,
            {"sub": "g-1", "email": "Eve@Evil.com", "hd": "evil.com"},
            provider="google",
            sso_cfg={"domain": "acme.com"},
        )

        resp = await client.post(SSO_CALLBACK, json=SSO_BODY)
        assert resp.status_code == 403
        assert resp.json() == {"detail": "Sign-in restricted to acme.com accounts."}

        [row] = await _committed(db)
        assert (row.action, row.outcome) == ("auth.sso.failed", "failure")
        assert row.subject_email == "eve@evil.com"
        assert row.details == {"provider": "google", "reason": "hd_mismatch"}

    async def test_missing_email_claim(self, client, db, sso_roles, monkeypatch):
        _exchange(monkeypatch, {"oid": "x"})

        resp = await client.post(SSO_CALLBACK, json=SSO_BODY)
        assert resp.status_code == 401

        [row] = await _committed(db)
        assert row.subject_email is None
        assert row.details == {"provider": "microsoft", "reason": "no_email"}

    async def test_missing_subject_claim(self, client, db, sso_roles, monkeypatch):
        _exchange(monkeypatch, {"email": "nosub@acme.com"}, provider="google")

        resp = await client.post(SSO_CALLBACK, json=SSO_BODY)
        assert resp.status_code == 401

        [row] = await _committed(db)
        assert row.subject_email == "nosub@acme.com"
        assert row.details == {"provider": "google", "reason": "no_subject"}

    async def test_local_account_conflict(self, client, db, sso_roles, monkeypatch):
        await create_user(db, email="local@acme.com", role="admin")
        _exchange(monkeypatch, {"oid": "l-oid", "email": "local@acme.com"})

        resp = await client.post(SSO_CALLBACK, json=SSO_BODY)
        assert resp.status_code == 409
        assert "local account" in resp.json()["detail"]

        [row] = await _committed(db)
        assert row.subject_email == "local@acme.com"
        assert row.details == {"provider": "microsoft", "reason": "local_account"}

    async def test_inactive_account(self, client, db, sso_roles, monkeypatch):
        user = await create_user(db, email="off@acme.com", role="member")
        user.auth_provider, user.sso_subject_id, user.is_active = "sso", "off-oid", False
        await db.flush()
        uid = user.id
        _exchange(monkeypatch, {"oid": "off-oid", "email": "off@acme.com"})

        resp = await client.post(SSO_CALLBACK, json=SSO_BODY)
        assert resp.status_code == 403
        assert resp.json() == {"detail": "Account disabled"}

        [row] = await _committed(db)
        assert row.actor_user_id == uid
        assert row.details == {"provider": "microsoft", "reason": "inactive"}

    async def test_expired_account(self, client, db, sso_roles, monkeypatch):
        user = await create_user(db, email="late@acme.com", role="member")
        user.auth_provider, user.sso_subject_id = "sso", "late-oid"
        user.access_expires_at = datetime.now(timezone.utc) - timedelta(days=1)
        await db.flush()
        _exchange(monkeypatch, {"oid": "late-oid", "email": "late@acme.com"})

        resp = await client.post(SSO_CALLBACK, json=SSO_BODY)
        assert resp.status_code == 403
        assert resp.json() == {"detail": "Account access has expired"}

        [row] = await _committed(db)
        assert row.details == {"provider": "microsoft", "reason": "expired"}

    async def test_exchange_failure(self, client, db, sso_roles, monkeypatch):
        async def refuse(db, code, redirect_uri):
            raise HTTPException(502, "SSO authentication failed. Identity provider is unavailable.")

        monkeypatch.setattr(sso, "exchange_code_for_claims", refuse)

        resp = await client.post(SSO_CALLBACK, json=SSO_BODY)
        assert resp.status_code == 502
        assert resp.json() == {
            "detail": "SSO authentication failed. Identity provider is unavailable."
        }

        [row] = await _committed(db)
        assert row.action == "auth.sso.failed"
        assert row.details == {"provider": None, "reason": "exchange_failed"}

    async def test_sso_success_records_subject(self, client, db, sso_roles, monkeypatch):
        _exchange(
            monkeypatch,
            {"sub": "sub-1", "email": "New.Person@Acme.com", "name": "New Person"},
            provider="google",
        )

        resp = await client.post(SSO_CALLBACK, json=SSO_BODY)
        assert resp.status_code == 200, resp.text

        [row] = await _committed(db)
        assert (row.action, row.outcome) == ("auth.sso.succeeded", "success")
        assert row.actor_email == "new.person@acme.com" and row.actor_user_id is not None
        assert row.details == {"provider": "google", "subject": "sub-1", "created": True}

    async def test_sso_success_for_an_existing_account_is_not_created(
        self, client, db, sso_roles, monkeypatch
    ):
        user = await create_user(db, email="known@acme.com", role="member")
        user.auth_provider, user.sso_subject_id = "sso", "known-oid"
        await db.flush()
        uid = user.id
        _exchange(monkeypatch, {"oid": "known-oid", "email": "known@acme.com"})

        assert (await client.post(SSO_CALLBACK, json=SSO_BODY)).status_code == 200

        [row] = await _committed(db)
        assert row.actor_user_id == uid
        assert row.details == {"provider": "microsoft", "subject": "known-oid", "created": False}


# ---------------------------------------------------------------------------
# Trusted reverse proxy
# ---------------------------------------------------------------------------


@pytest.fixture
def proxy_enabled(monkeypatch):
    """Proxy auth in header mode with a shared secret (as ``test_auth_proxy.py``)."""
    monkeypatch.setattr(settings, "PROXY_AUTH_ENABLED", True)
    monkeypatch.setattr(settings, "PROXY_AUTH_MODE", "header")
    monkeypatch.setattr(settings, "PROXY_AUTH_SHARED_SECRET", PROXY_SECRET)
    monkeypatch.setattr(settings, "PROXY_AUTH_SECRET_HEADER", PROXY_SECRET_HEADER)
    monkeypatch.setattr(settings, "PROXY_AUTH_VERIFY_ID_TOKEN", False)
    monkeypatch.setattr(settings, "PROXY_AUTH_ALLOWED_DOMAINS", ["example.com"])
    monkeypatch.setattr(settings, "PROXY_AUTH_ALLOW_ANY_DOMAIN", False)
    monkeypatch.setattr(settings, "PROXY_AUTH_BOOTSTRAP_ADMIN_EMAIL", "")
    monkeypatch.setattr(settings, "PROXY_AUTH_TRUST_PLATFORM_HEADERS", False)
    monkeypatch.setattr(settings, "PROXY_AUTH_ROLE_MAP", [])
    monkeypatch.setattr(settings, "PROXY_AUTH_ROLE_CLAIM", "roles")
    monkeypatch.setattr(settings, "PROXY_AUTH_ROLE_HEADER", "X-Forwarded-Groups")


def _proxy_headers(email: str, secret: str = PROXY_SECRET) -> dict:
    return {PROXY_SECRET_HEADER: secret, "X-Forwarded-Email": email}


async def _federated_user(db, email: str) -> User:
    user = await create_user(db, email=email, role="member")
    user.auth_provider = "sso"
    user.password_hash = None
    await db.flush()
    return user


class TestProxySession:
    async def test_proxy_session_pair(self, client, db, proxy_enabled):
        await create_role(db, key="member")
        user = await _federated_user(db, "alice@example.com")
        uid = user.id

        ok = await client.post(PROXY, headers=_proxy_headers("alice@example.com"))
        assert ok.status_code == 200, ok.text
        refused = await client.post(PROXY, headers=_proxy_headers("alice@example.com", "wrong"))
        assert refused.status_code == 401
        assert refused.json() == {"detail": "Proxy authentication failed."}

        succeeded, failed = await _committed(db)
        assert (succeeded.action, succeeded.outcome) == ("auth.proxy_session.succeeded", "success")
        assert succeeded.actor_user_id == uid
        assert succeeded.details == {
            "subject": "proxy:alice@example.com",
            "verified": False,
            "created": False,
        }
        assert (failed.action, failed.outcome) == ("auth.proxy_session.failed", "failure")
        assert failed.subject_email is None and failed.actor_user_id is None
        assert failed.details == {"reason": "unauthenticated"}

    async def test_refused_account_creation_is_recorded(self, client, db, proxy_enabled):
        await create_role(db, key="member")

        resp = await client.post(PROXY, headers=_proxy_headers("brand-new@example.com"))
        assert resp.status_code == 403

        [row] = await _committed(db)
        assert row.action == "auth.proxy_session.failed"
        assert row.subject_email == "brand-new@example.com"
        assert row.details == {"reason": "no_account"}
        assert (
            await db.execute(select(User).where(User.email == "brand-new@example.com"))
        ).scalar_one_or_none() is None

    async def test_inactive_account_is_recorded(self, client, db, proxy_enabled):
        await create_role(db, key="member")
        user = await _federated_user(db, "off@example.com")
        user.is_active = False
        await db.flush()
        uid = user.id

        resp = await client.post(PROXY, headers=_proxy_headers("off@example.com"))
        assert resp.status_code == 403
        assert resp.json() == {"detail": "Account disabled"}

        [row] = await _committed(db)
        assert row.actor_user_id == uid and row.details == {"reason": "inactive"}

    async def test_domain_refusal_is_an_identity_rejection(self, client, db, proxy_enabled):
        resp = await client.post(PROXY, headers=_proxy_headers("guest@partner.example"))
        assert resp.status_code == 403

        [row] = await _committed(db)
        assert row.details == {"reason": "identity_rejected"}

    async def test_feature_off_and_misconfiguration_record_nothing(self, client, db, monkeypatch):
        monkeypatch.setattr(settings, "PROXY_AUTH_ENABLED", False)
        assert (
            await client.post(PROXY, headers=_proxy_headers("a@example.com"))
        ).status_code == 404

        monkeypatch.setattr(settings, "PROXY_AUTH_ENABLED", True)
        monkeypatch.setattr(settings, "PROXY_AUTH_MODE", "header")
        monkeypatch.setattr(settings, "PROXY_AUTH_SHARED_SECRET", "")
        monkeypatch.setattr(settings, "PROXY_AUTH_TRUST_PLATFORM_HEADERS", False)
        assert (
            await client.post(PROXY, headers=_proxy_headers("a@example.com"))
        ).status_code == 500

        assert await _committed(db) == []


# ---------------------------------------------------------------------------
# Impersonation, registration, passwords
# ---------------------------------------------------------------------------


class TestImpersonation:
    async def test_impersonation_pair(self, client, db):
        await create_role(db, key="admin", permissions={"*": True})
        await create_role(db, key="member", label="Member", permissions=MEMBER_PERMISSIONS)
        admin = await create_user(db, email="admin@test.com", role="admin")
        uid = admin.id

        start = await client.post(
            "/api/v1/auth/impersonate", headers=auth_headers(admin), json={"role": "member"}
        )
        assert start.status_code == 200, start.text
        token = start.json()["access_token"]
        stop = await client.post(
            "/api/v1/auth/stop-impersonating", headers={"Authorization": f"Bearer {token}"}
        )
        assert stop.status_code == 200, stop.text

        started, stopped = await _committed(db)
        assert (started.action, started.outcome) == ("auth.impersonation.started", "success")
        assert started.actor_user_id == uid
        assert (started.target_type, started.target_id, started.target_label) == (
            "role",
            "member",
            "Member",
        )
        assert started.impersonated_role is None

        assert stopped.action == "auth.impersonation.stopped"
        assert stopped.actor_user_id == uid
        assert (stopped.target_type, stopped.target_id, stopped.target_label) == (
            "role",
            "member",
            "Member",
        )
        # The stop request itself still ran impersonated, and says so.
        assert stopped.impersonated_role == "member"
        assert stopped.impersonator_user_id == uid


class TestRegisterAndPasswords:
    async def test_register_records(self, client, db):
        resp = await client.post(
            "/api/v1/auth/register",
            json={"email": "first@test.com", "display_name": "First", "password": STRONG},
        )
        assert resp.status_code == 200

        [row] = await _committed(db)
        assert (row.action, row.outcome) == ("auth.register", "success")
        assert row.actor_email == "first@test.com" and row.actor_user_id is not None
        assert row.details == {"role": "admin", "first_user": True}

    async def test_reset_requested_for_unknown_email_is_success_shaped(self, client, db):
        await create_user(db, email="known@test.com", role="member")
        with (
            patch("app.api.v1.auth.email_service._is_configured", return_value=True),
            patch("app.api.v1.auth.email_service.send_email", new=AsyncMock(return_value=True)),
        ):
            unknown = await client.post(
                "/api/v1/auth/forgot-password", json={"email": " Nobody@Example.com "}
            )
            known = await client.post(
                "/api/v1/auth/forgot-password", json={"email": "known@test.com"}
            )
        assert unknown.status_code == known.status_code == 200
        assert unknown.json() == known.json() == {"ok": True}

        first, second = await _committed(db)
        assert first.subject_email == "nobody@example.com"
        assert second.subject_email == "known@test.com"

        def shape(row):
            return (
                row.category,
                row.action,
                row.outcome,
                row.actor_user_id,
                row.actor_email,
                row.target_type,
                row.details,
            )

        # Nothing but the typed address tells the two apart.
        assert shape(first) == shape(second)
        assert shape(first) == (
            "auth",
            "auth.password.reset_requested",
            "success",
            None,
            None,
            None,
            None,
        )

    async def test_reset_password_records(self, client, db):
        user = await create_user(db, email="reset@test.com", role="member")
        user.password_reset_token = "reset-token-1"
        user.password_reset_expires_at = datetime.now(timezone.utc) + timedelta(minutes=30)
        await db.flush()
        uid = user.id

        bad = await client.post(
            "/api/v1/auth/reset-password", json={"token": "wrong", "password": STRONG}
        )
        assert bad.status_code == 404
        assert bad.json() == {"detail": "Invalid or expired reset token"}
        ok = await client.post(
            "/api/v1/auth/reset-password", json={"token": "reset-token-1", "password": STRONG}
        )
        assert ok.status_code == 200

        failed, succeeded = await _committed(db)
        assert (failed.action, failed.outcome) == ("auth.password.reset", "failure")
        assert failed.details == {"reason": "invalid_token"}
        assert failed.subject_email is None
        assert (succeeded.action, succeeded.outcome) == ("auth.password.reset", "success")
        assert succeeded.actor_user_id == uid

    async def test_expired_reset_token_names_the_account(self, client, db):
        user = await create_user(db, email="stale@test.com", role="member")
        user.password_reset_token = "stale-token"
        user.password_reset_expires_at = datetime.now(timezone.utc) - timedelta(minutes=1)
        await db.flush()

        resp = await client.post(
            "/api/v1/auth/reset-password", json={"token": "stale-token", "password": STRONG}
        )
        assert resp.status_code == 404

        [row] = await _committed(db)
        assert row.outcome == "failure" and row.subject_email == "stale@test.com"
        assert row.details == {"reason": "invalid_token"}

    async def test_set_password_records(self, client, db):
        user = await create_user(db, email="invited@test.com", role="member")
        user.password_hash = None
        user.password_setup_token = "setup-token-1"
        await db.flush()
        uid = user.id

        bad = await client.post(
            "/api/v1/auth/set-password", json={"token": "nope", "password": STRONG}
        )
        assert bad.status_code == 404
        assert bad.json() == {"detail": "Invalid or expired setup token"}
        ok = await client.post(
            "/api/v1/auth/set-password", json={"token": "setup-token-1", "password": STRONG}
        )
        assert ok.status_code == 200

        failed, succeeded = await _committed(db)
        assert (failed.action, failed.outcome) == ("auth.password.set", "failure")
        assert failed.details == {"reason": "invalid_token"} and failed.subject_email is None
        assert (succeeded.action, succeeded.outcome) == ("auth.password.set", "success")
        assert succeeded.actor_user_id == uid

    async def test_self_password_change_records(self, client, db):
        await create_role(db, key="admin", permissions={"*": True})
        await create_role(db, key="member", label="Member", permissions=MEMBER_PERMISSIONS)
        member = await create_user(db, email="me@test.com", role="member")
        other = await create_user(db, email="other@test.com", role="member")
        admin = await create_user(db, email="boss@test.com", role="admin")
        uid, other_id = member.id, other.id

        own = await client.patch(
            f"/api/v1/users/{uid}", headers=auth_headers(member), json={"password": STRONG}
        )
        assert own.status_code == 200, own.text
        # Neither a display-name change nor an admin setting someone else's
        # password is the user changing their own password.
        rename = await client.patch(
            f"/api/v1/users/{uid}", headers=auth_headers(member), json={"display_name": "Me"}
        )
        assert rename.status_code == 200
        by_admin = await client.patch(
            f"/api/v1/users/{other_id}", headers=auth_headers(admin), json={"password": STRONG}
        )
        assert by_admin.status_code == 200, by_admin.text

        [row] = await _committed(db)
        assert (row.category, row.action, row.outcome) == (
            "auth",
            "auth.password.changed",
            "success",
        )
        assert row.actor_user_id == uid and row.actor_email == "me@test.com"
        assert row.details is None
