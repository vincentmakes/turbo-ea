"""Integration tests for the /bookmarks endpoints.

These tests require a PostgreSQL test database and an HTTP test client.
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
async def bm_env(db):
    """Prerequisite data for bookmark tests."""
    await create_role(db, key="admin", label="Admin", permissions={"*": True})
    await create_role(
        db,
        key="viewer",
        label="Viewer",
        permissions=VIEWER_PERMISSIONS,
    )
    admin = await create_user(db, email="admin@test.com", role="admin")
    viewer = await create_user(db, email="viewer@test.com", role="viewer")
    return {"admin": admin, "viewer": viewer}


# ---------------------------------------------------------------
# POST /bookmarks  (create)
# ---------------------------------------------------------------


class TestCreateBookmark:
    async def test_admin_can_create_bookmark(self, client, db, bm_env):
        admin = bm_env["admin"]
        resp = await client.post(
            "/api/v1/bookmarks",
            json={
                "name": "My Apps",
                "card_type": "Application",
                "filters": {"types": ["Application"]},
                "columns": ["name", "status"],
                "sort": {"field": "name", "direction": "asc"},
            },
            headers=auth_headers(admin),
        )
        assert resp.status_code == 201
        data = resp.json()
        assert data["name"] == "My Apps"
        assert data["card_type"] == "Application"
        assert data["is_owner"] is True
        assert data["visibility"] == "private"

    async def test_viewer_can_create_bookmark(self, client, db, bm_env):
        viewer = bm_env["viewer"]
        resp = await client.post(
            "/api/v1/bookmarks",
            json={
                "name": "Viewer View",
                "card_type": "Application",
            },
            headers=auth_headers(viewer),
        )
        assert resp.status_code == 201


# ---------------------------------------------------------------
# GET /bookmarks  (list)
# ---------------------------------------------------------------


class TestListBookmarks:
    async def test_list_bookmarks(self, client, db, bm_env):
        admin = bm_env["admin"]
        # Create one first
        await client.post(
            "/api/v1/bookmarks",
            json={"name": "Listed BM"},
            headers=auth_headers(admin),
        )
        resp = await client.get(
            "/api/v1/bookmarks",
            headers=auth_headers(admin),
        )
        assert resp.status_code == 200
        data = resp.json()
        assert isinstance(data, list)
        assert len(data) >= 1

    async def test_filter_my_bookmarks(self, client, db, bm_env):
        admin = bm_env["admin"]
        await client.post(
            "/api/v1/bookmarks",
            json={"name": "Mine"},
            headers=auth_headers(admin),
        )
        resp = await client.get(
            "/api/v1/bookmarks?filter=my",
            headers=auth_headers(admin),
        )
        assert resp.status_code == 200
        for bm in resp.json():
            assert bm["is_owner"] is True


# ---------------------------------------------------------------
# PATCH /bookmarks/{id}  (update)
# ---------------------------------------------------------------


class TestUpdateBookmark:
    async def test_owner_can_update(self, client, db, bm_env):
        admin = bm_env["admin"]
        create_resp = await client.post(
            "/api/v1/bookmarks",
            json={"name": "Old Name"},
            headers=auth_headers(admin),
        )
        bm_id = create_resp.json()["id"]

        resp = await client.patch(
            f"/api/v1/bookmarks/{bm_id}",
            json={"name": "New Name"},
            headers=auth_headers(admin),
        )
        assert resp.status_code == 200
        assert resp.json()["name"] == "New Name"

    async def test_update_nonexistent_returns_404(self, client, db, bm_env):
        admin = bm_env["admin"]
        fake_id = uuid.uuid4()
        resp = await client.patch(
            f"/api/v1/bookmarks/{fake_id}",
            json={"name": "Ghost"},
            headers=auth_headers(admin),
        )
        assert resp.status_code == 404

    async def test_non_owner_cannot_update(self, client, db, bm_env):
        admin = bm_env["admin"]
        viewer = bm_env["viewer"]
        create_resp = await client.post(
            "/api/v1/bookmarks",
            json={"name": "Admin BM"},
            headers=auth_headers(admin),
        )
        bm_id = create_resp.json()["id"]

        resp = await client.patch(
            f"/api/v1/bookmarks/{bm_id}",
            json={"name": "Hacked"},
            headers=auth_headers(viewer),
        )
        assert resp.status_code == 403


# ---------------------------------------------------------------
# DELETE /bookmarks/{id}
# ---------------------------------------------------------------


class TestDeleteBookmark:
    async def test_owner_can_delete(self, client, db, bm_env):
        admin = bm_env["admin"]
        create_resp = await client.post(
            "/api/v1/bookmarks",
            json={"name": "Delete Me"},
            headers=auth_headers(admin),
        )
        bm_id = create_resp.json()["id"]

        resp = await client.delete(
            f"/api/v1/bookmarks/{bm_id}",
            headers=auth_headers(admin),
        )
        assert resp.status_code == 204

    async def test_non_owner_cannot_delete(self, client, db, bm_env):
        admin = bm_env["admin"]
        viewer = bm_env["viewer"]
        create_resp = await client.post(
            "/api/v1/bookmarks",
            json={"name": "Protected BM"},
            headers=auth_headers(admin),
        )
        bm_id = create_resp.json()["id"]

        resp = await client.delete(
            f"/api/v1/bookmarks/{bm_id}",
            headers=auth_headers(viewer),
        )
        assert resp.status_code == 403

    async def test_delete_nonexistent_returns_404(self, client, db, bm_env):
        admin = bm_env["admin"]
        fake_id = uuid.uuid4()
        resp = await client.delete(
            f"/api/v1/bookmarks/{fake_id}",
            headers=auth_headers(admin),
        )
        assert resp.status_code == 404
