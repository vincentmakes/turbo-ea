from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.api.deps import get_current_user
from app.database import get_db
from app.models.todo import Todo
from app.models.user import User
from app.schemas.common import TodoCreate, TodoUpdate
from app.services import todo_service
from app.services.permission_service import PermissionService
from app.services.todo_service import TodoActor, TodoError

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
        # Read-only external-tracker mirror fields; written only by the SDK
        # todos bridge, never by the REST API.
        "external_ref": t.external_ref,
        "external_url": t.external_url,
        "external_source": t.external_source,
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


def _actor(user: User) -> TodoActor:
    return TodoActor(user_id=user.id, display_name=user.display_name)


async def _create_todo(
    db: AsyncSession, user: User, body: TodoCreate, card_id: uuid.UUID | None
) -> dict:
    try:
        todo = await todo_service.create_todo(
            db,
            _actor(user),
            description=body.description,
            card_id=card_id,
            assigned_to=body.assigned_to,
            due_date=body.due_date,
            link=body.link,
            recurrence_unit=body.recurrence_unit,
            recurrence_interval=body.recurrence_interval,
            lead_time_days=body.lead_time_days,
        )
    except TodoError as e:
        raise HTTPException(e.status_code, e.message) from e

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

    try:
        await todo_service.update_todo(db, _actor(user), todo, body.model_dump(exclude_unset=True))
    except TodoError as e:
        raise HTTPException(e.status_code, e.message) from e

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

    try:
        await todo_service.promote_todo(db, _actor(user), todo)
    except TodoError as e:
        raise HTTPException(e.status_code, e.message) from e

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

    await todo_service.delete_todo(db, _actor(user), todo)
    await db.commit()
