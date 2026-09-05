"""Rollback of governance writes — risks, stakeholder roles, tags, draft
decisions — on top of the card / relation coverage that already existed.

Each test writes through the same services the routes and the extension
bridges use (so the events carry exactly what production rows carry),
under a ``request_batch_id`` so they land in one batch, then plans and
executes the rollback of that batch.
"""

from __future__ import annotations

import uuid

import pytest
from sqlalchemy import select

from app.models.architecture_decision import ArchitectureDecision
from app.models.event import Event
from app.models.mutation_batch import MutationBatch
from app.models.risk import Risk, RiskCard
from app.models.stakeholder import Stakeholder
from app.models.tag import CardTag, Tag, TagGroup
from app.models.todo import Todo
from app.services import adr_service, risk_service, stakeholder_service, tag_service
from app.services.event_bus import request_batch_id
from app.services.rollback_service import execute_rollback, plan_rollback
from tests.conftest import create_card, create_user


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
        assert [e["event_type"] for e in plan["unsupported_events"]] == ["todo.created"]
        assert "not reversed" in plan["unsupported_events"][0]["reason"]
        result = await execute_rollback(db, batch, actor.id)
        assert all(r["status"] in ("ok", "skipped") for r in result["results"] if "status" in r)
        from app.models.card import Card

        assert (
            await db.execute(select(Card).where(Card.id == card_id))
        ).scalar_one_or_none() is None
        assert (await db.execute(select(Risk))).scalars().all() == []


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
