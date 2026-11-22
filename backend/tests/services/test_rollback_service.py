"""Rollback of governance writes — risks, stakeholder roles, tags, draft
decisions — on top of the card / relation coverage that already existed.

Each test writes through the same services the routes and the extension
bridges use (so the events carry exactly what production rows carry),
under a ``request_batch_id`` so they land in one batch, then plans and
executes the rollback of that batch.
"""

from __future__ import annotations

import uuid
from unittest.mock import AsyncMock

import pytest
from fastapi import HTTPException
from sqlalchemy import select

from app.models.architecture_decision import ArchitectureDecision
from app.models.diagram import Diagram
from app.models.event import Event
from app.models.mutation_batch import MutationBatch
from app.models.relation import Relation
from app.models.risk import Risk, RiskCard
from app.models.stakeholder import Stakeholder
from app.models.survey import Survey, SurveyResponse
from app.models.tag import CardTag, Tag, TagGroup
from app.models.todo import Todo
from app.services import (
    adr_service,
    card_write_service,
    risk_service,
    stakeholder_service,
    tag_service,
)
from app.services.bo_relationship_constants import ER_RELATION
from app.services.event_bus import event_bus, request_batch_id
from app.services.rollback_service import _lock_inverse_writes, execute_rollback, plan_rollback
from tests.conftest import create_card, create_relation, create_user


async def test_execute_checks_authorization_before_conflict_details(monkeypatch):
    from app.services import rollback_service as rs

    sequence = []
    ops = [{"op": "restore_card_fields", "card_id": str(uuid.uuid4())}]

    async def lock(*args):
        sequence.append("lock")

    async def authorize(operations):
        sequence.append("authorize")
        assert operations is ops
        raise HTTPException(403, "Insufficient permissions")

    async def conflict(*args):
        sequence.append("conflict")
        return [{"id": "private-batch"}]

    monkeypatch.setattr(rs, "_lock_inverse_writes", lock)
    monkeypatch.setattr(rs, "_find_conflicting_batches", conflict)
    create = AsyncMock()
    monkeypatch.setattr(rs, "create_batch", create)
    with pytest.raises(HTTPException) as exc:
        await rs.execute_rollback(
            object(), object(), uuid.uuid4(), events=[], operations=ops, authorize=authorize
        )
    assert exc.value.status_code == 403
    assert "private-batch" not in str(exc.value.detail)
    assert sequence == ["lock", "authorize"]
    create.assert_not_awaited()


async def test_execute_checks_conflicts_after_lock_and_authorization(monkeypatch):
    from app.services import rollback_service as rs

    sequence = []

    async def lock(*args):
        sequence.append("lock")

    async def authorize(operations):
        sequence.append("authorize")

    async def conflict(*args):
        sequence.append("conflict")
        return [{"id": "later"}]

    monkeypatch.setattr(rs, "_lock_inverse_writes", lock)
    monkeypatch.setattr(rs, "_find_conflicting_batches", conflict)
    create = AsyncMock()
    monkeypatch.setattr(rs, "create_batch", create)
    with pytest.raises(HTTPException) as exc:
        await rs.execute_rollback(
            object(), object(), uuid.uuid4(), events=[], operations=[], authorize=authorize
        )
    assert exc.value.status_code == 409
    assert sequence == ["lock", "authorize", "conflict"]
    create.assert_not_awaited()


async def _open_batch(db, actor) -> MutationBatch:
    batch = MutationBatch(tool_name="ext:test", actor_user_id=actor.id, dry_run=False)
    db.add(batch)
    await db.flush()
    return batch


class _InBatch:
    """Stamp every event published inside the block with ``batch.id``."""

    def __init__(self, batch: MutationBatch) -> None:
        self.batch = batch

    def __enter__(self):
        self._token = request_batch_id.set(self.batch.id)
        return self

    def __exit__(self, *exc):
        request_batch_id.reset(self._token)


async def _events(db, batch, event_type: str) -> list[Event]:
    rows = await db.execute(
        select(Event).where(Event.batch_id == batch.id, Event.event_type == event_type)
    )
    return list(rows.scalars().all())


def _ops(result: dict, op: str) -> list[dict]:
    return [r for r in result["results"] if r["op"] == op]


@pytest.fixture
async def actor(db):
    return await create_user(db, role="admin", display_name="Batch Actor")


class TestRiskRollback:
    async def test_created_risk_is_deleted_with_its_links_and_owner_todo(self, db, actor):
        owner = await create_user(db, role="member", display_name="Risk Owner")
        card_a = await create_card(db, name="App A")
        card_b = await create_card(db, name="App B")
        batch = await _open_batch(db, actor)
        with _InBatch(batch):
            risk = await risk_service.create_risk(
                db,
                title="Unowned cost centre",
                card_ids=[card_a.id, card_b.id],
                owner_id=owner.id,
                actor_id=None,
                event_extra={"ext": "test"},
            )
        risk_id = risk.id
        link = risk_service.risk_link(risk)
        assert len(await _events(db, batch, "risk.added")) == 2  # fan-out per card
        assert (await _events(db, batch, "risk.added"))[0].data["created"] is True
        todos = (await db.execute(select(Todo).where(Todo.link == link))).scalars().all()
        assert len(todos) == 1

        plan = await plan_rollback(db, batch)
        assert plan["unsupported_events"] == []
        deletes = [o for o in plan["operations"] if o["op"] == "delete_risk"]
        assert len(deletes) == 1, "the per-card fan-out collapses to one reversal"
        assert deletes[0]["detail"] == risk.reference

        result = await execute_rollback(db, batch, actor.id)
        assert _ops(result, "delete_risk")[0]["status"] == "ok"
        assert (
            await db.execute(select(Risk).where(Risk.id == risk_id))
        ).scalar_one_or_none() is None
        assert (
            await db.execute(select(RiskCard).where(RiskCard.risk_id == risk_id))
        ).scalars().all() == []
        assert (await db.execute(select(Todo).where(Todo.link == link))).scalars().all() == []
        # The reversal is itself a batch that references the original.
        rb = await db.get(MutationBatch, uuid.UUID(result["rollback_batch_id"]))
        assert rb.summary["reverses_batch_id"] == str(batch.id)

    async def test_linking_an_existing_risk_rolls_back_to_an_unlink(self, db, actor):
        card_a = await create_card(db, name="App A")
        card_b = await create_card(db, name="App B")
        earlier = await _open_batch(db, actor)
        with _InBatch(earlier):
            risk = await risk_service.create_risk(
                db, title="Existing", card_ids=[card_a.id], actor_id=None
            )
        batch = await _open_batch(db, actor)
        with _InBatch(batch):
            await risk_service.link_cards(db, risk.id, [card_b.id])
            await risk_service.publish_risk_event(
                db, risk, "risk.added", [card_b.id], actor_id=None
            )

        plan = await plan_rollback(db, batch)
        assert [o["op"] for o in plan["operations"]] == ["unlink_risk_card"]
        result = await execute_rollback(db, batch, actor.id)
        assert _ops(result, "unlink_risk_card")[0]["status"] == "ok"
        still = (await db.execute(select(Risk).where(Risk.id == risk.id))).scalar_one_or_none()
        assert still is not None, "the risk itself was not created by this batch"
        linked = await risk_service.linked_card_ids(db, risk.id)
        assert linked == [card_a.id]

    async def test_update_with_changes_restores_the_old_values(self, db, actor):
        card = await create_card(db, name="App")
        owner = await create_user(db, role="member")
        risk = await risk_service.create_risk(db, title="Before", card_ids=[card.id], actor_id=None)
        before = risk_service.risk_snapshot(risk)
        batch = await _open_batch(db, actor)
        with _InBatch(batch):
            risk.title = "After"
            risk.owner_id = owner.id
            risk.initial_probability = "high"
            risk.initial_level = risk_service.derive_level("high", risk.initial_impact) or "medium"
            await db.flush()
            await risk_service.sync_owner_todo(db, risk, actor_id=None, previous_owner=None)
            changes = risk_service.risk_changes(before, risk)
            assert set(changes) == {"title", "owner_id", "initial_probability"}
            await risk_service.publish_risk_event(
                db,
                risk,
                "risk.updated",
                [card.id],
                actor_id=None,
                extra={"fields": sorted(changes), "changes": changes},
            )
        link = risk_service.risk_link(risk)
        assert len((await db.execute(select(Todo).where(Todo.link == link))).scalars().all()) == 1

        plan = await plan_rollback(db, batch)
        assert [o["op"] for o in plan["operations"]] == ["restore_risk_fields"]
        assert plan["operations"][0]["fields"]["title"] == "Before"
        result = await execute_rollback(db, batch, actor.id)
        assert _ops(result, "restore_risk_fields")[0]["status"] == "ok"
        await db.refresh(risk)
        assert risk.title == "Before"
        assert risk.owner_id is None
        assert risk.initial_probability == "medium"
        assert risk.initial_level == risk_service.derive_level("medium", risk.initial_impact)
        # Clearing the owner again removes the Todo the update had created.
        assert (await db.execute(select(Todo).where(Todo.link == link))).scalars().all() == []

    async def test_update_without_changes_and_removal_stay_unsupported(self, db, actor):
        card = await create_card(db, name="App")
        risk = await risk_service.create_risk(db, title="R", card_ids=[card.id], actor_id=None)
        batch = await _open_batch(db, actor)
        with _InBatch(batch):
            await risk_service.publish_risk_event(
                db, risk, "risk.updated", [card.id], actor_id=None, extra={"fields": ["title"]}
            )
            await risk_service.publish_risk_event(
                db, risk, "risk.removed", [card.id], actor_id=None
            )
        plan = await plan_rollback(db, batch)
        assert plan["operations"] == []
        assert sorted(e["event_type"] for e in plan["unsupported_events"]) == [
            "risk.removed",
            "risk.updated",
        ]


class TestStakeholderRollback:
    async def _assign(self, db, card, user, role="responsible"):
        row = Stakeholder(card_id=card.id, user_id=user.id, role=role)
        db.add(row)
        await db.flush()
        await stakeholder_service.publish_stakeholder_event(
            db,
            "stakeholder.added",
            row,
            role_label="Responsible",
            user_display_name=user.display_name,
            actor_id=None,
        )
        return row

    async def test_assignment_is_removed_and_payload_names_no_user_id(self, db, actor):
        card = await create_card(db, name="App")
        person = await create_user(db, role="member", display_name="Owner")
        batch = await _open_batch(db, actor)
        with _InBatch(batch):
            await self._assign(db, card, person)

        plan = await plan_rollback(db, batch)
        (op,) = plan["operations"]
        assert op["op"] == "remove_stakeholder"
        assert op["stakeholder_user_id"] == str(person.id)
        assert "user_id" not in op, "a user_id key would push the rollback event over SSE"
        assert op["detail"] == "Owner · Responsible"

        result = await execute_rollback(db, batch, actor.id)
        assert _ops(result, "remove_stakeholder")[0]["status"] == "ok"
        assert (
            await stakeholder_service.find_assignment(db, card.id, person.id, "responsible")
        ) is None
        published = (
            (
                await db.execute(
                    select(Event).where(Event.event_type == "rollback.remove_stakeholder")
                )
            )
            .scalars()
            .all()
        )
        assert len(published) == 1
        assert "user_id" not in published[0].data

    async def test_removal_is_reassigned_and_role_change_restored(self, db, actor):
        card = await create_card(db, name="App")
        person = await create_user(db, role="member", display_name="Owner")
        row = await self._assign(db, card, person)
        batch = await _open_batch(db, actor)
        with _InBatch(batch):
            # Role change, then removal — the reverse order restores both.
            row.role = "observer"
            await db.flush()
            await stakeholder_service.publish_stakeholder_event(
                db,
                "stakeholder.role_changed",
                row,
                role_label="Observer",
                user_display_name=person.display_name,
                actor_id=None,
                extra={"old_role": "responsible", "old_role_label": "Responsible"},
            )
            await stakeholder_service.publish_stakeholder_event(
                db,
                "stakeholder.removed",
                row,
                role_label="Observer",
                user_display_name=person.display_name,
                actor_id=None,
            )
            await db.delete(row)
            await db.flush()

        result = await execute_rollback(db, batch, actor.id)
        statuses = {r["op"]: r["status"] for r in result["results"]}
        assert statuses == {"assign_stakeholder": "ok", "restore_stakeholder_role": "ok"}
        assert await stakeholder_service.find_assignment(db, card.id, person.id, "responsible")
        assert (
            await stakeholder_service.find_assignment(db, card.id, person.id, "observer")
        ) is None


class TestTagRollback:
    async def _tag(self, db, name="Strategic"):
        group = TagGroup(name=f"Group {uuid.uuid4().hex[:6]}", mode="multi")
        db.add(group)
        await db.flush()
        tag = Tag(name=name, tag_group_id=group.id)
        db.add(tag)
        await db.flush()
        return tag

    async def test_added_tag_is_removed_and_removed_tag_is_re_added(self, db, actor):
        card = await create_card(db, name="App")
        kept = await self._tag(db, "Kept")
        added = await self._tag(db, "Added")
        await tag_service.set_card_tags(db, card, [kept.id], mode="replace", actor_id=None)
        batch = await _open_batch(db, actor)
        with _InBatch(batch):
            await tag_service.set_card_tags(db, card, [added.id], mode="replace", actor_id=None)
        assert await tag_service.card_tag_ids(db, card.id) == [added.id]

        plan = await plan_rollback(db, batch)
        assert sorted(o["op"] for o in plan["operations"]) == ["add_card_tag", "remove_card_tag"]
        assert {o["detail"] for o in plan["operations"]} == {"Kept", "Added"}
        result = await execute_rollback(db, batch, actor.id)
        assert {r["op"]: r["status"] for r in result["results"]} == {
            "add_card_tag": "ok",
            "remove_card_tag": "ok",
        }
        assert await tag_service.card_tag_ids(db, card.id) == [kept.id]

    async def test_rollback_is_idempotent_on_a_tag_already_gone(self, db, actor):
        card = await create_card(db, name="App")
        tag = await self._tag(db)
        batch = await _open_batch(db, actor)
        with _InBatch(batch):
            await tag_service.set_card_tags(db, card, [tag.id], mode="add", actor_id=None)
        await db.execute(CardTag.__table__.delete().where(CardTag.card_id == card.id))
        result = await execute_rollback(db, batch, actor.id)
        assert _ops(result, "remove_card_tag")[0]["reason"] == "already_removed"


class TestDecisionRollback:
    async def test_draft_is_deleted_and_a_signed_one_is_left(self, db, actor):
        card = await create_card(db, name="App")
        batch = await _open_batch(db, actor)
        with _InBatch(batch):
            draft = await adr_service.create_decision(
                db, title="Draft", linked_card_ids=[card.id], created_by=actor.id
            )
            signed = await adr_service.create_decision(db, title="Signed", created_by=actor.id)
        signed.status = "signed"
        await db.flush()
        events = await _events(db, batch, "adr.created")
        assert len(events) == 2
        assert all(e.card_id is None for e in events)
        assert {e.data["adr_id"] for e in events} == {str(draft.id), str(signed.id)}

        plan = await plan_rollback(db, batch)
        assert sorted(o["detail"] for o in plan["operations"]) == sorted(
            [draft.reference_number, signed.reference_number]
        )
        result = await execute_rollback(db, batch, actor.id)
        by_id = {r["adr_id"]: r for r in _ops(result, "delete_adr")}
        assert by_id[str(draft.id)]["status"] == "ok"
        assert by_id[str(signed.id)] == {
            **by_id[str(signed.id)],
            "status": "skipped",
            "reason": "adr_not_draft",
        }
        remaining = (await db.execute(select(ArchitectureDecision.id))).scalars().all()
        assert remaining == [signed.id]

    async def test_a_created_revision_is_deleted_like_a_draft(self, db, actor):
        from app.services import decision_standing as ds

        source = await adr_service.create_decision(db, title="Signed", publish=False)
        source.status = "signed"
        await db.flush()
        batch = await _open_batch(db, actor)
        with _InBatch(batch):
            revision = await adr_service.create_revision(
                db, source, created_by=actor.id, register=await ds.load_register(db)
            )
        revision_id = revision.id
        [event] = await _events(db, batch, "adr.created")
        assert event.data["revision_of"] == str(source.id)

        plan = await plan_rollback(db, batch)
        assert plan["unsupported_events"] == []
        assert [(o["op"], o["adr_id"], o["detail"]) for o in plan["operations"]] == [
            ("delete_adr", str(revision_id), f"{source.reference_number} · Rev 2")
        ]
        result = await execute_rollback(db, batch, actor.id)
        assert _ops(result, "delete_adr")[0]["status"] == "ok"
        remaining = (await db.execute(select(ArchitectureDecision.id))).scalars().all()
        assert remaining == [source.id]


class TestDiagramRollback:
    async def test_created_diagram_is_deleted_and_a_published_one_is_left(self, db, actor):
        draft = Diagram(name="Draft canvas", data={"xml": "<x/>"}, created_by=actor.id)
        shared = Diagram(name="Shared canvas", data={}, created_by=actor.id)
        db.add_all([draft, shared])
        await db.flush()
        batch = await _open_batch(db, actor)
        with _InBatch(batch):
            for d in (draft, shared):
                await event_bus.publish(
                    "diagram.created",
                    {"id": str(d.id), "name": d.name, "card_ids": []},
                    db=db,
                    user_id=actor.id,
                )
            await event_bus.publish(
                "diagram.updated",
                {"id": str(draft.id), "name": draft.name, "changes": {}},
                db=db,
                user_id=actor.id,
            )
        shared.is_published = True
        await db.flush()

        plan = await plan_rollback(db, batch)
        assert sorted(o["diagram_id"] for o in plan["operations"]) == sorted(
            [str(draft.id), str(shared.id)]
        )
        assert [u["event_type"] for u in plan["unsupported_events"]] == ["diagram.updated"]
        assert plan["unsupported_events"][0]["reason"] == (
            "diagram.updated is not reversed: The previous canvas is not snapshotted."
        )

        result = await execute_rollback(db, batch, actor.id)
        by_id = {r["diagram_id"]: r for r in _ops(result, "delete_diagram")}
        assert by_id[str(draft.id)]["status"] == "ok"
        assert by_id[str(shared.id)]["status"] == "skipped"
        assert by_id[str(shared.id)]["reason"] == "diagram_published"
        remaining = (await db.execute(select(Diagram.id))).scalars().all()
        assert remaining == [shared.id]


class TestMixedBatch:
    async def test_card_with_tag_and_risk_rolls_back_clean_and_todos_stay(self, db, actor):
        """A created card, a tag on it and a risk against it in one batch —
        the order the ops run in must not matter, and the todo the batch
        also wrote is reported, never touched."""
        person = await create_user(db, role="member")
        group = TagGroup(name="G", mode="multi")
        db.add(group)
        await db.flush()
        tag = Tag(name="T", tag_group_id=group.id)
        db.add(tag)
        await db.flush()
        batch = await _open_batch(db, actor)
        with _InBatch(batch):
            card = await create_card(db, name="New App")
            from app.services.event_bus import event_bus

            await event_bus.publish("card.created", {"id": str(card.id)}, db=db, card_id=card.id)
            await tag_service.set_card_tags(db, card, [tag.id], mode="add", actor_id=None)
            await risk_service.create_risk(
                db, title="R", card_ids=[card.id], owner_id=person.id, actor_id=None
            )
            todo = Todo(card_id=card.id, description="Please review", assigned_to=person.id)
            db.add(todo)
            await db.flush()
            await event_bus.publish("todo.created", {"id": str(todo.id)}, db=db, card_id=card.id)
        card_id = card.id

        plan = await plan_rollback(db, batch)
        # A todo a PERSON created stays: the event carries no ``ext``.
        assert [e["event_type"] for e in plan["unsupported_events"]] == ["todo.created"]
        assert "not reversed" in plan["unsupported_events"][0]["reason"]
        result = await execute_rollback(db, batch, actor.id)
        assert all(r["status"] in ("ok", "skipped") for r in result["results"] if "status" in r)
        from app.models.card import Card

        assert (
            await db.execute(select(Card).where(Card.id == card_id))
        ).scalar_one_or_none() is None
        assert (await db.execute(select(Risk))).scalars().all() == []


class TestExtensionTodoRollback:
    """A todo an extension created (``data["ext"]`` on the event) is the
    batch's to take back — a rule that misfired on fifty cards left fifty
    requests nobody asked for. Everything a person did on top stays."""

    async def _ext_todo(self, db, actor, batch, *, description="Review", status="open"):
        from app.services.event_bus import event_bus

        person = await create_user(db, role="member")
        todo = Todo(
            description=description,
            assigned_to=person.id,
            status=status,
            external_source="rules",
        )
        db.add(todo)
        await db.flush()
        with _InBatch(batch):
            await event_bus.publish(
                "todo.created",
                {"todo_id": str(todo.id), "description": description, "ext": "rules"},
                db=db,
            )
        return todo

    async def test_open_extension_todo_is_deleted(self, db, actor):
        batch = await _open_batch(db, actor)
        todo = await self._ext_todo(db, actor, batch, description="Fill in the owner")
        todo_id = todo.id

        plan = await plan_rollback(db, batch)
        assert plan["unsupported_events"] == []
        (op,) = plan["operations"]
        assert op["op"] == "delete_todo" and op["todo_id"] == str(todo_id)
        assert op["detail"] == "Fill in the owner"
        result = await execute_rollback(db, batch, actor.id)
        assert _ops(result, "delete_todo")[0]["status"] == "ok"
        assert (
            await db.execute(select(Todo).where(Todo.id == todo_id))
        ).scalar_one_or_none() is None

    async def test_completed_extension_todo_stays(self, db, actor):
        batch = await _open_batch(db, actor)
        todo = await self._ext_todo(db, actor, batch, status="done")
        todo_id = todo.id

        result = await execute_rollback(db, batch, actor.id)
        (op,) = _ops(result, "delete_todo")
        assert op["status"] == "skipped" and op["reason"] == "already_completed"
        assert (await db.execute(select(Todo).where(Todo.id == todo_id))).scalar_one()

    async def test_rolled_forward_occurrence_is_declined(self, db, actor):
        from app.services.event_bus import event_bus

        batch = await _open_batch(db, actor)
        todo = Todo(description="Quarterly check", external_source="rules")
        db.add(todo)
        await db.flush()
        with _InBatch(batch):
            await event_bus.publish(
                "todo.created",
                {"todo_id": str(todo.id), "ext": "rules", "rolled_forward": True},
                db=db,
            )
        plan = await plan_rollback(db, batch)
        assert plan["operations"] == []
        assert "recurring" in plan["unsupported_events"][0]["reason"]

    async def test_system_todo_is_never_deleted(self, db, actor):
        from app.services.event_bus import event_bus

        batch = await _open_batch(db, actor)
        todo = Todo(description="Sign off", is_system=True)
        db.add(todo)
        await db.flush()
        with _InBatch(batch):
            await event_bus.publish(
                "todo.created", {"todo_id": str(todo.id), "ext": "rules"}, db=db
            )
        result = await execute_rollback(db, batch, actor.id)
        (op,) = _ops(result, "delete_todo")
        assert op["status"] == "skipped" and op["reason"] == "todo_is_system"


class TestConflicts:
    async def test_a_later_batch_touching_the_same_risk_conflicts(self, db, actor):
        card = await create_card(db, name="App")
        batch = await _open_batch(db, actor)
        with _InBatch(batch):
            risk = await risk_service.create_risk(db, title="R", card_ids=[card.id], actor_id=None)
        later = MutationBatch(tool_name="update_risks", actor_user_id=actor.id, dry_run=False)
        db.add(later)
        await db.flush()
        # ``created_at`` is transaction-constant in a test, so push the later
        # batch explicitly past the first one.
        from datetime import timedelta

        later.created_at = batch.created_at + timedelta(seconds=1)
        await db.flush()
        with _InBatch(later):
            await risk_service.publish_risk_event(
                db, risk, "risk.updated", [card.id], actor_id=None, extra={"fields": ["title"]}
            )
        from fastapi import HTTPException

        with pytest.raises(HTTPException) as exc:
            await execute_rollback(db, batch, actor.id)
        assert exc.value.status_code == 409
        touched = exc.value.detail["conflicting_batches"][0]["touched_entities"]
        assert touched == [str(risk.id)]
        forced = await execute_rollback(db, batch, actor.id, force=True)
        assert forced["forced"] is True

    async def test_a_later_review_of_a_batch_created_decision_conflicts(self, client, db, actor):
        """The review events are stored (2.200.0), each in its request's
        auto-batch: asking for and giving a signature on a decision an MCP
        batch created is later work on that decision, so rolling the batch
        back reports both requests as conflicts instead of silently deleting
        a decision people have started to sign."""
        from datetime import timedelta

        from fastapi import HTTPException

        from tests.conftest import auth_headers, create_role

        await create_role(db, key="admin", label="Admin", permissions={"*": True})
        batch = await _open_batch(db, actor)
        with _InBatch(batch):
            adr = await adr_service.create_decision(db, title="Batch ADR", created_by=actor.id)
        adr_id = str(adr.id)

        asked = await client.post(
            f"/api/v1/adr/{adr_id}/request-signatures",
            json={"user_ids": [str(actor.id)]},
            headers=auth_headers(actor),
        )
        assert asked.status_code == 200, asked.text
        signed = await client.post(f"/api/v1/adr/{adr_id}/sign", headers=auth_headers(actor))
        assert signed.status_code == 200, signed.text

        later = {}
        for event_type in ("adr.signatures_requested", "adr.signed"):
            (event,) = (
                (await db.execute(select(Event).where(Event.event_type == event_type)))
                .scalars()
                .all()
            )
            assert event.data["id"] == adr_id
            later[event_type] = await db.get(MutationBatch, event.batch_id)
        # ``created_at`` is transaction-constant in a test: order them by hand.
        for offset, other in enumerate(later.values(), start=1):
            other.created_at = batch.created_at + timedelta(seconds=offset)
        await db.flush()

        with pytest.raises(HTTPException) as exc:
            await execute_rollback(db, batch, actor.id)
        assert exc.value.status_code == 409
        conflicts = sorted(exc.value.detail["conflicting_batches"], key=lambda c: c["created_at"])
        assert [(c["batch_id"], c["touched_entities"]) for c in conflicts] == [
            (str(later["adr.signatures_requested"].id), [adr_id]),
            (str(later["adr.signed"].id), [adr_id]),
        ]


class TestSurveyRollback:
    """``survey.sent`` (one event per surveyed card) reverses as ONE close:
    the survey is closed and the requests nobody has answered yet are
    dropped; an answer already given is a person's work and stays."""

    async def _sent_survey(self, db, actor, batch, *, answered: bool = False):
        from app.services.event_bus import event_bus

        a = await create_card(db, name="A")
        b = await create_card(db, name="B")
        person = await create_user(db, role="member")
        survey = Survey(
            name="Refresh",
            status="active",
            target_type_key="Application",
            target_filters={"card_ids": [str(a.id), str(b.id)]},
            target_roles=["responsible"],
            fields=[{"key": "x", "action": "maintain"}],
        )
        db.add(survey)
        await db.flush()
        db.add(SurveyResponse(survey_id=survey.id, card_id=a.id, user_id=person.id))
        db.add(
            SurveyResponse(
                survey_id=survey.id,
                card_id=b.id,
                user_id=person.id,
                status="completed" if answered else "pending",
            )
        )
        await db.flush()
        with _InBatch(batch):
            for card in (a, b):
                await event_bus.publish(
                    "survey.sent",
                    {"survey_id": str(survey.id), "name": "Refresh", "ext": "rules"},
                    db=db,
                    card_id=card.id,
                )
        return survey

    async def _responses(self, db, survey_id):
        return (
            (await db.execute(select(SurveyResponse).where(SurveyResponse.survey_id == survey_id)))
            .scalars()
            .all()
        )

    async def test_two_card_events_plan_one_close(self, db, actor):
        batch = await _open_batch(db, actor)
        survey = await self._sent_survey(db, actor, batch)
        plan = await plan_rollback(db, batch)
        assert plan["unsupported_events"] == []
        (op,) = plan["operations"]
        assert op["op"] == "close_survey" and op["survey_id"] == str(survey.id)
        assert op["detail"] == "Refresh"

    async def test_apply_closes_and_drops_pending_keeps_answered(self, db, actor):
        batch = await _open_batch(db, actor)
        survey = await self._sent_survey(db, actor, batch, answered=True)
        result = await execute_rollback(db, batch, actor.id)
        (op,) = _ops(result, "close_survey")
        assert op["status"] == "ok"
        assert survey.status == "closed" and survey.closed_at is not None
        rows = await self._responses(db, survey.id)
        assert [r.status for r in rows] == ["completed"]

    async def test_second_apply_skips_an_already_closed_survey(self, db, actor):
        batch = await _open_batch(db, actor)
        survey = await self._sent_survey(db, actor, batch)
        survey.status = "closed"
        await db.flush()
        result = await execute_rollback(db, batch, actor.id)
        (op,) = _ops(result, "close_survey")
        assert op["status"] == "skipped" and op["reason"] == "already_closed"
        assert len(await self._responses(db, survey.id)) == 2


@pytest.mark.parametrize("delete_kind", ["relation", "card"])
async def test_rollback_bo_deletion_is_available_to_inventory_sync(client, db, actor, delete_kind):
    from app.models.bo_operation_receipt import BoOperationReceipt
    from app.services.card_write_service import WriteActor, upsert_relation
    from tests.conftest import auth_headers, create_card_type, create_relation_type, create_role

    await create_role(db)
    await create_card_type(db, key="DataObject", subtypes=[{"key": "Data"}])
    relation_type = "relDataObjectToDataObject"
    await create_relation_type(
        db, key=relation_type, source_type_key="DataObject", target_type_key="DataObject"
    )
    source = await create_card(db, card_type="DataObject", subtype="Data", name="Customer")
    target = await create_card(db, card_type="DataObject", subtype="Data", name="Order")
    batch = await _open_batch(db, actor)
    if delete_kind == "card":
        with _InBatch(batch):
            await event_bus.publish(
                "card.created", {"id": str(source.id)}, db=db, card_id=source.id
            )
    relation_batch = batch if delete_kind == "relation" else await _open_batch(db, actor)
    with _InBatch(relation_batch):
        link, _, _ = await upsert_relation(
            db,
            WriteActor(user_id=actor.id, display_name=actor.display_name),
            type_key=relation_type,
            source_id=source.id,
            target_id=target.id,
        )
    source_id, link_id = source.id, link.id
    headers = auth_headers(actor)
    base = "/api/v1/bo-relationship"
    saved = await client.put(f"{base}/layout", json={}, headers=headers)
    assert saved.status_code == 200, saved.text
    assert any(edge["id"] == str(link_id) for edge in saved.json()["edges"])

    rollback_actor = await create_user(db, role="admin", display_name="Rollback Actor")
    await execute_rollback(db, batch, rollback_actor.id)
    response = await client.get(f"{base}/changes", headers=headers)
    assert response.status_code == 200, response.text
    changes = response.json()["changes"]
    expected = {("edge", str(link_id), "removed")}
    if delete_kind == "card":
        expected.add(("node", str(source_id), "removed"))
    assert {(c["kind"], c["id"], c["change"]) for c in changes} == expected
    proofs = list(
        await db.scalars(
            select(BoOperationReceipt).where(BoOperationReceipt.result_id.in_([source_id, link_id]))
        )
    )
    assert len(proofs) == len(expected)
    assert all(proof.actor_id == rollback_actor.id for proof in proofs)
    accepted = [{k: change[k] for k in ("kind", "id", "revision")} for change in changes]
    synced = await client.put(
        f"{base}/layout", json={"accepted_inventory_changes": accepted}, headers=headers
    )
    assert synced.status_code == 200, synced.text
    assert all(edge["id"] != str(link_id) for edge in synced.json()["edges"])
    if delete_kind == "card":
        assert all(node["id"] != str(source_id) for node in synced.json()["nodes"])


@pytest.mark.parametrize("delete_kind", ["relation", "card", None])
async def test_rollback_prelocks_only_the_affected_endpoints(db, monkeypatch, delete_kind):
    deleted = await create_card(db, name="Deleted")
    incoming = await create_card(db, name="Incoming")
    outgoing = await create_card(db, name="Outgoing")
    direct_source = await create_card(db, name="Direct source")
    direct_target = await create_card(db, name="Direct target")
    event_card = await create_card(db, name="In event only")
    restored = await create_card(db, name="Restored fields")
    unrelated = await create_card(db, name="Unrelated")
    await create_relation(db, type_key=ER_RELATION, source_id=incoming.id, target_id=deleted.id)
    await create_relation(db, type_key=ER_RELATION, source_id=deleted.id, target_id=outgoing.id)
    direct = await create_relation(
        db, type_key=ER_RELATION, source_id=direct_source.id, target_id=direct_target.id
    )
    untouched = await create_relation(
        db, type_key=ER_RELATION, source_id=restored.id, target_id=unrelated.id
    )
    events = [
        Event(event_type="card.updated", card_id=event_card.id),
        Event(event_type="relation.created"),
    ]
    ops = [
        {"op": "restore_card_fields", "card_id": str(restored.id)},
        {"op": "unsupported", "relation_id": str(untouched.id)},
        {"op": "delete_card", "card_id": "invalid"},
        {"op": "delete_relation", "relation_id": "invalid"},
    ]
    expected_cards = {event_card.id, restored.id}
    expected_relations = set()
    if delete_kind == "card":
        ops.append({"op": "delete_card", "card_id": str(deleted.id)})
        expected_cards.update((deleted.id, incoming.id, outgoing.id))
        expected_relations.update(
            ((ER_RELATION, incoming.id, deleted.id), (ER_RELATION, deleted.id, outgoing.id))
        )
    if delete_kind == "relation":
        ops.append({"op": "delete_relation", "relation_id": str(direct.id)})
        expected_cards.update((direct_source.id, direct_target.id))
        expected_relations.add((ER_RELATION, direct_source.id, direct_target.id))

    calls = []
    lock_relations = card_write_service.lock_bo_relation_writes
    lock_cards = card_write_service.lock_relation_endpoints

    async def record_relation_locks(session, pairs):
        calls.append(("relation keys", set(pairs)))
        await lock_relations(session, pairs)

    async def record_card_locks(session, card_ids):
        calls.append(("card rows", set(card_ids)))
        return await lock_cards(session, card_ids)

    monkeypatch.setattr(card_write_service, "lock_bo_relation_writes", record_relation_locks)
    monkeypatch.setattr(card_write_service, "lock_relation_endpoints", record_card_locks)
    await _lock_inverse_writes(db, events, ops)
    assert calls == [("relation keys", expected_relations), ("card rows", expected_cards)]


async def test_rollback_skips_a_relation_deleted_between_lookup_and_lock(db, actor, monkeypatch):
    source = await create_card(db, name="Source")
    target = await create_card(db, name="Target")
    relation = await create_relation(db, source_id=source.id, target_id=target.id)
    batch = await _open_batch(db, actor)
    with _InBatch(batch):
        await event_bus.publish("relation.created", {"id": str(relation.id)}, db=db)

    lock_relation = card_write_service.lock_relation_for_write

    async def delete_before_lock(session, loaded):
        # Simulate a committed deletion between the initial read and the re-read.
        await session.delete(loaded)
        await session.flush()
        return await lock_relation(session, loaded)

    monkeypatch.setattr(card_write_service, "lock_relation_for_write", delete_before_lock)
    result = await execute_rollback(db, batch, actor.id)
    assert await db.get(Relation, relation.id) is None
    [op] = _ops(result, "delete_relation")
    assert (op["relation_id"], op["status"], op["reason"]) == (
        str(relation.id),
        "skipped",
        "already_deleted",
    )


@pytest.mark.parametrize("delete_kind", ["relation", "card"])
async def test_rollback_and_inventory_relation_delete_do_not_deadlock(test_engine, delete_kind):
    import asyncio

    from sqlalchemy import delete, func
    from sqlalchemy.ext.asyncio import AsyncSession

    from app.models.bo_operation_receipt import BoOperationReceipt
    from app.models.card import Card
    from app.models.card_type import CardType
    from app.models.relation import Relation
    from app.models.relation_type import RelationType
    from app.models.user import User
    from app.services.card_write_service import delete_relation, lock_relation_for_write
    from tests.conftest import create_card_type, create_relation, create_relation_type

    async with AsyncSession(test_engine, expire_on_commit=False) as session, session.begin():
        actor = await create_user(session, role="admin")
        ct = await create_card_type(session, key="DataObject")
        rt = await create_relation_type(
            session,
            key="relDataObjectToDataObject",
            source_type_key="DataObject",
            target_type_key="DataObject",
        )
        source = await create_card(session, card_type="DataObject")
        target = await create_card(session, card_type="DataObject")
        relation = await create_relation(
            session, type_key=rt.key, source_id=source.id, target_id=target.id
        )
        batch = await _open_batch(session, actor)
        with _InBatch(batch):
            if delete_kind == "relation":
                await event_bus.publish("relation.created", {"id": str(relation.id)}, db=session)
            else:
                await event_bus.publish(
                    "card.created", {"id": str(source.id)}, db=session, card_id=source.id
                )

    rollback_pid = None
    ready = asyncio.Event()

    async def rollback():
        nonlocal rollback_pid
        async with AsyncSession(test_engine) as session, session.begin():
            current_batch = await session.get(MutationBatch, batch.id)
            rollback_pid = await session.scalar(select(func.pg_backend_pid()))
            ready.set()
            await execute_rollback(session, current_batch, actor.id)

    async def wait_blocked():
        async with AsyncSession(test_engine) as observer:
            while not await observer.scalar(select(func.pg_blocking_pids(rollback_pid))):
                await asyncio.sleep(0.01)

    task = None
    try:
        async with AsyncSession(test_engine) as session, session.begin():
            current = await session.get(Relation, relation.id)
            locked = await lock_relation_for_write(session, current)
            task = asyncio.create_task(rollback())
            await asyncio.wait_for(ready.wait(), timeout=5)
            await asyncio.wait_for(wait_blocked(), timeout=5)
            await asyncio.wait_for(delete_relation(session, actor.id, locked), timeout=5)
            await asyncio.wait_for(session.flush(), timeout=5)
        if delete_kind == "relation":
            with pytest.raises(HTTPException) as exc:
                await asyncio.wait_for(task, timeout=5)
            assert exc.value.status_code == 409
            assert exc.value.detail["error"] == "rollback_conflict"
        else:
            await asyncio.wait_for(task, timeout=5)
    finally:
        if task is not None:
            if not task.done():
                task.cancel()
            await asyncio.gather(task, return_exceptions=True)
        async with AsyncSession(test_engine) as cleanup, cleanup.begin():
            batch_ids = select(MutationBatch.id).where(MutationBatch.actor_user_id == actor.id)
            await cleanup.execute(
                delete(Event).where((Event.user_id == actor.id) | Event.batch_id.in_(batch_ids))
            )
            await cleanup.execute(
                delete(BoOperationReceipt).where(BoOperationReceipt.actor_id == actor.id)
            )
            await cleanup.execute(
                delete(MutationBatch).where(MutationBatch.actor_user_id == actor.id)
            )
            await cleanup.execute(delete(Card).where(Card.id.in_([source.id, target.id])))
            await cleanup.execute(delete(RelationType).where(RelationType.id == rt.id))
            await cleanup.execute(delete(CardType).where(CardType.id == ct.id))
            await cleanup.execute(delete(User).where(User.id == actor.id))


async def test_removed_stage_cannot_be_restored_even_with_force(db, actor):
    from tests.conftest import create_card_type

    card_type = await create_card_type(db, key="Application")
    card_type.lifecycle_stages = []
    card = await create_card(db, name="Stage rollback")
    batch = await _open_batch(db, actor)
    with _InBatch(batch):
        await event_bus.publish(
            "card.updated",
            {"id": str(card.id), "changes": {"lifecycle_stage": {"old": "removed", "new": None}}},
            db=db,
            card_id=card.id,
        )
    with pytest.raises(HTTPException) as exc:
        await execute_rollback(db, batch, actor.id, force=True)
    assert exc.value.status_code == 409
    assert exc.value.detail["error"] == "rollback_conflict"
    assert card.lifecycle_stage is None


async def test_rollback_refreshes_card_after_lock_before_restoring_legacy_attributes(db, actor):
    from sqlalchemy import update

    from app.models.card import Card

    card = await create_card(db, name="Concurrent rollback", attributes={"other": "old"})
    batch = await _open_batch(db, actor)
    await db.execute(
        update(Card)
        .where(Card.id == card.id)
        .values(attributes={"other": "new"})
        .execution_options(synchronize_session=False)
    )
    await execute_rollback(
        db,
        batch,
        actor.id,
        events=[],
        operations=[
            {
                "op": "restore_card_fields",
                "card_id": str(card.id),
                "fields": {"attr_legacy": "restored"},
            }
        ],
    )
    assert card.attributes == {"other": "new", "legacy": "restored"}


@pytest.mark.parametrize("new_stage", ["three", None])
async def test_stage_rollback_rejects_later_unbatched_edit_unless_forced(db, actor, new_stage):
    from tests.conftest import create_card_type

    card_type = await create_card_type(db, key="Application")
    card_type.lifecycle_stages = [
        {"key": key, "label": key, "color": "#123456"} for key in ("one", "two", "three")
    ]
    card = await create_card(db, name="Stage changes")
    card.lifecycle_stage = "one"
    await db.flush()
    batch = await _open_batch(db, actor)
    writer = card_write_service.WriteActor.from_user(actor)
    with _InBatch(batch):
        await card_write_service.update_card(db, writer, card, {"lifecycle_stage": "two"})
    await card_write_service.update_card(db, writer, card, {"lifecycle_stage": new_stage})
    await db.flush()

    with pytest.raises(HTTPException) as exc:
        await execute_rollback(db, batch, actor.id)
    assert exc.value.status_code == 409
    assert exc.value.detail["error"] == "rollback_conflict"
    assert card.lifecycle_stage == new_stage
    await execute_rollback(db, batch, actor.id, force=True)
    assert card.lifecycle_stage == "one"


async def test_stage_rollback_rejects_ambiguous_simultaneous_batch_events(db, actor):
    from datetime import UTC, datetime

    from sqlalchemy import update

    from tests.conftest import create_card_type

    card_type = await create_card_type(db, key="Application")
    card_type.lifecycle_stages = [
        {"key": key, "label": key, "color": "#123456"} for key in ("one", "two", "three")
    ]
    card = await create_card(db, name="Stage changes")
    card.lifecycle_stage = "one"
    await db.flush()
    batch = await _open_batch(db, actor)
    writer = card_write_service.WriteActor.from_user(actor)
    with _InBatch(batch):
        await card_write_service.update_card(db, writer, card, {"lifecycle_stage": "two"})
        await card_write_service.update_card(db, writer, card, {"lifecycle_stage": "three"})
    await db.flush()
    events = (await db.scalars(select(Event).where(Event.batch_id == batch.id))).all()
    stage_events = [event for event in events if "lifecycle_stage" in event.data.get("changes", {})]
    assert len(stage_events) == 2
    await db.execute(
        update(Event)
        .where(Event.id.in_([event.id for event in stage_events]))
        .values(created_at=datetime(2025, 1, 1, tzinfo=UTC))
    )
    await db.flush()

    with pytest.raises(HTTPException) as exc:
        await execute_rollback(db, batch, actor.id)
    assert exc.value.status_code == 409
    assert exc.value.detail["error"] == "rollback_conflict"
    assert card.lifecycle_stage == "three"
