"""Integration tests for the /todos and /cards/{id}/todos endpoints.

These tests require a PostgreSQL test database and an HTTP test client.
"""

from __future__ import annotations

import uuid

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
async def todos_env(db):
    """Prerequisite data for todo tests."""
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
        name="Todo App",
        user_id=admin.id,
    )
    return {
        "admin": admin,
        "viewer": viewer,
        "card": card,
    }


# ---------------------------------------------------------------
# POST /cards/{id}/todos  (create)
# ---------------------------------------------------------------


class TestCreateTodo:
    async def test_create_todo(self, client, db, todos_env):
        admin = todos_env["admin"]
        card = todos_env["card"]
        resp = await client.post(
            f"/api/v1/cards/{card.id}/todos",
            json={"description": "Fix the bug"},
            headers=auth_headers(admin),
        )
        assert resp.status_code == 201
        data = resp.json()
        assert data["description"] == "Fix the bug"
        assert data["status"] == "open"
        assert data["card_id"] == str(card.id)

    async def test_create_todo_with_assignee(self, client, db, todos_env):
        admin = todos_env["admin"]
        card = todos_env["card"]
        resp = await client.post(
            f"/api/v1/cards/{card.id}/todos",
            json={
                "description": "Assigned task",
                "assigned_to": str(admin.id),
            },
            headers=auth_headers(admin),
        )
        assert resp.status_code == 201
        assert resp.json()["assigned_to"] == str(admin.id)

    async def test_create_todo_with_due_date(self, client, db, todos_env):
        admin = todos_env["admin"]
        card = todos_env["card"]
        resp = await client.post(
            f"/api/v1/cards/{card.id}/todos",
            json={
                "description": "Due task",
                "due_date": "2026-06-01",
            },
            headers=auth_headers(admin),
        )
        assert resp.status_code == 201
        assert resp.json()["due_date"] == "2026-06-01"


class TestCreateStandaloneTodo:
    async def test_create_standalone_todo_with_link_and_assignee(self, client, db, todos_env):
        admin = todos_env["admin"]
        viewer = todos_env["viewer"]
        resp = await client.post(
            "/api/v1/todos",
            json={
                "description": "Approve realized value",
                "assigned_to": str(viewer.id),
                "link": "/ea-delivery/adr/123/preview",
            },
            headers=auth_headers(admin),
        )
        assert resp.status_code == 201
        data = resp.json()
        assert data["card_id"] is None
        assert data["link"] == "/ea-delivery/adr/123/preview"
        assert data["assigned_to"] == str(viewer.id)
        assert data["status"] == "open"
        # The assignee sees it in their list and can complete it.
        listing = await client.get("/api/v1/todos?assigned_only=true", headers=auth_headers(viewer))
        assert data["id"] in [t["id"] for t in listing.json()]
        done = await client.patch(
            f"/api/v1/todos/{data['id']}",
            json={"status": "done"},
            headers=auth_headers(viewer),
        )
        assert done.status_code == 200
        assert done.json()["status"] == "done"

    async def test_link_must_be_relative_in_app_path(self, client, db, todos_env):
        admin = todos_env["admin"]
        card = todos_env["card"]
        for bad in ("https://evil.example/x", "//evil.example/x", "javascript:alert(1)"):
            resp = await client.post(
                "/api/v1/todos",
                json={"description": "x", "link": bad},
                headers=auth_headers(admin),
            )
            assert resp.status_code == 400, bad
        # Card todos accept the (validated) link too.
        resp = await client.post(
            f"/api/v1/cards/{card.id}/todos",
            json={"description": "with link", "link": "/inventory"},
            headers=auth_headers(admin),
        )
        assert resp.status_code == 201
        assert resp.json()["link"] == "/inventory"


# ---------------------------------------------------------------
# GET /cards/{id}/todos  (list per card)
# ---------------------------------------------------------------


class TestListCardTodos:
    async def test_list_card_todos(self, client, db, todos_env):
        admin = todos_env["admin"]
        card = todos_env["card"]
        await client.post(
            f"/api/v1/cards/{card.id}/todos",
            json={"description": "Task A"},
            headers=auth_headers(admin),
        )
        resp = await client.get(
            f"/api/v1/cards/{card.id}/todos",
            headers=auth_headers(admin),
        )
        assert resp.status_code == 200
        data = resp.json()
        assert isinstance(data, list)
        assert len(data) >= 1


# ---------------------------------------------------------------
# GET /todos  (list all, mine by default)
# ---------------------------------------------------------------


class TestListAllTodos:
    async def test_list_my_todos(self, client, db, todos_env):
        admin = todos_env["admin"]
        card = todos_env["card"]
        await client.post(
            f"/api/v1/cards/{card.id}/todos",
            json={
                "description": "My task",
                "assigned_to": str(admin.id),
            },
            headers=auth_headers(admin),
        )
        resp = await client.get(
            "/api/v1/todos",
            headers=auth_headers(admin),
        )
        assert resp.status_code == 200
        data = resp.json()
        assert isinstance(data, list)
        assert len(data) >= 1


# ---------------------------------------------------------------
# PATCH /todos/{id}  (update)
# ---------------------------------------------------------------


class TestUpdateTodo:
    async def test_mark_done(self, client, db, todos_env):
        admin = todos_env["admin"]
        card = todos_env["card"]
        create_resp = await client.post(
            f"/api/v1/cards/{card.id}/todos",
            json={"description": "Complete me"},
            headers=auth_headers(admin),
        )
        todo_id = create_resp.json()["id"]

        resp = await client.patch(
            f"/api/v1/todos/{todo_id}",
            json={"status": "done"},
            headers=auth_headers(admin),
        )
        assert resp.status_code == 200
        assert resp.json()["status"] == "done"

    async def test_update_nonexistent_returns_404(self, client, db, todos_env):
        admin = todos_env["admin"]
        fake_id = uuid.uuid4()
        resp = await client.patch(
            f"/api/v1/todos/{fake_id}",
            json={"status": "done"},
            headers=auth_headers(admin),
        )
        assert resp.status_code == 404

    async def test_system_todo_status_cannot_be_toggled(self, client, db, todos_env):
        """System-generated todos cannot have status manually changed."""
        admin = todos_env["admin"]
        card = todos_env["card"]

        from app.models.todo import Todo

        todo = Todo(
            card_id=card.id,
            description="System task",
            is_system=True,
            created_by=admin.id,
            assigned_to=admin.id,
        )
        db.add(todo)
        await db.flush()

        resp = await client.patch(
            f"/api/v1/todos/{todo.id}",
            json={"status": "done"},
            headers=auth_headers(admin),
        )
        assert resp.status_code == 403


# ---------------------------------------------------------------
# Recurrence
# ---------------------------------------------------------------


class TestRecurringTodo:
    async def test_create_recurring_first_occurrence_is_open(self, client, db, todos_env):
        admin = todos_env["admin"]
        card = todos_env["card"]
        resp = await client.post(
            f"/api/v1/cards/{card.id}/todos",
            json={
                "description": "Review access rights",
                "assigned_to": str(admin.id),
                "due_date": "2026-06-01",
                "recurrence_unit": "months",
                "recurrence_interval": 6,
            },
            headers=auth_headers(admin),
        )
        assert resp.status_code == 201
        data = resp.json()
        # First occurrence always opens immediately regardless of lead window.
        assert data["status"] == "open"
        assert data["recurrence_unit"] == "months"
        assert data["recurrence_interval"] == 6
        assert data["series_id"] is not None
        # Smart default lead time for monthly cadence is 7.
        assert data["lead_time_days"] == 7

    async def test_complete_recurring_spawns_next(self, client, db, todos_env):
        admin = todos_env["admin"]
        card = todos_env["card"]
        create = await client.post(
            f"/api/v1/cards/{card.id}/todos",
            json={
                "description": "Monthly review",
                "assigned_to": str(admin.id),
                "due_date": "2026-06-01",
                "recurrence_unit": "months",
                "recurrence_interval": 1,
            },
            headers=auth_headers(admin),
        )
        first = create.json()
        series_id = first["series_id"]

        patch = await client.patch(
            f"/api/v1/todos/{first['id']}",
            json={"status": "done"},
            headers=auth_headers(admin),
        )
        assert patch.status_code == 200
        assert patch.json()["status"] == "done"

        # A new occurrence in the same series should now exist on the card.
        listing = await client.get(
            f"/api/v1/cards/{card.id}/todos",
            headers=auth_headers(admin),
        )
        rows = listing.json()
        same_series = [r for r in rows if r["series_id"] == series_id]
        assert len(same_series) == 2
        new_rows = [r for r in same_series if r["status"] in ("open", "scheduled")]
        assert len(new_rows) == 1
        assert new_rows[0]["due_date"] == "2026-07-01"

    async def test_one_shot_complete_does_not_spawn(self, client, db, todos_env):
        admin = todos_env["admin"]
        card = todos_env["card"]
        create = await client.post(
            f"/api/v1/cards/{card.id}/todos",
            json={"description": "Just once"},
            headers=auth_headers(admin),
        )
        first = create.json()
        await client.patch(
            f"/api/v1/todos/{first['id']}",
            json={"status": "done"},
            headers=auth_headers(admin),
        )
        listing = await client.get(
            f"/api/v1/cards/{card.id}/todos",
            headers=auth_headers(admin),
        )
        assert len(listing.json()) == 1

    async def test_scheduled_todo_cannot_be_completed(self, client, db, todos_env):
        admin = todos_env["admin"]
        card = todos_env["card"]
        from app.models.todo import Todo

        todo = Todo(
            card_id=card.id,
            description="Future review",
            status="scheduled",
            created_by=admin.id,
            assigned_to=admin.id,
            recurrence_unit="months",
            recurrence_interval=6,
            lead_time_days=7,
        )
        db.add(todo)
        await db.flush()

        resp = await client.patch(
            f"/api/v1/todos/{todo.id}",
            json={"status": "done"},
            headers=auth_headers(admin),
        )
        assert resp.status_code == 409

    async def test_promote_scheduled_todo(self, client, db, todos_env):
        admin = todos_env["admin"]
        card = todos_env["card"]
        from app.models.todo import Todo

        todo = Todo(
            card_id=card.id,
            description="Promote me",
            status="scheduled",
            created_by=admin.id,
            assigned_to=admin.id,
            recurrence_unit="months",
            recurrence_interval=6,
            lead_time_days=7,
        )
        db.add(todo)
        await db.flush()

        resp = await client.post(
            f"/api/v1/todos/{todo.id}/promote",
            headers=auth_headers(admin),
        )
        assert resp.status_code == 200
        assert resp.json()["status"] == "open"


# ---------------------------------------------------------------
# DELETE /todos/{id}
# ---------------------------------------------------------------


class TestDeleteTodo:
    async def test_creator_can_delete(self, client, db, todos_env):
        admin = todos_env["admin"]
        card = todos_env["card"]
        create_resp = await client.post(
            f"/api/v1/cards/{card.id}/todos",
            json={"description": "Delete me"},
            headers=auth_headers(admin),
        )
        todo_id = create_resp.json()["id"]

        resp = await client.delete(
            f"/api/v1/todos/{todo_id}",
            headers=auth_headers(admin),
        )
        assert resp.status_code == 204

    async def test_delete_nonexistent_returns_404(self, client, db, todos_env):
        admin = todos_env["admin"]
        fake_id = uuid.uuid4()
        resp = await client.delete(
            f"/api/v1/todos/{fake_id}",
            headers=auth_headers(admin),
        )
        assert resp.status_code == 404
