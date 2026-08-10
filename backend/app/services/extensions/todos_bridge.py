"""The SDK todos bridge — extensions' sanctioned path to the core ``todos``
table (SDK 1.2, discussion #921).

Design invariants:

* **Grant-gated per call.** Every method re-evaluates
  ``extension_registry.grants_for(key)``, which returns ``[]`` the moment the
  extension is disabled, removed, pending restart, or its license entitlement
  stops being usable — access revokes immediately, no restart, same model as
  the job supervisor's per-tick check. Reads need ``core.todos.read`` (or
  write, which implies it); writes need ``core.todos.write``.
* **Scoped writes.** An extension may only mutate rows whose
  ``external_source`` is NULL or its own key — never another extension's
  mirror rows. ``is_system`` todos (core workflow pointers like ADR
  signing) accept exactly ONE kind of write: an update whose only fields
  are ``external_ref`` / ``external_url`` (SDK 1.3 — mirror metadata, so a
  connector can reference the sign-off in an external tracker). Their
  status, description, assignee and due date stay core-owned, and
  ``complete`` / ``delete`` are always refused. Writing external fields
  always stamps ``external_source`` with the extension's own key; it is
  not a parameter, so one extension cannot impersonate another's mirror.
* **Full audit provenance.** Each write runs in its own short session with
  the ``request_origin`` contextvar set to ``"ext"`` and an explicit
  ``MutationBatch(tool_name="ext:{key}", origin="ext", actor_user_id=None)``,
  so the admin audit log shows exactly which extension changed what; the
  shared ``todo_service`` stamps ``data["ext"]`` onto every emitted
  ``todo.*`` event as well.
* **Shared side effects.** All writes delegate to
  ``app.services.todo_service`` — the same code path the REST routes use —
  so assignment notifications, recurrence roll-forward, and event emission
  behave identically whether a human or an extension performed the write.
"""

from __future__ import annotations

import uuid
from collections.abc import Awaitable, Callable
from datetime import datetime
from typing import TypeVar

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import async_session
from app.models.todo import Todo
from app.services import mutation_batch_service, todo_service
from app.services.event_bus import request_batch_id, request_origin
from app.services.extensions.registry import extension_registry
from app.services.extensions.sdk import (
    ExtensionDataError,
    ExtensionPermissionError,
    ExtTodo,
    TodosBridge,
)
from app.services.todo_service import TodoActor, TodoError

READ_GRANTS = frozenset({"core.todos.read", "core.todos.write"})
WRITE_GRANT = "core.todos.write"

# The only fields writable on a system todo (SDK 1.3): mirror metadata.
_SYSTEM_WRITABLE_FIELDS = frozenset({"external_ref", "external_url"})

_T = TypeVar("_T")


def _to_ext_todo(t: Todo) -> ExtTodo:
    return ExtTodo(
        id=str(t.id),
        card_id=str(t.card_id) if t.card_id else None,
        description=t.description,
        status=t.status,
        link=t.link,
        is_system=t.is_system,
        assigned_to=str(t.assigned_to) if t.assigned_to else None,
        created_by=str(t.created_by) if t.created_by else None,
        due_date=str(t.due_date) if t.due_date else None,
        created_at=t.created_at.isoformat() if t.created_at else None,
        updated_at=t.updated_at.isoformat() if t.updated_at else None,
        external_ref=t.external_ref,
        external_url=t.external_url,
        external_source=t.external_source,
        series_id=str(t.series_id) if t.series_id else None,
        recurrence_unit=t.recurrence_unit,
    )


class ExtensionTodos(TodosBridge):
    """Per-extension bridge instance attached to ``ExtensionContext.todos``."""

    def __init__(self, key: str):
        self._key = key

    # -- gating ------------------------------------------------------------

    def _require(self, *, write: bool) -> None:
        grants = set(extension_registry.grants_for(self._key))
        if write:
            allowed = WRITE_GRANT in grants
        else:
            allowed = bool(READ_GRANTS & grants)
        if not allowed:
            needed = WRITE_GRANT if write else "core.todos.read"
            raise ExtensionPermissionError(
                f"Extension {self._key} requires the {needed} grant "
                "(and an enabled, licensed install) for this call"
            )

    def _actor(self) -> TodoActor:
        info = extension_registry.get(self._key)
        display = (info.name if info else None) or self._key
        return TodoActor(user_id=None, display_name=display, ext_key=self._key)

    async def _load_writable(
        self, db: AsyncSession, todo_id: str, *, allow_system: bool = False
    ) -> Todo:
        try:
            tid = uuid.UUID(todo_id)
        except ValueError as e:
            raise ExtensionDataError(f"Invalid todo id: {todo_id}") from e
        todo = (await db.execute(select(Todo).where(Todo.id == tid))).scalar_one_or_none()
        if todo is None:
            raise ExtensionDataError(f"Todo {todo_id} not found")
        if todo.is_system and not allow_system:
            raise ExtensionDataError(
                "System todos cannot be modified by extensions "
                "(only their external_ref/external_url mirror fields)"
            )
        if todo.external_source is not None and todo.external_source != self._key:
            raise ExtensionDataError(
                f"Todo {todo_id} is owned by another source ({todo.external_source})"
            )
        return todo

    # -- reads -------------------------------------------------------------

    async def list(
        self,
        *,
        status: str | None = None,
        card_id: str | None = None,
        assigned_to: str | None = None,
        external_source: str | None = None,
        external_ref: str | None = None,
        updated_since: datetime | None = None,
    ) -> list[ExtTodo]:
        self._require(write=False)
        async with async_session() as db:
            q = select(Todo).order_by(Todo.created_at.desc())
            if status:
                q = q.where(Todo.status == status)
            if card_id:
                q = q.where(Todo.card_id == uuid.UUID(card_id))
            if assigned_to:
                q = q.where(Todo.assigned_to == uuid.UUID(assigned_to))
            if external_source:
                q = q.where(Todo.external_source == external_source)
            if external_ref:
                q = q.where(Todo.external_ref == external_ref)
            if updated_since:
                q = q.where(Todo.updated_at >= updated_since)
            result = await db.execute(q)
            return [_to_ext_todo(t) for t in result.scalars().all()]

    async def get(self, todo_id: str) -> ExtTodo | None:
        self._require(write=False)
        try:
            tid = uuid.UUID(todo_id)
        except ValueError:
            return None
        async with async_session() as db:
            todo = (await db.execute(select(Todo).where(Todo.id == tid))).scalar_one_or_none()
            return _to_ext_todo(todo) if todo else None

    # -- writes ------------------------------------------------------------

    async def _write(self, op: Callable[[AsyncSession], Awaitable[_T]]) -> _T:
        """Run ``op(db)`` inside a fresh session with ext provenance: origin
        contextvar ``"ext"`` plus an explicit committed mutation batch."""
        self._require(write=True)
        origin_token = request_origin.set("ext")
        batch_token = None
        try:
            async with async_session() as db:
                batch = await mutation_batch_service.create_batch(
                    db,
                    tool_name=f"ext:{self._key}"[:100],
                    actor=None,
                    origin="ext",
                    dry_run=False,
                )
                batch_token = request_batch_id.set(batch.id)
                try:
                    result = await op(db)
                except TodoError as e:
                    raise ExtensionDataError(e.message) from e
                await mutation_batch_service.commit_batch(db, batch)
                await db.commit()
                return result
        finally:
            if batch_token is not None:
                request_batch_id.reset(batch_token)
            request_origin.reset(origin_token)

    async def create(
        self,
        *,
        description: str,
        card_id: str | None = None,
        assigned_to: str | None = None,
        due_date: str | None = None,
        external_ref: str | None = None,
        external_url: str | None = None,
    ) -> ExtTodo:
        async def op(db: AsyncSession):
            todo = await todo_service.create_todo(
                db,
                self._actor(),
                description=description,
                card_id=uuid.UUID(card_id) if card_id else None,
                assigned_to=assigned_to,
                due_date=due_date,
                external_ref=external_ref,
                external_url=external_url,
                # Never a parameter: the mirror is stamped with the writing
                # extension's own key, always.
                external_source=self._key,
            )
            return _to_ext_todo(todo)

        return await self._write(op)

    async def update(
        self,
        todo_id: str,
        *,
        description: str | None = None,
        status: str | None = None,
        assigned_to: str | None = None,
        due_date: str | None = None,
        external_ref: str | None = None,
        external_url: str | None = None,
    ) -> ExtTodo:
        changes = {
            k: v
            for k, v in {
                "description": description,
                "status": status,
                "assigned_to": assigned_to,
                "due_date": due_date,
                "external_ref": external_ref,
                "external_url": external_url,
            }.items()
            if v is not None
        }

        async def op(db: AsyncSession):
            # A system todo accepts an update iff it touches nothing but the
            # external mirror fields (evaluated on the pre-stamp changes —
            # the external_source stamp below is bridge-injected, not caller
            # input). The foreign-source check inside still applies, so a
            # system todo mirrored by one extension stays off-limits to
            # every other.
            todo = await self._load_writable(
                db,
                todo_id,
                allow_system=bool(changes) and set(changes) <= _SYSTEM_WRITABLE_FIELDS,
            )
            if "external_ref" in changes or "external_url" in changes:
                changes["external_source"] = self._key
            todo = await todo_service.update_todo(db, self._actor(), todo, changes)
            # updated_at is expired after the UPDATE flush (server-side
            # onupdate); refresh so the mapping below never lazy-loads.
            await db.refresh(todo)
            return _to_ext_todo(todo)

        return await self._write(op)

    async def complete(self, todo_id: str) -> ExtTodo:
        async def op(db: AsyncSession):
            todo = await self._load_writable(db, todo_id)
            todo = await todo_service.update_todo(db, self._actor(), todo, {"status": "done"})
            await db.refresh(todo)
            return _to_ext_todo(todo)

        return await self._write(op)

    async def delete(self, todo_id: str) -> None:
        async def op(db: AsyncSession):
            todo = await self._load_writable(db, todo_id)
            await todo_service.delete_todo(db, self._actor(), todo)
            return None

        return await self._write(op)
