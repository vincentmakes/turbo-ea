"""Integration tests for the /web-portals endpoints."""

from __future__ import annotations

import uuid

import pytest

from tests.conftest import (
    auth_headers,
    create_card_type,
    create_role,
    create_user,
)


@pytest.fixture
async def portals_env(db):
    """Prerequisite data for web portal tests."""
    await create_role(db, key="admin", label="Admin", permissions={"*": True})
    await create_role(
        db,
        key="viewer",
        label="Viewer",
        permissions={"inventory.view": True},
    )
    await create_card_type(db, key="Application", label="Application")
    admin = await create_user(db, email="admin@test.com", role="admin")
    viewer = await create_user(db, email="viewer@test.com", role="viewer")
    return {"admin": admin, "viewer": viewer}


class TestCreatePortal:
    async def test_admin_can_create_portal(self, client, db, portals_env):
        admin = portals_env["admin"]
        resp = await client.post(
            "/api/v1/web-portals",
            json={
                "name": "App Catalog",
                "slug": "app-catalog",
                "card_type": "Application",
                "is_published": True,
            },
            headers=auth_headers(admin),
        )
        assert resp.status_code == 201
        data = resp.json()
        assert data["name"] == "App Catalog"
        assert data["slug"] == "app-catalog"
        assert data["card_type"] == "Application"
        assert data["is_published"] is True

    async def test_create_portal_invalid_slug(self, client, db, portals_env):
        admin = portals_env["admin"]
        resp = await client.post(
            "/api/v1/web-portals",
            json={
                "name": "Bad Slug",
                "slug": "Invalid Slug!",
                "card_type": "Application",
            },
            headers=auth_headers(admin),
        )
        assert resp.status_code == 400

    async def test_create_portal_duplicate_slug(self, client, db, portals_env):
        admin = portals_env["admin"]
        body = {
            "name": "Portal One",
            "slug": "dup-slug",
            "card_type": "Application",
        }
        resp1 = await client.post(
            "/api/v1/web-portals",
            json=body,
            headers=auth_headers(admin),
        )
        assert resp1.status_code == 201

        resp2 = await client.post(
            "/api/v1/web-portals",
            json={**body, "name": "Portal Two"},
            headers=auth_headers(admin),
        )
        assert resp2.status_code == 400

    async def test_viewer_cannot_create_portal(self, client, db, portals_env):
        viewer = portals_env["viewer"]
        resp = await client.post(
            "/api/v1/web-portals",
            json={
                "name": "Blocked",
                "slug": "blocked",
                "card_type": "Application",
            },
            headers=auth_headers(viewer),
        )
        assert resp.status_code == 403


class TestListAndGetPortal:
    async def test_list_portals(self, client, db, portals_env):
        admin = portals_env["admin"]
        await client.post(
            "/api/v1/web-portals",
            json={
                "name": "Portal A",
                "slug": "portal-a",
                "card_type": "Application",
            },
            headers=auth_headers(admin),
        )
        resp = await client.get(
            "/api/v1/web-portals",
            headers=auth_headers(admin),
        )
        assert resp.status_code == 200
        data = resp.json()
        assert len(data) >= 1
        names = [p["name"] for p in data]
        assert "Portal A" in names

    async def test_get_portal_by_id(self, client, db, portals_env):
        admin = portals_env["admin"]
        create_resp = await client.post(
            "/api/v1/web-portals",
            json={
                "name": "Fetch Me",
                "slug": "fetch-me",
                "card_type": "Application",
            },
            headers=auth_headers(admin),
        )
        portal_id = create_resp.json()["id"]

        resp = await client.get(
            f"/api/v1/web-portals/{portal_id}",
            headers=auth_headers(admin),
        )
        assert resp.status_code == 200
        assert resp.json()["name"] == "Fetch Me"

    async def test_get_nonexistent_portal(self, client, db, portals_env):
        admin = portals_env["admin"]
        fake_id = uuid.uuid4()
        resp = await client.get(
            f"/api/v1/web-portals/{fake_id}",
            headers=auth_headers(admin),
        )
        assert resp.status_code == 404


class TestUpdatePortal:
    async def test_update_portal_name(self, client, db, portals_env):
        admin = portals_env["admin"]
        create_resp = await client.post(
            "/api/v1/web-portals",
            json={
                "name": "Original",
                "slug": "original",
                "card_type": "Application",
            },
            headers=auth_headers(admin),
        )
        portal_id = create_resp.json()["id"]

        resp = await client.patch(
            f"/api/v1/web-portals/{portal_id}",
            json={"name": "Updated"},
            headers=auth_headers(admin),
        )
        assert resp.status_code == 200
        assert resp.json()["name"] == "Updated"


class TestDeletePortal:
    async def test_delete_portal(self, client, db, portals_env):
        admin = portals_env["admin"]
        create_resp = await client.post(
            "/api/v1/web-portals",
            json={
                "name": "Delete Me",
                "slug": "delete-me",
                "card_type": "Application",
            },
            headers=auth_headers(admin),
        )
        portal_id = create_resp.json()["id"]

        resp = await client.delete(
            f"/api/v1/web-portals/{portal_id}",
            headers=auth_headers(admin),
        )
        assert resp.status_code == 204

        # Verify it is gone
        resp = await client.get(
            f"/api/v1/web-portals/{portal_id}",
            headers=auth_headers(admin),
        )
        assert resp.status_code == 404


class TestPublicPortal:
    async def test_public_portal_no_auth(self, client, db, portals_env):
        """Published portals are accessible without auth."""
        admin = portals_env["admin"]
        await client.post(
            "/api/v1/web-portals",
            json={
                "name": "Public Catalog",
                "slug": "public-catalog",
                "card_type": "Application",
                "is_published": True,
            },
            headers=auth_headers(admin),
        )

        resp = await client.get("/api/v1/web-portals/public/public-catalog")
        assert resp.status_code == 200
        data = resp.json()
        assert data["name"] == "Public Catalog"
        assert data["slug"] == "public-catalog"
        assert data["card_type"] == "Application"
        assert "type_info" in data

    async def test_public_portal_not_published(self, client, db, portals_env):
        """Unpublished portals return 404 on public endpoint."""
        admin = portals_env["admin"]
        await client.post(
            "/api/v1/web-portals",
            json={
                "name": "Draft Portal",
                "slug": "draft-portal",
                "card_type": "Application",
                "is_published": False,
            },
            headers=auth_headers(admin),
        )

        resp = await client.get("/api/v1/web-portals/public/draft-portal")
        assert resp.status_code == 404

    async def test_public_portal_nonexistent_slug(self, client, db, portals_env):
        resp = await client.get("/api/v1/web-portals/public/no-such-slug")
        assert resp.status_code == 404
