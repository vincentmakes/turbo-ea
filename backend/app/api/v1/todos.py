from __future__ import annotations

import uuid
from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.database import get_db
from app.models.todo import Todo
from app.models.user import User
from app.schemas.common import TodoCreate, TodoUpdate
from app.services import notification_service

router = APIRouter(tags=["todos"])


def _todo_to_dict(t: Todo) -> dict:
    return {
        "id": str(t.id),
        "fact_sheet_id": str(t.fact_sheet_id) if t.fact_sheet_id else None,
        "fact_sheet_name": t.fact_sheet.name if t.fact_sheet else None,
        "fact_sheet_type": t.fact_sheet.type if t.fact_sheet else None,
        "description": t.description,
        "status": t.status,
        "assigned_to": str(t.assigned_to) if t.assigned_to else None,
        "assignee_name": t.assignee.display_name if t.assignee else None,
        "created_by": str(t.created_by) if t.created_by else None,
        "due_date": str(t.due_date) if t.due_date else None,
        "created_at": t.created_at.isoformat() if t.created_at else None,
    }


@router.get("/todos")
async def list_all_todos(
    db: AsyncSession = Depends(get_db),
    status: str | None = Query(None),
    assigned_to: str | None = Query(None),
):
    q = select(Todo).order_by(Todo.created_at.desc())
    if status:
        q = q.where(Todo.status == status)
    if assigned_to:
        q = q.where(Todo.assigned_to == uuid.UUID(assigned_to))
    result = await db.execute(q)
    return [_todo_to_dict(t) for t in result.scalars().all()]


@router.get("/fact-sheets/{fs_id}/todos")
async def list_fact_sheet_todos(fs_id: str, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(Todo).where(Todo.fact_sheet_id == uuid.UUID(fs_id)).order_by(Todo.created_at.desc())
    )
    return [_todo_to_dict(t) for t in result.scalars().all()]


@router.post("/fact-sheets/{fs_id}/todos", status_code=201)
async def create_todo(
    fs_id: str,
    body: TodoCreate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    todo = Todo(
        fact_sheet_id=uuid.UUID(fs_id),
        description=body.description,
        assigned_to=uuid.UUID(body.assigned_to) if body.assigned_to else None,
        created_by=user.id,
        due_date=date.fromisoformat(body.due_date) if body.due_date else None,
    )
    db.add(todo)
    await db.flush()

    # Notify the assignee
    if todo.assigned_to and todo.assigned_to != user.id:
        await notification_service.create_notification(
            db,
            user_id=todo.assigned_to,
            notif_type="todo_assigned",
            title="Todo Assigned",
            message=f'{user.display_name} assigned you a todo: "{body.description[:80]}"',
            link="/todos",
            data={"todo_id": str(todo.id), "fact_sheet_id": fs_id},
            fact_sheet_id=uuid.UUID(fs_id),
            actor_id=user.id,
        )

    await db.commit()
    await db.refresh(todo)
    return _todo_to_dict(todo)


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
    old_assignee = todo.assigned_to
    for field, value in body.model_dump(exclude_unset=True).items():
        if field == "assigned_to" and value is not None:
            value = uuid.UUID(value)
        if field == "due_date" and value is not None:
            value = date.fromisoformat(value)
        setattr(todo, field, value)
    await db.flush()

    # Notify new assignee if assignment changed
    new_assignee = todo.assigned_to
    if new_assignee and new_assignee != old_assignee and new_assignee != user.id:
        await notification_service.create_notification(
            db,
            user_id=new_assignee,
            notif_type="todo_assigned",
            title="Todo Assigned",
            message=f'{user.display_name} assigned you a todo: "{todo.description[:80]}"',
            link="/todos",
            data={"todo_id": todo_id},
            fact_sheet_id=todo.fact_sheet_id,
            actor_id=user.id,
        )

    await db.commit()
    await db.refresh(todo)
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
    await db.delete(todo)
    await db.commit()
