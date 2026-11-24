"""``ctx.on_behalf_of(user)`` (SDK 1.19): a bridge write an extension makes
for a signed-in person is recorded under that person's name, while the
extension stays on the record (``data["ext"]``, origin ``ext``, the
``ext:{key}`` batch). Outside a scope every write is recorded exactly as
before — no person.

Same harness as the other bridge tests: every bridge module's
``async_session`` is patched to the savepoint-rollback test session and the
in-memory ``extension_registry`` singleton is driven directly.
"""

from __future__ import annotations

import asyncio
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import select

from app.models.architecture_decision import ArchitectureDecision
from app.models.card import Card
from app.models.event import Event
from app.models.mutation_batch import MutationBatch
from app.models.notification import Notification
from app.models.risk import Risk
from app.models.stakeholder import Stakeholder
from app.models.survey import Survey
from app.models.todo import Todo
from app.services.event_bus import event_bus
from app.services.extensions import adr_bridge, data_service, risks_bridge, surveys_bridge
from app.services.extensions.adr_bridge import ExtensionDecisions
from app.services.extensions.data_service import (
    ExtensionData,
    acting_person,
    acting_person_id,
    on_behalf_of,
)
from app.services.extensions.events import _deliverable
from app.services.extensions.license import Entitlement, LicenseDocument
from app.services.extensions.registry import ExtensionInfo, extension_registry
from app.services.extensions.risks_bridge import ExtensionRisks
from app.services.extensions.sdk import EventSubscription, ExtensionDataError
from app.services.extensions.surveys_bridge import ExtensionSurveys
from tests.conftest import (
    create_card,
    create_card_type,
    create_relation_type,
    create_stakeholder_role_def,
    create_tag,
    create_tag_group,
    create_user,
)

NOW = datetime.now(timezone.utc)
KEY = "sample-connector"
ALL_WRITE_GRANTS = [
    "core.cards.write",
    "core.stakeholders.write",
    "core.risks.write",
    "core.adr.write",
    "core.surveys.write",
    "core.events.card",
]


def load_registry(grants: list[str] = ALL_WRITE_GRANTS) -> None:
    extension_registry.clear()
    extension_registry.load_installed(
        [
            ExtensionInfo(
                key=KEY,
                name="Sample Connector",
                version="1.0.0",
                status="installed",
                enabled=True,
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
    data_service.reset_rate_limiter()
    yield
    extension_registry.clear()
    data_service.reset_rate_limiter()


@pytest.fixture(autouse=True)
def _patch_sessions(monkeypatch, db):
    @asynccontextmanager
    async def fake_session():
        yield db

    for mod in (data_service, risks_bridge, adr_bridge, surveys_bridge):
        monkeypatch.setattr(mod, "async_session", fake_session)
    # deliver_notification_batch imports the factory lazily from app.database.
    import app.database as database_mod

    monkeypatch.setattr(database_mod, "async_session", fake_session)


@pytest.fixture
async def env(db):
    await create_card_type(
        db,
        key="Application",
        label="Application",
        fields_schema=[
            {
                "section": "General",
                "fields": [{"key": "hosting", "label": "Hosting", "type": "text"}],
            }
        ],
    )
    await create_card_type(db, key="ITComponent", label="IT Component")
    await create_relation_type(db, key="app_to_itc")
    await create_stakeholder_role_def(db, card_type_key="Application", key="responsible")
    person = await create_user(db, email="alice@test.com", role="member", display_name="Alice")
    other = await create_user(db, email="bob@test.com", role="member", display_name="Bob")
    app = await create_card(db, card_type="Application", name="Billing")
    itc = await create_card(db, card_type="ITComponent", name="Postgres")
    load_registry()
    return {"person": person, "other": other, "app": app, "itc": itc}


async def _events(db, event_type: str) -> list[Event]:
    return list(
        (
            await db.execute(
                select(Event).where(Event.event_type == event_type).order_by(Event.created_at)
            )
        )
        .scalars()
        .all()
    )


async def _ext_batches(db) -> list[MutationBatch]:
    return list(
        (await db.execute(select(MutationBatch).where(MutationBatch.tool_name == f"ext:{KEY}")))
        .scalars()
        .all()
    )


async def _update(env, name: str) -> None:
    await ExtensionData(KEY).update_card(str(env["app"].id), {"name": name})


class TestScope:
    async def test_a_card_update_inside_the_scope_names_the_person(self, db, env):
        person = env["person"]
        with on_behalf_of(person):
            await _update(env, "Billing v2")

        (event,) = await _events(db, "card.updated")
        assert event.user_id == person.id
        assert event.data["ext"] == KEY
        assert event.data["origin"] == "ext"
        card = await db.get(Card, env["app"].id)
        assert card.updated_by == person.id
        # The audit batch keeps no actor (see the SDK 1.19 note): the events in
        # it name the person, the batch row stays the extension's.
        (batch,) = await _ext_batches(db)
        assert batch.actor_user_id is None
        assert batch.origin == "ext"
        assert event.batch_id == batch.id

    async def test_the_update_notification_names_the_person(self, db, env):
        db.add(Stakeholder(card_id=env["app"].id, user_id=env["other"].id, role="responsible"))
        await db.flush()
        with on_behalf_of(env["person"]):
            await _update(env, "Billing v2")
        await _update(env, "Billing v3")
        notes = (
            (
                await db.execute(
                    select(Notification)
                    .where(Notification.user_id == env["other"].id)
                    .where(Notification.type == "card_updated")
                    .order_by(Notification.created_at)
                )
            )
            .scalars()
            .all()
        )
        assert sorted(n.message.split(" updated ")[0] for n in notes) == [
            "Alice",
            "Sample Connector",
        ]

    async def test_outside_the_scope_no_person_is_recorded(self, db, env):
        await _update(env, "Billing v2")
        (event,) = await _events(db, "card.updated")
        assert event.user_id is None
        assert event.data["ext"] == KEY
        assert (await db.get(Card, env["app"].id)).updated_by is None

    async def test_the_scope_is_reset_on_exit(self, db, env):
        with on_behalf_of(env["person"]):
            assert acting_person_id() == env["person"].id
            await _update(env, "Inside")
        assert acting_person() is None
        await _update(env, "After")
        inside, after = await _events(db, "card.updated")
        assert inside.user_id == env["person"].id
        assert after.user_id is None

    async def test_the_scope_is_reset_when_the_body_raises(self, db, env):
        with pytest.raises(RuntimeError, match="boom"):
            with on_behalf_of(env["person"]):
                raise RuntimeError("boom")
        assert acting_person() is None
        await _update(env, "After")
        (event,) = await _events(db, "card.updated")
        assert event.user_id is None

    async def test_an_inner_scope_replaces_the_outer_one_until_it_exits(self, db, env):
        with on_behalf_of(env["person"]):
            with on_behalf_of(env["other"]):
                await _update(env, "Inner")
            await _update(env, "Outer again")
        assert acting_person() is None
        inner, outer = await _events(db, "card.updated")
        assert inner.user_id == env["other"].id
        assert outer.user_id == env["person"].id

    async def test_the_person_is_a_snapshot_of_id_and_name(self, db, env):
        with on_behalf_of(env["person"]):
            person = acting_person()
        assert person is not None
        assert (person.id, person.display_name) == (env["person"].id, "Alice")

    async def test_a_task_spawned_inside_inherits_the_person(self, db, env):
        async def read() -> object:
            return acting_person_id()

        with on_behalf_of(env["person"]):
            task = asyncio.create_task(read())
        assert await task == env["person"].id
        assert await asyncio.create_task(read()) is None

    async def test_a_dry_run_inside_the_scope_writes_nothing(self, db, env):
        with on_behalf_of(env["person"]):
            await ExtensionData(KEY).update_card(
                str(env["app"].id), {"name": "Preview"}, dry_run=True
            )
        assert await _events(db, "card.updated") == []
        assert await _ext_batches(db) == []


class TestValidation:
    @pytest.mark.parametrize("bad", [None, "0b0e7f52-2c6c-4f4b-9f0c-3a1d2e8b5a10", {"id": "x"}])
    async def test_anything_but_a_user_is_refused(self, db, env, bad):
        with pytest.raises(ExtensionDataError, match="get_current_user"):
            with on_behalf_of(bad):
                pytest.fail("the body must not run")
        assert acting_person() is None

    async def test_a_user_id_is_refused_even_as_a_uuid(self, db, env):
        with pytest.raises(ExtensionDataError, match="not UUID"):
            with on_behalf_of(env["person"].id):
                pass

    async def test_a_deactivated_user_is_refused(self, db, env):
        env["person"].is_active = False
        await db.flush()
        with pytest.raises(ExtensionDataError, match="deactivated"):
            with on_behalf_of(env["person"]):
                pytest.fail("the body must not run")
        assert acting_person() is None

    async def test_a_refusal_inside_a_scope_leaves_the_outer_person(self, db, env):
        env["other"].is_active = False
        await db.flush()
        with on_behalf_of(env["person"]):
            with pytest.raises(ExtensionDataError):
                with on_behalf_of(env["other"]):
                    pass
            assert acting_person_id() == env["person"].id
        assert acting_person() is None


class TestDataBridge:
    async def test_create_card(self, db, env):
        with on_behalf_of(env["person"]):
            created = await ExtensionData(KEY).create_card(type="Application", name="New")
        card = await db.get(Card, created.id)
        assert card.created_by == env["person"].id
        (event,) = await _events(db, "card.created")
        assert event.user_id == env["person"].id
        assert event.data["ext"] == KEY

    async def test_archive_card(self, db, env):
        with on_behalf_of(env["person"]):
            await ExtensionData(KEY).archive_card(str(env["app"].id))
        (event,) = await _events(db, "card.archived")
        assert event.user_id == env["person"].id
        assert (await db.get(Card, env["app"].id)).updated_by == env["person"].id

    async def test_upsert_relation(self, db, env):
        with on_behalf_of(env["person"]):
            await ExtensionData(KEY).upsert_relation(
                type="app_to_itc", source_id=str(env["app"].id), target_id=str(env["itc"].id)
            )
        events = await _events(db, "relation.created")
        assert events
        assert {e.user_id for e in events} == {env["person"].id}
        assert {e.data["ext"] for e in events} == {KEY}

    async def test_set_card_tags(self, db, env):
        group = await create_tag_group(db, name="Scope")
        tag = await create_tag(db, group=group, name="Core")
        with on_behalf_of(env["person"]):
            await ExtensionData(KEY).set_card_tags(str(env["app"].id), [str(tag.id)], mode="add")
        (event,) = await _events(db, "tag.added")
        assert event.user_id == env["person"].id
        assert event.data["ext"] == KEY

    async def test_assign_and_remove_stakeholder(self, db, env):
        bridge = ExtensionData(KEY)
        with on_behalf_of(env["person"]):
            await bridge.assign_stakeholder(str(env["app"].id), str(env["other"].id), "responsible")
            await bridge.remove_stakeholder(str(env["app"].id), str(env["other"].id), "responsible")
        (added,) = await _events(db, "stakeholder.added")
        (removed,) = await _events(db, "stakeholder.removed")
        assert added.user_id == env["person"].id
        assert removed.user_id == env["person"].id
        assert (
            await db.scalar(select(Stakeholder).where(Stakeholder.card_id == env["app"].id)) is None
        )

    async def test_stakeholder_and_tag_writes_outside_the_scope_name_nobody(self, db, env):
        group = await create_tag_group(db, name="Scope")
        tag = await create_tag(db, group=group, name="Core")
        bridge = ExtensionData(KEY)
        await bridge.set_card_tags(str(env["app"].id), [str(tag.id)], mode="add")
        await bridge.assign_stakeholder(str(env["app"].id), str(env["other"].id), "responsible")
        await bridge.remove_stakeholder(str(env["app"].id), str(env["other"].id), "responsible")
        for event_type in ("tag.added", "stakeholder.added", "stakeholder.removed"):
            (event,) = await _events(db, event_type)
            assert event.user_id is None, event_type


class TestOwnWriteFilter:
    async def test_the_extensions_own_event_is_still_filtered(self, db, env):
        queue: asyncio.Queue = asyncio.Queue()
        event_bus._subscribers.append(queue)
        try:
            with on_behalf_of(env["person"]):
                await _update(env, "Filtered")
        finally:
            event_bus._subscribers.remove(queue)
        messages = [queue.get_nowait() for _ in range(queue.qsize())]
        (message,) = [m for m in messages if m["event"] == "card.updated"]
        assert message["user_id"] == str(env["person"].id)
        assert message["data"]["ext"] == KEY
        assert not _deliverable(KEY, EventSubscription(prefix="card.", handler=None), message)
        # …and another extension still receives it, now with the person on it.
        assert _deliverable(
            KEY, EventSubscription(prefix="card.", handler=None, include_self=True), message
        )


class TestRisksBridge:
    async def test_create_names_the_person(self, db, env):
        with on_behalf_of(env["person"]):
            out = await ExtensionRisks(KEY).create(
                title="Unpatched DB",
                owner_id=str(env["other"].id),
                card_ids=[str(env["app"].id)],
            )
        risk = await db.get(Risk, out.id)
        assert risk.created_by == env["person"].id
        (event,) = await _events(db, "risk.added")
        assert event.user_id == env["person"].id
        assert event.data["ext"] == KEY
        todo = await db.scalar(select(Todo).where(Todo.assigned_to == env["other"].id))
        assert todo.created_by == env["person"].id

    async def test_update_names_the_person(self, db, env):
        bridge = ExtensionRisks(KEY)
        out = await bridge.create(
            title="Unpatched DB", card_ids=[str(env["app"].id)], source_ref="db-1"
        )
        itc = await create_card(db, card_type="Application", name="CRM")
        with on_behalf_of(env["person"]):
            await bridge.update(
                out.id, title="Patched", owner_id=str(env["other"].id), add_card_ids=[str(itc.id)]
            )
        updated = await _events(db, "risk.updated")
        assert [e.user_id for e in updated] == [env["person"].id]
        added = await _events(db, "risk.added")
        # The create ran outside the scope, the link added by the update inside.
        assert [(e.card_id, e.user_id) for e in added] == [
            (env["app"].id, None),
            (itc.id, env["person"].id),
        ]
        todo = await db.scalar(select(Todo).where(Todo.assigned_to == env["other"].id))
        assert todo.created_by == env["person"].id

    async def test_outside_the_scope_the_risk_has_no_creator(self, db, env):
        out = await ExtensionRisks(KEY).create(title="Unpatched DB")
        assert (await db.get(Risk, out.id)).created_by is None


class TestDecisionsBridge:
    async def test_create_draft_names_the_person_as_author(self, db, env):
        bridge = ExtensionDecisions(KEY)
        with on_behalf_of(env["person"]):
            inside = await bridge.create_draft(title="Adopt Postgres")
        outside = await bridge.create_draft(title="Adopt Redis")
        assert (await db.get(ArchitectureDecision, inside.id)).created_by == env["person"].id
        assert (await db.get(ArchitectureDecision, outside.id)).created_by is None


class TestSurveysBridge:
    async def test_send_names_the_person(self, db, env):
        db.add(Stakeholder(card_id=env["app"].id, user_id=env["other"].id, role="responsible"))
        await db.flush()
        with on_behalf_of(env["person"]):
            out = await ExtensionSurveys(KEY).send(
                name="Refresh",
                target_type="Application",
                card_ids=[str(env["app"].id)],
                roles=["responsible"],
                fields=[{"key": "hosting", "action": "maintain"}],
            )
        survey = await db.get(Survey, out.id)
        assert survey.created_by == env["person"].id
        (event,) = await _events(db, "survey.sent")
        assert event.user_id == env["person"].id
        assert event.data["ext"] == KEY
        note = await db.scalar(select(Notification).where(Notification.user_id == env["other"].id))
        assert note.actor_id == env["person"].id
