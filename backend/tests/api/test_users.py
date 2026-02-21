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


# -------------------------------------------------------------------
# DELETE /users/{id}  (soft-delete / deactivate)
# -------------------------------------------------------------------


class TestDeleteUser:
    async def test_admin_can_deactivate_user(self, client, db, users_env):
        admin = users_env["admin"]
        viewer = users_env["viewer"]
        resp = await client.delete(
            f"/api/v1/users/{viewer.id}",
            headers=auth_headers(admin),
        )
        assert resp.status_code == 204

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
