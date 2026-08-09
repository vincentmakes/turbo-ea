"""todo.* audit events emitted by the shared todo service.

Todos were historically invisible to the event bus, the audit log, and
card change history. These tests pin the new event surface: one event per
write, ``todo.completed`` replacing ``todo.updated`` on the done
transition, the roll-forward occurrence flagged, and auto-batch creation
so route-driven writes surface on the Admin → Audit log page.
"""

from __future__ import annotations

from datetime import date

import pytest
from sqlalchemy import select

from app.models.event import Event
from app.models.mutation_batch import MutationBatch
from app.services import todo_service
from app.services.event_bus import request_batch_id
from app.services.todo_service import TodoActor
from tests.conftest import create_card, create_card_type, create_role, create_user


@pytest.fixture(autouse=True)
def _reset_batch_contextvar():
    """publish() writes the auto-batch id back onto the contextvar; make sure
    it never leaks across tests."""
    token = request_batch_id.set(None)
    yield
    request_batch_id.reset(token)


@pytest.fixture
async def env(db):
    await create_role(db, key="admin", label="Admin", permissions={"*": True})
    await create_card_type(db, key="Application", label="Application")
    user = await create_user(db, email="ev@test.com", role="admin")
    card = await create_card(db, card_type="Application", name="Ev App", user_id=user.id)
    return {"user": user, "card": card}


def actor_of(user) -> TodoActor:
    return TodoActor(user_id=user.id, display_name=user.display_name)


async def events_of(db, event_type: str) -> list[Event]:
    rows = await db.execute(select(Event).where(Event.event_type == event_type))
    return list(rows.scalars().all())


class TestTodoEvents:
    async def test_create_emits_event_with_card_and_batch(self, db, env):
        todo = await todo_service.create_todo(
            db, actor_of(env["user"]), description="Track me", card_id=env["card"].id
        )
        evs = await events_of(db, "todo.created")
        assert len(evs) == 1
        ev = evs[0]
        assert ev.card_id == env["card"].id
        assert ev.data["todo_id"] == str(todo.id)
        # Auto-batch: the event joins the audit log even without a request.
        assert ev.batch_id is not None
        batch = (
            await db.execute(select(MutationBatch).where(MutationBatch.id == ev.batch_id))
        ).scalar_one()
        assert batch.tool_name.startswith("event:todo.created")

    async def test_update_emits_updated_with_changes_diff(self, db, env):
        todo = await todo_service.create_todo(db, actor_of(env["user"]), description="Before")
        await todo_service.update_todo(db, actor_of(env["user"]), todo, {"description": "After"})
        evs = await events_of(db, "todo.updated")
        assert len(evs) == 1
        assert evs[0].data["changes"]["description"] == {"from": "Before", "to": "After"}

    async def test_complete_emits_completed_not_updated(self, db, env):
        todo = await todo_service.create_todo(db, actor_of(env["user"]), description="Done soon")
        await todo_service.update_todo(db, actor_of(env["user"]), todo, {"status": "done"})
        assert len(await events_of(db, "todo.completed")) == 1
        assert await events_of(db, "todo.updated") == []

    async def test_recurring_completion_flags_rolled_forward_occurrence(self, db, env):
        todo = await todo_service.create_todo(
            db,
            actor_of(env["user"]),
            description="Quarterly",
            due_date=date.today(),
            recurrence_unit="months",
            recurrence_interval=3,
        )
        await todo_service.update_todo(db, actor_of(env["user"]), todo, {"status": "done"})
        created = await events_of(db, "todo.created")
        # One for the original create, one for the spawned occurrence.
        assert len(created) == 2
        flags = sorted(bool(ev.data.get("rolled_forward")) for ev in created)
        assert flags == [False, True]

    async def test_delete_and_promote_events(self, db, env):
        from app.models.todo import Todo

        scheduled = Todo(
            description="dormant",
            status="scheduled",
            created_by=env["user"].id,
            recurrence_unit="months",
        )
        db.add(scheduled)
        await db.flush()
        await todo_service.promote_todo(db, actor_of(env["user"]), scheduled)
        assert len(await events_of(db, "todo.promoted")) == 1

        gone = await todo_service.create_todo(db, actor_of(env["user"]), description="bye")
        await todo_service.delete_todo(db, actor_of(env["user"]), gone)
        deleted = await events_of(db, "todo.deleted")
        assert len(deleted) == 1
        assert deleted[0].data["todo_id"] == str(gone.id)

    async def test_extension_actor_stamps_ext_key(self, db, env):
        actor = TodoActor(user_id=None, display_name="Jira Sync", ext_key="jira-sync")
        await todo_service.create_todo(
            db, actor, description="from tracker", external_source="jira-sync"
        )
        evs = await events_of(db, "todo.created")
        assert evs[0].data["ext"] == "jira-sync"
        assert evs[0].user_id is None
