"""Integration tests for the /cards/{id}/comments and /comments endpoints.

These tests require a PostgreSQL test database and an HTTP test client.
"""

from __future__ import annotations

import uuid

import pytest

from app.core.permissions import MEMBER_PERMISSIONS, VIEWER_PERMISSIONS
from tests.conftest import (
    auth_headers,
    create_card,
    create_card_type,
    create_role,
    create_user,
)


@pytest.fixture
async def comments_env(db):
    """Prerequisite data for comment tests."""
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
    await create_card_type(db, key="Application", label="Application")
    admin = await create_user(db, email="admin@test.com", role="admin")
    member = await create_user(db, email="member@test.com", role="member")
    viewer = await create_user(db, email="viewer@test.com", role="viewer")
    card = await create_card(
        db,
        card_type="Application",
        name="Commented App",
        user_id=admin.id,
    )
    return {
        "admin": admin,
        "member": member,
        "viewer": viewer,
        "card": card,
    }


# ---------------------------------------------------------------
# POST /cards/{id}/comments  (create)
# ---------------------------------------------------------------


class TestCreateComment:
    async def test_admin_can_create_comment(self, client, db, comments_env):
        admin = comments_env["admin"]
        card = comments_env["card"]
        resp = await client.post(
            f"/api/v1/cards/{card.id}/comments",
            json={"content": "Looks good!"},
            headers=auth_headers(admin),
        )
        assert resp.status_code == 201
        data = resp.json()
        assert data["content"] == "Looks good!"
        assert data["card_id"] == str(card.id)
        assert data["user_id"] == str(admin.id)

    async def test_member_can_create_comment(self, client, db, comments_env):
        member = comments_env["member"]
        card = comments_env["card"]
        resp = await client.post(
            f"/api/v1/cards/{card.id}/comments",
            json={"content": "Member comment"},
            headers=auth_headers(member),
        )
        assert resp.status_code == 201

    async def test_viewer_cannot_create_comment(self, client, db, comments_env):
        viewer = comments_env["viewer"]
        card = comments_env["card"]
        resp = await client.post(
            f"/api/v1/cards/{card.id}/comments",
            json={"content": "Blocked"},
            headers=auth_headers(viewer),
        )
        assert resp.status_code == 403

    async def test_create_reply(self, client, db, comments_env):
        admin = comments_env["admin"]
        card = comments_env["card"]
        # Create parent comment
        parent_resp = await client.post(
            f"/api/v1/cards/{card.id}/comments",
            json={"content": "Parent"},
            headers=auth_headers(admin),
        )
        parent_id = parent_resp.json()["id"]

        # Create reply
        resp = await client.post(
            f"/api/v1/cards/{card.id}/comments",
            json={
                "content": "Reply",
                "parent_id": parent_id,
            },
            headers=auth_headers(admin),
        )
        assert resp.status_code == 201
        assert resp.json()["parent_id"] == parent_id


# ---------------------------------------------------------------
# GET /cards/{id}/comments  (list)
# ---------------------------------------------------------------


class TestListComments:
    async def test_list_comments(self, client, db, comments_env):
        admin = comments_env["admin"]
        card = comments_env["card"]
        # Create a comment first
        await client.post(
            f"/api/v1/cards/{card.id}/comments",
            json={"content": "Listed comment"},
            headers=auth_headers(admin),
        )
        resp = await client.get(
            f"/api/v1/cards/{card.id}/comments",
            headers=auth_headers(admin),
        )
        assert resp.status_code == 200
        data = resp.json()
        assert isinstance(data, list)
        assert len(data) >= 1

    async def test_viewer_can_list_comments(self, client, db, comments_env):
        viewer = comments_env["viewer"]
        card = comments_env["card"]
        resp = await client.get(
            f"/api/v1/cards/{card.id}/comments",
            headers=auth_headers(viewer),
        )
        assert resp.status_code == 200


# ---------------------------------------------------------------
# PATCH /comments/{id}  (update)
# ---------------------------------------------------------------


class TestUpdateComment:
    async def test_owner_can_update(self, client, db, comments_env):
        admin = comments_env["admin"]
        card = comments_env["card"]
        create_resp = await client.post(
            f"/api/v1/cards/{card.id}/comments",
            json={"content": "Original"},
            headers=auth_headers(admin),
        )
        comment_id = create_resp.json()["id"]

        resp = await client.patch(
            f"/api/v1/comments/{comment_id}",
            json={"content": "Edited"},
            headers=auth_headers(admin),
        )
        assert resp.status_code == 200
        assert resp.json()["content"] == "Edited"

    async def test_update_nonexistent_returns_404(self, client, db, comments_env):
        admin = comments_env["admin"]
        fake_id = uuid.uuid4()
        resp = await client.patch(
            f"/api/v1/comments/{fake_id}",
            json={"content": "Nope"},
            headers=auth_headers(admin),
        )
        assert resp.status_code == 404


# ---------------------------------------------------------------
# DELETE /comments/{id}
# ---------------------------------------------------------------


class TestDeleteComment:
    async def test_owner_can_delete(self, client, db, comments_env):
        admin = comments_env["admin"]
        card = comments_env["card"]
        create_resp = await client.post(
            f"/api/v1/cards/{card.id}/comments",
            json={"content": "Delete me"},
            headers=auth_headers(admin),
        )
        comment_id = create_resp.json()["id"]

        resp = await client.delete(
            f"/api/v1/comments/{comment_id}",
            headers=auth_headers(admin),
        )
        assert resp.status_code == 204

    async def test_delete_nonexistent_returns_404(self, client, db, comments_env):
        admin = comments_env["admin"]
        fake_id = uuid.uuid4()
        resp = await client.delete(
            f"/api/v1/comments/{fake_id}",
            headers=auth_headers(admin),
        )
        assert resp.status_code == 404
