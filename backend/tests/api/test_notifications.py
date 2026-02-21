"""Integration tests for the /notifications endpoints.

These tests require a PostgreSQL test database and an HTTP test client.
"""

from __future__ import annotations

import uuid

import pytest

from app.core.permissions import VIEWER_PERMISSIONS
from app.models.notification import Notification
from tests.conftest import (
    auth_headers,
    create_card,
    create_card_type,
    create_role,
    create_user,
)


@pytest.fixture
async def notif_env(db):
    """Prerequisite data for notification tests."""
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
        name="Notif App",
        user_id=admin.id,
    )
    return {
        "admin": admin,
        "viewer": viewer,
        "card": card,
    }


async def _insert_notification(db, *, user_id, title="Test Notification", is_read=False):
    """Insert a notification directly into the DB."""
    notif = Notification(
        user_id=user_id,
        type="card_updated",
        title=title,
        message="Something changed",
        is_read=is_read,
        data={},
    )
    db.add(notif)
    await db.flush()
    return notif


# ---------------------------------------------------------------
# GET /notifications  (list)
# ---------------------------------------------------------------


class TestListNotifications:
    async def test_list_own_notifications(self, client, db, notif_env):
        admin = notif_env["admin"]
        await _insert_notification(db, user_id=admin.id)
        await _insert_notification(db, user_id=admin.id, title="Second")

        resp = await client.get(
            "/api/v1/notifications",
            headers=auth_headers(admin),
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["total"] >= 2
        assert len(data["items"]) >= 2

    async def test_filter_unread(self, client, db, notif_env):
        admin = notif_env["admin"]
        await _insert_notification(db, user_id=admin.id, is_read=False)
        await _insert_notification(
            db,
            user_id=admin.id,
            title="Read",
            is_read=True,
        )

        resp = await client.get(
            "/api/v1/notifications?is_read=false",
            headers=auth_headers(admin),
        )
        assert resp.status_code == 200
        for item in resp.json()["items"]:
            assert item["is_read"] is False

    async def test_other_users_notifications_not_visible(self, client, db, notif_env):
        admin = notif_env["admin"]
        viewer = notif_env["viewer"]
        await _insert_notification(db, user_id=admin.id, title="Admin only")

        resp = await client.get(
            "/api/v1/notifications",
            headers=auth_headers(viewer),
        )
        assert resp.status_code == 200
        titles = [i["title"] for i in resp.json()["items"]]
        assert "Admin only" not in titles


# ---------------------------------------------------------------
# GET /notifications/unread-count
# ---------------------------------------------------------------


class TestUnreadCount:
    async def test_unread_count(self, client, db, notif_env):
        admin = notif_env["admin"]
        await _insert_notification(db, user_id=admin.id, is_read=False)
        await _insert_notification(db, user_id=admin.id, is_read=False)
        await _insert_notification(db, user_id=admin.id, is_read=True)

        resp = await client.get(
            "/api/v1/notifications/unread-count",
            headers=auth_headers(admin),
        )
        assert resp.status_code == 200
        assert resp.json()["count"] >= 2


# ---------------------------------------------------------------
# PATCH /notifications/{id}/read  (mark read)
# ---------------------------------------------------------------


class TestMarkRead:
    async def test_mark_as_read(self, client, db, notif_env):
        admin = notif_env["admin"]
        notif = await _insert_notification(db, user_id=admin.id, is_read=False)

        resp = await client.patch(
            f"/api/v1/notifications/{notif.id}/read",
            headers=auth_headers(admin),
        )
        assert resp.status_code == 200
        assert resp.json()["ok"] is True

    async def test_mark_nonexistent_returns_404(self, client, db, notif_env):
        admin = notif_env["admin"]
        fake_id = uuid.uuid4()
        resp = await client.patch(
            f"/api/v1/notifications/{fake_id}/read",
            headers=auth_headers(admin),
        )
        assert resp.status_code == 404


# ---------------------------------------------------------------
# POST /notifications/mark-all-read
# ---------------------------------------------------------------


class TestMarkAllRead:
    async def test_mark_all_as_read(self, client, db, notif_env):
        admin = notif_env["admin"]
        await _insert_notification(db, user_id=admin.id, is_read=False)
        await _insert_notification(db, user_id=admin.id, is_read=False)

        resp = await client.post(
            "/api/v1/notifications/mark-all-read",
            headers=auth_headers(admin),
        )
        assert resp.status_code == 200
        assert resp.json()["marked"] >= 2
