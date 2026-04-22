"""Integration tests for the /tag-groups and /cards/{id}/tags endpoints.

These tests require a PostgreSQL test database and an HTTP test client.
"""

from __future__ import annotations

import pytest

from app.core.permissions import VIEWER_PERMISSIONS
from tests.conftest import (
    auth_headers,
    create_card,
    create_card_type,
    create_role,
    create_user,
)


@pytest.fixture
async def tags_env(db):
    """Prerequisite data for tag tests."""
    await create_role(db, key="admin", label="Admin", permissions={"*": True})
    await create_role(
        db,
        key="viewer",
        label="Viewer",
        permissions=VIEWER_PERMISSIONS,
    )
    await create_card_type(db, key="Application", label="Application")
    admin = await create_user(db, email="admin@test.com", role="admin")
    viewer = await create_user(db, email="viewer@test.com", role="viewer")
    card = await create_card(
        db,
        card_type="Application",
        name="Tagged App",
        user_id=admin.id,
    )
    return {"admin": admin, "viewer": viewer, "card": card}


# ---------------------------------------------------------------
# POST /tag-groups  (create group)
# ---------------------------------------------------------------


class TestCreateTagGroup:
    async def test_admin_can_create_group(self, client, db, tags_env):
        admin = tags_env["admin"]
        resp = await client.post(
            "/api/v1/tag-groups",
            json={"name": "Environment", "mode": "single"},
            headers=auth_headers(admin),
        )
        assert resp.status_code == 201
        data = resp.json()
        assert data["name"] == "Environment"

    async def test_viewer_cannot_create_group(self, client, db, tags_env):
        viewer = tags_env["viewer"]
        resp = await client.post(
            "/api/v1/tag-groups",
            json={"name": "Blocked"},
            headers=auth_headers(viewer),
        )
        assert resp.status_code == 403


# ---------------------------------------------------------------
# GET /tag-groups  (list)
# ---------------------------------------------------------------


class TestListTagGroups:
    async def test_list_tag_groups(self, client, db, tags_env):
        """Tag groups are public (no auth required by endpoint)."""
        resp = await client.get("/api/v1/tag-groups")
        assert resp.status_code == 200
        assert isinstance(resp.json(), list)


# ---------------------------------------------------------------
# POST /tag-groups/{id}/tags  (create tag)
# ---------------------------------------------------------------


class TestCreateTag:
    async def test_admin_can_create_tag(self, client, db, tags_env):
        admin = tags_env["admin"]
        # Create group first
        group_resp = await client.post(
            "/api/v1/tag-groups",
            json={"name": "Lifecycle"},
            headers=auth_headers(admin),
        )
        group_id = group_resp.json()["id"]

        resp = await client.post(
            f"/api/v1/tag-groups/{group_id}/tags",
            json={"name": "Active", "color": "#00ff00"},
            headers=auth_headers(admin),
        )
        assert resp.status_code == 201
        data = resp.json()
        assert data["name"] == "Active"
        assert data["color"] == "#00ff00"


# ---------------------------------------------------------------
# POST /cards/{id}/tags  (assign tags)
# ---------------------------------------------------------------


class TestAssignTags:
    async def test_admin_can_assign_tags(self, client, db, tags_env):
        admin = tags_env["admin"]
        card = tags_env["card"]

        # Create group + tag
        group_resp = await client.post(
            "/api/v1/tag-groups",
            json={"name": "Status"},
            headers=auth_headers(admin),
        )
        group_id = group_resp.json()["id"]
        tag_resp = await client.post(
            f"/api/v1/tag-groups/{group_id}/tags",
            json={"name": "Production"},
            headers=auth_headers(admin),
        )
        tag_id = tag_resp.json()["id"]

        resp = await client.post(
            f"/api/v1/cards/{card.id}/tags",
            json=[tag_id],
            headers=auth_headers(admin),
        )
        assert resp.status_code == 201
        assert resp.json()["status"] == "ok"

    async def test_viewer_cannot_assign_tags(self, client, db, tags_env):
        viewer = tags_env["viewer"]
        card = tags_env["card"]
        resp = await client.post(
            f"/api/v1/cards/{card.id}/tags",
            json=["some-fake-id"],
            headers=auth_headers(viewer),
        )
        assert resp.status_code == 403


# ---------------------------------------------------------------
# DELETE /cards/{card_id}/tags/{tag_id}  (remove tag)
# ---------------------------------------------------------------


class TestRemoveTag:
    async def test_admin_can_remove_tag(self, client, db, tags_env):
        admin = tags_env["admin"]
        card = tags_env["card"]

        # Create group + tag + assign
        group_resp = await client.post(
            "/api/v1/tag-groups",
            json={"name": "Region"},
            headers=auth_headers(admin),
        )
        group_id = group_resp.json()["id"]
        tag_resp = await client.post(
            f"/api/v1/tag-groups/{group_id}/tags",
            json={"name": "EU"},
            headers=auth_headers(admin),
        )
        tag_id = tag_resp.json()["id"]
        await client.post(
            f"/api/v1/cards/{card.id}/tags",
            json=[tag_id],
            headers=auth_headers(admin),
        )

        resp = await client.delete(
            f"/api/v1/cards/{card.id}/tags/{tag_id}",
            headers=auth_headers(admin),
        )
        assert resp.status_code == 204


# ---------------------------------------------------------------
# PATCH /tag-groups/{id}  (update group)
# ---------------------------------------------------------------


class TestUpdateTagGroup:
    async def test_admin_can_update_group(self, client, db, tags_env):
        admin = tags_env["admin"]
        group_resp = await client.post(
            "/api/v1/tag-groups",
            json={"name": "Env", "mode": "multi"},
            headers=auth_headers(admin),
        )
        group_id = group_resp.json()["id"]

        resp = await client.patch(
            f"/api/v1/tag-groups/{group_id}",
            json={"name": "Environment", "description": "Deployment env", "mandatory": True},
            headers=auth_headers(admin),
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["name"] == "Environment"
        assert data["description"] == "Deployment env"
        assert data["mandatory"] is True
        assert data["mode"] == "multi"  # unchanged

    async def test_viewer_cannot_update_group(self, client, db, tags_env):
        admin = tags_env["admin"]
        viewer = tags_env["viewer"]
        group_resp = await client.post(
            "/api/v1/tag-groups",
            json={"name": "Protected"},
            headers=auth_headers(admin),
        )
        group_id = group_resp.json()["id"]

        resp = await client.patch(
            f"/api/v1/tag-groups/{group_id}",
            json={"name": "Hacked"},
            headers=auth_headers(viewer),
        )
        assert resp.status_code == 403

    async def test_update_unknown_group_returns_404(self, client, db, tags_env):
        admin = tags_env["admin"]
        resp = await client.patch(
            "/api/v1/tag-groups/00000000-0000-0000-0000-000000000000",
            json={"name": "Ghost"},
            headers=auth_headers(admin),
        )
        assert resp.status_code == 404


# ---------------------------------------------------------------
# DELETE /tag-groups/{id}  (delete group, cascades to tags + card_tags)
# ---------------------------------------------------------------


class TestDeleteTagGroup:
    async def test_admin_can_delete_group_cascades(self, client, db, tags_env):
        import uuid as uuid_mod

        from sqlalchemy import select

        from app.models.tag import CardTag, Tag, TagGroup

        admin = tags_env["admin"]
        card = tags_env["card"]

        group_resp = await client.post(
            "/api/v1/tag-groups",
            json={"name": "Doomed"},
            headers=auth_headers(admin),
        )
        group_id = group_resp.json()["id"]
        tag_resp = await client.post(
            f"/api/v1/tag-groups/{group_id}/tags",
            json={"name": "Temp"},
            headers=auth_headers(admin),
        )
        tag_id = tag_resp.json()["id"]
        await client.post(
            f"/api/v1/cards/{card.id}/tags",
            json=[tag_id],
            headers=auth_headers(admin),
        )

        resp = await client.delete(
            f"/api/v1/tag-groups/{group_id}",
            headers=auth_headers(admin),
        )
        assert resp.status_code == 204

        # Cascade: group gone, tag gone, card_tags row gone
        assert await db.get(TagGroup, uuid_mod.UUID(group_id)) is None
        assert await db.get(Tag, uuid_mod.UUID(tag_id)) is None
        leftover = await db.execute(select(CardTag).where(CardTag.tag_id == uuid_mod.UUID(tag_id)))
        assert leftover.scalar_one_or_none() is None

    async def test_viewer_cannot_delete_group(self, client, db, tags_env):
        admin = tags_env["admin"]
        viewer = tags_env["viewer"]
        group_resp = await client.post(
            "/api/v1/tag-groups",
            json={"name": "Protected"},
            headers=auth_headers(admin),
        )
        group_id = group_resp.json()["id"]

        resp = await client.delete(
            f"/api/v1/tag-groups/{group_id}",
            headers=auth_headers(viewer),
        )
        assert resp.status_code == 403


# ---------------------------------------------------------------
# PATCH /tag-groups/{group_id}/tags/{tag_id}  (update tag)
# ---------------------------------------------------------------


class TestUpdateTag:
    async def test_admin_can_update_tag(self, client, db, tags_env):
        admin = tags_env["admin"]
        group_resp = await client.post(
            "/api/v1/tag-groups",
            json={"name": "Priority"},
            headers=auth_headers(admin),
        )
        group_id = group_resp.json()["id"]
        tag_resp = await client.post(
            f"/api/v1/tag-groups/{group_id}/tags",
            json={"name": "High", "color": "#ff0000"},
            headers=auth_headers(admin),
        )
        tag_id = tag_resp.json()["id"]

        resp = await client.patch(
            f"/api/v1/tag-groups/{group_id}/tags/{tag_id}",
            json={"name": "Critical", "color": "#cc0000"},
            headers=auth_headers(admin),
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["name"] == "Critical"
        assert data["color"] == "#cc0000"

    async def test_viewer_cannot_update_tag(self, client, db, tags_env):
        admin = tags_env["admin"]
        viewer = tags_env["viewer"]
        group_resp = await client.post(
            "/api/v1/tag-groups",
            json={"name": "Owner"},
            headers=auth_headers(admin),
        )
        group_id = group_resp.json()["id"]
        tag_resp = await client.post(
            f"/api/v1/tag-groups/{group_id}/tags",
            json={"name": "Alice"},
            headers=auth_headers(admin),
        )
        tag_id = tag_resp.json()["id"]

        resp = await client.patch(
            f"/api/v1/tag-groups/{group_id}/tags/{tag_id}",
            json={"name": "Eve"},
            headers=auth_headers(viewer),
        )
        assert resp.status_code == 403

    async def test_update_tag_wrong_group_returns_404(self, client, db, tags_env):
        admin = tags_env["admin"]
        # Two groups, one tag
        g1 = await client.post(
            "/api/v1/tag-groups",
            json={"name": "G1"},
            headers=auth_headers(admin),
        )
        g2 = await client.post(
            "/api/v1/tag-groups",
            json={"name": "G2"},
            headers=auth_headers(admin),
        )
        tag_resp = await client.post(
            f"/api/v1/tag-groups/{g1.json()['id']}/tags",
            json={"name": "T1"},
            headers=auth_headers(admin),
        )
        tag_id = tag_resp.json()["id"]

        # Path references wrong group for this tag
        resp = await client.patch(
            f"/api/v1/tag-groups/{g2.json()['id']}/tags/{tag_id}",
            json={"name": "Moved"},
            headers=auth_headers(admin),
        )
        assert resp.status_code == 404


# ---------------------------------------------------------------
# DELETE /tag-groups/{group_id}/tags/{tag_id}  (delete tag)
# ---------------------------------------------------------------


class TestDeleteTag:
    async def test_admin_can_delete_tag_cascades_card_tags(self, client, db, tags_env):
        import uuid as uuid_mod

        from sqlalchemy import select

        from app.models.tag import CardTag, Tag

        admin = tags_env["admin"]
        card = tags_env["card"]

        group_resp = await client.post(
            "/api/v1/tag-groups",
            json={"name": "Stage"},
            headers=auth_headers(admin),
        )
        group_id = group_resp.json()["id"]
        tag_resp = await client.post(
            f"/api/v1/tag-groups/{group_id}/tags",
            json={"name": "Staging"},
            headers=auth_headers(admin),
        )
        tag_id = tag_resp.json()["id"]
        await client.post(
            f"/api/v1/cards/{card.id}/tags",
            json=[tag_id],
            headers=auth_headers(admin),
        )

        resp = await client.delete(
            f"/api/v1/tag-groups/{group_id}/tags/{tag_id}",
            headers=auth_headers(admin),
        )
        assert resp.status_code == 204

        assert await db.get(Tag, uuid_mod.UUID(tag_id)) is None
        leftover = await db.execute(select(CardTag).where(CardTag.tag_id == uuid_mod.UUID(tag_id)))
        assert leftover.scalar_one_or_none() is None

    async def test_viewer_cannot_delete_tag(self, client, db, tags_env):
        admin = tags_env["admin"]
        viewer = tags_env["viewer"]
        group_resp = await client.post(
            "/api/v1/tag-groups",
            json={"name": "Protected"},
            headers=auth_headers(admin),
        )
        group_id = group_resp.json()["id"]
        tag_resp = await client.post(
            f"/api/v1/tag-groups/{group_id}/tags",
            json={"name": "Locked"},
            headers=auth_headers(admin),
        )
        tag_id = tag_resp.json()["id"]

        resp = await client.delete(
            f"/api/v1/tag-groups/{group_id}/tags/{tag_id}",
            headers=auth_headers(viewer),
        )
        assert resp.status_code == 403

    async def test_delete_unknown_tag_returns_404(self, client, db, tags_env):
        admin = tags_env["admin"]
        group_resp = await client.post(
            "/api/v1/tag-groups",
            json={"name": "G"},
            headers=auth_headers(admin),
        )
        group_id = group_resp.json()["id"]

        resp = await client.delete(
            f"/api/v1/tag-groups/{group_id}/tags/00000000-0000-0000-0000-000000000000",
            headers=auth_headers(admin),
        )
        assert resp.status_code == 404
