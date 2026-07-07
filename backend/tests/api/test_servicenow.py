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
        """Default viewer holds neither servicenow.view nor .manage → 403."""
        viewer = snow_env["viewer"]
        resp = await client.get(
            "/api/v1/servicenow/connections",
            headers=auth_headers(viewer),
        )
        assert resp.status_code == 403


class TestReadOnlyViewPermission:
    """The read-only GET routes are gated on `servicenow.view`; mutations
    still require `servicenow.manage`. A view-only user can read but not write.
    """

    @pytest.fixture
    async def snow_viewer(self, db):
        await create_role(
            db,
            key="snow_reader",
            label="SNOW Reader",
            permissions={**VIEWER_PERMISSIONS, "servicenow.view": True},
            is_system=False,
        )
        return await create_user(db, email="snowreader@test.com", role="snow_reader")

    async def test_view_permission_can_list_connections(self, client, db, snow_viewer):
        resp = await client.get(
            "/api/v1/servicenow/connections",
            headers=auth_headers(snow_viewer),
        )
        assert resp.status_code == 200

    async def test_view_permission_can_list_mappings(self, client, db, snow_viewer):
        resp = await client.get(
            "/api/v1/servicenow/mappings",
            headers=auth_headers(snow_viewer),
        )
        assert resp.status_code == 200

    async def test_view_permission_cannot_create_connection(self, client, db, snow_viewer):
        """View grants read only — creating still needs servicenow.manage."""
        resp = await client.post(
            "/api/v1/servicenow/connections",
            json={
                "name": "Nope",
                "instance_url": "https://x.service-now.com",
                "auth_type": "basic",
                "username": "u",
                "password": "p",
            },
            headers=auth_headers(snow_viewer),
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


# ---------------------------------------------------------------
# POST/GET /servicenow/mappings  — field default values
# ---------------------------------------------------------------


class TestMappingDefaultValues:
    async def test_constant_and_list_default_round_trip(self, client, db, snow_env):
        """A mapping can carry a hardcoded constant (no snow_field) and a coerced
        list default, and both survive a create → GET round-trip."""
        from tests.conftest import create_card_type

        admin = snow_env["admin"]
        await create_card_type(
            db,
            key="ITComponent",
            label="IT Component",
            fields_schema=[
                {"section": "Details", "fields": [{"key": "tags", "type": "multiple_select"}]}
            ],
        )
        conn = await client.post(
            "/api/v1/servicenow/connections",
            json={
                "name": "SNOW",
                "instance_url": "https://c.service-now.com",
                "auth_type": "basic",
                "username": "u",
                "password": "p",
            },
            headers=auth_headers(admin),
        )
        conn_id = conn.json()["id"]

        resp = await client.post(
            "/api/v1/servicenow/mappings",
            json={
                "connection_id": conn_id,
                "card_type_key": "ITComponent",
                "snow_table": "cmdb_ci_hardware",
                "field_mappings": [
                    # Hardcoded constant — no source column.
                    {"turbo_field": "subtype", "snow_field": "", "default_value": "hardware"},
                    # List default coerced from a comma-separated string.
                    {
                        "turbo_field": "attributes.tags",
                        "snow_field": "u_tags",
                        "default_value": "a, b",
                    },
                ],
            },
            headers=auth_headers(admin),
        )
        assert resp.status_code == 200, resp.text
        fms = {fm["turbo_field"]: fm for fm in resp.json()["field_mappings"]}
        assert fms["subtype"]["snow_field"] == ""
        assert fms["subtype"]["default_value"] == "hardware"
        assert fms["attributes.tags"]["default_value"] == ["a", "b"]

    async def test_row_without_source_or_default_is_dropped(self, client, db, snow_env):
        """A field-mapping row with neither a snow_field nor a default is skipped."""
        admin = snow_env["admin"]
        conn = await client.post(
            "/api/v1/servicenow/connections",
            json={
                "name": "SNOW2",
                "instance_url": "https://d.service-now.com",
                "auth_type": "basic",
                "username": "u",
                "password": "p",
            },
            headers=auth_headers(admin),
        )
        resp = await client.post(
            "/api/v1/servicenow/mappings",
            json={
                "connection_id": conn.json()["id"],
                "card_type_key": "Application",
                "snow_table": "cmdb_ci",
                "field_mappings": [
                    {"turbo_field": "name", "snow_field": "name"},
                    {"turbo_field": "description", "snow_field": "", "default_value": None},
                ],
            },
            headers=auth_headers(admin),
        )
        assert resp.status_code == 200, resp.text
        turbo_fields = [fm["turbo_field"] for fm in resp.json()["field_mappings"]]
        assert turbo_fields == ["name"]


# ---------------------------------------------------------------
# GET /servicenow/cards/{id}/links  — derived record deep links
# ---------------------------------------------------------------


class TestCardServiceNowLinks:
    async def test_link_derived_from_identity_map(self, client, db, snow_env):
        """A synced card exposes a deep link built from its identity map row."""
        from app.models.servicenow import (
            SnowConnection,
            SnowIdentityMap,
            SnowMapping,
        )
        from tests.conftest import create_card

        admin = snow_env["admin"]
        card = await create_card(db, name="NexaCore ERP")
        conn = SnowConnection(
            name="Prod SNOW",
            instance_url="https://acme.service-now.com/",  # trailing slash on purpose
            auth_type="basic",
            credentials={},
        )
        db.add(conn)
        await db.flush()
        mapping = SnowMapping(
            connection_id=conn.id, card_type_key="Application", snow_table="cmdb_ci_appl"
        )
        db.add(mapping)
        await db.flush()
        db.add(
            SnowIdentityMap(
                connection_id=conn.id,
                mapping_id=mapping.id,
                card_id=card.id,
                snow_sys_id="abc123",
                snow_table="cmdb_ci_appl",
            )
        )
        await db.flush()

        resp = await client.get(
            f"/api/v1/servicenow/cards/{card.id}/links", headers=auth_headers(admin)
        )
        assert resp.status_code == 200, resp.text
        data = resp.json()
        assert len(data) == 1
        assert data[0]["connection_name"] == "Prod SNOW"
        assert data[0]["table"] == "cmdb_ci_appl"
        assert data[0]["sys_id"] == "abc123"
        # trailing slash collapsed, direct record-form URL
        assert data[0]["url"] == "https://acme.service-now.com/cmdb_ci_appl.do?sys_id=abc123"

    async def test_no_links_for_unsynced_card(self, client, db, snow_env):
        """A card that was never synced returns an empty list."""
        from tests.conftest import create_card

        admin = snow_env["admin"]
        card = await create_card(db, name="Manual Card")
        resp = await client.get(
            f"/api/v1/servicenow/cards/{card.id}/links", headers=auth_headers(admin)
        )
        assert resp.status_code == 200, resp.text
        assert resp.json() == []


# ---------------------------------------------------------------
# Default-value coercion helpers (pure, no DB)
# ---------------------------------------------------------------


class TestDefaultValueCoercion:
    """Unit tests for _field_type_for and _coerce_default_value."""

    _SCHEMA = [
        {
            "section": "Details",
            "fields": [
                {"key": "environment", "type": "single_select"},
                {"key": "tags", "type": "multiple_select"},
                {"key": "monitored", "type": "boolean"},
                {"key": "cost", "type": "cost"},
                {"key": "replicas", "type": "number"},
            ],
        }
    ]

    def test_field_type_for_attribute(self):
        from app.api.v1.servicenow import _field_type_for

        assert _field_type_for(self._SCHEMA, "attributes.tags") == "multiple_select"
        assert _field_type_for(self._SCHEMA, "attributes.monitored") == "boolean"

    def test_field_type_for_core_and_unknown(self):
        from app.api.v1.servicenow import _field_type_for

        # Core paths and unknown attribute keys fall back to text.
        assert _field_type_for(self._SCHEMA, "name") == "text"
        assert _field_type_for(self._SCHEMA, "attributes.nope") == "text"

    def test_coerce_multiple_select_splits_to_list(self):
        from app.api.v1.servicenow import _coerce_default_value

        assert _coerce_default_value("a, b ,c", "multiple_select") == ["a", "b", "c"]
        assert _coerce_default_value(["x", " y "], "multiple_select") == ["x", "y"]

    def test_coerce_boolean_and_numbers(self):
        from app.api.v1.servicenow import _coerce_default_value

        assert _coerce_default_value("yes", "boolean") is True
        assert _coerce_default_value("false", "boolean") is False
        assert _coerce_default_value("42", "number") == 42
        assert _coerce_default_value("3.5", "cost") == 3.5

    def test_coerce_text_and_none(self):
        from app.api.v1.servicenow import _coerce_default_value

        assert _coerce_default_value("  hardware ", "single_select") == "hardware"
        assert _coerce_default_value(None, "text") is None
