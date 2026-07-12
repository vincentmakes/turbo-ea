"""Integration tests for the /users endpoints.

These tests require a PostgreSQL test database and an HTTP test client.
"""

from __future__ import annotations

import uuid

import pytest

from app.core.permissions import MEMBER_PERMISSIONS, VIEWER_PERMISSIONS
from tests.conftest import (
    auth_headers,
    create_role,
    create_user,
)


@pytest.fixture
async def users_env(db):
    """Prerequisite data shared by all user tests."""
    await create_role(db, key="admin", label="Admin", permissions={"*": True})
    await create_role(
        db,
        key="member",
        label="Member",
        permissions=MEMBER_PERMISSIONS,
    )
    await create_role(
        db,
        key="viewer",
        label="Viewer",
        permissions=VIEWER_PERMISSIONS,
    )
    admin = await create_user(db, email="admin@test.com", role="admin")
    member = await create_user(db, email="member@test.com", role="member")
    viewer = await create_user(db, email="viewer@test.com", role="viewer")
    return {"admin": admin, "member": member, "viewer": viewer}


# -------------------------------------------------------------------
# GET /users  (list)
# -------------------------------------------------------------------


class TestListUsers:
    async def test_list_returns_users(self, client, db, users_env):
        admin = users_env["admin"]
        resp = await client.get(
            "/api/v1/users",
            headers=auth_headers(admin),
        )
        assert resp.status_code == 200
        emails = [u["email"] for u in resp.json()]
        assert "admin@test.com" in emails
        assert "member@test.com" in emails

    async def test_unauthenticated_returns_401(self, client, db, users_env):
        resp = await client.get("/api/v1/users")
        assert resp.status_code == 401

    async def test_disabled_users_excluded_by_default(self, client, db, users_env):
        """A disabled (is_active=False) user must not appear in the picker
        list — that's what owner / assignee / stakeholder dropdowns hit."""
        admin = users_env["admin"]
        disabled = await create_user(db, email="disabled@test.com", role="member")
        disabled.is_active = False
        await db.flush()

        resp = await client.get("/api/v1/users", headers=auth_headers(admin))
        assert resp.status_code == 200
        emails = [u["email"] for u in resp.json()]
        assert "disabled@test.com" not in emails
        assert "admin@test.com" in emails

    async def test_include_inactive_returns_disabled_users(self, client, db, users_env):
        """The Users admin page passes include_inactive=true so admins can
        still see and re-enable disabled users."""
        admin = users_env["admin"]
        disabled = await create_user(db, email="disabled@test.com", role="member")
        disabled.is_active = False
        await db.flush()

        resp = await client.get(
            "/api/v1/users?include_inactive=true",
            headers=auth_headers(admin),
        )
        assert resp.status_code == 200
        emails = [u["email"] for u in resp.json()]
        assert "disabled@test.com" in emails
        assert "admin@test.com" in emails

    # Fields the lite (non-admin) payload must never expose.
    SENSITIVE_FIELDS = {
        "role",
        "auth_provider",
        "has_password",
        "pending_setup",
        "last_login",
        "created_at",
        "locale",
        "ui_preferences",
    }

    async def test_admin_gets_full_payload(self, client, db, users_env):
        admin = users_env["admin"]
        resp = await client.get("/api/v1/users", headers=auth_headers(admin))
        assert resp.status_code == 200
        row = resp.json()[0]
        # Admin retains the full record (used by the Users admin screen).
        assert self.SENSITIVE_FIELDS.issubset(row.keys())

    @pytest.mark.parametrize("role_key", ["member", "viewer"])
    async def test_non_admin_gets_lite_payload(self, client, db, users_env, role_key):
        """A non-admin picker consumer sees only id/display_name/email/is_active
        — never the PII / attacker-surface metadata."""
        caller = users_env[role_key]
        resp = await client.get("/api/v1/users", headers=auth_headers(caller))
        assert resp.status_code == 200
        rows = resp.json()
        assert rows, "expected at least one user in the list"
        for row in rows:
            assert set(row.keys()) == {"id", "display_name", "email", "is_active"}
            assert not self.SENSITIVE_FIELDS.intersection(row.keys())
        # email stays — pickers display/search by it.
        assert any(r["email"] == "admin@test.com" for r in rows)


# -------------------------------------------------------------------
# GET /users/{id}  (single)
# -------------------------------------------------------------------


class TestGetUser:
    async def test_admin_gets_full_payload(self, client, db, users_env):
        admin, member = users_env["admin"], users_env["member"]
        resp = await client.get(f"/api/v1/users/{member.id}", headers=auth_headers(admin))
        assert resp.status_code == 200
        assert TestListUsers.SENSITIVE_FIELDS.issubset(resp.json().keys())

    async def test_non_admin_reading_other_user_gets_lite_payload(self, client, db, users_env):
        member, admin = users_env["member"], users_env["admin"]
        resp = await client.get(f"/api/v1/users/{admin.id}", headers=auth_headers(member))
        assert resp.status_code == 200
        assert set(resp.json().keys()) == {"id", "display_name", "email", "is_active"}

    async def test_non_admin_reading_self_gets_full_payload(self, client, db, users_env):
        """A user reading their own profile gets the full record (defensive —
        no frontend caller hits this today)."""
        member = users_env["member"]
        resp = await client.get(f"/api/v1/users/{member.id}", headers=auth_headers(member))
        assert resp.status_code == 200
        assert TestListUsers.SENSITIVE_FIELDS.issubset(resp.json().keys())


# -------------------------------------------------------------------
# POST /users  (create)
# -------------------------------------------------------------------


class TestCreateUser:
    async def test_admin_can_create_user(self, client, db, users_env):
        admin = users_env["admin"]
        resp = await client.post(
            "/api/v1/users",
            json={
                "email": "newuser@test.com",
                "display_name": "New User",
                "password": "StrongPass1",
                "role": "member",
            },
            headers=auth_headers(admin),
        )
        assert resp.status_code == 201
        data = resp.json()
        assert data["email"] == "newuser@test.com"
        assert data["role"] == "member"

    async def test_member_cannot_create_user(self, client, db, users_env):
        member = users_env["member"]
        resp = await client.post(
            "/api/v1/users",
            json={
                "email": "blocked@test.com",
                "display_name": "Blocked",
                "password": "Pass123",
                "role": "viewer",
            },
            headers=auth_headers(member),
        )
        assert resp.status_code == 403

    async def test_duplicate_email_rejected(self, client, db, users_env):
        admin = users_env["admin"]
        resp = await client.post(
            "/api/v1/users",
            json={
                "email": "admin@test.com",
                "display_name": "Dup",
                "password": "Pass123",
                "role": "member",
            },
            headers=auth_headers(admin),
        )
        assert resp.status_code == 409

    async def test_invalid_role_rejected(self, client, db, users_env):
        admin = users_env["admin"]
        resp = await client.post(
            "/api/v1/users",
            json={
                "email": "badrole@test.com",
                "display_name": "Bad Role",
                "password": "Pass123",
                "role": "nonexistent_role",
            },
            headers=auth_headers(admin),
        )
        assert resp.status_code == 400


# -------------------------------------------------------------------
# POST /users  (delegated invitation via users.invite)
# -------------------------------------------------------------------


class TestInviteUser:
    """The ``users.invite`` permission is the delegated form of ``admin.users``.

    It lets non-admin holders create new users from the stakeholder/owner
    picker, but the backend still gates the role they can assign — only
    ``member`` and ``viewer``. Elevated roles (admin, bpm_admin, custom
    elevated roles) still require ``admin.users``.
    """

    async def test_users_invite_can_create_member(self, client, db, users_env):
        # Build a non-admin role that holds users.invite but not admin.users.
        await create_role(
            db,
            key="inviter",
            label="Inviter",
            permissions={**MEMBER_PERMISSIONS, "users.invite": True},
        )
        inviter = await create_user(db, email="inviter@test.com", role="inviter")
        resp = await client.post(
            "/api/v1/users",
            json={
                "email": "invitee@test.com",
                "display_name": "Invitee",
                "password": "Pass1234",
                "role": "member",
            },
            headers=auth_headers(inviter),
        )
        assert resp.status_code == 201, resp.text
        assert resp.json()["email"] == "invitee@test.com"
        assert resp.json()["role"] == "member"

    async def test_users_invite_blocked_from_elevated_role(self, client, db, users_env):
        await create_role(
            db,
            key="inviter2",
            label="Inviter2",
            permissions={**MEMBER_PERMISSIONS, "users.invite": True},
        )
        inviter = await create_user(db, email="inviter2@test.com", role="inviter2")
        resp = await client.post(
            "/api/v1/users",
            json={
                "email": "escalation@test.com",
                "display_name": "Escalation",
                "password": "Pass1234",
                "role": "admin",
            },
            headers=auth_headers(inviter),
        )
        assert resp.status_code == 403
        assert "admin.users" in resp.json()["detail"]

    async def test_admin_can_still_invite_any_role(self, client, db, users_env):
        admin = users_env["admin"]
        resp = await client.post(
            "/api/v1/users",
            json={
                "email": "new-admin@test.com",
                "display_name": "New Admin",
                "password": "Pass1234",
                "role": "admin",
            },
            headers=auth_headers(admin),
        )
        assert resp.status_code == 201
        assert resp.json()["role"] == "admin"

    async def test_viewer_without_invite_permission_still_403(self, client, db, users_env):
        viewer = users_env["viewer"]
        resp = await client.post(
            "/api/v1/users",
            json={
                "email": "blocked2@test.com",
                "display_name": "Blocked2",
                "password": "Pass1234",
                "role": "viewer",
            },
            headers=auth_headers(viewer),
        )
        assert resp.status_code == 403


# -------------------------------------------------------------------
# PATCH /users/{id}  (update)
# -------------------------------------------------------------------


class TestUpdateUser:
    async def test_admin_can_update_user(self, client, db, users_env):
        admin = users_env["admin"]
        member = users_env["member"]
        resp = await client.patch(
            f"/api/v1/users/{member.id}",
            json={"display_name": "Updated Member"},
            headers=auth_headers(admin),
        )
        assert resp.status_code == 200
        assert resp.json()["display_name"] == "Updated Member"

    async def test_self_update_display_name(self, client, db, users_env):
        member = users_env["member"]
        resp = await client.patch(
            f"/api/v1/users/{member.id}",
            json={"display_name": "My New Name"},
            headers=auth_headers(member),
        )
        assert resp.status_code == 200
        assert resp.json()["display_name"] == "My New Name"

    async def test_non_admin_cannot_change_role(self, client, db, users_env):
        member = users_env["member"]
        resp = await client.patch(
            f"/api/v1/users/{member.id}",
            json={"role": "admin"},
            headers=auth_headers(member),
        )
        assert resp.status_code == 403

    async def test_update_nonexistent_returns_404(self, client, db, users_env):
        admin = users_env["admin"]
        fake_id = str(uuid.uuid4())
        resp = await client.patch(
            f"/api/v1/users/{fake_id}",
            json={"display_name": "Ghost"},
            headers=auth_headers(admin),
        )
        assert resp.status_code == 404

    async def test_create_user_without_password_allowed_when_sso_disabled(
        self, client, db, users_env
    ):
        """A local account may be created with no password and no invite email.
        It lands as a «Pending Setup» account (password-less) — the user sets
        their password on first login via «Forgot password» on the login page.
        The one-time setup token is stored on the row but never returned by the
        API.
        """
        admin = users_env["admin"]
        resp = await client.post(
            "/api/v1/users",
            json={
                "email": "no-pass@test.com",
                "display_name": "No Pass",
                "role": "member",
                "send_email": False,
            },
            headers=auth_headers(admin),
        )
        assert resp.status_code == 201
        data = resp.json()
        assert data["has_password"] is False
        assert data["pending_setup"] is True
        # The one-time setup token is never surfaced through the API.
        assert "setup_token" not in data

    async def test_setup_token_never_returned_by_api(self, client, db, users_env):
        """Neither the create response nor the list endpoint exposes the setup
        token, whether or not a password was supplied at creation."""
        admin = users_env["admin"]
        resp = await client.post(
            "/api/v1/users",
            json={
                "email": "with-pass@test.com",
                "display_name": "With Pass",
                "password": "StrongPass1",
                "role": "member",
                "send_email": False,
            },
            headers=auth_headers(admin),
        )
        assert resp.status_code == 201
        assert "setup_token" not in resp.json()

        # The list endpoint never exposes the setup token either.
        listing = await client.get("/api/v1/users", headers=auth_headers(admin))
        assert all("setup_token" not in u for u in listing.json())

    async def test_admin_setting_password_keeps_invitation_visible_until_login(
        self, client, db, users_env
    ):
        """Setting a password admin-side is NOT acceptance. The user hasn't
        logged in yet, so the invitation stays on the Pending list (so the
        admin can resend it) — but the legacy email setup link is
        invalidated so it can't overwrite the admin-chosen password (#539).
        """
        from sqlalchemy import select

        from app.models.sso_invitation import SsoInvitation
        from app.models.user import User

        admin = users_env["admin"]

        # Inject the "invited but not yet accepted" state directly so this test
        # focuses purely on the admin-set-password path (independent of how the
        # account was first created).
        invited = User(
            email="admin-set@test.com",
            display_name="Admin-Set",
            password_hash=None,
            role="member",
            password_setup_token="legacy-setup-token-XYZ",
        )
        db.add(invited)
        db.add(SsoInvitation(email="admin-set@test.com", role="member"))
        await db.commit()
        await db.refresh(invited)
        user_id = str(invited.id)

        # Admin sets a password via PATCH /users/{id}.
        resp = await client.patch(
            f"/api/v1/users/{user_id}",
            json={"password": "AdminSetsPass1"},
            headers=auth_headers(admin),
        )
        assert resp.status_code == 200

        # Setup token cleared (the legacy email link can no longer overwrite
        # the admin-chosen password).
        await db.refresh(invited)
        assert invited.password_setup_token is None
        assert invited.password_hash is not None
        # Admin-side password set does NOT log the user in.
        assert invited.last_login is None

        # The SsoInvitation row IS NOT deleted — admin can still resend.
        result = await db.execute(
            select(SsoInvitation).where(SsoInvitation.email == "admin-set@test.com")
        )
        assert result.scalar_one_or_none() is not None

        # And the list endpoint keeps showing it as pending.
        resp = await client.get("/api/v1/users/invitations", headers=auth_headers(admin))
        assert resp.status_code == 200
        assert any(inv["email"] == "admin-set@test.com" for inv in resp.json())

    async def test_invitation_hidden_once_user_has_logged_in(self, client, db, users_env):
        """An invitation is hidden from the Pending list once the matching
        user has signed in at least once (last_login is set). The User row
        existing alone (admin set up the account but user never logged in)
        is NOT enough to be considered «accepted» (#539).
        """
        from datetime import datetime, timezone

        from app.core.security import hash_password as _hash
        from app.models.sso_invitation import SsoInvitation
        from app.models.user import User

        admin = users_env["admin"]

        # User who has logged in at least once: invitation should be hidden.
        logged_in = User(
            email="logged-in@test.com",
            display_name="Logged In",
            password_hash=_hash("SomePass1234"),
            role="member",
            last_login=datetime.now(timezone.utc),
        )
        db.add(logged_in)
        db.add(SsoInvitation(email="logged-in@test.com", role="member"))

        # User whose password was set by admin but who has never logged in:
        # invitation should be VISIBLE so admin can resend.
        never_logged_in = User(
            email="never-logged-in@test.com",
            display_name="Never Logged In",
            password_hash=_hash("AnotherPass1"),
            role="member",
        )
        db.add(never_logged_in)
        db.add(SsoInvitation(email="never-logged-in@test.com", role="member"))
        await db.commit()

        resp = await client.get("/api/v1/users/invitations", headers=auth_headers(admin))
        assert resp.status_code == 200
        emails = [inv["email"] for inv in resp.json()]
        assert "logged-in@test.com" not in emails
        assert "never-logged-in@test.com" in emails

    async def test_create_user_no_invite_local_mode_skips_invitation(self, client, db, users_env):
        """Bulk-importing a user with «send invites» unchecked must NOT flag
        the account as Invited. In local-mode (SSO disabled) the SsoInvitation
        row serves no purpose other than the «pending invitations» list — and
        the admin explicitly opted out (#584).
        """
        from sqlalchemy import select

        from app.models.sso_invitation import SsoInvitation

        admin = users_env["admin"]
        resp = await client.post(
            "/api/v1/users",
            json={
                "email": "import-no-invite@test.com",
                "display_name": "Import No Invite",
                "password": "StrongPass1",
                "role": "member",
                "send_email": False,
            },
            headers=auth_headers(admin),
        )
        assert resp.status_code == 201

        # No SsoInvitation row.
        inv_q = await db.execute(
            select(SsoInvitation).where(SsoInvitation.email == "import-no-invite@test.com")
        )
        assert inv_q.scalar_one_or_none() is None

        # And the user is not surfaced on the pending list.
        resp = await client.get("/api/v1/users/invitations", headers=auth_headers(admin))
        assert resp.status_code == 200
        assert all(inv["email"] != "import-no-invite@test.com" for inv in resp.json())

    async def test_create_user_with_invite_local_mode_creates_invitation(
        self, client, db, users_env
    ):
        """When the admin explicitly asks to invite (send_email=True), the
        SsoInvitation row IS created so the user stays on the pending list
        until first login — that's what powers «resend invite» (#539)."""
        from sqlalchemy import select

        from app.models.sso_invitation import SsoInvitation

        admin = users_env["admin"]
        resp = await client.post(
            "/api/v1/users",
            json={
                "email": "import-with-invite@test.com",
                "display_name": "Import With Invite",
                "password": "StrongPass1",
                "role": "member",
                "send_email": True,
            },
            headers=auth_headers(admin),
        )
        assert resp.status_code == 201

        inv_q = await db.execute(
            select(SsoInvitation).where(SsoInvitation.email == "import-with-invite@test.com")
        )
        assert inv_q.scalar_one_or_none() is not None

        resp = await client.get("/api/v1/users/invitations", headers=auth_headers(admin))
        assert resp.status_code == 200
        assert any(inv["email"] == "import-with-invite@test.com" for inv in resp.json())

    async def test_invite_email_failure_does_not_leak_exception_details(
        self, client, db, users_env, monkeypatch
    ):
        """When sending the invitation email raises, the response reports the
        failure generically — exception text (which can carry SMTP hostnames
        or connection details) must only reach the server logs, never the
        API response (CodeQL py/stack-trace-exposure)."""
        import app.services.email_service as email_service

        async def _boom(**kwargs):
            raise RuntimeError("smtp-secret-host boom")

        monkeypatch.setattr(email_service, "send_notification_email", _boom)

        admin = users_env["admin"]
        resp = await client.post(
            "/api/v1/users",
            json={
                "email": "invite-fail@test.com",
                "display_name": "Invite Fail",
                "password": "StrongPass1",
                "role": "member",
                "send_email": True,
            },
            headers=auth_headers(admin),
        )
        assert resp.status_code == 201
        body = resp.json()
        assert body["email_sent"] is False
        assert body["email_error"]
        assert "boom" not in body["email_error"]
        assert "smtp-secret-host" not in body["email_error"]

    async def test_create_user_sso_enabled_without_invite_skips_invitation(
        self, client, db, users_env
    ):
        """In SSO mode with send_email=False the SsoInvitation row must NOT
        be created either — the admin explicitly opted out of notifying the
        user, so the «Invited» chip must stay off (#584 round 2). The User
        row still carries `auth_provider="sso"` and the chosen role, so the
        SSO callback's «link existing user» branch picks up the right role
        on first sign-in without needing a binding row.
        """
        from sqlalchemy import select

        from app.models.app_settings import AppSettings
        from app.models.sso_invitation import SsoInvitation
        from app.models.user import User

        db.add(
            AppSettings(
                id="default",
                general_settings={"sso": {"enabled": True, "provider": "generic_oidc"}},
            )
        )
        await db.commit()

        admin = users_env["admin"]
        resp = await client.post(
            "/api/v1/users",
            json={
                "email": "sso-no-invite@test.com",
                "display_name": "SSO No Invite",
                "role": "member",
                "send_email": False,
                # No password — allowed in SSO mode.
            },
            headers=auth_headers(admin),
        )
        assert resp.status_code == 201, resp.text

        # No SsoInvitation row → no «Invited» chip.
        inv_q = await db.execute(
            select(SsoInvitation).where(SsoInvitation.email == "sso-no-invite@test.com")
        )
        assert inv_q.scalar_one_or_none() is None

        # User row IS there with the chosen role + SSO auth provider, so SSO
        # sign-in will resolve the role from `user.role` directly.
        user_q = await db.execute(select(User).where(User.email == "sso-no-invite@test.com"))
        u = user_q.scalar_one()
        assert u.auth_provider == "sso"
        assert u.role == "member"

        # Not on the pending invitations list.
        resp = await client.get("/api/v1/users/invitations", headers=auth_headers(admin))
        assert resp.status_code == 200
        assert all(inv["email"] != "sso-no-invite@test.com" for inv in resp.json())

    async def test_create_user_sso_enabled_with_invite_creates_invitation(
        self, client, db, users_env
    ):
        """SSO mode + send_email=True still creates the SsoInvitation so the
        resend-invite UX continues to work for genuine SSO invitations."""
        from sqlalchemy import select

        from app.models.app_settings import AppSettings
        from app.models.sso_invitation import SsoInvitation

        db.add(
            AppSettings(
                id="default",
                general_settings={"sso": {"enabled": True, "provider": "generic_oidc"}},
            )
        )
        await db.commit()

        admin = users_env["admin"]
        resp = await client.post(
            "/api/v1/users",
            json={
                "email": "sso-with-invite@test.com",
                "display_name": "SSO With Invite",
                "role": "member",
                "send_email": True,
            },
            headers=auth_headers(admin),
        )
        assert resp.status_code == 201, resp.text

        inv_q = await db.execute(
            select(SsoInvitation).where(SsoInvitation.email == "sso-with-invite@test.com")
        )
        assert inv_q.scalar_one_or_none() is not None

    async def test_create_user_explicit_auth_provider_local(self, client, db, users_env):
        """The import flow forwards `auth_provider="local"` for sheet rows
        explicitly tagged as local. The new user lands as a local account even
        in SSO-enabled tenants (#584 follow-up)."""
        from sqlalchemy import select

        from app.models.app_settings import AppSettings
        from app.models.user import User

        # SSO enabled, so the legacy heuristic would have stamped this user
        # as sso (no password) — the explicit field must override it.
        db.add(
            AppSettings(
                id="default",
                general_settings={"sso": {"enabled": True, "provider": "generic_oidc"}},
            )
        )
        await db.commit()

        admin = users_env["admin"]
        resp = await client.post(
            "/api/v1/users",
            json={
                "email": "local-in-sso-tenant@test.com",
                "display_name": "Local In SSO Tenant",
                "password": "StrongPass1",
                "role": "member",
                "send_email": False,
                "auth_provider": "local",
            },
            headers=auth_headers(admin),
        )
        assert resp.status_code == 201, resp.text

        user_q = await db.execute(select(User).where(User.email == "local-in-sso-tenant@test.com"))
        u = user_q.scalar_one()
        assert u.auth_provider == "local"
        assert u.password_hash is not None

    async def test_create_user_local_no_password_with_invite_issues_setup_token(
        self, client, db, users_env
    ):
        """Local account, no password, send_email=True → the user is created
        with a single-use password_setup_token; the invite email carries the
        /auth/set-password?token=… link so the user picks their own password.
        Passwords are never transported through the import sheet (#584)."""
        from sqlalchemy import select

        from app.models.user import User

        admin = users_env["admin"]
        resp = await client.post(
            "/api/v1/users",
            json={
                "email": "local-pending@test.com",
                "display_name": "Local Pending",
                "role": "member",
                "send_email": True,
                "auth_provider": "local",
            },
            headers=auth_headers(admin),
        )
        assert resp.status_code == 201, resp.text

        user_q = await db.execute(select(User).where(User.email == "local-pending@test.com"))
        u = user_q.scalar_one()
        assert u.auth_provider == "local"
        assert u.password_hash is None
        assert u.password_setup_token is not None
        assert len(u.password_setup_token) >= 32  # urlsafe(48) → 64 chars

    async def test_create_user_local_no_password_without_invite_allowed(
        self, client, db, users_env
    ):
        """Explicit local account, no password, no invite → allowed. It lands
        as a «Pending Setup» account; the user sets their password on first
        login via «Forgot password» on the login page."""
        admin = users_env["admin"]
        resp = await client.post(
            "/api/v1/users",
            json={
                "email": "local-orphan@test.com",
                "display_name": "Local Orphan",
                "role": "member",
                "send_email": False,
                "auth_provider": "local",
            },
            headers=auth_headers(admin),
        )
        assert resp.status_code == 201
        data = resp.json()
        assert data["has_password"] is False
        assert data["pending_setup"] is True
        assert "setup_token" not in data

    async def test_create_user_explicit_auth_provider_sso_requires_sso_enabled(
        self, client, db, users_env
    ):
        """`auth_provider="sso"` is rejected when SSO is disabled — the user
        would have no way to sign in."""
        admin = users_env["admin"]
        resp = await client.post(
            "/api/v1/users",
            json={
                "email": "sso-without-sso@test.com",
                "display_name": "SSO Without SSO",
                "role": "member",
                "send_email": False,
                "auth_provider": "sso",
            },
            headers=auth_headers(admin),
        )
        assert resp.status_code == 400
        assert "sso" in resp.json()["detail"].lower()

    async def test_create_user_unknown_auth_provider_rejected_by_schema(
        self, client, db, users_env
    ):
        """Pydantic should reject auth_provider values outside the literal set."""
        admin = users_env["admin"]
        resp = await client.post(
            "/api/v1/users",
            json={
                "email": "bad-provider@test.com",
                "display_name": "Bad Provider",
                "password": "Pass1234",
                "role": "member",
                "auth_provider": "ldap",
            },
            headers=auth_headers(admin),
        )
        assert resp.status_code == 422


# -------------------------------------------------------------------
# DELETE /users/{id}  (hard delete — row is removed)
# -------------------------------------------------------------------


class TestDeleteUser:
    async def test_admin_can_delete_user(self, client, db, users_env):
        from sqlalchemy import select

        from app.models.user import User

        admin = users_env["admin"]
        viewer = users_env["viewer"]
        viewer_id = viewer.id
        resp = await client.delete(
            f"/api/v1/users/{viewer_id}",
            headers=auth_headers(admin),
        )
        assert resp.status_code == 204

        # Row must actually be gone — soft-delete used to leave it behind
        # which surfaced as the user reappearing on refresh.
        row = (await db.execute(select(User).where(User.id == viewer_id))).scalar_one_or_none()
        assert row is None

    async def test_cannot_delete_self(self, client, db, users_env):
        admin = users_env["admin"]
        resp = await client.delete(
            f"/api/v1/users/{admin.id}",
            headers=auth_headers(admin),
        )
        assert resp.status_code == 400

    async def test_member_cannot_delete_user(self, client, db, users_env):
        member = users_env["member"]
        viewer = users_env["viewer"]
        resp = await client.delete(
            f"/api/v1/users/{viewer.id}",
            headers=auth_headers(member),
        )
        assert resp.status_code == 403

    async def test_delete_nonexistent_returns_404(self, client, db, users_env):
        admin = users_env["admin"]
        fake_id = str(uuid.uuid4())
        resp = await client.delete(
            f"/api/v1/users/{fake_id}",
            headers=auth_headers(admin),
        )
        assert resp.status_code == 404


# -------------------------------------------------------------------
# PATCH /users/me/ui-preferences
# -------------------------------------------------------------------


class TestUiPreferences:
    @pytest.mark.parametrize("tab", ["overview", "workspace", "admin"])
    async def test_accepts_each_valid_dashboard_tab(self, client, db, users_env, tab):
        admin = users_env["admin"]
        resp = await client.patch(
            "/api/v1/users/me/ui-preferences",
            json={"dashboard_default_tab": tab},
            headers=auth_headers(admin),
        )
        assert resp.status_code == 200
        assert resp.json()["dashboard_default_tab"] == tab

    async def test_null_clears_pinned_tab(self, client, db, users_env):
        admin = users_env["admin"]
        await client.patch(
            "/api/v1/users/me/ui-preferences",
            json={"dashboard_default_tab": "admin"},
            headers=auth_headers(admin),
        )
        resp = await client.patch(
            "/api/v1/users/me/ui-preferences",
            json={"dashboard_default_tab": None},
            headers=auth_headers(admin),
        )
        assert resp.status_code == 200
        assert "dashboard_default_tab" not in resp.json()

    async def test_rejects_unknown_tab(self, client, db, users_env):
        admin = users_env["admin"]
        resp = await client.patch(
            "/api/v1/users/me/ui-preferences",
            json={"dashboard_default_tab": "not-a-tab"},
            headers=auth_headers(admin),
        )
        assert resp.status_code == 422

    async def test_persists_diagram_libraries(self, client, db, users_env):
        admin = users_env["admin"]
        libs = ["general", "uml", "archimate3"]
        resp = await client.patch(
            "/api/v1/users/me/ui-preferences",
            json={"diagram_libraries": libs},
            headers=auth_headers(admin),
        )
        assert resp.status_code == 200
        assert resp.json()["diagram_libraries"] == libs
        # Survives a fresh read
        resp = await client.get(
            "/api/v1/users/me/ui-preferences",
            headers=auth_headers(admin),
        )
        assert resp.json()["diagram_libraries"] == libs

    async def test_diagram_libraries_merge_preserves_tab(self, client, db, users_env):
        admin = users_env["admin"]
        await client.patch(
            "/api/v1/users/me/ui-preferences",
            json={"dashboard_default_tab": "workspace"},
            headers=auth_headers(admin),
        )
        resp = await client.patch(
            "/api/v1/users/me/ui-preferences",
            json={"diagram_libraries": ["general", "azure"]},
            headers=auth_headers(admin),
        )
        assert resp.status_code == 200
        body = resp.json()
        assert body["diagram_libraries"] == ["general", "azure"]
        assert body["dashboard_default_tab"] == "workspace"

    async def test_null_clears_diagram_libraries(self, client, db, users_env):
        admin = users_env["admin"]
        await client.patch(
            "/api/v1/users/me/ui-preferences",
            json={"diagram_libraries": ["general", "uml"]},
            headers=auth_headers(admin),
        )
        resp = await client.patch(
            "/api/v1/users/me/ui-preferences",
            json={"diagram_libraries": None},
            headers=auth_headers(admin),
        )
        assert resp.status_code == 200
        assert "diagram_libraries" not in resp.json()
