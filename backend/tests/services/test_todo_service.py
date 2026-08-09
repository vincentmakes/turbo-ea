"""Unit/integration tests for the shared todo write-path service.

The service is the single code path behind both the REST routes and the
extension todos bridge, so these tests pin the guard messages, status
codes, notification side effects, and recurrence roll-forward that the
routes have always exposed.
"""

from __future__ import annotations

from datetime import date

import pytest
from sqlalchemy import select

from app.models.notification import Notification
from app.models.todo import Todo
from app.services import todo_service
from app.services.todo_service import (
    TodoActor,
    TodoConflictError,
    TodoForbiddenError,
    TodoValidationError,
)
from tests.conftest import create_card, create_card_type, create_role, create_user


@pytest.fixture
async def env(db):
    await create_role(db, key="admin", label="Admin", permissions={"*": True})
    await create_card_type(db, key="Application", label="Application")
    user = await create_user(db, email="svc@test.com", role="admin")
    other = await create_user(db, email="svc2@test.com", role="admin")
    card = await create_card(db, card_type="Application", name="Svc App", user_id=user.id)
    return {"user": user, "other": other, "card": card}


def actor_of(user) -> TodoActor:
    return TodoActor(user_id=user.id, display_name=user.display_name)


class TestCreate:
    async def test_create_basic(self, db, env):
        todo = await todo_service.create_todo(
            db, actor_of(env["user"]), description="Do it", card_id=env["card"].id
        )
        assert todo.status == "open"
        assert todo.created_by == env["user"].id
        assert todo.external_source is None

    async def test_create_with_external_fields(self, db, env):
        todo = await todo_service.create_todo(
            db,
            actor_of(env["user"]),
            description="Mirrored",
            external_ref="PROJ-9",
            external_url="https://tracker/PROJ-9",
            external_source="jira-sync",
        )
        assert todo.external_ref == "PROJ-9"
        assert todo.external_source == "jira-sync"

    async def test_link_validation_message_is_preserved(self, db, env):
        with pytest.raises(TodoValidationError) as exc:
            await todo_service.create_todo(
                db, actor_of(env["user"]), description="x", link="https://evil.example"
            )
        assert exc.value.status_code == 400
        assert exc.value.message == "link must be a relative in-app path starting with /"

    async def test_assignment_notification_uses_actor_display_name(self, db, env):
        await todo_service.create_todo(
            db,
            actor_of(env["user"]),
            description="Assigned work",
            assigned_to=env["other"].id,
        )
        notif = (
            (await db.execute(select(Notification).where(Notification.user_id == env["other"].id)))
            .scalars()
            .first()
        )
        assert notif is not None
        assert env["user"].display_name in notif.message


class TestUpdateGuards:
    async def test_system_todo_status_change_forbidden(self, db, env):
        todo = Todo(description="sign it", is_system=True, created_by=env["user"].id)
        db.add(todo)
        await db.flush()
        with pytest.raises(TodoForbiddenError) as exc:
            await todo_service.update_todo(db, actor_of(env["user"]), todo, {"status": "done"})
        assert exc.value.status_code == 403
        assert exc.value.message == "This action must be completed from its linked page"

    async def test_scheduled_todo_cannot_complete(self, db, env):
        todo = Todo(
            description="future review",
            status="scheduled",
            created_by=env["user"].id,
            recurrence_unit="months",
        )
        db.add(todo)
        await db.flush()
        with pytest.raises(TodoConflictError) as exc:
            await todo_service.update_todo(db, actor_of(env["user"]), todo, {"status": "done"})
        assert exc.value.status_code == 409
        assert exc.value.message == "Activate the scheduled todo before completing it"


class TestRecurrence:
    async def test_completing_recurring_todo_rolls_forward(self, db, env):
        todo = await todo_service.create_todo(
            db,
            actor_of(env["user"]),
            description="Quarterly check",
            due_date=date.today(),
            recurrence_unit="months",
            recurrence_interval=3,
        )
        series_id = todo.series_id
        assert series_id is not None

        await todo_service.update_todo(db, actor_of(env["user"]), todo, {"status": "done"})
        rows = (await db.execute(select(Todo).where(Todo.series_id == series_id))).scalars().all()
        assert len(rows) == 2
        successor = next(r for r in rows if r.status != "done")
        from app.services.recurrence import compute_next_due

        assert successor.due_date == compute_next_due(todo.due_date, "months", 3)


class TestPromote:
    async def test_promote_open_is_idempotent(self, db, env):
        todo = await todo_service.create_todo(db, actor_of(env["user"]), description="x")
        out = await todo_service.promote_todo(db, actor_of(env["user"]), todo)
        assert out.status == "open"

    async def test_promote_done_conflicts(self, db, env):
        todo = Todo(description="done already", status="done", created_by=env["user"].id)
        db.add(todo)
        await db.flush()
        with pytest.raises(TodoConflictError) as exc:
            await todo_service.promote_todo(db, actor_of(env["user"]), todo)
        assert exc.value.message == "Only scheduled todos can be promoted"

    async def test_promote_scheduled_opens_and_notifies(self, db, env):
        todo = Todo(
            description="scheduled review",
            status="scheduled",
            created_by=env["user"].id,
            assigned_to=env["other"].id,
            recurrence_unit="months",
        )
        db.add(todo)
        await db.flush()
        out = await todo_service.promote_todo(db, actor_of(env["user"]), todo)
        assert out.status == "open"
        notif = (
            (await db.execute(select(Notification).where(Notification.user_id == env["other"].id)))
            .scalars()
            .first()
        )
        assert notif is not None


class TestDelete:
    async def test_delete_removes_row(self, db, env):
        todo = await todo_service.create_todo(db, actor_of(env["user"]), description="temp")
        tid = todo.id
        await todo_service.delete_todo(db, actor_of(env["user"]), todo)
        remaining = (await db.execute(select(Todo).where(Todo.id == tid))).scalar_one_or_none()
        assert remaining is None
