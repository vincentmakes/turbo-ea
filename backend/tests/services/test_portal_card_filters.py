"""A card-list portal's preset filters as SQL (``services/portal_card_filters.py``).

Each case states which cards of a small landscape a preset keeps, mirroring
what ``matchesStaticFilters`` (``portfolioHelpers.ts``) keeps for the same
``CardFilterValue`` in the portfolio reports. Integration tests requiring a
PostgreSQL test database; the pure helpers at the bottom need none.
"""

from __future__ import annotations

import uuid
from types import SimpleNamespace

import pytest
from sqlalchemy import select

from app.models.card import Card
from app.models.tag import CardTag, Tag, TagGroup
from app.services import portal_card_filters as pcf
from app.services.portal_card_filters import (
    EMPTY_KEY,
    has_active_card_filters,
    normalise_card_filters,
    parse_side_key,
    preset_conditions,
    public_filters,
)
from tests.conftest import create_card, create_card_type, create_relation, create_relation_type

FIELDS = [
    {
        "section": "Main",
        "fields": [
            {"key": "criticality", "type": "single_select", "options": [{"key": "high"}]},
            {"key": "regions", "type": "multiple_select", "options": [{"key": "eu"}]},
            {"key": "cloud", "type": "boolean"},
            {"key": "code", "type": "text"},
        ],
    }
]


def _cf(**kwargs) -> dict:
    """A ``filters`` blob holding a card_filters value with ``kwargs`` set."""
    value = {
        "subtypeFilters": [],
        "attrFilters": {},
        "relationFilters": {},
        "relSubtypeFilters": {},
        "tagFilterIds": [],
        "includeDescendants": False,
    }
    value.update(kwargs)
    return {"card_filters": value}


async def _names(db, filters, card_type="Application") -> set[str]:
    conditions = await preset_conditions(db, card_type, filters)
    rows = await db.execute(
        select(Card.name).where(Card.type == card_type, Card.status == "ACTIVE", *conditions)
    )
    return set(rows.scalars().all())


@pytest.fixture
async def land(db):
    """Five applications, two organisations (one a child of the other), an
    IT component, two relation types to Organization, a self-referencing
    Application type and two tag groups."""
    await create_card_type(db, key="Application", fields_schema=FIELDS)
    await create_card_type(db, key="Organization", has_hierarchy=True)
    await create_card_type(db, key="ITComponent")
    await create_relation_type(
        db,
        key="orgOwnsApp",
        source_type_key="Organization",
        target_type_key="Application",
    )
    await create_relation_type(
        db,
        key="orgUsesApp",
        source_type_key="Organization",
        target_type_key="Application",
        attributes_schema=[{"key": "usage", "type": "single_select"}],
    )
    await create_relation_type(
        db, key="appToItc", source_type_key="Application", target_type_key="ITComponent"
    )
    await create_relation_type(
        db, key="appCallsApp", source_type_key="Application", target_type_key="Application"
    )

    corp = await create_card(db, card_type="Organization", name="Corp")
    team = await create_card(db, card_type="Organization", name="Team", parent_id=corp.id)
    gone = await create_card(db, card_type="Organization", name="Gone", status="ARCHIVED")
    itc = await create_card(db, card_type="ITComponent", name="DB")

    alpha = await create_card(
        db,
        name="Alpha",
        subtype="business",
        approval_status="APPROVED",
        attributes={"criticality": "high", "regions": ["eu", "us"], "cloud": True, "code": "A"},
    )
    beta = await create_card(
        db,
        name="Beta",
        subtype="micro",
        attributes={"criticality": "low", "regions": "eu", "cloud": "Yes"},
    )
    gamma = await create_card(
        db, name="Gamma", subtype="", attributes={"cloud": "no", "regions": []}
    )
    delta = await create_card(db, name="Delta", attributes={"criticality": "", "cloud": "maybe"})
    epsilon = await create_card(db, name="Epsilon", subtype="micro", attributes={"cloud": False})
    await create_card(db, name="Archived", status="ARCHIVED", subtype="business")

    await create_relation(
        db, type_key="orgOwnsApp", source_id=corp.id, target_id=alpha.id, attributes={}
    )
    await create_relation(
        db,
        type_key="orgUsesApp",
        source_id=team.id,
        target_id=beta.id,
        attributes={"usage": "daily"},
    )
    await create_relation(
        db, type_key="orgUsesApp", source_id=corp.id, target_id=gamma.id, attributes={}
    )
    await create_relation(db, type_key="orgOwnsApp", source_id=gone.id, target_id=delta.id)
    await create_relation(db, type_key="appToItc", source_id=epsilon.id, target_id=itc.id)
    await create_relation(db, type_key="appCallsApp", source_id=alpha.id, target_id=beta.id)

    domain = TagGroup(name="Domain")
    tier = TagGroup(name="Tier")
    db.add_all([domain, tier])
    await db.flush()
    finance = Tag(tag_group_id=domain.id, name="Finance")
    sales = Tag(tag_group_id=domain.id, name="Sales")
    gold = Tag(tag_group_id=tier.id, name="Gold")
    db.add_all([finance, sales, gold])
    await db.flush()
    db.add_all(
        [
            CardTag(card_id=alpha.id, tag_id=finance.id),
            CardTag(card_id=alpha.id, tag_id=gold.id),
            CardTag(card_id=beta.id, tag_id=sales.id),
            CardTag(card_id=gamma.id, tag_id=gold.id),
        ]
    )
    await db.flush()
    return SimpleNamespace(
        corp=corp,
        team=team,
        gone=gone,
        itc=itc,
        alpha=alpha,
        beta=beta,
        gamma=gamma,
        delta=delta,
        epsilon=epsilon,
        finance=finance,
        sales=sales,
        gold=gold,
    )


ALL = {"Alpha", "Beta", "Gamma", "Delta", "Epsilon"}


class TestNoPreset:
    @pytest.mark.parametrize("filters", [None, {}, "junk", _cf()])
    async def test_everything_active_is_kept(self, db, land, filters):
        assert await _names(db, filters) == ALL


class TestSubtype:
    async def test_picked_subtypes(self, db, land):
        assert await _names(db, _cf(subtypeFilters=["micro"])) == {"Beta", "Epsilon"}

    async def test_empty_matches_none_and_blank(self, db, land):
        assert await _names(db, _cf(subtypeFilters=[EMPTY_KEY])) == {"Gamma", "Delta"}

    async def test_real_and_empty_together(self, db, land):
        assert await _names(db, _cf(subtypeFilters=["business", EMPTY_KEY])) == {
            "Alpha",
            "Gamma",
            "Delta",
        }


class TestAttributes:
    async def test_single_select(self, db, land):
        assert await _names(db, _cf(attrFilters={"criticality": ["high"]})) == {"Alpha"}

    async def test_single_select_empty_is_absent_or_blank(self, db, land):
        assert await _names(db, _cf(attrFilters={"criticality": [EMPTY_KEY]})) == {
            "Gamma",
            "Delta",
            "Epsilon",
        }

    async def test_multiple_select_matches_a_list_member_or_a_scalar(self, db, land):
        assert await _names(db, _cf(attrFilters={"regions": ["eu"]})) == {"Alpha", "Beta"}

    async def test_multiple_select_empty_includes_an_empty_list(self, db, land):
        assert await _names(db, _cf(attrFilters={"regions": [EMPTY_KEY]})) == {
            "Gamma",
            "Delta",
            "Epsilon",
        }

    async def test_boolean_true_reads_legacy_strings(self, db, land):
        assert await _names(db, _cf(attrFilters={"cloud": ["true"]})) == {"Alpha", "Beta"}

    async def test_boolean_false_reads_legacy_strings(self, db, land):
        assert await _names(db, _cf(attrFilters={"cloud": ["false"]})) == {"Gamma", "Epsilon"}

    async def test_boolean_empty_is_anything_unreadable(self, db, land):
        assert await _names(db, _cf(attrFilters={"cloud": [EMPTY_KEY]})) == {"Delta"}

    async def test_boolean_unknown_value_matches_nothing(self, db, land):
        assert await _names(db, _cf(attrFilters={"cloud": ["maybe"]})) == set()

    async def test_non_facet_field_is_a_plain_comparison(self, db, land):
        assert await _names(db, _cf(attrFilters={"code": ["A"]})) == {"Alpha"}

    async def test_fields_are_anded(self, db, land):
        filters = _cf(attrFilters={"regions": ["eu"], "cloud": ["true"], "criticality": ["low"]})
        assert await _names(db, filters) == {"Beta"}


class TestRelations:
    async def test_card_type_key_is_any_relation_to_that_type(self, db, land):
        filters = _cf(relationFilters={"Organization": [str(land.corp.id)]})
        assert await _names(db, filters) == {"Alpha", "Gamma"}

    async def test_relation_type_key_is_that_relation_only(self, db, land):
        filters = _cf(relationFilters={"orgUsesApp": [str(land.corp.id)]})
        assert await _names(db, filters) == {"Gamma"}

    async def test_an_archived_far_end_does_not_count(self, db, land):
        filters = _cf(relationFilters={"Organization": [str(land.gone.id)]})
        assert await _names(db, filters) == set()

    async def test_empty_is_no_relation_to_an_active_card_of_that_type(self, db, land):
        filters = _cf(relationFilters={"Organization": [EMPTY_KEY]})
        assert await _names(db, filters) == {"Delta", "Epsilon"}

    async def test_empty_on_a_relation_type(self, db, land):
        filters = _cf(relationFilters={"orgOwnsApp": [EMPTY_KEY]})
        assert await _names(db, filters) == {"Beta", "Gamma", "Delta", "Epsilon"}

    async def test_real_or_empty(self, db, land):
        filters = _cf(relationFilters={"ITComponent": [str(land.itc.id), EMPTY_KEY]})
        assert await _names(db, filters) == ALL

    async def test_keys_are_anded(self, db, land):
        filters = _cf(
            relationFilters={
                "Organization": [str(land.corp.id)],
                "orgOwnsApp": [str(land.corp.id)],
            }
        )
        assert await _names(db, filters) == {"Alpha"}

    async def test_include_sub_cards_widens_a_pick(self, db, land):
        picked = {"Organization": [str(land.corp.id)]}
        assert await _names(db, _cf(relationFilters=picked)) == {"Alpha", "Gamma"}
        widened = _cf(relationFilters=picked, includeDescendants=True)
        assert await _names(db, widened) == {"Alpha", "Beta", "Gamma"}

    async def test_include_sub_cards_keeps_the_empty_pick(self, db, land):
        filters = _cf(
            relationFilters={"orgUsesApp": [str(land.corp.id), EMPTY_KEY]},
            includeDescendants=True,
        )
        assert await _names(db, filters) == {"Alpha", "Beta", "Gamma", "Delta", "Epsilon"}

    async def test_self_type_sides(self, db, land):
        outgoing = _cf(relationFilters={"appCallsApp__out": [str(land.beta.id)]})
        incoming = _cf(relationFilters={"appCallsApp__in": [str(land.alpha.id)]})
        either = _cf(relationFilters={"appCallsApp": [str(land.alpha.id), str(land.beta.id)]})
        assert await _names(db, outgoing) == {"Alpha"}
        assert await _names(db, incoming) == {"Beta"}
        assert await _names(db, either) == {"Alpha", "Beta"}

    async def test_self_type_side_empty(self, db, land):
        filters = _cf(relationFilters={"appCallsApp__out": [EMPTY_KEY]})
        assert await _names(db, filters) == ALL - {"Alpha"}

    async def test_malformed_ids_are_dropped(self, db, land):
        assert await _names(db, _cf(relationFilters={"Organization": ["nope"]})) == ALL


class TestRelationSubtypes:
    async def test_picked_value(self, db, land):
        filters = _cf(relSubtypeFilters={"orgUsesApp::usage": ["daily"]})
        assert await _names(db, filters) == {"Beta"}

    async def test_empty_is_a_relation_without_a_value(self, db, land):
        filters = _cf(relSubtypeFilters={"orgUsesApp::usage": [EMPTY_KEY]})
        assert await _names(db, filters) == {"Gamma"}

    @pytest.mark.parametrize("composite", ["orgUsesApp", "orgUsesApp::", "unknown::usage"])
    async def test_unusable_keys_are_ignored(self, db, land, composite):
        filters = _cf(relSubtypeFilters={composite: ["daily"]})
        assert await _names(db, filters) == ALL


class TestTags:
    async def test_or_within_a_group(self, db, land):
        filters = _cf(tagFilterIds=[str(land.finance.id), str(land.sales.id)])
        assert await _names(db, filters) == {"Alpha", "Beta"}

    async def test_and_across_groups(self, db, land):
        filters = _cf(tagFilterIds=[str(land.sales.id), str(land.gold.id)])
        assert await _names(db, filters) == set()
        filters = _cf(tagFilterIds=[str(land.finance.id), str(land.gold.id)])
        assert await _names(db, filters) == {"Alpha"}

    async def test_unknown_and_malformed_tags_are_ignored(self, db, land):
        filters = _cf(tagFilterIds=["nope", str(uuid.uuid4())])
        assert await _names(db, filters) == ALL


class TestLegacyAndApproval:
    async def test_legacy_subtypes_and_tags_still_apply(self, db, land):
        filters = {"subtypes": ["business", "micro"], "tag_ids": [str(land.gold.id)]}
        assert await _names(db, filters) == {"Alpha"}

    async def test_legacy_tags_are_any_tag_across_groups(self, db, land):
        filters = {"tag_ids": [str(land.sales.id), str(land.gold.id)]}
        assert await _names(db, filters) == {"Alpha", "Beta", "Gamma"}

    async def test_a_malformed_legacy_tag_list_is_ignored_whole(self, db, land):
        filters = {"tag_ids": [str(land.gold.id), "nope"]}
        assert await _names(db, filters) == ALL

    async def test_card_filters_replace_the_legacy_keys(self, db, land):
        filters = {"subtypes": ["business"], **_cf(subtypeFilters=["micro"])}
        assert await _names(db, filters) == {"Beta", "Epsilon"}

    async def test_approval_applies_in_both_shapes(self, db, land):
        assert await _names(db, {"approval_statuses": ["APPROVED"]}) == {"Alpha"}
        filters = {"approval_statuses": ["APPROVED"], **_cf(subtypeFilters=["micro"])}
        assert await _names(db, filters) == set()


class TestDescendantIds:
    async def test_every_depth_and_none_for_no_roots(self, db, land):
        leaf = await create_card(db, card_type="Organization", name="Leaf", parent_id=land.team.id)
        assert await pcf.descendant_ids(db, [land.corp.id]) == {land.team.id, leaf.id}
        assert await pcf.descendant_ids(db, []) == set()


# ---------------------------------------------------------------------------
# Pure helpers
# ---------------------------------------------------------------------------


class TestNormalise:
    def test_not_an_object(self):
        assert normalise_card_filters(None) is None
        assert normalise_card_filters(["x"]) is None

    def test_drops_whatever_is_malformed(self):
        raw = {
            "subtypeFilters": ["a", 3, None],
            "attrFilters": {"k": ["v", 1], "empty": [], "bad": "v", 4: ["x"]},
            "relationFilters": "nope",
            "relSubtypeFilters": {"r::f": ["x"]},
            "tagFilterIds": "t",
            "includeDescendants": "yes",
            "unknown": 1,
        }
        assert normalise_card_filters(raw) == {
            "subtypeFilters": ["a"],
            "attrFilters": {"k": ["v"]},
            "relationFilters": {},
            "relSubtypeFilters": {"r::f": ["x"]},
            "tagFilterIds": [],
            "includeDescendants": False,
        }

    def test_include_descendants_must_be_true_itself(self):
        assert normalise_card_filters({"includeDescendants": True})["includeDescendants"] is True


class TestActive:
    @pytest.mark.parametrize(
        "value",
        [
            None,
            {},
            normalise_card_filters({}),
            normalise_card_filters({"includeDescendants": True}),
        ],
    )
    def test_inactive(self, value):
        assert has_active_card_filters(value) is False

    @pytest.mark.parametrize(
        "key,picked",
        [
            ("subtypeFilters", ["a"]),
            ("attrFilters", {"k": ["v"]}),
            ("relationFilters", {"T": ["id"]}),
            ("relSubtypeFilters", {"r::f": ["v"]}),
            ("tagFilterIds", ["t"]),
        ],
    )
    def test_any_pick_is_active(self, key, picked):
        assert has_active_card_filters({**normalise_card_filters({}), key: picked}) is True


class TestPublicFilters:
    def test_card_filters_never_reach_a_visitor(self):
        stored = {"approval_statuses": ["APPROVED"], **_cf(subtypeFilters=["a"])}
        assert public_filters(stored) == {"approval_statuses": ["APPROVED"]}
        assert "card_filters" in stored, "the stored blob is not mutated"

    @pytest.mark.parametrize("value", [None, {}, {"subtypes": ["a"]}, "junk"])
    def test_everything_else_passes_unchanged(self, value):
        assert public_filters(value) is value


class TestParseSideKey:
    @pytest.mark.parametrize(
        "key,expected",
        [
            ("rel", ("rel", None)),
            ("rel__out", ("rel", True)),
            ("rel__in", ("rel", False)),
            ("rel__inner", ("rel__inner", None)),
            ("__in", ("", False)),
        ],
    )
    def test_cases(self, key, expected):
        assert parse_side_key(key) == expected


class TestFieldTypes:
    def test_reads_every_section_and_skips_junk(self):
        schema = [
            "junk",
            {"fields": [{"key": "a", "type": "boolean"}, {"key": 3}, "x"]},
            {"fields": None},
            {"fields": [{"key": "a", "type": "text"}, {"key": "b"}]},
        ]
        assert pcf._field_types(schema) == {"a": "boolean", "b": ""}
        assert pcf._field_types(None) == {}
