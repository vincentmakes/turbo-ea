"""Integration tests for the auth dependencies in api/deps.py.

Tests get_current_user, get_optional_user, require_admin, require_bpm_admin,
and require_permission dependency factory.
"""

from __future__ import annotations

import pytest

from app.core.permissions import MEMBER_PERMISSIONS, VIEWER_PERMISSIONS
from tests.conftest import (
    auth_headers,
    create_card_type,
    create_role,
    create_user,
)


@pytest.fixture
async def deps_env(db):
    """Shared test data for dependency tests."""
    await create_role(db, key="admin", label="Admin", permissions={"*": True})
    await create_role(db, key="member", label="Member", permissions=MEMBER_PERMISSIONS)
    await create_role(db, key="viewer", label="Viewer", permissions=VIEWER_PERMISSIONS)
    await create_card_type(db, key="Application", label="Application")
    admin = await create_user(db, email="admin@test.com", role="admin")
    member = await create_user(db, email="member@test.com", role="member")
    viewer = await create_user(db, email="viewer@test.com", role="viewer")
    return {"admin": admin, "member": member, "viewer": viewer}


# ---------------------------------------------------------------------------
# get_current_user — missing/invalid token
# ---------------------------------------------------------------------------


class TestGetCurrentUser:
    async def test_no_auth_header_returns_401(self, client, db, deps_env):
        """Missing Authorization header returns 401."""
        resp = await client.get("/api/v1/cards")
        assert resp.status_code == 401
        assert resp.json()["detail"] == "Not authenticated"

    async def test_malformed_auth_header_returns_401(self, client, db, deps_env):
        """Authorization header without 'Bearer ' prefix returns 401."""
        resp = await client.get(
            "/api/v1/cards",
            headers={"Authorization": "Token abc123"},
        )
        assert resp.status_code == 401

    async def test_empty_bearer_token_returns_401(self, client, db, deps_env):
        """Empty bearer token string returns 401."""
        resp = await client.get(
            "/api/v1/cards",
            headers={"Authorization": "Bearer "},
        )
        assert resp.status_code == 401

    async def test_garbage_token_returns_401(self, client, db, deps_env):
        """Random string as token returns 401 (invalid JWT)."""
        resp = await client.get(
            "/api/v1/cards",
            headers={"Authorization": "Bearer not-a-valid-jwt"},
        )
        assert resp.status_code == 401

    async def test_expired_token_returns_401(self, client, db, deps_env):
        """An expired JWT should return 401."""
        from datetime import datetime, timedelta, timezone

        import jwt

        from app.config import settings

        expired_payload = {
            "sub": str(deps_env["admin"].id),
            "role": "admin",
            "iat": datetime.now(timezone.utc) - timedelta(hours=48),
            "exp": datetime.now(timezone.utc) - timedelta(hours=24),
            "iss": "turbo-ea",
            "aud": "turbo-ea",
        }
        token = jwt.encode(expired_payload, settings.SECRET_KEY, algorithm="HS256")

        resp = await client.get(
            "/api/v1/cards",
            headers={"Authorization": f"Bearer {token}"},
        )
        assert resp.status_code == 401

    async def test_valid_token_returns_data(self, client, db, deps_env):
        """Valid JWT for active user succeeds."""
        admin = deps_env["admin"]
        resp = await client.get(
            "/api/v1/cards",
            headers=auth_headers(admin),
        )
        assert resp.status_code == 200

    async def test_inactive_user_returns_401(self, client, db, deps_env):
        """Valid JWT for an inactive user returns 401."""
        from app.core.security import create_access_token

        inactive = await create_user(db, email="inactive@test.com", role="member")
        inactive.is_active = False
        await db.flush()

        token = create_access_token(inactive.id, inactive.role)
        resp = await client.get(
            "/api/v1/cards",
            headers={"Authorization": f"Bearer {token}"},
        )
        assert resp.status_code == 401
        assert "inactive" in resp.json()["detail"].lower()


# ---------------------------------------------------------------------------
# get_optional_user — graceful fallback
# ---------------------------------------------------------------------------


class TestGetOptionalUser:
    async def test_public_endpoint_no_auth(self, client, db, deps_env):
        """Public endpoints work without auth (get_optional_user returns None)."""
        # /settings/currency is public — no auth needed
        resp = await client.get("/api/v1/settings/currency")
        assert resp.status_code == 200

    async def test_public_endpoint_with_valid_auth(self, client, db, deps_env):
        """Public endpoints also work with valid auth."""
        resp = await client.get(
            "/api/v1/settings/currency",
            headers=auth_headers(deps_env["admin"]),
        )
        assert resp.status_code == 200

    async def test_public_endpoint_with_garbage_auth(self, client, db, deps_env):
        """Public endpoints silently ignore invalid tokens (optional auth)."""
        resp = await client.get(
            "/api/v1/settings/currency",
            headers={"Authorization": "Bearer garbage-token"},
        )
        # Depends on whether the endpoint uses get_optional_user or no auth
        # Currency is public so it should still work
        assert resp.status_code == 200


# ---------------------------------------------------------------------------
# require_permission dependency
# ---------------------------------------------------------------------------


class TestRequirePermission:
    async def test_admin_passes_any_permission(self, client, db, deps_env):
        """Admin (wildcard) passes any permission check."""
        admin = deps_env["admin"]
        # The metamodel endpoint requires admin.metamodel permission
        resp = await client.get(
            "/api/v1/metamodel/types",
            headers=auth_headers(admin),
        )
        assert resp.status_code == 200

    async def test_viewer_denied_create(self, client, db, deps_env):
        """Viewer lacks inventory.create — POST /cards returns 403."""
        viewer = deps_env["viewer"]
        resp = await client.post(
            "/api/v1/cards",
            json={"type": "Application", "name": "Denied Card"},
            headers=auth_headers(viewer),
        )
        assert resp.status_code == 403

    async def test_member_allowed_create(self, client, db, deps_env):
        """Member has inventory.create — POST /cards succeeds."""
        member = deps_env["member"]
        resp = await client.post(
            "/api/v1/cards",
            json={"type": "Application", "name": "Allowed Card"},
            headers=auth_headers(member),
        )
        assert resp.status_code == 200

    async def test_viewer_allowed_view(self, client, db, deps_env):
        """Viewer has inventory.view — GET /cards succeeds."""
        viewer = deps_env["viewer"]
        resp = await client.get(
            "/api/v1/cards",
            headers=auth_headers(viewer),
        )
        assert resp.status_code == 200

    async def test_viewer_denied_admin(self, client, db, deps_env):
        """Viewer denied admin.settings — PATCH /settings/currency returns 403."""
        viewer = deps_env["viewer"]
        resp = await client.patch(
            "/api/v1/settings/currency",
            json={"currency": "EUR"},
            headers=auth_headers(viewer),
        )
        assert resp.status_code == 403
