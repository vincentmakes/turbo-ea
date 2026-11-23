"""``card_approval`` pinned to exact values.

``test_card_approval.py`` covers the rule and the shape of the fan-out; these
pin what each piece produces in full — the fields that break an approval, the
wording and payload of both notification forms, what delivery hands to the
notification service, and the ``card.updated`` events the child cascade owes —
because the nightly mutation run showed those were the values no test compared.
"""

from __future__ import annotations

import uuid

import pytest
from fastapi import BackgroundTasks

from app.models.stakeholder import Stakeholder
from app.services import card_approval, notification_service
from app.services.card_lifecycle import ChildStrategyResult
from tests.conftest import create_card, create_card_type, create_user

BREAKING = [
    "name",
    "description",
    "lifecycle",
    "lifecycle_stage",
    "attributes",
    "subtype",
    "alias",
    "parent_id",
    "parent_label",
]


@pytest.fixture
async def env(db):
    await create_card_type(db, key="Application", label="Application", has_hierarchy=True)
    editor = await create_user(db, email="editor@test.com", role="admin")
    owner = await create_user(db, email="owner@test.com", role="member")
    other = await create_user(db, email="other@test.com", role="member")
    return {"editor": editor, "owner": owner, "other": other}


async def hold(db, card, user, role="responsible"):
    db.add(Stakeholder(card_id=card.id, user_id=user.id, role=role))
    await db.flush()


# ── the rule ────────────────────────────────────────────────────────────────


def test_the_breaking_fields_are_exactly_these():
    assert card_approval.STATUS_BREAKING_FIELDS == frozenset(BREAKING)


def test_the_constants():
    assert card_approval.APPROVAL_BROKEN_LINK == (
        "/inventory?approval_status=BROKEN&mine=stakeholder"
    )
    assert card_approval.NOTIF_TYPE == "approval_status_changed"
    assert card_approval._MAX_LISTED_CARDS == 50


def test_the_change_entry_is_a_fresh_dict_each_time():
    first = card_approval.approval_change_entry()
    assert first == {"old": "APPROVED", "new": "BROKEN"}
    first["new"] = "mutated"
    assert card_approval.approval_change_entry() == {"old": "APPROVED", "new": "BROKEN"}


@pytest.mark.parametrize("field", BREAKING)
async def test_each_breaking_field_breaks_an_approval_on_its_own(db, env, field):
    card = await create_card(db, name="A", approval_status="APPROVED")
    assert card_approval.break_approval(card, [field]) is True
    assert card.approval_status == "BROKEN"


async def test_breaking_reads_any_iterable_of_fields(db, env):
    card = await create_card(db, name="A", approval_status="APPROVED")
    assert card_approval.break_approval(card, iter(["data_quality", "alias"])) is True


async def test_no_field_breaks_nothing(db, env):
    card = await create_card(db, name="A", approval_status="APPROVED")
    assert card_approval.break_approval(card, []) is False
    assert card.approval_status == "APPROVED"


# ── the two notification forms ──────────────────────────────────────────────


def test_the_single_card_entry():
    card_id = uuid.uuid4()
    assert card_approval._single_card_entry(card_id, "CRM", "Ada") == {
        "title": "Approval broken",
        "message": 'Ada changed "CRM" — its approval is no longer valid',
        "link": f"/cards/{card_id}",
        "card_id": card_id,
        "data": {
            "approval_status": "BROKEN",
            "previous_approval_status": "APPROVED",
            "action": "broken",
            "card_count": 1,
            "card_ids": [str(card_id)],
        },
    }


async def test_a_single_broken_card_gets_the_single_card_entry(db, env):
    owner = env["owner"]
    card = await create_card(db, name="Solo", approval_status="BROKEN")
    await hold(db, card, owner)
    got = await card_approval.build_approval_broken_recipients(
        db, cards=[card], actor_id=env["editor"].id, actor_display_name="Ada"
    )
    assert got == [
        {"user_id": owner.id, **card_approval._single_card_entry(card.id, "Solo", "Ada")}
    ]


async def test_several_broken_cards_get_one_aggregated_entry(db, env):
    owner = env["owner"]
    b = await create_card(db, name="Beta", approval_status="BROKEN")
    a = await create_card(db, name="Alpha", approval_status="BROKEN")
    for card in (b, a):
        await hold(db, card, owner)
    got = await card_approval.build_approval_broken_recipients(
        db, cards=[b, a], actor_id=env["editor"].id, actor_display_name="Ada"
    )
    assert got == [
        {
            "user_id": owner.id,
            "title": "2 cards need re-approval",
            "message": (
                "Ada changed 2 cards you are a stakeholder on — their approval is no longer valid"
            ),
            "link": "/inventory?approval_status=BROKEN&mine=stakeholder",
            "data": {
                "approval_status": "BROKEN",
                "previous_approval_status": "APPROVED",
                "action": "broken",
                "card_count": 2,
                # by name, not by the order the cards were passed in
                "card_ids": [str(a.id), str(b.id)],
            },
            "email_items": [
                {"label": "Alpha", "link": f"/cards/{a.id}"},
                {"label": "Beta", "link": f"/cards/{b.id}"},
            ],
            "email_items_title": "Cards needing re-approval",
        }
    ]


async def test_each_person_gets_their_own_cards(db, env):
    owner, other = env["owner"], env["other"]
    a = await create_card(db, name="A", approval_status="BROKEN")
    b = await create_card(db, name="B", approval_status="BROKEN")
    await hold(db, a, owner)
    await hold(db, b, owner)
    await hold(db, b, other)
    got = await card_approval.build_approval_broken_recipients(
        db, cards=[a, b], actor_id=None, actor_display_name="Ada"
    )
    by_user = {r["user_id"]: r for r in got}
    assert set(by_user) == {owner.id, other.id}
    assert by_user[owner.id]["data"]["card_count"] == 2
    assert by_user[other.id]["card_id"] == b.id


async def test_several_people_with_one_card_each_all_get_theirs(db, env):
    owner, other = env["owner"], env["other"]
    a = await create_card(db, name="A", approval_status="BROKEN")
    b = await create_card(db, name="B", approval_status="BROKEN")
    await hold(db, a, owner)
    await hold(db, b, other)
    got = await card_approval.build_approval_broken_recipients(
        db, cards=[a, b], actor_id=None, actor_display_name="Ada"
    )
    assert sorted((r["user_id"], r["card_id"]) for r in got) == sorted(
        [(owner.id, a.id), (other.id, b.id)]
    )


async def test_a_held_card_that_did_not_break_is_not_mentioned(db, env):
    owner = env["owner"]
    broken = await create_card(db, name="Broken", approval_status="BROKEN")
    fine = await create_card(db, name="Fine", approval_status="APPROVED")
    await hold(db, broken, owner)
    await hold(db, fine, owner)
    got = await card_approval.build_approval_broken_recipients(
        db, cards=[broken], actor_id=None, actor_display_name="Ada"
    )
    assert [r["card_id"] for r in got] == [broken.id]


async def test_no_actor_drops_nobody(db, env):
    editor = env["editor"]
    card = await create_card(db, name="Solo", approval_status="BROKEN")
    await hold(db, card, editor)
    got = await card_approval.build_approval_broken_recipients(
        db, cards=[card], actor_id=None, actor_display_name="System"
    )
    assert [r["user_id"] for r in got] == [editor.id]


async def test_the_actor_is_dropped_but_others_on_the_same_card_are_not(db, env):
    editor, owner = env["editor"], env["owner"]
    card = await create_card(db, name="Solo", approval_status="BROKEN")
    await hold(db, card, editor)
    await hold(db, card, owner)
    got = await card_approval.build_approval_broken_recipients(
        db, cards=[card], actor_id=editor.id, actor_display_name="Ada"
    )
    assert [r["user_id"] for r in got] == [owner.id]


async def test_exactly_the_cap_is_listed(db, env):
    owner = env["owner"]
    cap = card_approval._MAX_LISTED_CARDS
    cards = [
        await create_card(db, name=f"App {i:03d}", approval_status="BROKEN") for i in range(cap)
    ]
    for card in cards:
        await hold(db, card, owner)
    (entry,) = await card_approval.build_approval_broken_recipients(
        db, cards=cards, actor_id=None, actor_display_name="Ada"
    )
    assert entry["data"]["card_ids"] == [str(c.id) for c in cards]
    assert [i["label"] for i in entry["email_items"]] == [c.name for c in cards]


# ── delivery ────────────────────────────────────────────────────────────────


def recipient(user_id, **extra):
    return {
        "user_id": user_id,
        "title": "T",
        "message": "M",
        "link": "/x",
        "data": {"k": 1},
        "card_id": None,
        **extra,
    }


async def test_with_background_tasks_delivery_is_deferred_to_the_batch(db, env):
    tasks = BackgroundTasks()
    recipients = [recipient(env["owner"].id)]
    await card_approval.deliver_approval_broken(
        db, recipients, actor_id=env["editor"].id, background_tasks=tasks
    )
    (task,) = tasks.tasks
    assert task.func is notification_service.deliver_notification_batch
    assert task.args == (recipients,)
    assert task.kwargs == {"notif_type": "approval_status_changed", "actor_id": env["editor"].id}


async def test_without_background_tasks_each_row_is_created_inline(db, env, monkeypatch):
    calls = []

    async def fake(db_arg, **kwargs):
        calls.append((db_arg, kwargs))

    monkeypatch.setattr(notification_service, "create_notification", fake)
    card_id = uuid.uuid4()
    first = recipient(
        env["owner"].id,
        card_id=card_id,
        email_items=[{"label": "x"}],  # understood by the batch path only
        email_items_title="ignored",
    )
    second = {"user_id": env["other"].id, "title": "T2", "message": "M2"}
    actor = env["editor"].id
    await card_approval.deliver_approval_broken(db, [first, second], actor_id=actor)
    assert calls == [
        (
            db,
            {
                "user_id": env["owner"].id,
                "notif_type": "approval_status_changed",
                "title": "T",
                "message": "M",
                "link": "/x",
                "data": {"k": 1},
                "card_id": card_id,
                "actor_id": actor,
            },
        ),
        (
            db,
            {
                "user_id": env["other"].id,
                "notif_type": "approval_status_changed",
                "title": "T2",
                "message": "M2",
                "link": None,
                "data": None,
                "card_id": None,
                "actor_id": actor,
            },
        ),
    ]


async def test_nothing_to_deliver_schedules_nothing(db, env, monkeypatch):
    async def boom(*a, **k):
        raise AssertionError("delivered")

    monkeypatch.setattr(notification_service, "create_notification", boom)
    tasks = BackgroundTasks()
    await card_approval.deliver_approval_broken(db, [], actor_id=None, background_tasks=tasks)
    await card_approval.deliver_approval_broken(db, [], actor_id=None)
    assert tasks.tasks == []


async def test_the_single_card_wrapper_builds_then_delivers(db, env):
    owner, editor = env["owner"], env["editor"]
    card = await create_card(db, name="Solo", approval_status="BROKEN")
    await hold(db, card, editor)  # the actor: never told about their own edit
    await hold(db, card, owner)
    tasks = BackgroundTasks()
    await card_approval.notify_approval_broken(
        db, card=card, actor_id=editor.id, actor_display_name="Ada", background_tasks=tasks
    )
    (task,) = tasks.tasks
    assert task.args == (
        [{"user_id": owner.id, **card_approval._single_card_entry(card.id, "Solo", "Ada")}],
    )
    assert task.kwargs == {"notif_type": "approval_status_changed", "actor_id": editor.id}


async def test_the_single_card_wrapper_delivers_inline_without_tasks(db, env, monkeypatch):
    seen = []

    async def fake(db_arg, **kwargs):
        seen.append(kwargs["user_id"])

    monkeypatch.setattr(notification_service, "create_notification", fake)
    card = await create_card(db, name="Solo", approval_status="BROKEN")
    await hold(db, card, env["owner"])
    await card_approval.notify_approval_broken(
        db, card=card, actor_id=env["editor"].id, actor_display_name="Ada"
    )
    assert seen == [env["owner"].id]


# ── the child cascade ───────────────────────────────────────────────────────


@pytest.fixture
def published(monkeypatch):
    calls = []

    async def fake(event_type, data, db=None, card_id=None, user_id=None, batch_id=None):
        calls.append(
            {"type": event_type, "data": data, "db": db, "card_id": card_id, "user_id": user_id}
        )

    monkeypatch.setattr(card_approval.event_bus, "publish", fake)
    return calls


@pytest.fixture
def delivered(monkeypatch):
    calls = []

    async def fake(db, recipients, *, actor_id, background_tasks=None):
        calls.append(
            {"db": db, "recipients": recipients, "actor_id": actor_id, "tasks": background_tasks}
        )

    monkeypatch.setattr(card_approval, "deliver_approval_broken", fake)
    return calls


def result(**fields):
    return ChildStrategyResult(strategy="disconnect", **fields)


async def test_each_moved_child_gets_its_event(db, env, published, delivered):
    editor = env["editor"]
    old_parent = await create_card(db, name="Old parent")
    new_parent = await create_card(db, name="New parent")
    moved = await create_card(db, name="Moved", parent_id=new_parent.id)
    orphan = await create_card(db, name="Orphan")
    await card_approval.record_child_strategy_effects(
        db,
        results=[
            result(
                disconnected_ids=[moved.id, orphan.id],
                previous_parent_ids={moved.id: old_parent.id, orphan.id: None},
            )
        ],
        actor_id=editor.id,
        actor_display_name="Ada",
    )
    expected = {
        moved.id: {"parent_id": {"old": str(old_parent.id), "new": str(new_parent.id)}},
        orphan.id: {"parent_id": {"old": None, "new": None}},
    }
    assert published == [
        {
            "type": "card.updated",
            "data": {"id": str(cid), "changes": expected[cid]},
            "db": db,
            "card_id": cid,
            "user_id": editor.id,
        }
        for cid in sorted(expected, key=str)
    ]
    # nothing broke, so nobody is owed a re-review
    assert delivered == [
        {"db": db, "recipients": [], "actor_id": editor.id, "tasks": None},
    ]


async def test_a_cleared_label_and_a_break_are_recorded_with_the_move(
    db, env, published, delivered
):
    owner = env["owner"]
    child = await create_card(db, name="Child", approval_status="BROKEN")
    await hold(db, child, owner)
    tasks = BackgroundTasks()
    await card_approval.record_child_strategy_effects(
        db,
        results=[
            result(
                disconnected_ids=[child.id],
                approval_broken_ids=[child.id],
                previous_parent_labels={child.id: "subsidiary"},
            )
        ],
        actor_id=None,
        actor_display_name="Ada",
        background_tasks=tasks,
    )
    assert published[0]["data"]["changes"] == {
        "parent_id": {"old": None, "new": None},
        "parent_label": {"old": "subsidiary", "new": None},
        "approval_status": {"old": "APPROVED", "new": "BROKEN"},
    }
    assert published[0]["user_id"] is None
    assert delivered == [
        {
            "db": db,
            "recipients": [
                {"user_id": owner.id, **card_approval._single_card_entry(child.id, "Child", "Ada")}
            ],
            "actor_id": None,
            "tasks": tasks,
        }
    ]


async def test_results_from_several_strategies_are_merged(db, env, published, delivered):
    a = await create_card(db, name="A")
    b = await create_card(db, name="B")
    await card_approval.record_child_strategy_effects(
        db,
        results=[result(disconnected_ids=[a.id]), result(disconnected_ids=[b.id])],
        actor_id=None,
        actor_display_name="Ada",
    )
    assert sorted(p["card_id"] for p in published) == sorted([a.id, b.id])


async def test_a_removed_child_gets_no_event_and_no_notification(db, env, published, delivered):
    owner = env["owner"]
    kept = await create_card(db, name="Kept", approval_status="BROKEN")
    gone = await create_card(db, name="Gone", approval_status="BROKEN")
    for card in (kept, gone):
        await hold(db, card, owner)
    await card_approval.record_child_strategy_effects(
        db,
        results=[
            result(disconnected_ids=[kept.id, gone.id], approval_broken_ids=[kept.id, gone.id])
        ],
        actor_id=None,
        actor_display_name="Ada",
        removed_ids=frozenset({gone.id}),
    )
    assert [p["card_id"] for p in published] == [kept.id]
    (call,) = delivered
    assert [r["card_id"] for r in call["recipients"]] == [kept.id]


async def test_an_archived_child_keeps_its_event_but_is_not_notified(db, env, published, delivered):
    owner = env["owner"]
    kept = await create_card(db, name="Kept", approval_status="BROKEN")
    shelved = await create_card(db, name="Shelved", approval_status="BROKEN")
    for card in (kept, shelved):
        await hold(db, card, owner)
    await card_approval.record_child_strategy_effects(
        db,
        results=[
            result(
                disconnected_ids=[kept.id, shelved.id], approval_broken_ids=[kept.id, shelved.id]
            )
        ],
        actor_id=None,
        actor_display_name="Ada",
        archived_ids=frozenset({shelved.id}),
    )
    assert sorted(p["card_id"] for p in published) == sorted([kept.id, shelved.id])
    assert [r["card_id"] for r in delivered[0]["recipients"]] == [kept.id]


async def test_a_child_no_longer_active_is_not_notified(db, env, published, delivered):
    owner = env["owner"]
    child = await create_card(db, name="Archived", approval_status="BROKEN", status="ARCHIVED")
    await hold(db, child, owner)
    await card_approval.record_child_strategy_effects(
        db,
        results=[result(disconnected_ids=[child.id], approval_broken_ids=[child.id])],
        actor_id=None,
        actor_display_name="Ada",
    )
    assert [p["card_id"] for p in published] == [child.id]
    assert delivered[0]["recipients"] == []


async def test_a_child_that_no_longer_exists_is_skipped(db, env, published, delivered):
    real = await create_card(db, name="Real")
    ghost = uuid.UUID(int=1)  # sorts before every real id, so it is met first
    await card_approval.record_child_strategy_effects(
        db,
        results=[result(disconnected_ids=[real.id, ghost], approval_broken_ids=[ghost])],
        actor_id=None,
        actor_display_name="Ada",
    )
    assert [p["card_id"] for p in published] == [real.id]
    assert delivered[0]["recipients"] == []


async def test_nothing_touched_records_nothing(db, env, published, delivered):
    gone = await create_card(db, name="Gone")
    await card_approval.record_child_strategy_effects(
        db,
        results=[result(disconnected_ids=[gone.id], approval_broken_ids=[gone.id])],
        actor_id=None,
        actor_display_name="Ada",
        removed_ids=frozenset({gone.id}),
    )
    await card_approval.record_child_strategy_effects(
        db, results=[], actor_id=None, actor_display_name="Ada"
    )
    assert published == [] and delivered == []


async def test_the_cascade_never_notifies_the_actor(db, env, published, delivered):
    editor, owner = env["editor"], env["owner"]
    child = await create_card(db, name="Child", approval_status="BROKEN")
    await hold(db, child, editor)
    await hold(db, child, owner)
    await card_approval.record_child_strategy_effects(
        db,
        results=[result(disconnected_ids=[child.id], approval_broken_ids=[child.id])],
        actor_id=editor.id,
        actor_display_name="Ada",
    )
    assert [r["user_id"] for r in delivered[0]["recipients"]] == [owner.id]
