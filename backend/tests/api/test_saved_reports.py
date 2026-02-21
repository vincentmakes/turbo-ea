"""Integration tests for the /saved-reports endpoints.

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
async def reports_env(db):
    """Prerequisite data shared by all saved-report tests."""
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
# POST /saved-reports  (create)
# -------------------------------------------------------------------


class TestCreateSavedReport:
    async def test_admin_can_create_private(self, client, db, reports_env):
        admin = reports_env["admin"]
        resp = await client.post(
            "/api/v1/saved-reports",
            json={
                "name": "My Portfolio",
                "report_type": "portfolio",
                "config": {"xAxis": "cost", "yAxis": "risk"},
                "visibility": "private",
            },
            headers=auth_headers(admin),
        )
        assert resp.status_code == 201
        data = resp.json()
        assert data["name"] == "My Portfolio"
        assert data["report_type"] == "portfolio"
        assert data["visibility"] == "private"
        assert data["is_owner"] is True

    async def test_member_can_create_public(self, client, db, reports_env):
        member = reports_env["member"]
        resp = await client.post(
            "/api/v1/saved-reports",
            json={
                "name": "Public Lifecycle",
                "report_type": "lifecycle",
                "config": {"type": "Application"},
                "visibility": "public",
            },
            headers=auth_headers(member),
        )
        assert resp.status_code == 201
        assert resp.json()["visibility"] == "public"

    async def test_viewer_cannot_create(self, client, db, reports_env):
        viewer = reports_env["viewer"]
        resp = await client.post(
            "/api/v1/saved-reports",
            json={
                "name": "Blocked",
                "report_type": "portfolio",
                "config": {},
                "visibility": "private",
            },
            headers=auth_headers(viewer),
        )
        assert resp.status_code == 403

    async def test_invalid_report_type_rejected(self, client, db, reports_env):
        admin = reports_env["admin"]
        resp = await client.post(
            "/api/v1/saved-reports",
            json={
                "name": "Bad Type",
                "report_type": "nonexistent_type",
                "config": {},
                "visibility": "private",
            },
            headers=auth_headers(admin),
        )
        assert resp.status_code == 400


# -------------------------------------------------------------------
# GET /saved-reports  (list)
# -------------------------------------------------------------------


class TestListSavedReports:
    async def test_list_own_reports(self, client, db, reports_env):
        admin = reports_env["admin"]
        # Create a report
        await client.post(
            "/api/v1/saved-reports",
            json={
                "name": "Admin Report",
                "report_type": "portfolio",
                "config": {},
                "visibility": "private",
            },
            headers=auth_headers(admin),
        )

        resp = await client.get(
            "/api/v1/saved-reports?filter=my",
            headers=auth_headers(admin),
        )
        assert resp.status_code == 200
        names = [r["name"] for r in resp.json()]
        assert "Admin Report" in names

    async def test_public_reports_visible_to_all(self, client, db, reports_env):
        admin = reports_env["admin"]
        member = reports_env["member"]
        # Admin creates a public report
        await client.post(
            "/api/v1/saved-reports",
            json={
                "name": "Shared Public",
                "report_type": "cost",
                "config": {},
                "visibility": "public",
            },
            headers=auth_headers(admin),
        )

        # Member can see it
        resp = await client.get(
            "/api/v1/saved-reports?filter=public",
            headers=auth_headers(member),
        )
        assert resp.status_code == 200
        names = [r["name"] for r in resp.json()]
        assert "Shared Public" in names

    async def test_private_not_visible_to_others(self, client, db, reports_env):
        admin = reports_env["admin"]
        member = reports_env["member"]
        # Admin creates a private report
        await client.post(
            "/api/v1/saved-reports",
            json={
                "name": "Admin Only",
                "report_type": "matrix",
                "config": {},
                "visibility": "private",
            },
            headers=auth_headers(admin),
        )

        # Member should NOT see it in their "all" view
        resp = await client.get(
            "/api/v1/saved-reports?filter=all",
            headers=auth_headers(member),
        )
        assert resp.status_code == 200
        names = [r["name"] for r in resp.json()]
        assert "Admin Only" not in names


# -------------------------------------------------------------------
# GET /saved-reports/{id}
# -------------------------------------------------------------------


class TestGetSavedReport:
    async def test_owner_can_get(self, client, db, reports_env):
        admin = reports_env["admin"]
        create_resp = await client.post(
            "/api/v1/saved-reports",
            json={
                "name": "Get Me",
                "report_type": "portfolio",
                "config": {"key": "val"},
                "visibility": "private",
            },
            headers=auth_headers(admin),
        )
        report_id = create_resp.json()["id"]

        resp = await client.get(
            f"/api/v1/saved-reports/{report_id}",
            headers=auth_headers(admin),
        )
        assert resp.status_code == 200
        assert resp.json()["name"] == "Get Me"
        assert resp.json()["config"] == {"key": "val"}

    async def test_non_owner_cannot_get_private(self, client, db, reports_env):
        admin = reports_env["admin"]
        member = reports_env["member"]
        create_resp = await client.post(
            "/api/v1/saved-reports",
            json={
                "name": "Private",
                "report_type": "portfolio",
                "config": {},
                "visibility": "private",
            },
            headers=auth_headers(admin),
        )
        report_id = create_resp.json()["id"]

        resp = await client.get(
            f"/api/v1/saved-reports/{report_id}",
            headers=auth_headers(member),
        )
        assert resp.status_code == 403

    async def test_get_nonexistent_returns_404(self, client, db, reports_env):
        admin = reports_env["admin"]
        fake_id = str(uuid.uuid4())
        resp = await client.get(
            f"/api/v1/saved-reports/{fake_id}",
            headers=auth_headers(admin),
        )
        assert resp.status_code == 404


# -------------------------------------------------------------------
# PATCH /saved-reports/{id}  (update)
# -------------------------------------------------------------------


class TestUpdateSavedReport:
    async def test_owner_can_update(self, client, db, reports_env):
        admin = reports_env["admin"]
        create_resp = await client.post(
            "/api/v1/saved-reports",
            json={
                "name": "Old Name",
                "report_type": "portfolio",
                "config": {},
                "visibility": "private",
            },
            headers=auth_headers(admin),
        )
        report_id = create_resp.json()["id"]

        resp = await client.patch(
            f"/api/v1/saved-reports/{report_id}",
            json={"name": "New Name"},
            headers=auth_headers(admin),
        )
        assert resp.status_code == 200
        assert resp.json()["name"] == "New Name"

    async def test_non_owner_cannot_update(self, client, db, reports_env):
        admin = reports_env["admin"]
        member = reports_env["member"]
        create_resp = await client.post(
            "/api/v1/saved-reports",
            json={
                "name": "Protected",
                "report_type": "portfolio",
                "config": {},
                "visibility": "public",
            },
            headers=auth_headers(admin),
        )
        report_id = create_resp.json()["id"]

        resp = await client.patch(
            f"/api/v1/saved-reports/{report_id}",
            json={"name": "Hacked"},
            headers=auth_headers(member),
        )
        assert resp.status_code == 403

    async def test_change_visibility(self, client, db, reports_env):
        admin = reports_env["admin"]
        create_resp = await client.post(
            "/api/v1/saved-reports",
            json={
                "name": "Vis Change",
                "report_type": "cost",
                "config": {},
                "visibility": "private",
            },
            headers=auth_headers(admin),
        )
        report_id = create_resp.json()["id"]

        resp = await client.patch(
            f"/api/v1/saved-reports/{report_id}",
            json={"visibility": "public"},
            headers=auth_headers(admin),
        )
        assert resp.status_code == 200
        assert resp.json()["visibility"] == "public"


# -------------------------------------------------------------------
# DELETE /saved-reports/{id}
# -------------------------------------------------------------------


class TestDeleteSavedReport:
    async def test_owner_can_delete(self, client, db, reports_env):
        admin = reports_env["admin"]
        create_resp = await client.post(
            "/api/v1/saved-reports",
            json={
                "name": "Delete Me",
                "report_type": "portfolio",
                "config": {},
                "visibility": "private",
            },
            headers=auth_headers(admin),
        )
        report_id = create_resp.json()["id"]

        resp = await client.delete(
            f"/api/v1/saved-reports/{report_id}",
            headers=auth_headers(admin),
        )
        assert resp.status_code == 204

    async def test_non_owner_cannot_delete(self, client, db, reports_env):
        admin = reports_env["admin"]
        member = reports_env["member"]
        create_resp = await client.post(
            "/api/v1/saved-reports",
            json={
                "name": "Not Yours",
                "report_type": "portfolio",
                "config": {},
                "visibility": "public",
            },
            headers=auth_headers(admin),
        )
        report_id = create_resp.json()["id"]

        resp = await client.delete(
            f"/api/v1/saved-reports/{report_id}",
            headers=auth_headers(member),
        )
        assert resp.status_code == 403

    async def test_delete_nonexistent_returns_404(self, client, db, reports_env):
        admin = reports_env["admin"]
        fake_id = str(uuid.uuid4())
        resp = await client.delete(
            f"/api/v1/saved-reports/{fake_id}",
            headers=auth_headers(admin),
        )
        assert resp.status_code == 404
