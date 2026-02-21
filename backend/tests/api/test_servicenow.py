"""Integration tests for the /servicenow endpoints.

Tests ServiceNow connection CRUD operations and permission checks.
Sync/mapping endpoints that require a real ServiceNow instance are
not tested here -- only connection management.
"""

from __future__ import annotations

import uuid

import pytest

from app.core.permissions import VIEWER_PERMISSIONS
from tests.conftest import (
    auth_headers,
    create_role,
    create_user,
)


@pytest.fixture
async def snow_env(db):
    """Prerequisite data for ServiceNow tests."""
    await create_role(db, key="admin", label="Admin", permissions={"*": True})
    await create_role(db, key="viewer", label="Viewer", permissions=VIEWER_PERMISSIONS)
    admin = await create_user(db, email="admin@test.com", role="admin")
    viewer = await create_user(db, email="viewer@test.com", role="viewer")
    return {"admin": admin, "viewer": viewer}


# ---------------------------------------------------------------
# POST /servicenow/connections  (create)
# ---------------------------------------------------------------


class TestCreateConnection:
    async def test_create_basic_connection(self, client, db, snow_env):
        """Admin can create a ServiceNow connection with basic auth."""
        admin = snow_env["admin"]
        resp = await client.post(
            "/api/v1/servicenow/connections",
            json={
                "name": "Production SNOW",
                "instance_url": "https://mycompany.service-now.com",
                "auth_type": "basic",
                "username": "api_user",
                "password": "secret123",
            },
            headers=auth_headers(admin),
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["name"] == "Production SNOW"
        assert data["instance_url"] == "https://mycompany.service-now.com"
        assert data["auth_type"] == "basic"
        assert data["is_active"] is True
        assert "id" in data

    async def test_create_oauth2_connection(self, client, db, snow_env):
        """Admin can create a ServiceNow connection with OAuth2 auth."""
        admin = snow_env["admin"]
        resp = await client.post(
            "/api/v1/servicenow/connections",
            json={
                "name": "OAuth SNOW",
                "instance_url": "https://oauth.service-now.com",
                "auth_type": "oauth2",
                "client_id": "my_client_id",
                "client_secret": "my_client_secret",
            },
            headers=auth_headers(admin),
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["name"] == "OAuth SNOW"
        assert data["auth_type"] == "oauth2"

    async def test_create_connection_invalid_url_no_https(self, client, db, snow_env):
        """Connection URL must start with https://."""
        admin = snow_env["admin"]
        resp = await client.post(
            "/api/v1/servicenow/connections",
            json={
                "name": "Bad URL",
                "instance_url": "http://insecure.service-now.com",
                "auth_type": "basic",
                "username": "user",
                "password": "pass",
            },
            headers=auth_headers(admin),
        )
        assert resp.status_code == 400
        assert "HTTPS" in resp.json()["detail"]

    async def test_viewer_cannot_create_connection(self, client, db, snow_env):
        """Viewer role lacks servicenow.manage permission."""
        viewer = snow_env["viewer"]
        resp = await client.post(
            "/api/v1/servicenow/connections",
            json={
                "name": "Denied",
                "instance_url": "https://denied.service-now.com",
                "auth_type": "basic",
                "username": "user",
                "password": "pass",
            },
            headers=auth_headers(viewer),
        )
        assert resp.status_code == 403


# ---------------------------------------------------------------
# GET /servicenow/connections  (list)
# ---------------------------------------------------------------


class TestListConnections:
    async def test_list_empty(self, client, db, snow_env):
        """Listing connections when none exist returns empty list."""
        admin = snow_env["admin"]
        resp = await client.get(
            "/api/v1/servicenow/connections",
            headers=auth_headers(admin),
        )
        assert resp.status_code == 200
        assert resp.json() == []

    async def test_list_returns_created_connections(self, client, db, snow_env):
        """Created connections appear in the list."""
        admin = snow_env["admin"]

        # Create a connection
        create_resp = await client.post(
            "/api/v1/servicenow/connections",
            json={
                "name": "Listed SNOW",
                "instance_url": "https://listed.service-now.com",
                "auth_type": "basic",
                "username": "user",
                "password": "pass",
            },
            headers=auth_headers(admin),
        )
        assert create_resp.status_code == 200
        conn_id = create_resp.json()["id"]

        # List and verify
        resp = await client.get(
            "/api/v1/servicenow/connections",
            headers=auth_headers(admin),
        )
        assert resp.status_code == 200
        data = resp.json()
        assert len(data) >= 1
        ids = [c["id"] for c in data]
        assert conn_id in ids

    async def test_viewer_cannot_list_connections(self, client, db, snow_env):
        """Viewer role lacks servicenow.manage permission for listing."""
        viewer = snow_env["viewer"]
        resp = await client.get(
            "/api/v1/servicenow/connections",
            headers=auth_headers(viewer),
        )
        assert resp.status_code == 403


# ---------------------------------------------------------------
# GET /servicenow/connections/{id}  (get single)
# ---------------------------------------------------------------


class TestGetConnection:
    async def test_get_connection_by_id(self, client, db, snow_env):
        """Admin can fetch a single connection by ID."""
        admin = snow_env["admin"]

        create_resp = await client.post(
            "/api/v1/servicenow/connections",
            json={
                "name": "Get Me",
                "instance_url": "https://getme.service-now.com",
                "auth_type": "basic",
                "username": "user",
                "password": "pass",
            },
            headers=auth_headers(admin),
        )
        conn_id = create_resp.json()["id"]

        resp = await client.get(
            f"/api/v1/servicenow/connections/{conn_id}",
            headers=auth_headers(admin),
        )
        assert resp.status_code == 200
        assert resp.json()["name"] == "Get Me"
        assert resp.json()["id"] == conn_id

    async def test_get_nonexistent_connection_404(self, client, db, snow_env):
        """Getting a nonexistent connection returns 404."""
        admin = snow_env["admin"]
        fake_id = uuid.uuid4()
        resp = await client.get(
            f"/api/v1/servicenow/connections/{fake_id}",
            headers=auth_headers(admin),
        )
        assert resp.status_code == 404


# ---------------------------------------------------------------
# PATCH /servicenow/connections/{id}  (update)
# ---------------------------------------------------------------


class TestUpdateConnection:
    async def test_update_connection_name(self, client, db, snow_env):
        """Admin can update connection name via PATCH."""
        admin = snow_env["admin"]

        create_resp = await client.post(
            "/api/v1/servicenow/connections",
            json={
                "name": "Original Name",
                "instance_url": "https://update.service-now.com",
                "auth_type": "basic",
                "username": "user",
                "password": "pass",
            },
            headers=auth_headers(admin),
        )
        conn_id = create_resp.json()["id"]

        resp = await client.patch(
            f"/api/v1/servicenow/connections/{conn_id}",
            json={"name": "Updated Name"},
            headers=auth_headers(admin),
        )
        assert resp.status_code == 200
        assert resp.json()["name"] == "Updated Name"

    async def test_update_connection_deactivate(self, client, db, snow_env):
        """Admin can deactivate a connection."""
        admin = snow_env["admin"]

        create_resp = await client.post(
            "/api/v1/servicenow/connections",
            json={
                "name": "Active Conn",
                "instance_url": "https://deactivate.service-now.com",
                "auth_type": "basic",
                "username": "user",
                "password": "pass",
            },
            headers=auth_headers(admin),
        )
        conn_id = create_resp.json()["id"]

        resp = await client.patch(
            f"/api/v1/servicenow/connections/{conn_id}",
            json={"is_active": False},
            headers=auth_headers(admin),
        )
        assert resp.status_code == 200
        assert resp.json()["is_active"] is False

    async def test_update_nonexistent_connection_404(self, client, db, snow_env):
        """Updating a nonexistent connection returns 404."""
        admin = snow_env["admin"]
        fake_id = uuid.uuid4()
        resp = await client.patch(
            f"/api/v1/servicenow/connections/{fake_id}",
            json={"name": "Ghost"},
            headers=auth_headers(admin),
        )
        assert resp.status_code == 404

    async def test_update_connection_url_must_be_https(self, client, db, snow_env):
        """Updating instance_url validates HTTPS requirement."""
        admin = snow_env["admin"]

        create_resp = await client.post(
            "/api/v1/servicenow/connections",
            json={
                "name": "URL Test",
                "instance_url": "https://urltest.service-now.com",
                "auth_type": "basic",
                "username": "user",
                "password": "pass",
            },
            headers=auth_headers(admin),
        )
        conn_id = create_resp.json()["id"]

        resp = await client.patch(
            f"/api/v1/servicenow/connections/{conn_id}",
            json={"instance_url": "http://insecure.example.com"},
            headers=auth_headers(admin),
        )
        assert resp.status_code == 400


# ---------------------------------------------------------------
# DELETE /servicenow/connections/{id}
# ---------------------------------------------------------------


class TestDeleteConnection:
    async def test_delete_connection(self, client, db, snow_env):
        """Admin can delete a connection."""
        admin = snow_env["admin"]

        create_resp = await client.post(
            "/api/v1/servicenow/connections",
            json={
                "name": "Delete Me",
                "instance_url": "https://deleteme.service-now.com",
                "auth_type": "basic",
                "username": "user",
                "password": "pass",
            },
            headers=auth_headers(admin),
        )
        conn_id = create_resp.json()["id"]

        resp = await client.delete(
            f"/api/v1/servicenow/connections/{conn_id}",
            headers=auth_headers(admin),
        )
        assert resp.status_code == 200
        assert resp.json()["ok"] is True

        # Verify it is gone
        get_resp = await client.get(
            f"/api/v1/servicenow/connections/{conn_id}",
            headers=auth_headers(admin),
        )
        assert get_resp.status_code == 404

    async def test_delete_nonexistent_connection_404(self, client, db, snow_env):
        """Deleting a nonexistent connection returns 404."""
        admin = snow_env["admin"]
        fake_id = uuid.uuid4()
        resp = await client.delete(
            f"/api/v1/servicenow/connections/{fake_id}",
            headers=auth_headers(admin),
        )
        assert resp.status_code == 404

    async def test_viewer_cannot_delete_connection(self, client, db, snow_env):
        """Viewer role lacks servicenow.manage permission for delete."""
        admin = snow_env["admin"]
        viewer = snow_env["viewer"]

        create_resp = await client.post(
            "/api/v1/servicenow/connections",
            json={
                "name": "Protected",
                "instance_url": "https://protected.service-now.com",
                "auth_type": "basic",
                "username": "user",
                "password": "pass",
            },
            headers=auth_headers(admin),
        )
        conn_id = create_resp.json()["id"]

        resp = await client.delete(
            f"/api/v1/servicenow/connections/{conn_id}",
            headers=auth_headers(viewer),
        )
        assert resp.status_code == 403


# ---------------------------------------------------------------
# Unauthenticated access
# ---------------------------------------------------------------


class TestServiceNowAuth:
    async def test_unauthenticated_list_rejected(self, client, db):
        """ServiceNow endpoints require authentication."""
        resp = await client.get("/api/v1/servicenow/connections")
        assert resp.status_code == 401

    async def test_unauthenticated_create_rejected(self, client, db):
        """ServiceNow create endpoint requires authentication."""
        resp = await client.post(
            "/api/v1/servicenow/connections",
            json={
                "name": "No Auth",
                "instance_url": "https://noauth.service-now.com",
                "auth_type": "basic",
            },
        )
        assert resp.status_code == 401
