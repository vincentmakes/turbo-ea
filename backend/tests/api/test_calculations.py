"""Integration tests for the /calculations endpoints.

These tests require a PostgreSQL test database and an HTTP test client.
"""

from __future__ import annotations

import uuid

import pytest

from app.core.permissions import MEMBER_PERMISSIONS, VIEWER_PERMISSIONS
from tests.conftest import (
    auth_headers,
    create_card_type,
    create_role,
    create_user,
)


@pytest.fixture
async def calc_env(db):
    """Prerequisite data shared by all calculation tests."""
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
    await create_card_type(
        db,
        key="Application",
        label="Application",
        fields_schema=[
            {
                "section": "General",
                "fields": [
                    {
                        "key": "costTotalAnnual",
                        "label": "Annual Cost",
                        "type": "cost",
                        "weight": 1,
                    },
                ],
            }
        ],
    )
    admin = await create_user(db, email="admin@test.com", role="admin")
    member = await create_user(db, email="member@test.com", role="member")
    viewer = await create_user(db, email="viewer@test.com", role="viewer")
    return {"admin": admin, "member": member, "viewer": viewer}


# -------------------------------------------------------------------
# POST /calculations  (create)
# -------------------------------------------------------------------


class TestCreateCalculation:
    async def test_admin_can_create(self, client, db, calc_env):
        admin = calc_env["admin"]
        resp = await client.post(
            "/api/v1/calculations",
            json={
                "name": "Total Cost",
                "target_type_key": "Application",
                "target_field_key": "costTotalAnnual",
                "formula": "42",
            },
            headers=auth_headers(admin),
        )
        assert resp.status_code == 201
        data = resp.json()
        assert data["name"] == "Total Cost"
        assert data["target_type_key"] == "Application"
        assert data["is_active"] is False

    async def test_member_cannot_create(self, client, db, calc_env):
        member = calc_env["member"]
        resp = await client.post(
            "/api/v1/calculations",
            json={
                "name": "Blocked",
                "target_type_key": "Application",
                "target_field_key": "costTotalAnnual",
                "formula": "1+1",
            },
            headers=auth_headers(member),
        )
        assert resp.status_code == 403

    async def test_viewer_cannot_create(self, client, db, calc_env):
        viewer = calc_env["viewer"]
        resp = await client.post(
            "/api/v1/calculations",
            json={
                "name": "Blocked",
                "target_type_key": "Application",
                "target_field_key": "costTotalAnnual",
                "formula": "1+1",
            },
            headers=auth_headers(viewer),
        )
        assert resp.status_code == 403


# -------------------------------------------------------------------
# GET /calculations  (list)
# -------------------------------------------------------------------


class TestListCalculations:
    async def test_list_returns_calculations(self, client, db, calc_env):
        admin = calc_env["admin"]
        # Create two calculations
        await client.post(
            "/api/v1/calculations",
            json={
                "name": "Calc A",
                "target_type_key": "Application",
                "target_field_key": "costTotalAnnual",
                "formula": "1",
            },
            headers=auth_headers(admin),
        )
        await client.post(
            "/api/v1/calculations",
            json={
                "name": "Calc B",
                "target_type_key": "Application",
                "target_field_key": "costTotalAnnual",
                "formula": "2",
            },
            headers=auth_headers(admin),
        )

        resp = await client.get(
            "/api/v1/calculations",
            headers=auth_headers(admin),
        )
        assert resp.status_code == 200
        names = [c["name"] for c in resp.json()]
        assert "Calc A" in names
        assert "Calc B" in names

    async def test_filter_by_type_key(self, client, db, calc_env):
        admin = calc_env["admin"]
        await client.post(
            "/api/v1/calculations",
            json={
                "name": "App Calc",
                "target_type_key": "Application",
                "target_field_key": "costTotalAnnual",
                "formula": "1",
            },
            headers=auth_headers(admin),
        )

        resp = await client.get(
            "/api/v1/calculations?type_key=Application",
            headers=auth_headers(admin),
        )
        assert resp.status_code == 200
        assert len(resp.json()) >= 1

        resp2 = await client.get(
            "/api/v1/calculations?type_key=NonExistent",
            headers=auth_headers(admin),
        )
        assert resp2.status_code == 200
        assert len(resp2.json()) == 0


# -------------------------------------------------------------------
# DELETE /calculations/{id}
# -------------------------------------------------------------------


class TestDeleteCalculation:
    async def test_admin_can_delete(self, client, db, calc_env):
        admin = calc_env["admin"]
        create_resp = await client.post(
            "/api/v1/calculations",
            json={
                "name": "Delete Me",
                "target_type_key": "Application",
                "target_field_key": "costTotalAnnual",
                "formula": "0",
            },
            headers=auth_headers(admin),
        )
        calc_id = create_resp.json()["id"]

        resp = await client.delete(
            f"/api/v1/calculations/{calc_id}",
            headers=auth_headers(admin),
        )
        assert resp.status_code == 204

    async def test_delete_nonexistent_returns_404(self, client, db, calc_env):
        admin = calc_env["admin"]
        fake_id = str(uuid.uuid4())
        resp = await client.delete(
            f"/api/v1/calculations/{fake_id}",
            headers=auth_headers(admin),
        )
        assert resp.status_code == 404

    async def test_member_cannot_delete(self, client, db, calc_env):
        admin = calc_env["admin"]
        member = calc_env["member"]
        create_resp = await client.post(
            "/api/v1/calculations",
            json={
                "name": "Protected",
                "target_type_key": "Application",
                "target_field_key": "costTotalAnnual",
                "formula": "0",
            },
            headers=auth_headers(admin),
        )
        calc_id = create_resp.json()["id"]

        resp = await client.delete(
            f"/api/v1/calculations/{calc_id}",
            headers=auth_headers(member),
        )
        assert resp.status_code == 403


# -------------------------------------------------------------------
# POST /calculations/validate
# -------------------------------------------------------------------


class TestValidateFormula:
    async def test_validate_simple_formula(self, client, db, calc_env):
        admin = calc_env["admin"]
        resp = await client.post(
            "/api/v1/calculations/validate",
            json={
                "formula": "1 + 1",
                "target_type_key": "Application",
            },
            headers=auth_headers(admin),
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["valid"] is True

    async def test_validate_invalid_formula(self, client, db, calc_env):
        admin = calc_env["admin"]
        resp = await client.post(
            "/api/v1/calculations/validate",
            json={
                "formula": "import os",
                "target_type_key": "Application",
            },
            headers=auth_headers(admin),
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["valid"] is False


# -------------------------------------------------------------------
# POST /calculations/{id}/activate + deactivate
# -------------------------------------------------------------------


class TestActivateDeactivate:
    async def test_activate_and_deactivate(self, client, db, calc_env):
        admin = calc_env["admin"]
        create_resp = await client.post(
            "/api/v1/calculations",
            json={
                "name": "Toggle Me",
                "target_type_key": "Application",
                "target_field_key": "costTotalAnnual",
                "formula": "42",
            },
            headers=auth_headers(admin),
        )
        calc_id = create_resp.json()["id"]
        assert create_resp.json()["is_active"] is False

        # Activate
        resp = await client.post(
            f"/api/v1/calculations/{calc_id}/activate",
            headers=auth_headers(admin),
        )
        assert resp.status_code == 200
        assert resp.json()["is_active"] is True

        # Deactivate
        resp2 = await client.post(
            f"/api/v1/calculations/{calc_id}/deactivate",
            headers=auth_headers(admin),
        )
        assert resp2.status_code == 200
        assert resp2.json()["is_active"] is False
