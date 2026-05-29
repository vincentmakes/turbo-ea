"""Recurring-todo service: completion-driven roll-forward + lead-time promotion.

A recurring card todo is a self-perpetuating chain of plain ``Todo`` rows
sharing one ``series_id`` (see ``app/models/todo.py``). This module owns the
two pieces of behaviour that make the chain advance:

* ``roll_forward`` — called when a recurring todo is marked ``done``. It
  spawns the next row in the series with ``due_date`` shifted by the
  recurrence rule (calendar-correct math, shared with mitigation tasks via
  ``app.services.recurrence``). The new row lands ``open`` if today is inside
  its lead-time window, otherwise ``scheduled`` (dormant — no notification,
  hidden from the default open list).
* ``promote_scheduled_todos`` — the daily background pass that flips
  ``scheduled`` rows to ``open`` once their lead-time window opens, firing the
  ``todo_assigned`` notification at that point. Mirrors
  ``risk_mitigation_task_service.promote_scheduled_occurrences``.

The API layer in ``app/api/v1/todos.py`` stays a thin permission +
serialization wrapper around these helpers. System todos always carry
``recurrence_unit == "none"``, so none of this ever fires for them.
"""

from __future__ import annotations

import logging
import uuid
from datetime import date

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.todo import Todo
from app.services import notification_service
from app.services.recurrence import compute_next_due, is_within_lead_window

logger = logging.getLogger(__name__)


def is_recurring(todo: Todo) -> bool:
    return todo.recurrence_unit != "none"


async def _notify_assignee(db: AsyncSession, todo: Todo, *, actor_id: uuid.UUID | None) -> None:
    """Fire a ``todo_assigned`` notification for an open recurring occurrence."""
    if not todo.assigned_to:
        return
    snippet = todo.description[:80]
    await notification_service.create_notification(
        db,
        user_id=todo.assigned_to,
        notif_type="todo_assigned",
        title="Recurring Todo Due",
        message=f'A recurring todo is due: "{snippet}"',
        link="/todos",
        data={"todo_id": str(todo.id), "card_id": str(todo.card_id) if todo.card_id else None},
        card_id=todo.card_id,
        actor_id=actor_id,
    )


async def roll_forward(
    db: AsyncSession,
    *,
    todo: Todo,
    actor_id: uuid.UUID | None,
    today: date | None = None,
) -> Todo | None:
    """Spawn the next occurrence of a recurring todo once ``todo`` is done.

    Returns the new ``Todo`` row, or ``None`` if the todo is not recurring or
    the recurrence rule yields no next due date. The caller is responsible for
    having already set ``todo.status = "done"``; this function only creates the
    successor. Must run inside the caller's transaction (no commit here).
    """
    if not is_recurring(todo):
        return None
    today = today or date.today()
    base_due = todo.due_date or today
    next_due = compute_next_due(base_due, todo.recurrence_unit, todo.recurrence_interval)
    if next_due is None:
        return None

    in_window = is_within_lead_window(next_due, todo.lead_time_days, today)
    nxt = Todo(
        card_id=todo.card_id,
        description=todo.description,
        status="open" if in_window else "scheduled",
        is_system=False,
        assigned_to=todo.assigned_to,
        created_by=todo.created_by,
        due_date=next_due,
        series_id=todo.series_id,
        recurrence_unit=todo.recurrence_unit,
        recurrence_interval=todo.recurrence_interval,
        lead_time_days=todo.lead_time_days,
    )
    db.add(nxt)
    await db.flush()

    # Only an open occurrence reaches the assignee; scheduled rows stay silent
    # until the promotion loop opens them.
    if nxt.status == "open":
        await _notify_assignee(db, nxt, actor_id=actor_id)
    return nxt


async def promote_scheduled_todos(
    db: AsyncSession,
    *,
    today: date | None = None,
) -> int:
    """Flip eligible ``scheduled`` recurring todos to ``open``.

    Called by the daily promotion loop in ``app.main``. Selects scheduled
    recurring rows whose lead-time window has opened, flips them to ``open``,
    and fires the ``todo_assigned`` notification. Returns the count promoted.
    Does not commit — the caller owns the transaction.
    """
    today = today or date.today()
    result = await db.execute(
        select(Todo).where(
            Todo.status == "scheduled",
            Todo.recurrence_unit != "none",
        )
    )
    promoted = 0
    for todo in result.scalars().all():
        if not is_within_lead_window(todo.due_date, todo.lead_time_days, today):
            continue
        todo.status = "open"
        await db.flush()
        await _notify_assignee(db, todo, actor_id=todo.created_by)
        promoted += 1
    return promoted
