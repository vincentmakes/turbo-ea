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


# ---------------------------------------------------------------
# GET /events/stream — per-subscriber visibility filter
# ---------------------------------------------------------------


class TestEventStreamVisibility:
    """Unit tests for the pure `_event_visible_to` predicate that gates which
    bus messages each SSE subscriber receives. No live connection needed."""

    def test_admin_sees_everything(self):
        from app.api.v1.events import _event_visible_to

        # An audit / ops-sensitive event (break-glass operator email in payload).
        ops_msg = {
            "event": "ops.rescue_access_granted",
            "data": {"operator_email": "op@vendor.example", "reason": "incident"},
        }
        assert _event_visible_to(True, ops_msg, "any-user-id") is True

    def test_non_admin_does_not_see_ops_event(self):
        from app.api.v1.events import _event_visible_to

        ops_msg = {
            "event": "ops.rescue_access_granted",
            "data": {"operator_email": "op@vendor.example"},
        }
        assert _event_visible_to(False, ops_msg, "user-123") is False

    def test_non_admin_does_not_see_card_event(self):
        from app.api.v1.events import _event_visible_to

        card_msg = {"event": "card.updated", "data": {"detail": "x"}, "card_id": "c1"}
        assert _event_visible_to(False, card_msg, "user-123") is False

    def test_non_admin_sees_own_notification(self):
        from app.api.v1.events import _event_visible_to

        msg = {"event": "notification.created", "data": {"user_id": "user-123"}}
        assert _event_visible_to(False, msg, "user-123") is True

    def test_non_admin_does_not_see_others_notification(self):
        from app.api.v1.events import _event_visible_to

        msg = {"event": "notification.created", "data": {"user_id": "someone-else"}}
        assert _event_visible_to(False, msg, "user-123") is False

    def test_non_admin_missing_data_is_withheld(self):
        from app.api.v1.events import _event_visible_to

        assert _event_visible_to(False, {"event": "x"}, "user-123") is False
        assert _event_visible_to(False, {"event": "x", "data": None}, "user-123") is False


# ---------------------------------------------------------------
# GET /events/stream — must not hold a pooled DB connection open
# ---------------------------------------------------------------


class TestEventStreamHoldsNoSession:
    """Guard tests for the connection-per-open-tab regression (discussion #901).

    ``get_db`` is a yield-dependency: FastAPI only unwinds it once the response
    completes, and an SSE response completes when the browser tab closes. When
    ``event_stream`` took ``db: AsyncSession = Depends(get_db)`` and queried it,
    the session's pooled connection stayed checked out — ``idle in transaction``
    — for the tab's whole lifetime, so every open tab permanently consumed one
    connection and a few dozen tabs exhausted the pool (and, on a managed
    Postgres with a low ``datconnlimit``, the database's own cap).

    The auth/permission lookups must therefore run in an explicit short-lived
    session that is closed before the ``StreamingResponse`` is returned.
    """

    def test_stream_takes_no_session_dependency(self):
        """No parameter may carry a session — that is what pins the connection."""
        import inspect

        from sqlalchemy.ext.asyncio import AsyncSession

        from app.api.v1.events import event_stream

        params = inspect.signature(event_stream).parameters
        assert not any(p.annotation is AsyncSession for p in params.values()), (
            "event_stream must not receive an AsyncSession — a streaming endpoint "
            "holds its request-scoped session for the life of the stream."
        )
        assert "db" not in params

    def test_stream_does_not_depend_on_get_db(self):
        """Belt and braces: `get_db` must not appear as a dependency default."""
        import inspect

        from app.api.v1.events import event_stream
        from app.database import get_db

        for param in inspect.signature(event_stream).parameters.values():
            dependency = getattr(param.default, "dependency", None)
            assert dependency is not get_db, (
                "event_stream must not use Depends(get_db); open a short-lived "
                "session instead and close it before streaming starts."
            )

    def test_stream_uses_a_short_lived_session(self):
        """The handler opens its own session and closes it before streaming."""
        import inspect

        from app.api.v1.events import event_stream

        source = inspect.getsource(event_stream)
        assert "async with async_session()" in source
        # The stream body itself must stay free of database access.
        generate_body = source.split("async def generate()", 1)[1]
        assert "db" not in generate_body

    async def test_stream_rejects_missing_token(self, client):
        """Auth still rejected before any session is opened."""
        resp = await client.get("/api/v1/events/stream")
        assert resp.status_code == 401

    async def test_stream_rejects_invalid_token(self, client):
        resp = await client.get("/api/v1/events/stream?token=not-a-real-jwt")
        assert resp.status_code == 401


# ---------------------------------------------------------------
# Connection-pool sizing is operator-tunable
# ---------------------------------------------------------------


class TestPoolSettings:
    """The pool must be configurable so an instance on a capped managed
    Postgres can fit under its connection limit without patching source."""

    def test_pool_settings_exist_with_documented_defaults(self):
        from app.config import settings

        assert settings.DB_POOL_SIZE == 20
        assert settings.DB_MAX_OVERFLOW == 10
        assert settings.DB_POOL_TIMEOUT == 30

    def test_engine_uses_the_configured_pool_size(self):
        from app.config import settings
        from app.database import engine

        assert engine.pool.size() == settings.DB_POOL_SIZE
