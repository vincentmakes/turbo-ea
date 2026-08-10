"""The SDK todos bridge: grant gating, scoped writes, audit provenance.

The bridge opens its own sessions via ``async_session``; tests patch that
factory to hand back the savepoint-rollback test session, and drive the
in-memory ``extension_registry`` singleton directly (the same pattern the
registry unit tests use)."""

from __future__ import annotations

from contextlib import asynccontextmanager
from datetime import date, datetime, timedelta, timezone

import pytest
from sqlalchemy import select

from app.models.event import Event
from app.models.mutation_batch import MutationBatch
from app.models.notification import Notification
from app.models.todo import Todo
from app.services.extensions import todos_bridge as bridge_mod
from app.services.extensions.license import Entitlement, LicenseDocument
from app.services.extensions.registry import ExtensionInfo, extension_registry
from app.services.extensions.sdk import ExtensionDataError, ExtensionPermissionError
from app.services.extensions.todos_bridge import ExtensionTodos
from tests.conftest import create_role, create_user

NOW = datetime.now(timezone.utc)
KEY = "jira-sync"


def load_registry(*, grants: list[str], enabled: bool = True, status: str = "installed") -> None:
    extension_registry.clear()
    extension_registry.load_installed(
        [
            ExtensionInfo(
                key=KEY,
                name="Jira Sync",
                version="1.0.0",
                status=status,
                enabled=enabled,
                manifest={"grants": grants},
            )
        ]
    )
    extension_registry.set_license(
        LicenseDocument(
            licensee="ACME",
            customer_id="cus_1",
            issued_at=NOW - timedelta(days=1),
            grace_days=30,
            entitlements=[Entitlement(extension_key=KEY, expires_at=None)],
        )
    )


@pytest.fixture(autouse=True)
def _registry_cleanup():
    extension_registry.clear()
    yield
    extension_registry.clear()


@pytest.fixture(autouse=True)
def _patch_session(monkeypatch, db):
    @asynccontextmanager
    async def fake_session():
        yield db

    monkeypatch.setattr(bridge_mod, "async_session", fake_session)


@pytest.fixture
async def env(db):
    await create_role(db, key="admin", label="Admin", permissions={"*": True})
    user = await create_user(db, email="bridge@test.com", role="admin")
    return {"user": user}


class TestGrantGating:
    async def test_no_grant_blocks_reads_and_writes(self, db, env):
        load_registry(grants=[])
        bridge = ExtensionTodos(KEY)
        with pytest.raises(ExtensionPermissionError):
            await bridge.list()
        with pytest.raises(ExtensionPermissionError):
            await bridge.create(description="x")

    async def test_read_grant_allows_list_blocks_create(self, db, env):
        load_registry(grants=["core.todos.read"])
        bridge = ExtensionTodos(KEY)
        assert await bridge.list() == []
        with pytest.raises(ExtensionPermissionError):
            await bridge.create(description="x")

    async def test_write_grant_implies_read(self, db, env):
        load_registry(grants=["core.todos.write"])
        bridge = ExtensionTodos(KEY)
        assert await bridge.list() == []

    async def test_disable_revokes_mid_run(self, db, env):
        load_registry(grants=["core.todos.write"])
        bridge = ExtensionTodos(KEY)
        created = await bridge.create(description="works")
        assert created.external_source == KEY
        # Simulate the admin disabling the extension — no restart involved.
        load_registry(grants=["core.todos.write"], enabled=False)
        with pytest.raises(ExtensionPermissionError):
            await bridge.create(description="blocked")

    async def test_needs_restart_revokes(self, db, env):
        load_registry(grants=["core.todos.write"], status="needs_restart")
        bridge = ExtensionTodos(KEY)
        with pytest.raises(ExtensionPermissionError):
            await bridge.list()


class TestWrites:
    async def test_create_stamps_provenance(self, db, env):
        load_registry(grants=["core.todos.write"])
        bridge = ExtensionTodos(KEY)
        todo = await bridge.create(
            description="Mirror of PROJ-1",
            external_ref="PROJ-1",
            external_url="https://tracker/PROJ-1",
        )
        assert todo.external_source == KEY
        assert todo.created_by is None

        row = (
            (await db.execute(select(MutationBatch).order_by(MutationBatch.created_at.desc())))
            .scalars()
            .first()
        )
        assert row.tool_name == f"ext:{KEY}"
        assert row.origin == "ext"
        assert row.actor_user_id is None
        assert row.committed_at is not None

        ev = (
            (await db.execute(select(Event).where(Event.event_type == "todo.created")))
            .scalars()
            .one()
        )
        assert ev.data["ext"] == KEY
        assert ev.data["origin"] == "ext"
        assert ev.batch_id == row.id

    async def test_update_own_row_and_complete(self, db, env):
        load_registry(grants=["core.todos.write"])
        bridge = ExtensionTodos(KEY)
        todo = await bridge.create(description="open item", external_ref="PROJ-2")
        updated = await bridge.update(todo.id, description="renamed")
        assert updated.description == "renamed"
        done = await bridge.complete(todo.id)
        assert done.status == "done"

    async def test_cannot_touch_foreign_source_row(self, db, env):
        load_registry(grants=["core.todos.write"])
        db.add(Todo(description="planner's row", external_source="planner-sync"))
        await db.flush()
        foreign = (
            await db.execute(select(Todo).where(Todo.external_source == "planner-sync"))
        ).scalar_one()
        bridge = ExtensionTodos(KEY)
        with pytest.raises(ExtensionDataError):
            await bridge.update(str(foreign.id), description="hijack")
        with pytest.raises(ExtensionDataError):
            await bridge.delete(str(foreign.id))

    async def test_cannot_touch_system_todo(self, db, env):
        load_registry(grants=["core.todos.write"])
        db.add(Todo(description="sign the ADR", is_system=True))
        await db.flush()
        system = (await db.execute(select(Todo).where(Todo.is_system.is_(True)))).scalar_one()
        bridge = ExtensionTodos(KEY)
        with pytest.raises(ExtensionDataError):
            await bridge.complete(str(system.id))

    async def test_system_todo_accepts_external_mirror_fields_only(self, db, env):
        # SDK 1.3 carve-out: a system todo may be stamped with mirror
        # metadata (external_ref/external_url only) so connectors can
        # reference a sign-off in an external tracker.
        load_registry(grants=["core.todos.write"])
        db.add(Todo(description="sign the ADR", is_system=True))
        await db.flush()
        system = (await db.execute(select(Todo).where(Todo.is_system.is_(True)))).scalar_one()
        bridge = ExtensionTodos(KEY)
        stamped = await bridge.update(
            str(system.id), external_ref="PROJ-9", external_url="https://tracker/PROJ-9"
        )
        assert stamped.external_ref == "PROJ-9"
        assert stamped.external_source == KEY
        assert stamped.is_system is True
        # The write is audited like every other bridge write.
        ev = (
            (await db.execute(select(Event).where(Event.event_type == "todo.updated")))
            .scalars()
            .one()
        )
        assert ev.data["ext"] == KEY

    async def test_system_todo_refuses_everything_but_mirror_fields(self, db, env):
        load_registry(grants=["core.todos.write"])
        db.add(Todo(description="review the risk", is_system=True))
        await db.flush()
        system = (await db.execute(select(Todo).where(Todo.is_system.is_(True)))).scalar_one()
        bridge = ExtensionTodos(KEY)
        # Mixing a mirror field with anything else must not smuggle the
        # other field through.
        with pytest.raises(ExtensionDataError):
            await bridge.update(str(system.id), external_ref="PROJ-9", description="hijack")
        with pytest.raises(ExtensionDataError):
            await bridge.update(str(system.id), status="done")
        with pytest.raises(ExtensionDataError):
            await bridge.update(str(system.id), assigned_to=str(env["user"].id))
        with pytest.raises(ExtensionDataError):
            await bridge.delete(str(system.id))
        # An update providing nothing at all is not a mirror write either.
        with pytest.raises(ExtensionDataError):
            await bridge.update(str(system.id))

    async def test_system_todo_mirrored_by_another_extension_stays_foreign(self, db, env):
        load_registry(grants=["core.todos.write"])
        db.add(
            Todo(
                description="sign-off mirrored elsewhere",
                is_system=True,
                external_source="planner-sync",
                external_ref="PL-1",
            )
        )
        await db.flush()
        system = (await db.execute(select(Todo).where(Todo.is_system.is_(True)))).scalar_one()
        bridge = ExtensionTodos(KEY)
        with pytest.raises(ExtensionDataError):
            await bridge.update(str(system.id), external_ref="PROJ-9")

    async def test_can_claim_unowned_user_todo(self, db, env):
        # external_source NULL rows are claimable — that's the "push an
        # existing user todo out to the tracker" direction.
        load_registry(grants=["core.todos.write"])
        db.add(Todo(description="user's own todo", created_by=env["user"].id))
        await db.flush()
        row = (
            await db.execute(select(Todo).where(Todo.description == "user's own todo"))
        ).scalar_one()
        bridge = ExtensionTodos(KEY)
        claimed = await bridge.update(
            str(row.id), external_ref="PROJ-3", external_url="https://tracker/PROJ-3"
        )
        assert claimed.external_source == KEY

    async def test_complete_recurring_rolls_forward(self, db, env):
        load_registry(grants=["core.todos.write"])
        # A user-created recurring todo (no external_source) completed via
        # the bridge must roll forward exactly like the UI path.
        from app.services import todo_service
        from app.services.todo_service import TodoActor

        todo = await todo_service.create_todo(
            db,
            TodoActor(user_id=env["user"].id, display_name="U"),
            description="Quarterly review",
            due_date=date.today(),
            recurrence_unit="months",
            recurrence_interval=3,
        )
        await db.commit()
        bridge = ExtensionTodos(KEY)
        await bridge.complete(str(todo.id))
        rows = (
            (await db.execute(select(Todo).where(Todo.series_id == todo.series_id))).scalars().all()
        )
        assert len(rows) == 2

    async def test_assignment_notification_uses_extension_name(self, db, env):
        load_registry(grants=["core.todos.write"])
        bridge = ExtensionTodos(KEY)
        await bridge.create(description="For you", assigned_to=str(env["user"].id))
        notif = (
            (await db.execute(select(Notification).where(Notification.user_id == env["user"].id)))
            .scalars()
            .first()
        )
        assert notif is not None
        assert "Jira Sync" in notif.message

    async def test_data_error_carries_service_message(self, db, env):
        load_registry(grants=["core.todos.write"])
        bridge = ExtensionTodos(KEY)
        with pytest.raises(ExtensionDataError) as exc:
            await bridge.update("00000000-0000-0000-0000-000000000000", description="x")
        assert "not found" in str(exc.value)


class TestReads:
    async def test_list_filters_by_external_identity(self, db, env):
        load_registry(grants=["core.todos.write"])
        bridge = ExtensionTodos(KEY)
        await bridge.create(description="one", external_ref="PROJ-1")
        await bridge.create(description="two", external_ref="PROJ-2")
        hits = await bridge.list(external_source=KEY, external_ref="PROJ-2")
        assert [t.description for t in hits] == ["two"]

    async def test_get_missing_returns_none(self, db, env):
        load_registry(grants=["core.todos.read"])
        bridge = ExtensionTodos(KEY)
        assert await bridge.get("not-a-uuid") is None
        assert await bridge.get("00000000-0000-0000-0000-000000000000") is None
