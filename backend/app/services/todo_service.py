"""Todo write-path service: validation, guards, notifications, events.

Shared by the REST routes in ``app/api/v1/todos.py`` and the extension
todos bridge (``app/services/extensions/todos_bridge.py``) so both paths
produce identical side effects — assignment notifications, recurrence
roll-forward, and the ``todo.*`` audit events introduced with this module
(todo writes were previously invisible to the event bus and change
history).

Every function flushes but never commits — the caller owns the
transaction. Domain failures raise :class:`TodoError` subclasses carrying
the HTTP status code and the exact message the routes have always
returned; routes translate them to ``HTTPException`` verbatim, the bridge
to ``ExtensionDataError``.

Writes are attributed through :class:`TodoActor`: a human user
(``user_id`` set, ``ext_key`` None) or an extension (``user_id`` None,
``ext_key`` set). Extension actors stamp ``data["ext"]`` on every event so
the audit trail records which extension performed the write.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import date
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.todo import Todo
from app.services import notification_service, todo_recurrence_service
from app.services.event_bus import event_bus
from app.services.recurrence import default_lead_time_days


@dataclass(frozen=True)
class TodoActor:
    """Who is performing a todo write.

    ``user_id`` is None for extension writes (there is no service-account
    concept; attribution rides on ``ext_key`` + the mutation batch).
    ``display_name`` feeds the assignment-notification text.
    """

    user_id: uuid.UUID | None
    display_name: str
    ext_key: str | None = None


class TodoError(Exception):
    """Domain error carrying the HTTP status + message the routes emit."""

    status_code = 400

    def __init__(self, message: str):
        super().__init__(message)
        self.message = message


class TodoValidationError(TodoError):
    status_code = 400


class TodoForbiddenError(TodoError):
    status_code = 403


class TodoConflictError(TodoError):
    status_code = 409


def validated_link(link: str | None) -> str | None:
    """Todos may deep-link only within the app — relative paths, never an
    external URL (a todo assigned to someone else must not become a
    click-through to an arbitrary site). External-tracker links live on the
    bridge-only ``external_url`` column instead."""
    if link is None or link == "":
        return None
    if not link.startswith("/") or link.startswith("//"):
        raise TodoValidationError("link must be a relative in-app path starting with /")
    return link


def _coerce_user_id(value: str | uuid.UUID | None) -> uuid.UUID | None:
    if value is None or isinstance(value, uuid.UUID):
        return value
    return uuid.UUID(value)


def _coerce_date(value: str | date | None) -> date | None:
    if value is None or isinstance(value, date):
        return value
    return date.fromisoformat(value)


def _event_payload(todo: Todo, actor: TodoActor, extra: dict[str, Any] | None = None) -> dict:
    data: dict[str, Any] = {
        "todo_id": str(todo.id),
        "card_id": str(todo.card_id) if todo.card_id else None,
        "description": todo.description[:200],
        "status": todo.status,
        "assigned_to": str(todo.assigned_to) if todo.assigned_to else None,
        "external_source": todo.external_source,
        "external_ref": todo.external_ref,
    }
    if actor.ext_key:
        data["ext"] = actor.ext_key
    if extra:
        data.update(extra)
    return data


async def _publish(
    db: AsyncSession,
    actor: TodoActor,
    event_type: str,
    todo: Todo,
    extra: dict[str, Any] | None = None,
) -> None:
    # db is always passed so the event lands as an audit row (and joins the
    # request's mutation batch); card_id threads todo activity into the
    # linked card's history timeline.
    await event_bus.publish(
        event_type,
        _event_payload(todo, actor, extra),
        db=db,
        card_id=todo.card_id,
        user_id=actor.user_id,
    )


async def _notify_assigned(db: AsyncSession, actor: TodoActor, todo: Todo) -> None:
    if todo.assigned_to is None:
        return
    await notification_service.create_notification(
        db,
        user_id=todo.assigned_to,
        notif_type="todo_assigned",
        title="Todo Assigned",
        message=f'{actor.display_name} assigned you a todo: "{todo.description[:80]}"',
        link="/todos",
        data={"todo_id": str(todo.id), "card_id": str(todo.card_id) if todo.card_id else None},
        card_id=todo.card_id,
    )


async def create_todo(
    db: AsyncSession,
    actor: TodoActor,
    *,
    description: str,
    card_id: uuid.UUID | None = None,
    assigned_to: str | uuid.UUID | None = None,
    due_date: str | date | None = None,
    link: str | None = None,
    recurrence_unit: str = "none",
    recurrence_interval: int = 1,
    lead_time_days: int | None = None,
    external_ref: str | None = None,
    external_url: str | None = None,
    external_source: str | None = None,
) -> Todo:
    """Create a todo with the assignment notification and ``todo.created``
    event. Flushes, never commits."""
    recurring = recurrence_unit != "none"
    # First occurrence always opens immediately — the user just created the
    # todo intending to act on it. Lead-time gating only applies to the
    # rolled-forward occurrences spawned on completion.
    resolved_lead_time = (
        lead_time_days
        if lead_time_days is not None
        else default_lead_time_days(recurrence_unit, recurrence_interval)
    )
    todo = Todo(
        card_id=card_id,
        description=description,
        link=validated_link(link),
        assigned_to=_coerce_user_id(assigned_to),
        created_by=actor.user_id,
        due_date=_coerce_date(due_date),
        series_id=uuid.uuid4() if recurring else None,
        recurrence_unit=recurrence_unit,
        recurrence_interval=recurrence_interval,
        lead_time_days=resolved_lead_time if recurring else 0,
        external_ref=external_ref,
        external_url=external_url,
        external_source=external_source,
    )
    db.add(todo)
    await db.flush()

    # Notify the assignee (even if self-assigned)
    if todo.assigned_to:
        await _notify_assigned(db, actor, todo)

    await _publish(db, actor, "todo.created", todo)
    return todo


async def update_todo(
    db: AsyncSession,
    actor: TodoActor,
    todo: Todo,
    changes: dict[str, Any],
) -> Todo:
    """Apply ``changes`` (TodoUpdate field names, plus ``external_ref`` /
    ``external_url`` / ``external_source`` when called from the bridge) with
    the guards, roll-forward, notification and event side effects. Flushes,
    never commits. Emits ``todo.completed`` instead of ``todo.updated`` when
    the change set transitions status to done."""
    # System-generated todos (e.g. sign requests) cannot be manually toggled
    if todo.is_system and "status" in changes:
        raise TodoForbiddenError("This action must be completed from its linked page")

    # A scheduled (dormant) recurring occurrence isn't actionable yet — it
    # must be promoted to open first (via the daily loop or POST .../promote).
    if todo.status == "scheduled" and changes.get("status") == "done":
        raise TodoConflictError("Activate the scheduled todo before completing it")

    completing = changes.get("status") == "done" and todo.status != "done"
    was_open_recurring = completing and todo_recurrence_service.is_recurring(todo)

    old_assignee = todo.assigned_to
    diff: dict[str, dict[str, str | None]] = {}
    for field, value in changes.items():
        if field == "assigned_to" and value is not None:
            value = _coerce_user_id(value)
        if field == "due_date" and value is not None:
            value = _coerce_date(value)
        if field == "link":
            value = validated_link(value)
        old = getattr(todo, field)
        if old != value:
            diff[field] = {
                "from": str(old) if old is not None else None,
                "to": str(value) if value is not None else None,
            }
        setattr(todo, field, value)
    await db.flush()

    # Completing a recurring todo spawns the next occurrence in the series.
    if was_open_recurring:
        nxt = await todo_recurrence_service.roll_forward(db, todo=todo, actor_id=actor.user_id)
        if nxt is not None:
            await _publish(db, actor, "todo.created", nxt, {"rolled_forward": True})

    # Notify new assignee if assignment changed (even if self-assigned)
    new_assignee = todo.assigned_to
    if new_assignee and new_assignee != old_assignee:
        await notification_service.create_notification(
            db,
            user_id=new_assignee,
            notif_type="todo_assigned",
            title="Todo Assigned",
            message=f'{actor.display_name} assigned you a todo: "{todo.description[:80]}"',
            link="/todos",
            data={"todo_id": str(todo.id)},
            card_id=todo.card_id,
        )

    event_type = "todo.completed" if completing else "todo.updated"
    await _publish(db, actor, event_type, todo, {"changes": diff})
    return todo


async def promote_todo(db: AsyncSession, actor: TodoActor, todo: Todo) -> Todo:
    """Manually activate a scheduled recurring todo ("do the review early").

    Idempotent on todos that are already open; raises 409 otherwise. Flushes,
    never commits."""
    if todo.status == "open":
        # Already actionable — nothing to do.
        return todo
    if todo.status != "scheduled":
        raise TodoConflictError("Only scheduled todos can be promoted")

    todo.status = "open"
    await db.flush()
    if todo.assigned_to:
        await notification_service.create_notification(
            db,
            user_id=todo.assigned_to,
            notif_type="todo_assigned",
            title="Recurring Todo Due",
            message=f'A recurring todo is due: "{todo.description[:80]}"',
            link="/todos",
            data={"todo_id": str(todo.id)},
            card_id=todo.card_id,
            actor_id=actor.user_id,
        )
    await _publish(db, actor, "todo.promoted", todo)
    return todo


async def delete_todo(db: AsyncSession, actor: TodoActor, todo: Todo) -> None:
    """Delete a todo, emitting ``todo.deleted`` first (the payload needs the
    row). Flushes, never commits."""
    await _publish(db, actor, "todo.deleted", todo)
    await db.delete(todo)
    await db.flush()
