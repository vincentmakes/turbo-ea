"""Tests for the recurring-todo service (roll-forward + lead-time promotion)."""

from __future__ import annotations

from datetime import date, timedelta

import pytest

from app.models.todo import Todo
from app.services import todo_recurrence_service as svc
from tests.conftest import create_card, create_card_type, create_role, create_user


@pytest.fixture
async def env(db):
    await create_role(db, key="admin", label="Admin", permissions={"*": True})
    await create_card_type(db, key="Application", label="Application")
    user = await create_user(db, email="owner@test.com", role="admin")
    card = await create_card(db, card_type="Application", name="App", user_id=user.id)
    return {"user": user, "card": card}


async def _make_recurring_todo(db, env, *, due, unit="months", interval=1, lead=7, status="open"):
    import uuid

    todo = Todo(
        card_id=env["card"].id,
        description="Review access rights",
        status=status,
        assigned_to=env["user"].id,
        created_by=env["user"].id,
        due_date=due,
        series_id=uuid.uuid4(),
        recurrence_unit=unit,
        recurrence_interval=interval,
        lead_time_days=lead,
    )
    db.add(todo)
    await db.flush()
    return todo


class TestRollForward:
    async def test_one_shot_returns_none(self, db, env):
        todo = Todo(
            card_id=env["card"].id,
            description="One-shot",
            status="done",
            created_by=env["user"].id,
            recurrence_unit="none",
        )
        db.add(todo)
        await db.flush()
        assert await svc.roll_forward(db, todo=todo, actor_id=env["user"].id) is None

    async def test_spawns_next_with_shifted_due_and_same_series(self, db, env):
        today = date(2026, 1, 10)
        todo = await _make_recurring_todo(db, env, due=date(2026, 1, 15), unit="months", interval=1)
        todo.status = "done"
        nxt = await svc.roll_forward(db, todo=todo, actor_id=env["user"].id, today=today)
        assert nxt is not None
        assert nxt.due_date == date(2026, 2, 15)
        assert nxt.series_id == todo.series_id
        assert nxt.assigned_to == todo.assigned_to
        assert nxt.recurrence_unit == "months"
        assert nxt.is_system is False

    async def test_next_is_scheduled_when_far_from_due(self, db, env):
        # Due far in the future, lead 7 → today way outside window → scheduled.
        today = date(2026, 1, 10)
        todo = await _make_recurring_todo(
            db, env, due=date(2026, 1, 10), unit="months", interval=6, lead=7
        )
        todo.status = "done"
        nxt = await svc.roll_forward(db, todo=todo, actor_id=env["user"].id, today=today)
        assert nxt is not None
        assert nxt.due_date == date(2026, 7, 10)
        assert nxt.status == "scheduled"

    async def test_next_is_open_when_within_lead_window(self, db, env):
        today = date(2026, 1, 9)
        # Daily cadence: next due 2026-01-10, lead 1 → window opens 2026-01-09.
        todo = await _make_recurring_todo(
            db, env, due=date(2026, 1, 9), unit="days", interval=1, lead=1
        )
        todo.status = "done"
        nxt = await svc.roll_forward(db, todo=todo, actor_id=env["user"].id, today=today)
        assert nxt is not None
        assert nxt.due_date == date(2026, 1, 10)
        assert nxt.status == "open"


class TestPromoteScheduledTodos:
    async def test_promotes_eligible_scheduled(self, db, env):
        today = date(2026, 1, 10)
        due_soon = today + timedelta(days=3)
        todo = await _make_recurring_todo(
            db, env, due=due_soon, unit="months", interval=1, lead=7, status="scheduled"
        )
        count = await svc.promote_scheduled_todos(db, today=today)
        await db.refresh(todo)
        assert count == 1
        assert todo.status == "open"

    async def test_skips_out_of_window(self, db, env):
        today = date(2026, 1, 10)
        due_far = today + timedelta(days=60)
        todo = await _make_recurring_todo(
            db, env, due=due_far, unit="months", interval=3, lead=7, status="scheduled"
        )
        count = await svc.promote_scheduled_todos(db, today=today)
        await db.refresh(todo)
        assert count == 0
        assert todo.status == "scheduled"

    async def test_ignores_non_recurring_scheduled(self, db, env):
        # A non-recurring row should never be in "scheduled", but guard anyway.
        todo = Todo(
            card_id=env["card"].id,
            description="weird",
            status="scheduled",
            created_by=env["user"].id,
            recurrence_unit="none",
            due_date=date(2026, 1, 1),
        )
        db.add(todo)
        await db.flush()
        count = await svc.promote_scheduled_todos(db, today=date(2026, 6, 1))
        await db.refresh(todo)
        assert count == 0
        assert todo.status == "scheduled"
