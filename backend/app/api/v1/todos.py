from __future__ import annotations

import uuid
from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.api.deps import get_current_user
from app.database import get_db
from app.models.todo import Todo
from app.models.user import User
from app.schemas.common import TodoCreate, TodoUpdate
from app.services import notification_service, todo_recurrence_service
from app.services.permission_service import PermissionService
from app.services.recurrence import default_lead_time_days

router = APIRouter(tags=["todos"])


def _todo_to_dict(t: Todo) -> dict:
    return {
        "id": str(t.id),
        "card_id": str(t.card_id) if t.card_id else None,
        "card_name": t.card.name if t.card else None,
        "card_type": t.card.type if t.card else None,
        "description": t.description,
        "status": t.status,
        "link": t.link,
        "is_system": t.is_system,
        "assigned_to": str(t.assigned_to) if t.assigned_to else None,
        "assignee_name": t.assignee.display_name if t.assignee else None,
        "created_by": str(t.created_by) if t.created_by else None,
        "due_date": str(t.due_date) if t.due_date else None,
        "created_at": t.created_at.isoformat() if t.created_at else None,
        "series_id": str(t.series_id) if t.series_id else None,
        "recurrence_unit": t.recurrence_unit,
        "recurrence_interval": t.recurrence_interval,
        "lead_time_days": t.lead_time_days,
    }


@router.get("/todos")
async def list_all_todos(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
    status: str | None = Query(None),
    assigned_to: str | None = Query(None),
    mine: bool = Query(True),
    assigned_only: bool = Query(False),
    created_only: bool = Query(False),
):
    q = select(Todo).order_by(Todo.created_at.desc())
    if status:
        q = q.where(Todo.status == status)
    if assigned_to:
        target_id = uuid.UUID(assigned_to)
        # Only allow querying another user's todos if the caller is an admin
        if target_id != user.id:
            if not await PermissionService.has_app_permission(db, user, "admin.todos"):
                raise HTTPException(403, "Cannot view other users' todos")
        q = q.where(Todo.assigned_to == target_id)
    elif assigned_only:
        # Strict scope: only todos assigned to the caller (used by the
        # workspace counter and the dashboard's My Open Todos preview).
        q = q.where(Todo.assigned_to == user.id)
    elif created_only:
        # Strict scope: only todos the caller created (used by the
        # "Created by me" tab on /todos).
        q = q.where(Todo.created_by == user.id)
    elif mine:
        # Default: todos assigned to OR created by the caller.
        q = q.where((Todo.assigned_to == user.id) | (Todo.created_by == user.id))

    q = q.options(selectinload(Todo.card), selectinload(Todo.assignee))
    result = await db.execute(q)
    return [_todo_to_dict(t) for t in result.scalars().all()]


@router.get("/cards/{card_id}/todos")
async def list_card_todos(
    card_id: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    card_uuid = uuid.UUID(card_id)
    q = (
        select(Todo)
        .where(Todo.card_id == card_uuid)
        .options(selectinload(Todo.card), selectinload(Todo.assignee))
        .order_by(Todo.created_at.desc())
    )
    result = await db.execute(q)
    return [_todo_to_dict(t) for t in result.scalars().all()]


def _validated_link(link: str | None) -> str | None:
    """Todos may deep-link only within the app — relative paths, never an
    external URL (a todo assigned to someone else must not become a
    click-through to an arbitrary site)."""
    if link is None or link == "":
        return None
    if not link.startswith("/") or link.startswith("//"):
        raise HTTPException(400, "link must be a relative in-app path starting with /")
    return link


async def _create_todo(
    db: AsyncSession, user: User, body: TodoCreate, card_id: uuid.UUID | None
) -> dict:
    recurring = body.recurrence_unit != "none"
    # First occurrence always opens immediately — the user just created the
    # todo intending to act on it. Lead-time gating only applies to the
    # rolled-forward occurrences spawned on completion.
    lead_time_days = (
        body.lead_time_days
        if body.lead_time_days is not None
        else default_lead_time_days(body.recurrence_unit, body.recurrence_interval)
    )
    todo = Todo(
        card_id=card_id,
        description=body.description,
        link=_validated_link(body.link),
        assigned_to=uuid.UUID(body.assigned_to) if body.assigned_to else None,
        created_by=user.id,
        due_date=date.fromisoformat(body.due_date) if body.due_date else None,
        series_id=uuid.uuid4() if recurring else None,
        recurrence_unit=body.recurrence_unit,
        recurrence_interval=body.recurrence_interval,
        lead_time_days=lead_time_days if recurring else 0,
    )
    db.add(todo)
    await db.flush()

    # Notify the assignee (even if self-assigned)
    if todo.assigned_to:
        await notification_service.create_notification(
            db,
            user_id=todo.assigned_to,
            notif_type="todo_assigned",
            title="Todo Assigned",
            message=f'{user.display_name} assigned you a todo: "{body.description[:80]}"',
            link="/todos",
            data={"todo_id": str(todo.id), "card_id": str(card_id) if card_id else None},
            card_id=card_id,
        )

    await db.commit()
    result = await db.execute(
        select(Todo)
        .where(Todo.id == todo.id)
        .options(selectinload(Todo.card), selectinload(Todo.assignee))
    )
    return _todo_to_dict(result.scalar_one())


@router.post("/cards/{card_id}/todos", status_code=201)
async def create_todo(
    card_id: str,
    body: TodoCreate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    return await _create_todo(db, user, body, uuid.UUID(card_id))


@router.post("/todos", status_code=201)
async def create_standalone_todo(
    body: TodoCreate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Create a todo that is not attached to a card — e.g. pointing at an
    ADR, a risk, or an extension page via ``link``. Same shape and rules as
    card todos (assignment notification included), just without a card."""
    return await _create_todo(db, user, body, None)


@router.patch("/todos/{todo_id}")
async def update_todo(
    todo_id: str,
    body: TodoUpdate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    result = await db.execute(select(Todo).where(Todo.id == uuid.UUID(todo_id)))
    todo = result.scalar_one_or_none()
    if not todo:
        raise HTTPException(404, "Todo not found")

    # Only the assignee, creator, or an admin can update a todo
    if todo.assigned_to != user.id and todo.created_by != user.id:
        if not await PermissionService.has_app_permission(db, user, "admin.todos"):
            raise HTTPException(403, "Not enough permissions")

    # System-generated todos (e.g. sign requests) cannot be manually toggled
    update_data = body.model_dump(exclude_unset=True)
    if todo.is_system and "status" in update_data:
        raise HTTPException(
            403,
            "This action must be completed from its linked page",
        )

    # A scheduled (dormant) recurring occurrence isn't actionable yet — it
    # must be promoted to open first (via the daily loop or POST .../promote).
    if todo.status == "scheduled" and update_data.get("status") == "done":
        raise HTTPException(409, "Activate the scheduled todo before completing it")

    was_open_recurring = (
        update_data.get("status") == "done"
        and todo.status != "done"
        and todo_recurrence_service.is_recurring(todo)
    )

    old_assignee = todo.assigned_to
    for field, value in update_data.items():
        if field == "assigned_to" and value is not None:
            value = uuid.UUID(value)
        if field == "due_date" and value is not None:
            value = date.fromisoformat(value)
        setattr(todo, field, value)
    await db.flush()

    # Completing a recurring todo spawns the next occurrence in the series.
    if was_open_recurring:
        await todo_recurrence_service.roll_forward(db, todo=todo, actor_id=user.id)

    # Notify new assignee if assignment changed (even if self-assigned)
    new_assignee = todo.assigned_to
    if new_assignee and new_assignee != old_assignee:
        await notification_service.create_notification(
            db,
            user_id=new_assignee,
            notif_type="todo_assigned",
            title="Todo Assigned",
            message=f'{user.display_name} assigned you a todo: "{todo.description[:80]}"',
            link="/todos",
            data={"todo_id": todo_id},
            card_id=todo.card_id,
        )

    await db.commit()
    result = await db.execute(
        select(Todo)
        .where(Todo.id == todo.id)
        .options(selectinload(Todo.card), selectinload(Todo.assignee))
    )
    todo = result.scalar_one()
    return _todo_to_dict(todo)


@router.post("/todos/{todo_id}/promote")
async def promote_todo(
    todo_id: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Manually activate a scheduled recurring todo ("do the review early").

    Short-circuits the wait for the daily promotion loop. Idempotent on
    todos that are already open.
    """
    result = await db.execute(select(Todo).where(Todo.id == uuid.UUID(todo_id)))
    todo = result.scalar_one_or_none()
    if not todo:
        raise HTTPException(404, "Todo not found")

    if todo.assigned_to != user.id and todo.created_by != user.id:
        if not await PermissionService.has_app_permission(db, user, "admin.todos"):
            raise HTTPException(403, "Not enough permissions")

    if todo.status == "open":
        # Already actionable — nothing to do.
        pass
    elif todo.status != "scheduled":
        raise HTTPException(409, "Only scheduled todos can be promoted")
    else:
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
                actor_id=user.id,
            )

    await db.commit()
    result = await db.execute(
        select(Todo)
        .where(Todo.id == todo.id)
        .options(selectinload(Todo.card), selectinload(Todo.assignee))
    )
    todo = result.scalar_one()
    return _todo_to_dict(todo)


@router.delete("/todos/{todo_id}", status_code=204)
async def delete_todo(
    todo_id: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    result = await db.execute(select(Todo).where(Todo.id == uuid.UUID(todo_id)))
    todo = result.scalar_one_or_none()
    if not todo:
        raise HTTPException(404, "Todo not found")

    # Only the assignee, creator, or an admin can delete a todo
    if todo.assigned_to != user.id and todo.created_by != user.id:
        if not await PermissionService.has_app_permission(db, user, "admin.todos"):
            raise HTTPException(403, "Not enough permissions")

    await db.delete(todo)
    await db.commit()
