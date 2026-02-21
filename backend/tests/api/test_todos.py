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
