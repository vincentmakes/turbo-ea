"""``survey_service.resolve_targets``: which cards a survey's filters reach,
and who is asked about each.

The send path's own tests (``test_survey_service.py``) cover activation; this
file pins the filters one by one — every attribute operator, tags, related
cards, explicit card ids — and the shape of a target entry.
"""

from __future__ import annotations

import pytest

from app.models.stakeholder import Stakeholder
from app.models.survey import Survey
from app.models.tag import CardTag, Tag, TagGroup
from app.services import survey_service
from tests.conftest import (
    create_card,
    create_card_type,
    create_relation,
    create_relation_type,
    create_user,
)


@pytest.fixture
async def cards(db):
    await create_card_type(db, key="Application", label="Application")
    await create_card_type(db, key="ITComponent", label="IT Component")
    made = {
        "c10": await create_card(
            db, name="C10", attributes={"cost": 10, "risk": "low", "note": "Payroll system"}
        ),
        "c20": await create_card(
            db, name="C20", attributes={"cost": 20, "risk": "high", "note": ""}
        ),
        "c30": await create_card(db, name="C30", attributes={"cost": 30}),
        "bare": await create_card(db, name="Bare", attributes={}),
    }
    # Never reached: archived, or another type.
    await create_card(db, name="Gone", status="ARCHIVED", attributes={"cost": 10, "risk": "low"})
    await create_card(db, card_type="ITComponent", name="Other", attributes={"risk": "low"})
    return made


async def _matched(db, filters, *, target_type="Application"):
    survey = Survey(
        name="S",
        message="m",
        target_type_key=target_type,
        target_filters=filters,
        target_roles=[],
        fields=[],
    )
    db.add(survey)
    await db.flush()
    _, matched = await survey_service.resolve_targets(db, survey)
    return {c.name for c in matched}


ALL = {"C10", "C20", "C30", "Bare"}


@pytest.mark.parametrize(
    ("attribute_filter", "expected"),
    [
        ({"key": "risk", "op": "eq", "value": "low"}, {"C10"}),
        ({"key": "risk", "value": "low"}, {"C10"}),  # eq is the default
        ({"key": "cost", "op": "eq", "value": 20}, {"C20"}),  # compared as text
        # "Not equals" includes the cards with no value at all.
        ({"key": "risk", "op": "ne", "value": "low"}, {"C20", "C30", "Bare"}),
        ({"key": "cost", "op": "gt", "value": 10}, {"C20", "C30"}),
        ({"key": "cost", "op": "gte", "value": "20"}, {"C20", "C30"}),
        ({"key": "cost", "op": "lt", "value": 20}, {"C10"}),
        ({"key": "cost", "op": "lte", "value": 20.0}, {"C10", "C20"}),
        ({"key": "cost", "op": "gt", "value": "abc"}, ALL),  # not a number: skipped
        ({"key": "note", "op": "contains", "value": "PAYROLL"}, {"C10"}),  # case-insensitive
        ({"key": "note", "op": "contains", "value": "roll sys"}, {"C10"}),
        ({"key": "note", "op": "is_empty"}, {"C20", "C30", "Bare"}),
        ({"key": "note", "op": "is_not_empty"}, {"C10"}),
        ({"key": "risk", "op": "eq", "value": None}, ALL),  # no value: skipped
        ({"key": "", "op": "eq", "value": "low"}, ALL),  # no key: skipped
        ({"op": "eq", "value": "low"}, ALL),
        ({"key": "risk", "op": "between", "value": "low"}, ALL),  # unknown op: skipped
    ],
)
async def test_attribute_filter(db, cards, attribute_filter, expected):
    assert await _matched(db, {"attribute_filters": [attribute_filter]}) == expected


async def test_attribute_filters_are_combined(db, cards):
    filters = {
        "attribute_filters": [
            {"key": "cost", "op": "gte", "value": 10},
            {"key": "risk", "op": "is_not_empty"},
            {"key": "cost", "op": "lt", "value": 15},
        ]
    }
    assert await _matched(db, filters) == {"C10"}


async def test_a_skipped_filter_does_not_stop_the_next_one(db, cards):
    filters = {
        "attribute_filters": [
            {"key": "", "value": "x"},
            {"key": "cost", "op": "gt", "value": "abc"},
            {"key": "risk", "value": "high"},
        ]
    }
    assert await _matched(db, filters) == {"C20"}


async def test_no_filters_reach_every_active_card_of_the_type(db, cards):
    assert await _matched(db, {}) == ALL
    assert await _matched(db, None) == ALL


async def test_card_ids_narrow_within_the_type(db, cards):
    filters = {"card_ids": [str(cards["c10"].id), str(cards["c30"].id)]}
    assert await _matched(db, filters) == {"C10", "C30"}


async def test_tag_ids_keep_tagged_cards(db, cards):
    group = TagGroup(name="Scope")
    db.add(group)
    await db.flush()
    in_scope = Tag(tag_group_id=group.id, name="In scope")
    unused = Tag(tag_group_id=group.id, name="Unused")
    db.add_all([in_scope, unused])
    await db.flush()
    db.add(CardTag(card_id=cards["c20"].id, tag_id=in_scope.id))
    await db.flush()
    assert await _matched(db, {"tag_ids": [str(in_scope.id)]}) == {"C20"}
    assert await _matched(db, {"tag_ids": [str(unused.id)]}) == set()


class TestRelatedIds:
    @pytest.fixture
    async def related(self, db, cards):
        await create_relation_type(
            db, key="owns", source_type_key="Application", target_type_key="ITComponent"
        )
        await create_relation_type(
            db, key="uses", source_type_key="Application", target_type_key="ITComponent"
        )
        await create_relation_type(
            db, key="feeds", source_type_key="ITComponent", target_type_key="Application"
        )
        hub = await create_card(db, card_type="ITComponent", name="Hub")
        await create_relation(db, type_key="owns", source_id=cards["c10"].id, target_id=hub.id)
        await create_relation(db, type_key="uses", source_id=cards["c20"].id, target_id=hub.id)
        await create_relation(db, type_key="feeds", source_id=hub.id, target_id=cards["c30"].id)
        return hub

    async def test_either_end_counts(self, db, cards, related):
        assert await _matched(db, {"related_ids": [str(related.id)]}) == {"C10", "C20", "C30"}

    async def test_a_relation_type_narrows_both_directions(self, db, cards, related):
        hub = str(related.id)
        assert await _matched(db, {"related_ids": [hub], "relation_type_key": "owns"}) == {"C10"}
        assert await _matched(db, {"related_ids": [hub], "relation_type_key": "feeds"}) == {"C30"}


class TestTargets:
    async def test_one_entry_per_card_and_user_with_sorted_roles(self, db, cards):
        alice = await create_user(db, email="alice@test.com", display_name="Alice")
        bob = await create_user(db, email="bob@test.com", display_name="Bob")
        c10 = cards["c10"]
        db.add_all(
            [
                Stakeholder(card_id=c10.id, user_id=alice.id, role="technical_owner"),
                Stakeholder(card_id=c10.id, user_id=alice.id, role="business_owner"),
                Stakeholder(card_id=c10.id, user_id=bob.id, role="observer"),
            ]
        )
        survey = Survey(
            name="S",
            message="m",
            target_type_key="Application",
            target_filters={"card_ids": [str(c10.id)]},
            target_roles=["business_owner", "technical_owner"],
            fields=[],
        )
        db.add(survey)
        await db.flush()

        targets, matched = await survey_service.resolve_targets(db, survey)

        assert [c.id for c in matched] == [c10.id]
        assert targets == [
            {
                "card_id": str(c10.id),
                "card_name": "C10",
                "card_type": "Application",
                "users": [
                    {
                        "user_id": str(alice.id),
                        "display_name": "Alice",
                        "email": "alice@test.com",
                        "roles": ["business_owner", "technical_owner"],
                    }
                ],
            }
        ]

    async def test_no_roles_means_every_stakeholder(self, db, cards):
        alice = await create_user(db, email="alice@test.com")
        bob = await create_user(db, email="bob@test.com")
        c20 = cards["c20"]
        db.add_all(
            [
                Stakeholder(card_id=c20.id, user_id=alice.id, role="responsible"),
                Stakeholder(card_id=c20.id, user_id=bob.id, role="observer"),
            ]
        )
        survey = Survey(
            name="S",
            message="m",
            target_type_key="Application",
            target_filters={"card_ids": [str(c20.id)]},
            target_roles=[],
            fields=[],
        )
        db.add(survey)
        await db.flush()
        targets, _ = await survey_service.resolve_targets(db, survey)
        assert {u["email"] for u in targets[0]["users"]} == {"alice@test.com", "bob@test.com"}

    async def test_nothing_matched_returns_two_empty_lists(self, db, cards):
        survey = Survey(
            name="S",
            message="m",
            target_type_key="Application",
            target_filters={"attribute_filters": [{"key": "risk", "value": "none"}]},
            target_roles=[],
            fields=[],
        )
        db.add(survey)
        await db.flush()
        assert await survey_service.resolve_targets(db, survey) == ([], [])
