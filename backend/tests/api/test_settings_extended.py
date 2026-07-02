"""Extended integration tests for settings endpoints.

Covers: logo upload/delete, favicon upload/delete, SSO config, email test,
bpm-row-order — the endpoints NOT covered by test_settings.py.
"""

from __future__ import annotations

import io

import pytest

from app.core.permissions import MEMBER_PERMISSIONS, VIEWER_PERMISSIONS
from tests.conftest import (
    auth_headers,
    create_role,
    create_user,
)


@pytest.fixture
async def ext_settings_env(db):
    """Prerequisite data shared by all extended settings tests."""
    await create_role(db, key="admin", label="Admin", permissions={"*": True})
    await create_role(db, key="member", label="Member", permissions=MEMBER_PERMISSIONS)
    await create_role(db, key="viewer", label="Viewer", permissions=VIEWER_PERMISSIONS)
    admin = await create_user(db, email="admin@test.com", role="admin")
    member = await create_user(db, email="member@test.com", role="member")
    viewer = await create_user(db, email="viewer@test.com", role="viewer")
    return {"admin": admin, "member": member, "viewer": viewer}


# -------------------------------------------------------------------
# Logo endpoints
# -------------------------------------------------------------------


class TestLogoEndpoints:
    async def test_get_logo_default_redirects(self, client, db, ext_settings_env):
        """Without custom logo, GET /logo redirects to default."""
        resp = await client.get("/api/v1/settings/logo", follow_redirects=False)
        assert resp.status_code == 302
        assert "/logo.png" in resp.headers.get("location", "")

    async def test_upload_logo_success(self, client, db, ext_settings_env):
        """Admin can upload a PNG logo."""
        admin = ext_settings_env["admin"]
        # 1x1 transparent PNG
        png_bytes = (
            b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01"
            b"\x00\x00\x00\x01\x08\x06\x00\x00\x00\x1f\x15\xc4\x89"
            b"\x00\x00\x00\nIDATx\x9cc\x00\x01\x00\x00\x05\x00\x01"
            b"\r\n\xb4\x00\x00\x00\x00IEND\xaeB`\x82"
        )
        resp = await client.post(
            "/api/v1/settings/logo",
            files={"file": ("logo.png", io.BytesIO(png_bytes), "image/png")},
            headers=auth_headers(admin),
        )
        assert resp.status_code == 200
        assert resp.json()["ok"] is True

    async def test_upload_logo_returns_custom(self, client, db, ext_settings_env):
        """After uploading, GET /logo returns the custom image (no redirect)."""
        admin = ext_settings_env["admin"]
        png_bytes = b"\x89PNG\r\n\x1a\nSOMEBYTES"
        await client.post(
            "/api/v1/settings/logo",
            files={"file": ("logo.png", io.BytesIO(png_bytes), "image/png")},
            headers=auth_headers(admin),
        )
        resp = await client.get("/api/v1/settings/logo")
        assert resp.status_code == 200

    async def test_upload_logo_bad_mime_rejected(self, client, db, ext_settings_env):
        """Uploading a non-image file is rejected."""
        admin = ext_settings_env["admin"]
        resp = await client.post(
            "/api/v1/settings/logo",
            files={"file": ("logo.txt", io.BytesIO(b"not an image"), "text/plain")},
            headers=auth_headers(admin),
        )
        assert resp.status_code == 400
        assert "Unsupported" in resp.json()["detail"]

    async def test_upload_logo_too_large_rejected(self, client, db, ext_settings_env):
        """Logo over 2MB is rejected."""
        admin = ext_settings_env["admin"]
        big_data = b"\x00" * (2 * 1024 * 1024 + 1)
        resp = await client.post(
            "/api/v1/settings/logo",
            files={"file": ("huge.png", io.BytesIO(big_data), "image/png")},
            headers=auth_headers(admin),
        )
        assert resp.status_code == 400
        assert "MB" in resp.json()["detail"]

    async def test_member_cannot_upload_logo(self, client, db, ext_settings_env):
        """Member role lacks admin.settings permission."""
        member = ext_settings_env["member"]
        resp = await client.post(
            "/api/v1/settings/logo",
            files={"file": ("logo.png", io.BytesIO(b"fake"), "image/png")},
            headers=auth_headers(member),
        )
        assert resp.status_code == 403

    async def test_delete_logo(self, client, db, ext_settings_env):
        """Admin can reset logo to default."""
        admin = ext_settings_env["admin"]
        # Upload first
        await client.post(
            "/api/v1/settings/logo",
            files={"file": ("logo.png", io.BytesIO(b"\x89PNG"), "image/png")},
            headers=auth_headers(admin),
        )
        # Delete
        resp = await client.delete(
            "/api/v1/settings/logo",
            headers=auth_headers(admin),
        )
        assert resp.status_code == 200
        assert resp.json()["ok"] is True

        # Should redirect again
        get_resp = await client.get("/api/v1/settings/logo", follow_redirects=False)
        assert get_resp.status_code == 302

    async def test_logo_info_no_custom(self, client, db, ext_settings_env):
        """Logo info returns has_custom_logo=False when no custom logo."""
        admin = ext_settings_env["admin"]
        resp = await client.get(
            "/api/v1/settings/logo/info",
            headers=auth_headers(admin),
        )
        assert resp.status_code == 200
        assert resp.json()["has_custom_logo"] is False

    async def test_logo_info_with_custom(self, client, db, ext_settings_env):
        """Logo info returns has_custom_logo=True after upload."""
        admin = ext_settings_env["admin"]
        await client.post(
            "/api/v1/settings/logo",
            files={"file": ("logo.png", io.BytesIO(b"\x89PNG"), "image/png")},
            headers=auth_headers(admin),
        )
        resp = await client.get(
            "/api/v1/settings/logo/info",
            headers=auth_headers(admin),
        )
        assert resp.status_code == 200
        assert resp.json()["has_custom_logo"] is True

    async def test_member_cannot_get_logo_info(self, client, db, ext_settings_env):
        """Logo info is admin-only."""
        member = ext_settings_env["member"]
        resp = await client.get(
            "/api/v1/settings/logo/info",
            headers=auth_headers(member),
        )
        assert resp.status_code == 403


# -------------------------------------------------------------------
# Favicon endpoints
# -------------------------------------------------------------------


class TestFaviconEndpoints:
    async def test_get_favicon_default_redirects(self, client, db, ext_settings_env):
        """Without custom favicon, GET /favicon redirects to default."""
        resp = await client.get("/api/v1/settings/favicon", follow_redirects=False)
        assert resp.status_code == 302
        assert "/favicon.png" in resp.headers.get("location", "")

    async def test_upload_favicon_success(self, client, db, ext_settings_env):
        """Admin can upload a favicon."""
        admin = ext_settings_env["admin"]
        resp = await client.post(
            "/api/v1/settings/favicon",
            files={"file": ("icon.png", io.BytesIO(b"\x89PNG"), "image/png")},
            headers=auth_headers(admin),
        )
        assert resp.status_code == 200
        assert resp.json()["ok"] is True

    async def test_upload_favicon_bad_mime_rejected(self, client, db, ext_settings_env):
        """Uploading a non-image favicon is rejected."""
        admin = ext_settings_env["admin"]
        resp = await client.post(
            "/api/v1/settings/favicon",
            files={"file": ("icon.svg", io.BytesIO(b"<svg>"), "image/svg+xml")},
            headers=auth_headers(admin),
        )
        assert resp.status_code == 400

    async def test_delete_favicon(self, client, db, ext_settings_env):
        """Admin can reset favicon to default."""
        admin = ext_settings_env["admin"]
        await client.post(
            "/api/v1/settings/favicon",
            files={"file": ("icon.png", io.BytesIO(b"\x89PNG"), "image/png")},
            headers=auth_headers(admin),
        )
        resp = await client.delete(
            "/api/v1/settings/favicon",
            headers=auth_headers(admin),
        )
        assert resp.status_code == 200
        assert resp.json()["ok"] is True

    async def test_favicon_info(self, client, db, ext_settings_env):
        admin = ext_settings_env["admin"]
        resp = await client.get(
            "/api/v1/settings/favicon/info",
            headers=auth_headers(admin),
        )
        assert resp.status_code == 200
        assert "has_custom_favicon" in resp.json()

    async def test_member_cannot_delete_favicon(self, client, db, ext_settings_env):
        member = ext_settings_env["member"]
        resp = await client.delete(
            "/api/v1/settings/favicon",
            headers=auth_headers(member),
        )
        assert resp.status_code == 403


# -------------------------------------------------------------------
# SSO endpoints
# -------------------------------------------------------------------


class TestSsoEndpoints:
    async def test_get_sso_default(self, client, db, ext_settings_env):
        """Admin can get SSO settings, default is disabled."""
        admin = ext_settings_env["admin"]
        resp = await client.get(
            "/api/v1/settings/sso",
            headers=auth_headers(admin),
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["enabled"] is False
        assert data["client_id"] == ""
        assert data["tenant_id"] == "organizations"

    async def test_update_sso(self, client, db, ext_settings_env):
        """Admin can enable SSO with client credentials."""
        admin = ext_settings_env["admin"]
        resp = await client.patch(
            "/api/v1/settings/sso",
            json={
                "enabled": True,
                "client_id": "my-client-id",
                "client_secret": "my-secret",
                "tenant_id": "my-tenant-id",
            },
            headers=auth_headers(admin),
        )
        assert resp.status_code == 200
        assert resp.json()["ok"] is True

        # Verify stored (secret should be masked)
        get_resp = await client.get(
            "/api/v1/settings/sso",
            headers=auth_headers(admin),
        )
        data = get_resp.json()
        assert data["enabled"] is True
        assert data["client_id"] == "my-client-id"
        assert data["client_secret"] == "••••••••"
        assert data["tenant_id"] == "my-tenant-id"

    async def test_update_sso_masked_secret_preserves_existing(self, client, db, ext_settings_env):
        """Sending masked placeholder does not overwrite the stored secret."""
        admin = ext_settings_env["admin"]
        # Set initial secret
        await client.patch(
            "/api/v1/settings/sso",
            json={"enabled": True, "client_id": "cid", "client_secret": "real-secret"},
            headers=auth_headers(admin),
        )
        # Update with masked placeholder — secret should not change
        resp = await client.patch(
            "/api/v1/settings/sso",
            json={"enabled": True, "client_id": "cid", "client_secret": "••••••••"},
            headers=auth_headers(admin),
        )
        assert resp.status_code == 200

        # Secret still masked (meaning it's still stored)
        get_resp = await client.get(
            "/api/v1/settings/sso",
            headers=auth_headers(admin),
        )
        assert get_resp.json()["client_secret"] == "••••••••"

    async def test_sso_status_public(self, client, db, ext_settings_env):
        """SSO status is a public endpoint (no auth required)."""
        resp = await client.get("/api/v1/settings/sso/status")
        assert resp.status_code == 200
        assert "enabled" in resp.json()

    async def test_member_cannot_update_sso(self, client, db, ext_settings_env):
        member = ext_settings_env["member"]
        resp = await client.patch(
            "/api/v1/settings/sso",
            json={"enabled": True, "client_id": "x", "client_secret": "y"},
            headers=auth_headers(member),
        )
        assert resp.status_code == 403

    async def test_member_cannot_get_sso(self, client, db, ext_settings_env):
        member = ext_settings_env["member"]
        resp = await client.get(
            "/api/v1/settings/sso",
            headers=auth_headers(member),
        )
        assert resp.status_code == 403


# -------------------------------------------------------------------
# BPM row-order endpoints
# -------------------------------------------------------------------


class TestBpmRowOrder:
    async def test_get_default_row_order(self, client, db, ext_settings_env):
        """Public endpoint returns default row order."""
        resp = await client.get("/api/v1/settings/bpm-row-order")
        assert resp.status_code == 200
        data = resp.json()
        assert data["row_order"] == ["management", "core", "support"]

    async def test_admin_can_set_row_order(self, client, db, ext_settings_env):
        admin = ext_settings_env["admin"]
        new_order = ["core", "support", "management"]
        resp = await client.patch(
            "/api/v1/settings/bpm-row-order",
            json={"row_order": new_order},
            headers=auth_headers(admin),
        )
        assert resp.status_code == 200
        assert resp.json()["ok"] is True

        get_resp = await client.get("/api/v1/settings/bpm-row-order")
        assert get_resp.json()["row_order"] == new_order

    async def test_member_cannot_set_row_order(self, client, db, ext_settings_env):
        member = ext_settings_env["member"]
        resp = await client.patch(
            "/api/v1/settings/bpm-row-order",
            json={"row_order": ["core"]},
            headers=auth_headers(member),
        )
        assert resp.status_code == 403


# -------------------------------------------------------------------
# Email test endpoint
# -------------------------------------------------------------------


class TestEmailTestEndpoint:
    async def test_member_cannot_send_test_email(self, client, db, ext_settings_env):
        """Member role cannot trigger test email."""
        member = ext_settings_env["member"]
        resp = await client.post(
            "/api/v1/settings/email/test",
            headers=auth_headers(member),
        )
        assert resp.status_code == 403

    async def test_email_password_masked_in_response(self, client, db, ext_settings_env):
        """Email settings should mask the password in GET response."""
        admin = ext_settings_env["admin"]
        # Set a password
        await client.patch(
            "/api/v1/settings/email",
            json={
                "smtp_host": "smtp.example.com",
                "smtp_port": 587,
                "smtp_user": "user",
                "smtp_password": "realpassword",
                "smtp_from": "noreply@example.com",
                "smtp_tls": True,
            },
            headers=auth_headers(admin),
        )
        # Get should mask the password
        resp = await client.get(
            "/api/v1/settings/email",
            headers=auth_headers(admin),
        )
        assert resp.json()["smtp_password"] == "••••••••"

    async def test_email_masked_placeholder_preserves_password(self, client, db, ext_settings_env):
        """Sending the masked placeholder should not overwrite the real password."""
        admin = ext_settings_env["admin"]
        # Set initial password
        await client.patch(
            "/api/v1/settings/email",
            json={
                "smtp_host": "smtp.example.com",
                "smtp_port": 587,
                "smtp_user": "user",
                "smtp_password": "realpassword",
                "smtp_from": "noreply@example.com",
                "smtp_tls": True,
            },
            headers=auth_headers(admin),
        )
        # Update host only, send masked password
        await client.patch(
            "/api/v1/settings/email",
            json={
                "smtp_host": "smtp2.example.com",
                "smtp_port": 587,
                "smtp_user": "user",
                "smtp_password": "••••••••",
                "smtp_from": "noreply@example.com",
                "smtp_tls": True,
            },
            headers=auth_headers(admin),
        )
        resp = await client.get(
            "/api/v1/settings/email",
            headers=auth_headers(admin),
        )
        data = resp.json()
        assert data["smtp_host"] == "smtp2.example.com"
        # Password still masked = still stored
        assert data["smtp_password"] == "••••••••"

    async def test_rejects_unknown_method(self, client, db, ext_settings_env):
        """PATCH with an unsupported email method is rejected."""
        admin = ext_settings_env["admin"]
        resp = await client.patch(
            "/api/v1/settings/email",
            json={"method": "carrier_pigeon"},
            headers=auth_headers(admin),
        )
        assert resp.status_code == 400

    async def test_graph_method_round_trips(self, client, db, ext_settings_env):
        """graph_api method + oauth fields persist and report configured."""
        admin = ext_settings_env["admin"]
        await client.patch(
            "/api/v1/settings/email",
            json={
                "method": "graph_api",
                "oauth_provider": "microsoft",
                "oauth_tenant_id": "tenant-1",
                "oauth_client_id": "client-1",
                "oauth_client_secret": "shh-secret",
                "graph_sender": "mailbox@company.com",
                "smtp_from": "brand@company.com",
            },
            headers=auth_headers(admin),
        )
        resp = await client.get("/api/v1/settings/email", headers=auth_headers(admin))
        data = resp.json()
        assert data["method"] == "graph_api"
        assert data["oauth_tenant_id"] == "tenant-1"
        assert data["graph_sender"] == "mailbox@company.com"
        # Secret masked, never returned in plaintext
        assert data["oauth_client_secret"] == "••••••••"
        assert data["configured"] is True

    async def test_partial_patch_preserves_method_and_oauth(self, client, db, ext_settings_env):
        """A PATCH built against the old payload shape (no method/oauth fields)
        must not reset the stored method or blank the OAuth config."""
        admin = ext_settings_env["admin"]
        await client.patch(
            "/api/v1/settings/email",
            json={
                "method": "graph_api",
                "oauth_tenant_id": "t",
                "oauth_client_id": "c",
                "oauth_client_secret": "sec",
                "graph_sender": "m@company.com",
            },
            headers=auth_headers(admin),
        )
        # Old-shape client tweaks only the From address.
        await client.patch(
            "/api/v1/settings/email",
            json={"smtp_from": "brand@company.com"},
            headers=auth_headers(admin),
        )
        resp = await client.get("/api/v1/settings/email", headers=auth_headers(admin))
        data = resp.json()
        assert data["method"] == "graph_api"
        assert data["oauth_tenant_id"] == "t"
        assert data["graph_sender"] == "m@company.com"
        assert data["smtp_from"] == "brand@company.com"
        assert data["configured"] is True

    async def test_patch_returns_masked_settings(self, client, db, ext_settings_env):
        """PATCH echoes the same masked body as GET so the UI needs no refetch."""
        admin = ext_settings_env["admin"]
        resp = await client.patch(
            "/api/v1/settings/email",
            json={
                "method": "graph_api",
                "oauth_tenant_id": "t",
                "oauth_client_id": "c",
                "oauth_client_secret": "sec",
                "graph_sender": "m@company.com",
            },
            headers=auth_headers(admin),
        )
        data = resp.json()
        assert data["ok"] is True
        assert data["configured"] is True
        assert data["oauth_client_secret"] == "••••••••"

    async def test_oauth_secret_masked_placeholder_preserved(self, client, db, ext_settings_env):
        """Sending the masked placeholder must not overwrite the stored oauth secret."""
        admin = ext_settings_env["admin"]
        await client.patch(
            "/api/v1/settings/email",
            json={
                "method": "graph_api",
                "oauth_tenant_id": "t",
                "oauth_client_id": "c",
                "oauth_client_secret": "real-secret",
                "graph_sender": "m@company.com",
            },
            headers=auth_headers(admin),
        )
        # Change the sender, re-send the masked secret
        await client.patch(
            "/api/v1/settings/email",
            json={
                "method": "graph_api",
                "oauth_tenant_id": "t",
                "oauth_client_id": "c",
                "oauth_client_secret": "••••••••",
                "graph_sender": "m2@company.com",
            },
            headers=auth_headers(admin),
        )
        resp = await client.get("/api/v1/settings/email", headers=auth_headers(admin))
        data = resp.json()
        assert data["graph_sender"] == "m2@company.com"
        assert data["oauth_client_secret"] == "••••••••"
        assert data["configured"] is True


# -------------------------------------------------------------------
# Archived-card retention endpoint
# -------------------------------------------------------------------


class TestArchiveRetentionDays:
    async def test_get_default_is_30(self, client, db, ext_settings_env):
        """Public endpoint defaults to 30 days when unset."""
        resp = await client.get("/api/v1/settings/archive-retention-days")
        assert resp.status_code == 200
        assert resp.json()["days"] == 30

    async def test_bootstrap_includes_retention(self, client, db, ext_settings_env):
        resp = await client.get("/api/v1/settings/bootstrap")
        assert resp.status_code == 200
        assert resp.json()["archive_retention_days"] == 30

    async def test_admin_can_set_retention(self, client, db, ext_settings_env):
        admin = ext_settings_env["admin"]
        resp = await client.patch(
            "/api/v1/settings/archive-retention-days",
            json={"days": 90},
            headers=auth_headers(admin),
        )
        assert resp.status_code == 200
        assert resp.json()["days"] == 90

        get_resp = await client.get("/api/v1/settings/archive-retention-days")
        assert get_resp.json()["days"] == 90
        boot = await client.get("/api/v1/settings/bootstrap")
        assert boot.json()["archive_retention_days"] == 90

    async def test_zero_means_indefinite(self, client, db, ext_settings_env):
        admin = ext_settings_env["admin"]
        resp = await client.patch(
            "/api/v1/settings/archive-retention-days",
            json={"days": 0},
            headers=auth_headers(admin),
        )
        assert resp.status_code == 200
        assert resp.json()["days"] == 0

    async def test_negative_rejected(self, client, db, ext_settings_env):
        admin = ext_settings_env["admin"]
        resp = await client.patch(
            "/api/v1/settings/archive-retention-days",
            json={"days": -1},
            headers=auth_headers(admin),
        )
        assert resp.status_code == 422

    async def test_over_max_rejected(self, client, db, ext_settings_env):
        admin = ext_settings_env["admin"]
        resp = await client.patch(
            "/api/v1/settings/archive-retention-days",
            json={"days": 4000},
            headers=auth_headers(admin),
        )
        assert resp.status_code == 422

    async def test_member_cannot_set_retention(self, client, db, ext_settings_env):
        member = ext_settings_env["member"]
        resp = await client.patch(
            "/api/v1/settings/archive-retention-days",
            json={"days": 90},
            headers=auth_headers(member),
        )
        assert resp.status_code == 403
