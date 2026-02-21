"""Integration tests for the /events endpoints.

These tests require a PostgreSQL test database and an HTTP test client.
"""

from __future__ import annotations

import pytest

from app.core.permissions import VIEWER_PERMISSIONS
from app.models.event import Event
from tests.conftest import (
    auth_headers,
    create_card,
    create_card_type,
    create_role,
    create_user,
)


@pytest.fixture
async def events_env(db):
    """Prerequisite data for event tests."""
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
        name="Event App",
        user_id=admin.id,
    )
    return {
        "admin": admin,
        "viewer": viewer,
        "card": card,
    }


async def _insert_event(
    db,
    *,
    event_type="card.updated",
    card_id=None,
    user_id=None,
):
    """Insert an event directly into the DB."""
    ev = Event(
        event_type=event_type,
        card_id=card_id,
        user_id=user_id,
        data={"detail": "test event"},
    )
    db.add(ev)
    await db.flush()
    return ev


# ---------------------------------------------------------------
# GET /events  (list — requires admin.events permission)
# ---------------------------------------------------------------


class TestListEvents:
    async def test_admin_can_list_events(self, client, db, events_env):
        admin = events_env["admin"]
        card = events_env["card"]
        await _insert_event(db, card_id=card.id, user_id=admin.id)
        await _insert_event(
            db,
            event_type="card.created",
            card_id=card.id,
            user_id=admin.id,
        )

        resp = await client.get(
            "/api/v1/events",
            headers=auth_headers(admin),
        )
        assert resp.status_code == 200
        data = resp.json()
        assert isinstance(data, list)
        assert len(data) >= 2

    async def test_viewer_cannot_list_events(self, client, db, events_env):
        viewer = events_env["viewer"]
        resp = await client.get(
            "/api/v1/events",
            headers=auth_headers(viewer),
        )
        assert resp.status_code == 403

    async def test_filter_by_card_id(self, client, db, events_env):
        admin = events_env["admin"]
        card = events_env["card"]
        await _insert_event(db, card_id=card.id, user_id=admin.id)

        resp = await client.get(
            f"/api/v1/events?card_id={card.id}",
            headers=auth_headers(admin),
        )
        assert resp.status_code == 200
        data = resp.json()
        assert len(data) >= 1
        for ev in data:
            assert ev["card_id"] == str(card.id)

    async def test_event_includes_user_info(self, client, db, events_env):
        admin = events_env["admin"]
        card = events_env["card"]
        await _insert_event(db, card_id=card.id, user_id=admin.id)

        resp = await client.get(
            "/api/v1/events",
            headers=auth_headers(admin),
        )
        assert resp.status_code == 200
        data = resp.json()
        assert len(data) >= 1
        assert data[0]["user_id"] == str(admin.id)

    async def test_unauthenticated_returns_401(self, client, db, events_env):
        resp = await client.get("/api/v1/events")
        assert resp.status_code == 401
