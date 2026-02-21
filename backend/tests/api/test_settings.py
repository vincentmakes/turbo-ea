"""Integration tests for the /settings endpoints.

These tests require a PostgreSQL test database and an HTTP test client.
"""

from __future__ import annotations

import pytest

from app.core.permissions import MEMBER_PERMISSIONS, VIEWER_PERMISSIONS
from tests.conftest import (
    auth_headers,
    create_role,
    create_user,
)


@pytest.fixture
async def settings_env(db):
    """Prerequisite data shared by all settings tests."""
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
# GET /settings/currency + PATCH /settings/currency
# -------------------------------------------------------------------


class TestCurrencySettings:
    async def test_get_default_currency(self, client, db, settings_env):
        """Currency endpoint is public (no auth required)."""
        resp = await client.get("/api/v1/settings/currency")
        assert resp.status_code == 200
        assert resp.json()["currency"] == "USD"

    async def test_admin_can_set_currency(self, client, db, settings_env):
        admin = settings_env["admin"]
        resp = await client.patch(
            "/api/v1/settings/currency",
            json={"currency": "EUR"},
            headers=auth_headers(admin),
        )
        assert resp.status_code == 200
        assert resp.json()["ok"] is True

        # Verify the change persisted
        get_resp = await client.get("/api/v1/settings/currency")
        assert get_resp.json()["currency"] == "EUR"

    async def test_member_cannot_set_currency(self, client, db, settings_env):
        member = settings_env["member"]
        resp = await client.patch(
            "/api/v1/settings/currency",
            json={"currency": "GBP"},
            headers=auth_headers(member),
        )
        assert resp.status_code == 403

    async def test_viewer_cannot_set_currency(self, client, db, settings_env):
        viewer = settings_env["viewer"]
        resp = await client.patch(
            "/api/v1/settings/currency",
            json={"currency": "JPY"},
            headers=auth_headers(viewer),
        )
        assert resp.status_code == 403


# -------------------------------------------------------------------
# GET /settings/bpm-enabled + PATCH /settings/bpm-enabled
# -------------------------------------------------------------------


class TestBpmEnabledSettings:
    async def test_get_default_bpm_enabled(self, client, db, settings_env):
        """BPM enabled endpoint is public."""
        resp = await client.get("/api/v1/settings/bpm-enabled")
        assert resp.status_code == 200
        # Default is True
        assert resp.json()["enabled"] is True

    async def test_admin_can_toggle_bpm(self, client, db, settings_env):
        admin = settings_env["admin"]

        # Disable BPM
        resp = await client.patch(
            "/api/v1/settings/bpm-enabled",
            json={"enabled": False},
            headers=auth_headers(admin),
        )
        assert resp.status_code == 200
        assert resp.json()["ok"] is True

        get_resp = await client.get("/api/v1/settings/bpm-enabled")
        assert get_resp.json()["enabled"] is False

        # Re-enable BPM
        resp2 = await client.patch(
            "/api/v1/settings/bpm-enabled",
            json={"enabled": True},
            headers=auth_headers(admin),
        )
        assert resp2.status_code == 200

        get_resp2 = await client.get("/api/v1/settings/bpm-enabled")
        assert get_resp2.json()["enabled"] is True

    async def test_member_cannot_toggle_bpm(self, client, db, settings_env):
        member = settings_env["member"]
        resp = await client.patch(
            "/api/v1/settings/bpm-enabled",
            json={"enabled": False},
            headers=auth_headers(member),
        )
        assert resp.status_code == 403


# -------------------------------------------------------------------
# GET /settings/registration + PATCH /settings/registration
# -------------------------------------------------------------------


class TestRegistrationSettings:
    async def test_get_default_registration(self, client, db, settings_env):
        """Registration endpoint is public."""
        resp = await client.get("/api/v1/settings/registration")
        assert resp.status_code == 200
        assert resp.json()["enabled"] is True

    async def test_admin_can_disable_registration(self, client, db, settings_env):
        admin = settings_env["admin"]
        resp = await client.patch(
            "/api/v1/settings/registration",
            json={"enabled": False},
            headers=auth_headers(admin),
        )
        assert resp.status_code == 200
        assert resp.json()["ok"] is True

        get_resp = await client.get("/api/v1/settings/registration")
        assert get_resp.json()["enabled"] is False

    async def test_member_cannot_change_registration(self, client, db, settings_env):
        member = settings_env["member"]
        resp = await client.patch(
            "/api/v1/settings/registration",
            json={"enabled": False},
            headers=auth_headers(member),
        )
        assert resp.status_code == 403


# -------------------------------------------------------------------
# GET /settings/email (admin-only)
# -------------------------------------------------------------------


class TestEmailSettings:
    async def test_admin_can_get_email_settings(self, client, db, settings_env):
        admin = settings_env["admin"]
        resp = await client.get(
            "/api/v1/settings/email",
            headers=auth_headers(admin),
        )
        assert resp.status_code == 200
        data = resp.json()
        assert "smtp_host" in data
        assert "smtp_port" in data

    async def test_member_cannot_get_email_settings(self, client, db, settings_env):
        member = settings_env["member"]
        resp = await client.get(
            "/api/v1/settings/email",
            headers=auth_headers(member),
        )
        assert resp.status_code == 403

    async def test_admin_can_update_email_settings(self, client, db, settings_env):
        admin = settings_env["admin"]
        resp = await client.patch(
            "/api/v1/settings/email",
            json={
                "smtp_host": "smtp.example.com",
                "smtp_port": 465,
                "smtp_user": "user@example.com",
                "smtp_password": "",
                "smtp_from": "noreply@example.com",
                "smtp_tls": True,
            },
            headers=auth_headers(admin),
        )
        assert resp.status_code == 200
        assert resp.json()["ok"] is True

        # Verify stored
        get_resp = await client.get(
            "/api/v1/settings/email",
            headers=auth_headers(admin),
        )
        data = get_resp.json()
        assert data["smtp_host"] == "smtp.example.com"
        assert data["smtp_port"] == 465
