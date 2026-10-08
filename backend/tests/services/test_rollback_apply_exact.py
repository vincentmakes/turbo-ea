"""``rollback_service`` appliers and entry points, pinned to exact values.

Every applier has two kinds of outcome a caller reads: the skip reason when
there is nothing to undo (the batch summary shows it per op), and the state it
leaves behind. ``test_rollback_service`` drives the happy paths end to end;
these walk each applier's branches one at a time and compare the whole result,
plus the summary, events and conflict report ``execute_rollback`` produces.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone

import pytest
from fastapi import HTTPException
from sqlalchemy import select

from app.models.architecture_decision import ArchitectureDecision
from app.models.card import Card
from app.models.event import Event
from app.models.mutation_batch import MutationBatch
from app.models.relation import Relation
from app.models.risk import Risk, RiskCard
from app.models.stakeholder import Stakeholder
from app.models.survey import Survey, SurveyResponse
from app.models.tag import CardTag, Tag, TagGroup
from app.models.todo import Todo
from app.services import (
    compliance_risk_sync,
    data_quality,
    risk_service,
    stakeholder_service,
)
from app.services import rollback_service as rs
from app.services.event_bus import request_origin
from tests.conftest import create_card, create_user

GHOST = str(uuid.uuid4())


@pytest.fixture
async def actor(db):
    return await create_user(db, email="actor@test.com", role="admin", display_name="Actor")


@pytest.fixture
def rescored(monkeypatch):
    """Record each card the appliers rescore, by either path."""
    calls = []

    async def stakeholder_rescore(db, card_id):
        calls.append(("stakeholder", card_id))

    async def cards_rescore(db, card_ids, **kw):
        calls.append(("cards", list(card_ids)))
        return 0

    monkeypatch.setattr(
        stakeholder_service, "rescore_after_stakeholder_change", stakeholder_rescore
    )
    monkeypatch.setattr(data_quality, "rescore_cards", cards_rescore)
    return calls


async def exists(db, model, ident) -> bool:
    return (
        await db.execute(select(model).where(model.id == ident))
    ).scalar_one_or_none() is not None


async def apply(db, op):
    return await rs._apply_inverse(db, op)


def skipped(op, reason):
    return {**op, "status": "skipped", "reason": reason}


def ok(op):
    return {**op, "status": "ok"}


async def test_an_unknown_op_is_skipped(db):
    op = {"op": "teleport"}
    assert await apply(db, op) == skipped(op, "unsupported")


# ── cards ───────────────────────────────────────────────────────────────────


@pytest.mark.parametrize(
    "name, missing_reason",
    [
        ("delete_card", "already_deleted"),
        ("restore_card", "card_not_found"),
        ("archive_card", "card_not_found"),
        ("restore_card_fields", "card_not_found"),
    ],
)
async def test_card_ops_without_a_card(db, name, missing_reason):
    for empty in ({"op": name}, {"op": name, "card_id": ""}, {"op": name, "card_id": None}):
        assert await apply(db, empty) == skipped(empty, "missing_card_id")
    for absent in ({"op": name, "card_id": GHOST}, {"op": name, "card_id": "not-a-uuid"}):
        assert await apply(db, absent) == skipped(absent, missing_reason)


async def test_delete_card(db):
    card = await create_card(db, name="Made by the batch")
    op = {"op": "delete_card", "card_id": str(card.id)}
    assert await apply(db, op) == ok(op)
    await db.flush()
    assert not await exists(db, Card, card.id)


async def test_restore_card(db):
    card = await create_card(db, name="A", status="ARCHIVED")
    card.archived_at = datetime.now(timezone.utc)
    await db.flush()
    op = {"op": "restore_card", "card_id": str(card.id)}
    assert await apply(db, op) == ok(op)
    assert (card.status, card.archived_at) == ("ACTIVE", None)


async def test_archive_card(db):
    card = await create_card(db, name="A")
    before = datetime.now(timezone.utc)
    op = {"op": "archive_card", "card_id": str(card.id)}
    assert await apply(db, op) == ok(op)
    assert card.status == "ARCHIVED"
    assert card.archived_at.tzinfo is not None
    assert before <= card.archived_at <= datetime.now(timezone.utc)


async def test_restore_card_fields(db):
    parent = await create_card(db, name="Parent")
    card = await create_card(db, name="Renamed", description="new")
    op = {
        "op": "restore_card_fields",
        "card_id": str(card.id),
        "fields": {"name": "Original", "description": None, "parent_id": str(parent.id)},
    }
    assert await apply(db, op) == ok(op)
    assert (card.name, card.description) == ("Original", None)
    assert card.parent_id == parent.id and isinstance(card.parent_id, uuid.UUID)


async def test_restore_card_fields_clears_a_parent(db):
    parent = await create_card(db, name="Parent")
    card = await create_card(db, name="Child", parent_id=parent.id)
    op = {"op": "restore_card_fields", "card_id": str(card.id), "fields": {"parent_id": None}}
    assert await apply(db, op) == ok(op)
    assert card.parent_id is None


async def test_restore_card_fields_with_nothing_to_restore(db):
    card = await create_card(db, name="Same")
    op = {"op": "restore_card_fields", "card_id": str(card.id)}
    assert await apply(db, op) == ok(op)
    assert card.name == "Same"


# ── relations ───────────────────────────────────────────────────────────────


async def test_delete_relation(db):
    a, b = await create_card(db, name="A"), await create_card(db, name="B")
    rel = Relation(type="relAppToITC", source_id=a.id, target_id=b.id)
    db.add(rel)
    await db.flush()
    op = {"op": "delete_relation", "relation_id": str(rel.id)}
    assert await apply(db, op) == ok(op)
    await db.flush()
    assert not await exists(db, Relation, rel.id)
    assert await apply(db, op) == skipped(op, "already_deleted")
    for bad in ({"op": "delete_relation"}, {"op": "delete_relation", "relation_id": "x"}):
        assert await apply(db, bad) == skipped(bad, "missing_relation_id")


# ── risks ───────────────────────────────────────────────────────────────────


@pytest.fixture
def propagated(monkeypatch):
    calls = []

    async def fake(db, risk, **kwargs):
        calls.append((risk.id, kwargs))

    monkeypatch.setattr(compliance_risk_sync, "propagate_risk_to_findings", fake)
    return calls


async def test_delete_risk_takes_the_owner_todo_with_it(db, propagated):
    owner = await create_user(db, email="owner@test.com", role="member")
    risk = await risk_service.create_risk(
        db, title="R", card_ids=[], owner_id=owner.id, actor_id=None
    )
    link = risk_service.risk_link(risk)
    personal = Todo(description="mine", link=link, is_system=False)
    unrelated = Todo(description="other", link="/elsewhere", is_system=True)
    db.add_all([personal, unrelated])
    await db.flush()
    system = (
        await db.execute(select(Todo).where(Todo.link == link, Todo.is_system.is_(True)))
    ).scalar_one()

    op = {"op": "delete_risk", "risk_id": str(risk.id), "detail": "R-1"}
    assert await apply(db, op) == ok(op)
    await db.flush()
    assert propagated == [(risk.id, {"deleted": True, "actor_user_id": None})]
    assert not await exists(db, Risk, risk.id)
    assert not await exists(db, Todo, system.id)
    assert await exists(db, Todo, personal.id)
    assert await exists(db, Todo, unrelated.id)


async def test_delete_risk_that_is_gone(db, propagated):
    for op in ({"op": "delete_risk", "risk_id": GHOST}, {"op": "delete_risk"}):
        assert await apply(db, op) == skipped(op, "risk_not_found")
    assert propagated == []


async def test_unlink_risk_card(db):
    card = await create_card(db, name="App")
    risk = await risk_service.create_risk(db, title="R", card_ids=[card.id], actor_id=None)
    op = {"op": "unlink_risk_card", "risk_id": str(risk.id), "card_id": str(card.id)}
    assert await apply(db, op) == ok(op)
    await db.flush()
    rows = await db.execute(select(RiskCard).where(RiskCard.risk_id == risk.id))
    assert rows.scalars().all() == []
    assert await apply(db, op) == skipped(op, "already_unlinked")
    for bad in (
        {"op": "unlink_risk_card", "card_id": str(card.id)},
        {"op": "unlink_risk_card", "risk_id": str(risk.id)},
    ):
        assert await apply(db, bad) == skipped(bad, "missing_target")


@pytest.fixture
def owner_synced(monkeypatch):
    calls = []

    async def fake(db, risk, *, actor_id, previous_owner):
        calls.append({"risk": risk.id, "actor_id": actor_id, "previous_owner": previous_owner})

    monkeypatch.setattr(risk_service, "sync_owner_todo", fake)
    return calls


async def test_restore_risk_fields(db, propagated, owner_synced):
    old_owner = await create_user(db, email="old@test.com", role="member")
    new_owner = await create_user(db, email="new@test.com", role="member")
    risk = await risk_service.create_risk(
        db,
        title="Now",
        card_ids=[],
        owner_id=new_owner.id,
        initial_probability="low",
        initial_impact="low",
        actor_id=None,
    )
    risk.status = "in_progress"
    risk.residual_probability, risk.residual_impact = "low", "low"
    await db.flush()
    owner_synced.clear()
    propagated.clear()
    op = {
        "op": "restore_risk_fields",
        "risk_id": str(risk.id),
        "fields": {
            "title": "Before",
            "initial_probability": "very_high",
            "initial_impact": "critical",
            "residual_probability": None,
            "owner_id": str(old_owner.id),
            "target_resolution_date": "2026-05-06T00:00:00",
            "status": "identified",
            "reference": "R-999999",  # not restorable: ignored
        },
    }
    result = await apply(db, op)
    assert result == {
        **op,
        "status": "ok",
        "restored": [
            "title",
            "initial_probability",
            "initial_impact",
            "residual_probability",
            "owner_id",
            "target_resolution_date",
            "status",
        ],
    }
    assert risk.title == "Before"
    assert risk.owner_id == old_owner.id
    assert str(risk.target_resolution_date) == "2026-05-06"
    assert risk.reference != "R-999999"
    assert risk.initial_level == "critical"  # re-derived
    assert risk.residual_level is None  # one half missing
    assert owner_synced == [{"risk": risk.id, "actor_id": None, "previous_owner": new_owner.id}]
    assert propagated == [(risk.id, {"actor_user_id": None})]  # the status moved


async def test_restore_risk_fields_without_a_status_change_leaves_findings(
    db, propagated, owner_synced
):
    risk = await risk_service.create_risk(db, title="Now", card_ids=[], actor_id=None)
    propagated.clear()
    op = {"op": "restore_risk_fields", "risk_id": str(risk.id), "fields": {"title": "Before"}}
    assert (await apply(db, op))["restored"] == ["title"]
    assert propagated == []
    assert owner_synced[-1]["previous_owner"] is None


async def test_restore_risk_fields_falls_back_to_a_medium_initial_level(
    db, propagated, owner_synced
):
    """A stored value outside the level matrix derives no level; the initial
    level is not nullable, so it reads medium rather than failing the flush."""
    risk = await risk_service.create_risk(db, title="Now", card_ids=[], actor_id=None)
    op = {
        "op": "restore_risk_fields",
        "risk_id": str(risk.id),
        "fields": {"initial_probability": "legacy"},
    }
    await apply(db, op)
    assert risk.initial_probability == "legacy"
    assert risk.initial_level == "medium"


async def test_restore_risk_fields_of_a_risk_that_is_gone(db, owner_synced):
    op = {"op": "restore_risk_fields", "risk_id": GHOST, "fields": {"title": "x"}}
    assert await apply(db, op) == skipped(op, "risk_not_found")
    assert owner_synced == []


# ── stakeholders ────────────────────────────────────────────────────────────


@pytest.fixture
async def holding(db):
    card = await create_card(db, name="App")
    user = await create_user(db, email="holder@test.com", role="member")
    return card, user


def st_op(name, card, user, role="owner", **extra):
    return {
        "op": name,
        "card_id": str(card.id),
        "stakeholder_user_id": str(user.id),
        "role": role,
        **extra,
    }


async def stakeholders(db, card):
    rows = await db.execute(select(Stakeholder).where(Stakeholder.card_id == card.id))
    return sorted((s.user_id, s.role) for s in rows.scalars().all())


@pytest.mark.parametrize("name", ["remove_stakeholder", "assign_stakeholder"])
async def test_stakeholder_ops_need_a_card_a_user_and_a_role(db, holding, rescored, name):
    card, user = holding
    for bad in (
        {**st_op(name, card, user), "card_id": None},
        {**st_op(name, card, user), "stakeholder_user_id": "nope"},
        {**st_op(name, card, user), "role": ""},
    ):
        assert await apply(db, bad) == skipped(bad, "missing_target")
    assert rescored == []


async def test_remove_stakeholder(db, holding, rescored):
    card, user = holding
    db.add(Stakeholder(card_id=card.id, user_id=user.id, role="owner"))
    db.add(Stakeholder(card_id=card.id, user_id=user.id, role="observer"))
    await db.flush()
    op = st_op("remove_stakeholder", card, user)
    assert await apply(db, op) == ok(op)
    assert await stakeholders(db, card) == [(user.id, "observer")]
    assert rescored == [("stakeholder", card.id)]
    assert await apply(db, op) == skipped(op, "already_removed")


async def test_assign_stakeholder(db, holding, rescored):
    card, user = holding
    op = st_op("assign_stakeholder", card, user)
    assert await apply(db, op) == ok(op)
    assert await stakeholders(db, card) == [(user.id, "owner")]
    assert rescored == [("stakeholder", card.id)]
    assert await apply(db, op) == skipped(op, "already_assigned")


async def test_assign_stakeholder_to_a_missing_card_or_user(db, holding, rescored):
    card, user = holding
    gone_card = {**st_op("assign_stakeholder", card, user), "card_id": GHOST}
    assert await apply(db, gone_card) == skipped(gone_card, "card_not_found")
    gone_user = {**st_op("assign_stakeholder", card, user), "stakeholder_user_id": GHOST}
    assert await apply(db, gone_user) == skipped(gone_user, "user_not_found")
    assert await stakeholders(db, card) == []
    assert rescored == []


async def test_restore_stakeholder_role(db, holding, rescored):
    card, user = holding
    db.add(Stakeholder(card_id=card.id, user_id=user.id, role="reviewer"))
    await db.flush()
    op = st_op("restore_stakeholder_role", card, user, role="reviewer", old_role="owner")
    assert await apply(db, op) == ok(op)
    assert await stakeholders(db, card) == [(user.id, "owner")]
    assert rescored == [("stakeholder", card.id)]
    assert await apply(db, op) == skipped(op, "assignment_not_found")


async def test_restore_stakeholder_role_needs_the_old_role(db, holding, rescored):
    card, user = holding
    db.add(Stakeholder(card_id=card.id, user_id=user.id, role="reviewer"))
    await db.flush()
    for bad in (
        st_op("restore_stakeholder_role", card, user, role="reviewer"),
        st_op("restore_stakeholder_role", card, user, role="reviewer", old_role=""),
        {**st_op("restore_stakeholder_role", card, user, old_role="owner"), "card_id": "x"},
    ):
        assert await apply(db, bad) == skipped(bad, "missing_target")
    assert await stakeholders(db, card) == [(user.id, "reviewer")]
    assert rescored == []


# ── tags ────────────────────────────────────────────────────────────────────


@pytest.fixture
async def tagging(db):
    card = await create_card(db, name="App")
    group = TagGroup(name="G")
    db.add(group)
    await db.flush()
    tag = Tag(tag_group_id=group.id, name="T")
    db.add(tag)
    await db.flush()
    return card, tag


async def card_tags(db, card):
    rows = await db.execute(select(CardTag.tag_id).where(CardTag.card_id == card.id))
    return list(rows.scalars().all())


@pytest.mark.parametrize("name", ["remove_card_tag", "add_card_tag"])
async def test_tag_ops_need_a_card_and_a_tag(db, tagging, rescored, name):
    card, tag = tagging
    for bad in (
        {"op": name, "card_id": str(card.id)},
        {"op": name, "tag_id": str(tag.id)},
        {"op": name, "card_id": "x", "tag_id": str(tag.id)},
    ):
        assert await apply(db, bad) == skipped(bad, "missing_target")
    assert rescored == []


async def test_remove_card_tag(db, tagging, rescored):
    card, tag = tagging
    db.add(CardTag(card_id=card.id, tag_id=tag.id))
    await db.flush()
    op = {"op": "remove_card_tag", "card_id": str(card.id), "tag_id": str(tag.id)}
    assert await apply(db, op) == ok(op)
    assert await card_tags(db, card) == []
    assert rescored == [("cards", [card.id])]
    assert await apply(db, op) == skipped(op, "already_removed")


async def test_add_card_tag(db, tagging, rescored):
    card, tag = tagging
    op = {"op": "add_card_tag", "card_id": str(card.id), "tag_id": str(tag.id)}
    assert await apply(db, op) == ok(op)
    assert await card_tags(db, card) == [tag.id]
    assert rescored == [("cards", [card.id])]
    assert await apply(db, op) == skipped(op, "already_tagged")


async def test_add_card_tag_to_a_missing_card_or_tag(db, tagging, rescored):
    card, tag = tagging
    gone_card = {"op": "add_card_tag", "card_id": GHOST, "tag_id": str(tag.id)}
    assert await apply(db, gone_card) == skipped(gone_card, "card_not_found")
    gone_tag = {"op": "add_card_tag", "card_id": str(card.id), "tag_id": GHOST}
    assert await apply(db, gone_tag) == skipped(gone_tag, "tag_not_found")
    assert rescored == []


# ── decisions, todos, surveys ───────────────────────────────────────────────


async def test_delete_adr(db):
    draft = ArchitectureDecision(reference_number="ADR-901", title="Draft")
    signed = ArchitectureDecision(reference_number="ADR-902", title="Signed", status="signed")
    db.add_all([draft, signed])
    await db.flush()
    op = {"op": "delete_adr", "adr_id": str(draft.id)}
    assert await apply(db, op) == ok(op)
    await db.flush()
    assert not await exists(db, ArchitectureDecision, draft.id)
    assert await apply(db, op) == skipped(op, "already_deleted")
    keep = {"op": "delete_adr", "adr_id": str(signed.id)}
    assert await apply(db, keep) == skipped(keep, "adr_not_draft")
    assert await exists(db, ArchitectureDecision, signed.id)
    for bad in ({"op": "delete_adr"}, {"op": "delete_adr", "adr_id": "x"}):
        assert await apply(db, bad) == skipped(bad, "missing_adr_id")


async def test_delete_todo(db):
    open_todo = Todo(description="open")
    system = Todo(description="system", is_system=True)
    done = Todo(description="done", status="done")
    db.add_all([open_todo, system, done])
    await db.flush()
    op = {"op": "delete_todo", "todo_id": str(open_todo.id)}
    assert await apply(db, op) == ok(op)
    await db.flush()
    assert not await exists(db, Todo, open_todo.id)
    assert await apply(db, op) == skipped(op, "already_deleted")
    for todo, reason in ((system, "todo_is_system"), (done, "already_completed")):
        keep = {"op": "delete_todo", "todo_id": str(todo.id)}
        assert await apply(db, keep) == skipped(keep, reason)
        assert await exists(db, Todo, todo.id)
    for bad in ({"op": "delete_todo"}, {"op": "delete_todo", "todo_id": "x"}):
        assert await apply(db, bad) == skipped(bad, "missing_todo_id")


async def test_close_survey(db):
    card = await create_card(db, name="App")
    u1 = await create_user(db, email="u1@test.com", role="member")
    u2 = await create_user(db, email="u2@test.com", role="member")
    survey = Survey(name="S", target_type_key="Application", status="active")
    db.add(survey)
    await db.flush()
    pending = SurveyResponse(survey_id=survey.id, card_id=card.id, user_id=u1.id)
    answered = SurveyResponse(
        survey_id=survey.id, card_id=card.id, user_id=u2.id, status="completed"
    )
    db.add_all([pending, answered])
    await db.flush()

    before = datetime.now(timezone.utc)
    op = {"op": "close_survey", "survey_id": str(survey.id)}
    assert await apply(db, op) == ok(op)
    assert survey.status == "closed"
    assert before <= survey.closed_at <= datetime.now(timezone.utc)
    left = await db.execute(select(SurveyResponse.id).where(SurveyResponse.survey_id == survey.id))
    assert list(left.scalars().all()) == [answered.id]
    assert await apply(db, op) == skipped(op, "already_closed")
    gone = {"op": "close_survey", "survey_id": GHOST}
    assert await apply(db, gone) == skipped(gone, "not_found")
    for bad in ({"op": "close_survey"}, {"op": "close_survey", "survey_id": "x"}):
        assert await apply(db, bad) == skipped(bad, "missing_survey_id")


# ── conflicts ───────────────────────────────────────────────────────────────


async def open_batch(db, actor, tool="t", *, after=None):
    batch = MutationBatch(tool_name=tool, actor_user_id=actor.id, dry_run=False)
    db.add(batch)
    await db.flush()
    if after is not None:
        batch.created_at = after.created_at + timedelta(seconds=1)
        await db.flush()
    return batch


async def add_event(db, batch, event_type, data, card_id=None, *, at=None):
    event = Event(event_type=event_type, data=data, card_id=card_id, batch_id=batch.id)
    db.add(event)
    await db.flush()
    if at is not None:
        event.created_at = at
        await db.flush()
    return event


async def test_conflicts_are_later_batches_touching_our_entities(db, actor):
    ours = await open_batch(db, actor, "ours")
    await add_event(db, ours, "card.updated", {"id": "c-1"})
    await add_event(db, ours, "relation.created", {"id": "r-1"})
    later = await open_batch(db, actor, "later", after=ours)
    await add_event(db, later, "card.updated", {"id": "c-1"})
    await add_event(db, later, "relation.deleted", {"id": "r-1"})
    await add_event(db, later, "relation.created", {"id": "c-1"})  # same id, other kind
    await add_event(db, later, "comment.added", {"id": "c-1"})  # no entity
    unrelated = await open_batch(db, actor, "unrelated", after=ours)
    await add_event(db, unrelated, "card.updated", {"id": "c-9"})
    earlier = MutationBatch(tool_name="earlier", actor_user_id=actor.id, dry_run=False)
    db.add(earlier)
    await db.flush()
    earlier.created_at = ours.created_at - timedelta(seconds=1)
    await db.flush()
    await add_event(db, earlier, "card.updated", {"id": "c-1"})

    events = await rs._batch_events(db, ours)
    assert await rs._find_conflicting_batches(db, ours, events) == [
        {
            "batch_id": str(later.id),
            "tool_name": "later",
            "created_at": later.created_at.isoformat(),
            "touched_entities": ["c-1", "r-1"],
        }
    ]


async def test_a_batch_touching_nothing_has_no_conflicts(db, actor):
    ours = await open_batch(db, actor)
    await add_event(db, ours, "comment.added", {})
    later = await open_batch(db, actor, after=ours)
    await add_event(db, later, "card.updated", {"id": "c-1"})
    events = await rs._batch_events(db, ours)
    assert await rs._find_conflicting_batches(db, ours, events) == []


# ── entry points ────────────────────────────────────────────────────────────


async def test_events_are_read_newest_first(db, actor):
    batch = await open_batch(db, actor)
    now = datetime.now(timezone.utc)
    first = await add_event(db, batch, "card.updated", {"id": "a"}, at=now)
    second = await add_event(db, batch, "card.updated", {"id": "b"}, at=now + timedelta(seconds=1))
    other = await open_batch(db, actor)
    await add_event(db, other, "card.updated", {"id": "z"})
    assert [e.id for e in await rs._batch_events(db, batch)] == [second.id, first.id]


async def test_plan_rollback(db, actor):
    batch = await open_batch(db, actor)
    card = await create_card(db, name="App")
    now = datetime.now(timezone.utc)
    created = await add_event(db, batch, "card.created", {"id": str(card.id)}, card.id, at=now)
    comment = await add_event(
        db, batch, "comment.added", {}, card.id, at=now + timedelta(seconds=1)
    )
    plan = await rs.plan_rollback(db, batch)
    assert plan == {
        "batch": rs.batch_to_dict(batch),
        "operations": [{"event_id": str(created.id), "op": "delete_card", "card_id": str(card.id)}],
        "unsupported_events": [
            {
                "event_id": str(comment.id),
                "op": "unsupported",
                "event_type": "comment.added",
                "reason": rs._unsupported(comment)["reason"],
            }
        ],
        "event_count": 2,
    }


@pytest.fixture
def published(monkeypatch):
    calls = []

    async def fake(event_type, data, db=None, card_id=None, user_id=None, batch_id=None):
        calls.append({"type": event_type, "data": data, "batch_id": batch_id, "db": db})

    monkeypatch.setattr(rs.event_bus, "publish", fake)
    return calls


async def test_execute_rollback(db, actor, published):
    batch = await open_batch(db, actor)
    card = await create_card(db, name="Made")
    now = datetime.now(timezone.utc)
    created = await add_event(db, batch, "card.created", {"id": str(card.id)}, card.id, at=now)
    gone = await add_event(
        db, batch, "card.archived", {"id": GHOST}, None, at=now + timedelta(seconds=1)
    )
    comment = await add_event(
        db, batch, "comment.added", {}, card.id, at=now + timedelta(seconds=2)
    )

    before = datetime.now(timezone.utc)
    result = await rs.execute_rollback(db, batch, actor.id)
    await db.flush()

    unsupported = rs._unsupported(comment)
    restore = {"event_id": str(gone.id), "op": "restore_card", "card_id": GHOST}
    delete = {"event_id": str(created.id), "op": "delete_card", "card_id": str(card.id)}
    expected_results = [unsupported, skipped(restore, "card_not_found"), ok(delete)]
    rollback_id = uuid.UUID(result["rollback_batch_id"])
    assert result == {
        "rollback_batch_id": str(rollback_id),
        "reversed_batch_id": str(batch.id),
        "forced": False,
        "results": expected_results,
    }
    assert not await exists(db, Card, card.id)

    rollback = (
        await db.execute(select(MutationBatch).where(MutationBatch.id == rollback_id))
    ).scalar_one()
    assert (rollback.tool_name, rollback.origin, rollback.dry_run) == (
        "rollback_batch",
        "api",
        False,
    )
    assert rollback.actor_user_id == actor.id
    assert rollback.committed_at is not None and rollback.committed_at >= before
    assert rollback.summary == {
        "reverses_batch_id": str(batch.id),
        "forced": False,
        "results": expected_results,
    }
    # one event per applied op, none for the unsupported one
    assert published == [
        {
            "type": "rollback.restore_card",
            "data": {**restore, "outcome": "skipped"},
            "batch_id": rollback_id,
            "db": db,
        },
        {
            "type": "rollback.delete_card",
            "data": {**delete, "outcome": "ok"},
            "batch_id": rollback_id,
            "db": db,
        },
    ]


async def test_execute_rollback_follows_the_callers_origin(db, actor, published):
    batch = await open_batch(db, actor)
    token = request_origin.set("mcp")
    try:
        result = await rs.execute_rollback(db, batch, actor.id)
    finally:
        request_origin.reset(token)
    rollback = (
        await db.execute(
            select(MutationBatch).where(MutationBatch.id == uuid.UUID(result["rollback_batch_id"]))
        )
    ).scalar_one()
    assert rollback.origin == "mcp"
    assert result["results"] == []


async def test_a_conflict_refuses_unless_forced(db, actor, published):
    batch = await open_batch(db, actor)
    card = await create_card(db, name="App")
    await add_event(db, batch, "card.updated", {"id": str(card.id), "changes": {}}, card.id)
    later = await open_batch(db, actor, "later", after=batch)
    await add_event(db, later, "card.updated", {"id": str(card.id)}, card.id)

    with pytest.raises(HTTPException) as exc:
        await rs.execute_rollback(db, batch, actor.id)
    assert exc.value.status_code == 409
    assert exc.value.detail == {
        "error": "rollback_conflict",
        "message": (
            "The batch you are trying to roll back was followed by other batches that "
            "modified the same entities. Pass force=true to override and accept the "
            "data loss."
        ),
        "conflicting_batches": [
            {
                "batch_id": str(later.id),
                "tool_name": "later",
                "created_at": later.created_at.isoformat(),
                "touched_entities": [str(card.id)],
            }
        ],
    }
    assert published == []

    forced = await rs.execute_rollback(db, batch, actor.id, force=True)
    assert forced["forced"] is True
    rollback = (
        await db.execute(
            select(MutationBatch).where(MutationBatch.id == uuid.UUID(forced["rollback_batch_id"]))
        )
    ).scalar_one()
    assert rollback.summary["forced"] is True
