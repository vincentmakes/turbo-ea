"""Integration tests for the /diagrams endpoints.

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
async def diagrams_env(db):
    """Prerequisite data shared by all diagram tests."""
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
# POST /diagrams  (create)
# -------------------------------------------------------------------


class TestCreateDiagram:
    async def test_admin_can_create(self, client, db, diagrams_env):
        admin = diagrams_env["admin"]
        resp = await client.post(
            "/api/v1/diagrams",
            json={
                "name": "Architecture Overview",
                "type": "free_draw",
                "data": {"xml": "<mxGraphModel/>"},
            },
            headers=auth_headers(admin),
        )
        assert resp.status_code == 201
        data = resp.json()
        assert data["name"] == "Architecture Overview"
        assert data["type"] == "free_draw"

    async def test_member_can_create(self, client, db, diagrams_env):
        member = diagrams_env["member"]
        resp = await client.post(
            "/api/v1/diagrams",
            json={
                "name": "Member Diagram",
                "data": {},
            },
            headers=auth_headers(member),
        )
        assert resp.status_code == 201

    async def test_viewer_cannot_create(self, client, db, diagrams_env):
        viewer = diagrams_env["viewer"]
        resp = await client.post(
            "/api/v1/diagrams",
            json={
                "name": "Blocked",
                "data": {},
            },
            headers=auth_headers(viewer),
        )
        assert resp.status_code == 403


# -------------------------------------------------------------------
# GET /diagrams  (list)
# -------------------------------------------------------------------


class TestListDiagrams:
    async def test_list_returns_diagrams(self, client, db, diagrams_env):
        admin = diagrams_env["admin"]
        await client.post(
            "/api/v1/diagrams",
            json={"name": "Diagram A", "data": {}},
            headers=auth_headers(admin),
        )
        await client.post(
            "/api/v1/diagrams",
            json={"name": "Diagram B", "data": {}},
            headers=auth_headers(admin),
        )

        resp = await client.get(
            "/api/v1/diagrams",
            headers=auth_headers(admin),
        )
        assert resp.status_code == 200
        names = [d["name"] for d in resp.json()]
        assert "Diagram A" in names
        assert "Diagram B" in names

    async def test_viewer_can_list(self, client, db, diagrams_env):
        viewer = diagrams_env["viewer"]
        resp = await client.get(
            "/api/v1/diagrams",
            headers=auth_headers(viewer),
        )
        assert resp.status_code == 200


# -------------------------------------------------------------------
# GET /diagrams/{id}
# -------------------------------------------------------------------


class TestGetDiagram:
    async def test_get_existing_diagram(self, client, db, diagrams_env):
        admin = diagrams_env["admin"]
        create_resp = await client.post(
            "/api/v1/diagrams",
            json={
                "name": "Lookup",
                "data": {"xml": "<mxGraphModel/>"},
            },
            headers=auth_headers(admin),
        )
        diagram_id = create_resp.json()["id"]

        resp = await client.get(
            f"/api/v1/diagrams/{diagram_id}",
            headers=auth_headers(admin),
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["name"] == "Lookup"
        assert data["data"]["xml"] == "<mxGraphModel/>"

    async def test_get_nonexistent_returns_404(self, client, db, diagrams_env):
        admin = diagrams_env["admin"]
        fake_id = str(uuid.uuid4())
        resp = await client.get(
            f"/api/v1/diagrams/{fake_id}",
            headers=auth_headers(admin),
        )
        assert resp.status_code == 404


# -------------------------------------------------------------------
# PATCH /diagrams/{id}  (update)
# -------------------------------------------------------------------


class TestUpdateDiagram:
    async def test_update_name(self, client, db, diagrams_env):
        admin = diagrams_env["admin"]
        create_resp = await client.post(
            "/api/v1/diagrams",
            json={"name": "Old Name", "data": {}},
            headers=auth_headers(admin),
        )
        diagram_id = create_resp.json()["id"]

        resp = await client.patch(
            f"/api/v1/diagrams/{diagram_id}",
            json={"name": "New Name"},
            headers=auth_headers(admin),
        )
        assert resp.status_code == 200
        assert resp.json()["name"] == "New Name"

    async def test_update_data(self, client, db, diagrams_env):
        admin = diagrams_env["admin"]
        create_resp = await client.post(
            "/api/v1/diagrams",
            json={"name": "Data Update", "data": {}},
            headers=auth_headers(admin),
        )
        diagram_id = create_resp.json()["id"]

        resp = await client.patch(
            f"/api/v1/diagrams/{diagram_id}",
            json={"data": {"xml": "<mxGraphModel><root/></mxGraphModel>"}},
            headers=auth_headers(admin),
        )
        assert resp.status_code == 200

    async def test_update_nonexistent_returns_404(self, client, db, diagrams_env):
        admin = diagrams_env["admin"]
        fake_id = str(uuid.uuid4())
        resp = await client.patch(
            f"/api/v1/diagrams/{fake_id}",
            json={"name": "Ghost"},
            headers=auth_headers(admin),
        )
        assert resp.status_code == 404

    async def test_viewer_cannot_update(self, client, db, diagrams_env):
        admin = diagrams_env["admin"]
        viewer = diagrams_env["viewer"]
        create_resp = await client.post(
            "/api/v1/diagrams",
            json={"name": "Protected", "data": {}},
            headers=auth_headers(admin),
        )
        diagram_id = create_resp.json()["id"]

        resp = await client.patch(
            f"/api/v1/diagrams/{diagram_id}",
            json={"name": "Hacked"},
            headers=auth_headers(viewer),
        )
        assert resp.status_code == 403


# -------------------------------------------------------------------
# DELETE /diagrams/{id}
# -------------------------------------------------------------------


class TestDeleteDiagram:
    async def test_admin_can_delete(self, client, db, diagrams_env):
        admin = diagrams_env["admin"]
        create_resp = await client.post(
            "/api/v1/diagrams",
            json={"name": "Delete Me", "data": {}},
            headers=auth_headers(admin),
        )
        diagram_id = create_resp.json()["id"]

        resp = await client.delete(
            f"/api/v1/diagrams/{diagram_id}",
            headers=auth_headers(admin),
        )
        assert resp.status_code == 204

        # Verify it's gone
        get_resp = await client.get(
            f"/api/v1/diagrams/{diagram_id}",
            headers=auth_headers(admin),
        )
        assert get_resp.status_code == 404

    async def test_viewer_cannot_delete(self, client, db, diagrams_env):
        admin = diagrams_env["admin"]
        viewer = diagrams_env["viewer"]
        create_resp = await client.post(
            "/api/v1/diagrams",
            json={"name": "Protected", "data": {}},
            headers=auth_headers(admin),
        )
        diagram_id = create_resp.json()["id"]

        resp = await client.delete(
            f"/api/v1/diagrams/{diagram_id}",
            headers=auth_headers(viewer),
        )
        assert resp.status_code == 403

    async def test_delete_nonexistent_returns_404(self, client, db, diagrams_env):
        admin = diagrams_env["admin"]
        fake_id = str(uuid.uuid4())
        resp = await client.delete(
            f"/api/v1/diagrams/{fake_id}",
            headers=auth_headers(admin),
        )
        assert resp.status_code == 404
