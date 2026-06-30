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
# GET /settings/date-format + PATCH /settings/date-format
# -------------------------------------------------------------------


class TestDateFormatSettings:
    async def test_get_default_date_format(self, client, db, settings_env):
        """Date format endpoint is public (no auth required)."""
        resp = await client.get("/api/v1/settings/date-format")
        assert resp.status_code == 200
        assert resp.json()["date_format"] == "DD MMM YYYY"

    async def test_admin_can_set_date_format(self, client, db, settings_env):
        admin = settings_env["admin"]
        resp = await client.patch(
            "/api/v1/settings/date-format",
            json={"date_format": "DD/MM/YYYY"},
            headers=auth_headers(admin),
        )
        assert resp.status_code == 200
        assert resp.json()["ok"] is True

        get_resp = await client.get("/api/v1/settings/date-format")
        assert get_resp.json()["date_format"] == "DD/MM/YYYY"

    async def test_invalid_date_format_rejected(self, client, db, settings_env):
        admin = settings_env["admin"]
        resp = await client.patch(
            "/api/v1/settings/date-format",
            json={"date_format": "totally-bogus"},
            headers=auth_headers(admin),
        )
        assert resp.status_code == 400

    async def test_member_cannot_set_date_format(self, client, db, settings_env):
        member = settings_env["member"]
        resp = await client.patch(
            "/api/v1/settings/date-format",
            json={"date_format": "YYYY-MM-DD"},
            headers=auth_headers(member),
        )
        assert resp.status_code == 403

    async def test_viewer_cannot_set_date_format(self, client, db, settings_env):
        viewer = settings_env["viewer"]
        resp = await client.patch(
            "/api/v1/settings/date-format",
            json={"date_format": "DD/MM/YYYY"},
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
# GET /settings/grc-enabled + PATCH /settings/grc-enabled
# -------------------------------------------------------------------


class TestGrcEnabledSettings:
    async def test_get_default_grc_enabled(self, client, db, settings_env):
        """GRC enabled endpoint is public and defaults to True."""
        resp = await client.get("/api/v1/settings/grc-enabled")
        assert resp.status_code == 200
        assert resp.json()["enabled"] is True

    async def test_admin_can_toggle_grc(self, client, db, settings_env):
        admin = settings_env["admin"]

        resp = await client.patch(
            "/api/v1/settings/grc-enabled",
            json={"enabled": False},
            headers=auth_headers(admin),
        )
        assert resp.status_code == 200
        assert resp.json()["ok"] is True

        get_resp = await client.get("/api/v1/settings/grc-enabled")
        assert get_resp.json()["enabled"] is False

        resp2 = await client.patch(
            "/api/v1/settings/grc-enabled",
            json={"enabled": True},
            headers=auth_headers(admin),
        )
        assert resp2.status_code == 200

        get_resp2 = await client.get("/api/v1/settings/grc-enabled")
        assert get_resp2.json()["enabled"] is True

    async def test_member_cannot_toggle_grc(self, client, db, settings_env):
        member = settings_env["member"]
        resp = await client.patch(
            "/api/v1/settings/grc-enabled",
            json={"enabled": False},
            headers=auth_headers(member),
        )
        assert resp.status_code == 403


# -------------------------------------------------------------------
# GET /settings/sponsor-button-enabled + PATCH /settings/sponsor-button-enabled
# -------------------------------------------------------------------


class TestSponsorButtonEnabledSettings:
    async def test_get_default_sponsor_button_enabled(self, client, db, settings_env):
        """Sponsor button endpoint is public and defaults to True."""
        resp = await client.get("/api/v1/settings/sponsor-button-enabled")
        assert resp.status_code == 200
        assert resp.json()["enabled"] is True

    async def test_admin_can_toggle_sponsor_button(self, client, db, settings_env):
        admin = settings_env["admin"]

        resp = await client.patch(
            "/api/v1/settings/sponsor-button-enabled",
            json={"enabled": False},
            headers=auth_headers(admin),
        )
        assert resp.status_code == 200
        assert resp.json()["ok"] is True

        get_resp = await client.get("/api/v1/settings/sponsor-button-enabled")
        assert get_resp.json()["enabled"] is False

        # bootstrap reflects the admin edit
        boot = await client.get("/api/v1/settings/bootstrap")
        assert boot.json()["sponsor_button_enabled"] is False

        resp2 = await client.patch(
            "/api/v1/settings/sponsor-button-enabled",
            json={"enabled": True},
            headers=auth_headers(admin),
        )
        assert resp2.status_code == 200

        get_resp2 = await client.get("/api/v1/settings/sponsor-button-enabled")
        assert get_resp2.json()["enabled"] is True

    async def test_member_cannot_toggle_sponsor_button(self, client, db, settings_env):
        member = settings_env["member"]
        resp = await client.patch(
            "/api/v1/settings/sponsor-button-enabled",
            json={"enabled": False},
            headers=auth_headers(member),
        )
        assert resp.status_code == 403


# -------------------------------------------------------------------
# GET /settings/file-uploads-enabled + PATCH /settings/file-uploads-enabled
# -------------------------------------------------------------------


class TestFileUploadsEnabledSettings:
    async def test_get_default_file_uploads_enabled(self, client, db, settings_env):
        """File uploads endpoint is public and defaults to True."""
        resp = await client.get("/api/v1/settings/file-uploads-enabled")
        assert resp.status_code == 200
        assert resp.json()["enabled"] is True

    async def test_admin_can_toggle_file_uploads(self, client, db, settings_env):
        admin = settings_env["admin"]

        resp = await client.patch(
            "/api/v1/settings/file-uploads-enabled",
            json={"enabled": False},
            headers=auth_headers(admin),
        )
        assert resp.status_code == 200
        assert resp.json()["ok"] is True

        get_resp = await client.get("/api/v1/settings/file-uploads-enabled")
        assert get_resp.json()["enabled"] is False

        # Bootstrap mirrors the change.
        boot = await client.get("/api/v1/settings/bootstrap")
        assert boot.json()["file_uploads_enabled"] is False

        resp2 = await client.patch(
            "/api/v1/settings/file-uploads-enabled",
            json={"enabled": True},
            headers=auth_headers(admin),
        )
        assert resp2.status_code == 200

        get_resp2 = await client.get("/api/v1/settings/file-uploads-enabled")
        assert get_resp2.json()["enabled"] is True

    async def test_member_cannot_toggle_file_uploads(self, client, db, settings_env):
        member = settings_env["member"]
        resp = await client.patch(
            "/api/v1/settings/file-uploads-enabled",
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


# -------------------------------------------------------------------
# GET /settings/bootstrap
# -------------------------------------------------------------------


class TestBootstrapSettings:
    """One round-trip equivalent of the small per-setting GETs."""

    async def test_bootstrap_returns_defaults_on_fresh_db(self, client, db, settings_env):
        resp = await client.get("/api/v1/settings/bootstrap")
        assert resp.status_code == 200
        data = resp.json()
        assert data["currency"] == "USD"
        assert data["date_format"] == "DD MMM YYYY"
        assert data["app_title"] == "Turbo EA"
        assert data["bpm_enabled"] is True
        assert data["ppm_enabled"] is False
        assert data["turbolens_enabled"] is True
        assert data["grc_enabled"] is True
        assert data["sponsor_button_enabled"] is True
        assert data["file_uploads_enabled"] is True
        assert "en" in data["enabled_locales"]
        assert data["fiscal_year_start"] == 1
        assert data["bpm_row_order"] == ["management", "core", "support"]
        assert data["show_principles_tab"] is True
        # Login-branding fields default to blank / hidden=false.
        assert data["login_tagline"] == ""
        assert data["login_tagline_hidden"] is False
        assert data["login_help_text"] == ""
        assert data["login_help_link"] == ""
        # smtp_configured reflects whatever the test env has set.
        assert isinstance(data["smtp_configured"], bool)

    async def test_bootstrap_reflects_admin_edits(self, client, db, settings_env):
        admin = settings_env["admin"]
        # Tweak two unrelated settings via their per-endpoint PATCH paths
        await client.patch(
            "/api/v1/settings/currency",
            json={"currency": "EUR"},
            headers=auth_headers(admin),
        )
        await client.patch(
            "/api/v1/settings/ppm-enabled",
            json={"enabled": True},
            headers=auth_headers(admin),
        )

        resp = await client.get("/api/v1/settings/bootstrap")
        assert resp.status_code == 200
        data = resp.json()
        assert data["currency"] == "EUR"
        assert data["ppm_enabled"] is True
        # Untouched fields keep their defaults
        assert data["bpm_enabled"] is True

    async def test_bootstrap_is_public(self, client, db, settings_env):
        """Used during boot, before the user has a token — must not require auth."""
        resp = await client.get("/api/v1/settings/bootstrap")
        assert resp.status_code == 200


# -------------------------------------------------------------------
# GET/PATCH /settings/login-branding
# -------------------------------------------------------------------


class TestLoginBrandingSettings:
    async def test_get_requires_admin(self, client, db, settings_env):
        resp = await client.get(
            "/api/v1/settings/login-branding",
            headers=auth_headers(settings_env["member"]),
        )
        assert resp.status_code == 403

    async def test_get_defaults(self, client, db, settings_env):
        resp = await client.get(
            "/api/v1/settings/login-branding",
            headers=auth_headers(settings_env["admin"]),
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data == {
            "login_tagline": "",
            "login_tagline_hidden": False,
            "login_help_text": "",
            "login_help_link": "",
        }

    async def test_patch_updates_and_bootstrap_reflects(self, client, db, settings_env):
        admin = settings_env["admin"]
        resp = await client.patch(
            "/api/v1/settings/login-branding",
            json={
                "login_tagline": "  Our EA Platform  ",
                "login_tagline_hidden": False,
                "login_help_text": "Need help? Contact IT.",
                "login_help_link": "support@example.com",
            },
            headers=auth_headers(admin),
        )
        assert resp.status_code == 200
        data = resp.json()
        # Whitespace trimmed.
        assert data["login_tagline"] == "Our EA Platform"
        assert data["login_help_text"] == "Need help? Contact IT."
        assert data["login_help_link"] == "support@example.com"
        assert data["login_tagline_hidden"] is False

        # Bootstrap echoes the values.
        boot = await client.get("/api/v1/settings/bootstrap")
        assert boot.status_code == 200
        b = boot.json()
        assert b["login_tagline"] == "Our EA Platform"
        assert b["login_help_text"] == "Need help? Contact IT."
        assert b["login_help_link"] == "support@example.com"
        assert b["login_tagline_hidden"] is False

    async def test_patch_hide_tagline(self, client, db, settings_env):
        admin = settings_env["admin"]
        resp = await client.patch(
            "/api/v1/settings/login-branding",
            json={
                "login_tagline": "",
                "login_tagline_hidden": True,
                "login_help_text": "",
                "login_help_link": "",
            },
            headers=auth_headers(admin),
        )
        assert resp.status_code == 200
        assert resp.json()["login_tagline_hidden"] is True

    async def test_patch_requires_admin(self, client, db, settings_env):
        resp = await client.patch(
            "/api/v1/settings/login-branding",
            json={
                "login_tagline": "Nope",
                "login_tagline_hidden": False,
                "login_help_text": "",
                "login_help_link": "",
            },
            headers=auth_headers(settings_env["viewer"]),
        )
        assert resp.status_code == 403


# -------------------------------------------------------------------
# GET /settings/ai + PATCH /settings/ai — Azure Hosted OpenAI
# -------------------------------------------------------------------


class TestAISettingsAzure:
    async def test_admin_can_save_azure_openai_settings(self, client, db, settings_env):
        admin = settings_env["admin"]
        resp = await client.patch(
            "/api/v1/settings/ai",
            json={
                "enabled": True,
                "provider_type": "azure_openai",
                "provider_url": "https://my-resource.openai.azure.com",
                "api_key": "azure-test-key",
                "model": "my-gpt4o-deployment",
                "api_version": "2025-01-01",
                "enabled_types": ["Application"],
                "portfolio_insights_enabled": False,
            },
            headers=auth_headers(admin),
        )
        assert resp.status_code == 200
        assert resp.json()["ok"] is True

    async def test_azure_settings_persisted_and_returned(self, client, db, settings_env):
        admin = settings_env["admin"]
        await client.patch(
            "/api/v1/settings/ai",
            json={
                "enabled": True,
                "provider_type": "azure_openai",
                "provider_url": "https://my-resource.openai.azure.com",
                "api_key": "azure-test-key",
                "model": "my-gpt4o-deployment",
                "api_version": "2024-05-01-preview",
                "enabled_types": [],
                "portfolio_insights_enabled": False,
            },
            headers=auth_headers(admin),
        )

        get_resp = await client.get("/api/v1/settings/ai", headers=auth_headers(admin))
        assert get_resp.status_code == 200
        data = get_resp.json()
        assert data["provider_type"] == "azure_openai"
        assert data["provider_url"] == "https://my-resource.openai.azure.com"
        assert data["model"] == "my-gpt4o-deployment"
        assert data["api_version"] == "2024-05-01-preview"
        # API key is masked after saving
        assert data["api_key"] == "••••••••"

    async def test_azure_requires_provider_url(self, client, db, settings_env):
        admin = settings_env["admin"]
        resp = await client.patch(
            "/api/v1/settings/ai",
            json={
                "enabled": True,
                "provider_type": "azure_openai",
                "provider_url": "",
                "api_key": "azure-test-key",
                "model": "my-gpt4o-deployment",
                "api_version": "2025-01-01",
                "enabled_types": [],
                "portfolio_insights_enabled": False,
            },
            headers=auth_headers(admin),
        )
        assert resp.status_code == 400

    async def test_azure_openai_is_valid_provider_type(self, client, db, settings_env):
        """azure_openai must be accepted; other unknown types must be rejected."""
        admin = settings_env["admin"]

        # Valid
        resp = await client.patch(
            "/api/v1/settings/ai",
            json={
                "enabled": False,
                "provider_type": "azure_openai",
                "provider_url": "https://my-resource.openai.azure.com",
                "api_key": "",
                "model": "",
                "api_version": "2025-01-01",
                "enabled_types": [],
                "portfolio_insights_enabled": False,
            },
            headers=auth_headers(admin),
        )
        assert resp.status_code == 200

        # Invalid
        resp2 = await client.patch(
            "/api/v1/settings/ai",
            json={
                "enabled": False,
                "provider_type": "unknown_provider",
                "provider_url": "https://example.com",
                "api_key": "",
                "model": "",
                "api_version": "",
                "enabled_types": [],
                "portfolio_insights_enabled": False,
            },
            headers=auth_headers(admin),
        )
        assert resp2.status_code == 400

    async def test_api_version_not_stored_for_non_azure(self, client, db, settings_env):
        """api_version should be empty string when provider is not azure_openai."""
        admin = settings_env["admin"]
        await client.patch(
            "/api/v1/settings/ai",
            json={
                "enabled": False,
                "provider_type": "openai",
                "provider_url": "https://api.openai.com",
                "api_key": "sk-test",
                "model": "gpt-4o-mini",
                "api_version": "2025-01-01",
                "enabled_types": [],
                "portfolio_insights_enabled": False,
            },
            headers=auth_headers(admin),
        )

        get_resp = await client.get("/api/v1/settings/ai", headers=auth_headers(admin))
        data = get_resp.json()
        assert data["provider_type"] == "openai"
        # api_version is cleared for non-Azure providers
        assert data["api_version"] == ""

    async def test_member_cannot_save_azure_settings(self, client, db, settings_env):
        member = settings_env["member"]
        resp = await client.patch(
            "/api/v1/settings/ai",
            json={
                "enabled": True,
                "provider_type": "azure_openai",
                "provider_url": "https://my-resource.openai.azure.com",
                "api_key": "azure-test-key",
                "model": "my-gpt4o-deployment",
                "api_version": "2025-01-01",
                "enabled_types": [],
                "portfolio_insights_enabled": False,
            },
            headers=auth_headers(member),
        )
        assert resp.status_code == 403
