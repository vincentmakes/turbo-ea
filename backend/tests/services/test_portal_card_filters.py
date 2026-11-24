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
from sqlalchemy.dialects import postgresql
from sqlalchemy.orm import aliased

from app.models.card import Card
from app.models.tag import TagGroup
from app.services import portal_card_filters as pcf
from app.services.portal_card_filters import (
    EMPTY_KEY,
    has_active_card_filters,
    normalise_card_filters,
    parse_side_key,
    preset_conditions,
    public_filters,
)
from tests.conftest import (
    create_card,
    create_card_type,
    create_relation,
    create_relation_type,
    create_tag,
    create_tag_group,
)

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

    domain = await create_tag_group(db, name="Domain")
    tier = await create_tag_group(db, name="Tier")
    finance = await create_tag(db, group=domain, name="Finance", cards=[alpha])
    sales = await create_tag(db, group=domain, name="Sales", cards=[beta])
    gold = await create_tag(db, group=tier, name="Gold", cards=[alpha, gamma])
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

    async def test_boolean_empty_includes_no_value_at_all(self, db, land):
        await create_card(db, name="Zeta", attributes={})
        assert await _names(db, _cf(attrFilters={"cloud": [EMPTY_KEY]})) == {"Delta", "Zeta"}

    async def test_single_select_stored_as_a_list_still_matches(self, db, land):
        """Legacy data; the report reads a list on any field (``rawValues``)."""
        await create_card(db, name="Eta", attributes={"criticality": ["high"]})
        assert await _names(db, _cf(attrFilters={"criticality": ["high"]})) == {"Alpha", "Eta"}

    async def test_a_card_type_with_no_row_does_not_fail(self, db, land):
        assert await _names(db, _cf(attrFilters={"k": ["v"]}), card_type="Ghost") == set()

    async def test_boolean_unknown_value_matches_nothing(self, db, land):
        assert await _names(db, _cf(attrFilters={"cloud": ["maybe"]})) == set()

    async def test_non_facet_field_is_a_plain_comparison(self, db, land):
        assert await _names(db, _cf(attrFilters={"code": ["A"]})) == {"Alpha"}

    async def test_fields_are_anded(self, db, land):
        filters = _cf(attrFilters={"regions": ["eu"], "cloud": ["true"], "criticality": ["low"]})
        assert await _names(db, filters) == {"Beta"}


# ---------------------------------------------------------------------------
# Text / number / date conditions (``attrConditions``, #1425)
# ---------------------------------------------------------------------------
#
# The same edge cases are pinned on the browser's matcher
# (``frontend/src/lib/fieldFilters.test.ts``): numeric text counts as a
# number, a JSON boolean / list never does, a number longer than 40
# characters or with a three-digit exponent is not read, an impossible
# calendar date compares as its text, the needle is ASCII.

GADGET_FIELDS = [
    {
        "section": "Main",
        "fields": [
            {"key": "code", "type": "text"},
            {"key": "notes", "type": "multiline_text"},
            {"key": "site", "type": "url"},
            {"key": "n", "type": "number"},
            {"key": "pct", "type": "percentage"},
            {"key": "price", "type": "cost"},
            {"key": "due", "type": "date"},
            {"key": "crit", "type": "single_select", "options": [{"key": "high"}]},
        ],
    }
]

GADGETS = {
    "Alpha": {
        "code": "ORG-12",
        "notes": "Line one\nLine two",
        "site": "https://alpha.example",
        "n": 12.5,
        "pct": 50,
        "price": 100,
        "due": "2026-01-01",
        "crit": "high",
    },
    "Beta": {"code": "org-120", "n": "12.5", "pct": 49.5, "due": "2026-12-31T10:00:00Z"},
    "Gamma": {"code": 12345, "n": "abc", "due": "2026-13-45"},
    "Delta": {"code": ["ORG-12"], "n": [12], "due": ["2026-06-01"]},
    "Eps": {"code": True, "n": True, "due": "01/02/2026"},
    "Zeta": {"code": None, "n": None, "due": None},
    "Eta": {},
    "Theta": {"code": "100%", "n": "1" * 500},
    "Iota": {"code": "a_b", "n": "1e999999"},
    "Kappa": {"code": "a\\b", "n": "1e2", "due": "2025-12-31"},
    "Lambda": {"code": "axb", "n": "-.5", "due": "2026-06-01 noon"},
    "Mu": {"n": "9e99"},
    "Nu": {"n": "1" * 40},
    "Xi": {"n": "1" * 41},
    "Omicron": {"n": "9e100"},
}
ALL_GADGETS = set(GADGETS)


@pytest.fixture
async def gadgets(db):
    await create_card_type(db, key="Gadget", fields_schema=GADGET_FIELDS)
    for name, attributes in GADGETS.items():
        await create_card(db, card_type="Gadget", name=name, attributes=attributes)


async def _gadgets(db, conditions) -> set[str]:
    return await _names(db, _cf(attrConditions=conditions), card_type="Gadget")


class TestTextConditions:
    async def test_contains_is_case_insensitive_on_strings_and_numbers(self, db, gadgets):
        assert await _gadgets(db, {"code": {"contains": "org-12"}}) == {"Alpha", "Beta"}
        assert await _gadgets(db, {"code": {"contains": "234"}}) == {"Gamma"}

    async def test_the_needle_is_trimmed(self, db, gadgets):
        assert await _gadgets(db, {"code": {"contains": "  ORG-120 "}}) == {"Beta"}

    async def test_a_list_or_a_boolean_never_matches(self, db, gadgets):
        assert await _gadgets(db, {"code": {"contains": "tru"}}) == set()
        assert await _gadgets(db, {"code": {"contains": "["}}) == set()

    @pytest.mark.parametrize(
        "needle,expected",
        [("%", {"Theta"}), ("_", {"Iota"}), ("a_b", {"Iota"}), ("\\", {"Kappa"})],
    )
    async def test_wildcards_are_literal(self, db, gadgets, needle, expected):
        assert await _gadgets(db, {"code": {"contains": needle}}) == expected

    async def test_multiline_and_url_fields_are_text(self, db, gadgets):
        assert await _gadgets(db, {"notes": {"contains": "line TWO"}}) == {"Alpha"}
        assert await _gadgets(db, {"site": {"contains": "example"}}) == {"Alpha"}


NUMERIC = {"Alpha", "Beta", "Kappa", "Lambda", "Mu", "Nu"}


class TestNumberConditions:
    async def test_only_plain_decimals_are_numbers(self, db, gadgets):
        """``"abc"``, a list, ``true``, null, a 500-digit text, a 41-character
        text and a three-digit exponent are not numbers; a 40-character one
        and a two-digit exponent are."""
        assert await _gadgets(db, {"n": {"min": -1e99}}) == NUMERIC
        assert await _gadgets(db, {"n": {"max": 1e101}}) == NUMERIC

    async def test_bounds_are_inclusive(self, db, gadgets):
        assert await _gadgets(db, {"n": {"min": 12.5, "max": 12.5}}) == {"Alpha", "Beta"}
        assert await _gadgets(db, {"n": {"min": 12.5, "max": 100}}) == {"Alpha", "Beta", "Kappa"}

    async def test_only_min(self, db, gadgets):
        assert await _gadgets(db, {"n": {"min": 12.6}}) == {"Kappa", "Mu", "Nu"}

    async def test_only_max(self, db, gadgets):
        assert await _gadgets(db, {"n": {"max": 12.4}}) == {"Lambda"}
        assert await _gadgets(db, {"n": {"max": -0.5}}) == {"Lambda"}
        assert await _gadgets(db, {"n": {"max": -0.6}}) == set()

    async def test_percentage_is_a_number(self, db, gadgets):
        assert await _gadgets(db, {"pct": {"min": 50}}) == {"Alpha"}
        assert await _gadgets(db, {"pct": {"max": 49.5}}) == {"Beta"}


class TestDateConditions:
    async def test_from(self, db, gadgets):
        """A time suffix is read by its day; an impossible date compares as
        its text; a list, a malformed date and a date followed by junk do not
        count."""
        assert await _gadgets(db, {"due": {"from": "2026-01-01"}}) == {"Alpha", "Beta", "Gamma"}

    async def test_to(self, db, gadgets):
        assert await _gadgets(db, {"due": {"to": "2026-01-01"}}) == {"Alpha", "Kappa"}

    async def test_both_bounds_are_inclusive(self, db, gadgets):
        assert await _gadgets(db, {"due": {"from": "2026-01-02", "to": "2026-12-31"}}) == {"Beta"}
        assert await _gadgets(db, {"due": {"from": "2026-01-01", "to": "2026-12-30"}}) == {"Alpha"}


class TestConditionsThatDoNotApply:
    @pytest.mark.parametrize(
        "conditions",
        [
            {"price": {"min": 0}},  # a portal never filters on costs
            {"code": {"min": 1}},  # a number condition on a text field
            {"n": {"contains": "1"}},  # a text condition on a number field
            {"due": {"min": 1}},
            {"n": {"from": "2026-01-01"}},
            {"crit": {"contains": "high"}},  # a select is a facet, not text
            {"ghost": {"contains": "x"}},  # a field the type does not have
            {"code": {"contains": "x", "min": 1}},  # two shapes at once
            {"code": {"contains": "   "}},
        ],
    )
    async def test_skipped(self, db, gadgets, conditions):
        assert await _gadgets(db, conditions) == ALL_GADGETS

    async def test_conditions_are_anded(self, db, gadgets):
        conditions = {"code": {"contains": "org"}, "n": {"min": 12.5}, "pct": {"max": 49.5}}
        assert await _gadgets(db, conditions) == {"Beta"}

    def test_condition_clause_reads_the_given_entity(self):
        other = aliased(Card, name="cond_other")
        clause = pcf.condition_clause("code", {"contains": "x"}, "text", card=other)
        assert "cond_other" in str(clause.compile(dialect=postgresql.dialect()))
        assert pcf.condition_clause("code", {"contains": "x"}, None) is None


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

    async def test_a_relation_type_the_card_is_the_source_of(self, db, land):
        filters = _cf(relationFilters={"appToItc": [str(land.itc.id)]})
        assert await _names(db, filters) == {"Epsilon"}

    async def test_a_hidden_relation_type_key_reads_as_a_card_type(self, db, land):
        """The report's payload leaves hidden types out, so their key falls to
        the card-type branch — which no card type answers to."""
        from app.models.relation_type import RelationType

        rt = (
            await db.execute(select(RelationType).where(RelationType.key == "orgUsesApp"))
        ).scalar_one()
        rt.is_hidden = True
        await db.flush()
        filters = _cf(relationFilters={"orgUsesApp": [str(land.corp.id)]})
        assert await _names(db, filters) == set()
        assert await _names(db, _cf(relationFilters={"orgUsesApp": [EMPTY_KEY]})) == ALL

    async def test_malformed_ids_are_dropped(self, db, land):
        assert await _names(db, _cf(relationFilters={"Organization": ["nope"]})) == ALL


class TestRelationSubtypes:
    async def test_picked_value(self, db, land):
        filters = _cf(relSubtypeFilters={"orgUsesApp::usage": ["daily"]})
        assert await _names(db, filters) == {"Beta"}

    async def test_empty_is_a_relation_without_a_value(self, db, land):
        filters = _cf(relSubtypeFilters={"orgUsesApp::usage": [EMPTY_KEY]})
        assert await _names(db, filters) == {"Gamma"}

    async def test_a_relation_the_card_is_the_source_of(self, db, land):
        await create_relation_type(
            db,
            key="appRunsOn",
            source_type_key="Application",
            target_type_key="ITComponent",
            attributes_schema=[{"key": "env", "type": "single_select"}],
        )
        await create_relation(
            db,
            type_key="appRunsOn",
            source_id=land.epsilon.id,
            target_id=land.itc.id,
            attributes={"env": "prod"},
        )
        filters = _cf(relSubtypeFilters={"appRunsOn::env": ["prod"]})
        assert await _names(db, filters) == {"Epsilon"}

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

    async def test_a_group_restricted_to_other_types_is_ignored(self, db, land):
        """The report never offers or matches such a group, so neither does the portal."""
        tier = await db.get(TagGroup, land.gold.tag_group_id)
        tier.restrict_to_types = ["ITComponent"]
        await db.flush()
        assert await _names(db, _cf(tagFilterIds=[str(land.gold.id)])) == ALL
        tier.restrict_to_types = ["Application", "ITComponent"]
        await db.flush()
        assert await _names(db, _cf(tagFilterIds=[str(land.gold.id)])) == {"Alpha", "Gamma"}

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

    @pytest.mark.parametrize(
        "card_filters", [{}, {"includeDescendants": True}, {"subtypeFilters": []}, "junk"]
    )
    async def test_card_filters_narrowing_nothing_leave_the_legacy_keys(
        self, db, land, card_filters
    ):
        filters = {"subtypes": ["business"], "card_filters": card_filters}
        assert await _names(db, filters) == {"Alpha"}

    async def test_card_filters_replace_the_legacy_keys(self, db, land):
        filters = {"subtypes": ["business"], **_cf(subtypeFilters=["micro"])}
        assert await _names(db, filters) == {"Beta", "Epsilon"}

    async def test_approval_applies_in_both_shapes(self, db, land):
        assert await _names(db, {"approval_statuses": ["APPROVED"]}) == {"Alpha"}
        filters = {"approval_statuses": ["APPROVED"], **_cf(subtypeFilters=["micro"])}
        assert await _names(db, filters) == set()


class TestDescendantIds:
    async def test_a_parent_cycle_terminates(self, db, land):
        a = await create_card(db, card_type="Organization", name="Loop A")
        b = await create_card(db, card_type="Organization", name="Loop B", parent_id=a.id)
        a.parent_id = b.id
        await db.flush()
        assert await pcf.descendant_ids(db, [a.id]) == {a.id, b.id}

    async def test_every_depth_and_none_for_no_roots(self, db, land):
        leaf = await create_card(db, card_type="Organization", name="Leaf", parent_id=land.team.id)
        # Another tree entirely: never beneath Corp.
        other = await create_card(db, card_type="Organization", name="Other")
        await create_card(db, card_type="Organization", name="Stray", parent_id=other.id)
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
            "attrConditions": {},
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
            ("attrConditions", {"k": {"contains": "v"}}),
            ("relationFilters", {"T": ["id"]}),
            ("relSubtypeFilters", {"r::f": ["v"]}),
            ("tagFilterIds", ["t"]),
        ],
    )
    def test_any_pick_is_active(self, key, picked):
        assert has_active_card_filters({**normalise_card_filters({}), key: picked}) is True


class TestNormaliseAttrConditions:
    def test_not_an_object(self):
        assert pcf.normalise_attr_conditions(None) == {}
        assert pcf.normalise_attr_conditions([{"contains": "x"}]) == {}

    def test_canonical_shapes(self):
        raw = {
            "code": {"contains": "  ORG-12 "},
            "n": {"min": 0, "max": 2.5},
            "due": {"from": "2026-01-01", "to": "2026-12-31"},
        }
        assert pcf.normalise_attr_conditions(raw) == {
            "code": {"contains": "ORG-12"},
            "n": {"min": 0, "max": 2.5},
            "due": {"from": "2026-01-01", "to": "2026-12-31"},
        }

    def test_drops_whatever_is_unusable(self):
        raw = {
            "": {"contains": "x"},
            "blank": {"contains": "   "},
            "notText": {"contains": 3},
            "mixed": {"contains": "x", "min": 1},
            "empty": {},
            "list": ["x"],
            "str": "x",
            "bool": {"min": True},
            "inf": {"max": float("inf")},
            "nan": {"min": float("nan")},
            "huge": {"min": 10**400},
            "textNumber": {"min": "2"},
            "noBound": {"min": None, "max": None},
            "shortDate": {"from": "2026-1-1"},
            "timeDate": {"to": "2026-01-01T00:00"},
            "dateNumber": {"from": 20260101},
            "half": {"min": True, "max": 3},
            "halfDate": {"from": "x", "to": "2026-02-03"},
        }
        assert pcf.normalise_attr_conditions(raw) == {
            "half": {"max": 3},
            "halfDate": {"to": "2026-02-03"},
        }

    def test_contains_is_capped(self):
        exact = "y" * pcf.CONTAINS_MAX
        assert pcf.normalise_condition("text", {"contains": exact}) == {"contains": exact}
        assert pcf.normalise_condition("text", {"contains": f" {exact}z "}) == {"contains": exact}
        assert pcf.CONTAINS_MAX == 200

    def test_condition_shape(self):
        assert pcf.condition_shape({"contains": ""}) == "text"
        assert pcf.condition_shape({"max": None}) == "number"
        assert pcf.condition_shape({"to": None}) == "date"
        assert pcf.condition_shape({"from": 1, "min": 1}) is None
        assert pcf.condition_shape({"other": 1}) is None
        assert pcf.condition_shape("contains") is None

    def test_an_unknown_kind_is_nothing(self):
        assert pcf.normalise_condition("facet", {"contains": "x"}) is None
        assert pcf.normalise_condition("text", "x") is None

    def test_normalise_card_filters_keeps_conditions(self):
        cf = normalise_card_filters({"attrConditions": {"code": {"contains": "x"}, "bad": 1}})
        assert cf["attrConditions"] == {"code": {"contains": "x"}}
        assert has_active_card_filters(cf) is True


class TestPublicFilters:
    def test_card_filters_never_reach_a_visitor(self):
        stored = {"approval_statuses": ["APPROVED"], **_cf(subtypeFilters=["a"])}
        assert public_filters(stored) == {"approval_statuses": ["APPROVED"]}
        assert "card_filters" in stored, "the stored blob is not mutated"

    @pytest.mark.parametrize("value", [None, {}, {"subtypes": ["a"]}, "junk"])
    def test_everything_else_passes_unchanged(self, value):
        assert public_filters(value) is value


class TestUuids:
    def test_keeps_every_valid_id_past_a_malformed_one(self):
        valid = str(uuid.uuid4())
        assert pcf.uuids(["nope", valid, 3]) == [uuid.UUID(valid)]


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
        assert pcf.field_types(schema) == {"a": "boolean", "b": ""}
        assert pcf.field_types(None) == {}


# ---------------------------------------------------------------------------
# A visitor's own filters (#1425)
# ---------------------------------------------------------------------------

EMPTY_VISITOR = {
    "subtypeFilters": [],
    "attrFilters": {},
    "attrConditions": {},
    "relationFilters": {},
    "tagFilterIds": [],
    "anyTagIds": [],
}

#: Every filter of the ``land`` landscape a visitor might use.
ALLOWED = ["subtype", "tags", "field:criticality", "field:regions", "field:cloud", "field:code"]
ALLOWED += ["rel:orgOwnsApp", "rel:orgUsesApp", "rel:appCallsApp"]

TYPES = {"criticality": "single_select", "regions": "multiple_select", "cloud": "boolean"}
TYPES |= {"code": "text", "spend": "cost"}


async def _visitor_names(db, value: dict, *, allowed=ALLOWED) -> set[str]:
    restricted = pcf.restrict_visitor_filters({**EMPTY_VISITOR, **value}, allowed, TYPES)
    conditions = await pcf.visitor_conditions(db, "Application", restricted)
    rows = await db.execute(
        select(Card.name).where(Card.type == "Application", Card.status == "ACTIVE", *conditions)
    )
    return set(rows.scalars().all())


class TestNormaliseVisitorFilters:
    def test_parses_json_and_keeps_the_subset(self):
        raw = (
            '{"subtypeFilters": ["micro", 3], "attrFilters": {"regions": ["eu", 1]},'
            ' "attrConditions": {"code": {"contains": " A "}, "bad": {"contains": ""}},'
            ' "relationFilters": {"orgOwnsApp": ["x"]}, "tagFilterIds": ["t", null],'
            ' "relSubtypeFilters": {"r::f": ["v"]}, "includeDescendants": true,'
            ' "anyTagIds": ["t2"], "filterFields": ["code"]}'
        )
        assert pcf.normalise_visitor_filters(raw) == {
            "subtypeFilters": ["micro"],
            "attrFilters": {"regions": ["eu"]},
            "attrConditions": {"code": {"contains": "A"}},
            "relationFilters": {"orgOwnsApp": ["x"]},
            "tagFilterIds": ["t"],
            "anyTagIds": [],
        }

    def test_an_object_is_read_as_is(self):
        out = pcf.normalise_visitor_filters({"subtypeFilters": ["micro"]})
        assert out == {**EMPTY_VISITOR, "subtypeFilters": ["micro"]}

    @pytest.mark.parametrize(
        "raw",
        [None, "", "not json", "[1, 2]", '"text"', "3", "null", ["subtypeFilters"], 7, "{"],
    )
    def test_garbage_is_no_filter(self, raw):
        assert pcf.normalise_visitor_filters(raw) == EMPTY_VISITOR

    def test_wrong_types_inside_are_dropped(self):
        raw = {
            "subtypeFilters": "micro",
            "attrFilters": ["x"],
            "attrConditions": "code",
            "relationFilters": {"r": "id"},
            "tagFilterIds": {"t": 1},
        }
        assert pcf.normalise_visitor_filters(raw) == EMPTY_VISITOR

    def test_oversize_is_ignored_whole(self):
        at_cap = '{"subtypeFilters": ["a"]}'.ljust(pcf.VISITOR_FILTERS_MAX_CHARS)
        assert len(at_cap) == pcf.VISITOR_FILTERS_MAX_CHARS
        assert pcf.normalise_visitor_filters(at_cap)["subtypeFilters"] == ["a"]
        over = at_cap + " "
        assert pcf.normalise_visitor_filters(over) == EMPTY_VISITOR


class TestRestrictVisitorFilters:
    VALUE = {
        "subtypeFilters": ["micro"],
        "attrFilters": {"criticality": ["high"], "secret": ["x"], "spend": ["1"]},
        "attrConditions": {"code": {"contains": "A"}, "spend": {"min": 1}, "gone": {"min": 1}},
        "relationFilters": {"orgOwnsApp": ["id"], "Organization": ["id"], "hiddenRel": ["id"]},
        "tagFilterIds": ["t"],
        "anyTagIds": ["t2"],
    }

    def test_keeps_what_is_allowed(self):
        allowed = [*ALLOWED, "field:spend", "field:secret", "field:gone"]
        out = pcf.restrict_visitor_filters(self.VALUE, allowed, {**TYPES, "secret": "text"})
        assert out == {
            "subtypeFilters": ["micro"],
            # A cost field never, even listed; an unknown field never.
            "attrFilters": {"criticality": ["high"], "secret": ["x"]},
            "attrConditions": {"code": {"contains": "A"}},
            # A card type key is not a relation type: never read as one here.
            "relationFilters": {"orgOwnsApp": ["id"]},
            "tagFilterIds": ["t"],
            "anyTagIds": ["t2"],
        }

    def test_nothing_allowed_keeps_nothing(self):
        assert pcf.restrict_visitor_filters(self.VALUE, [], TYPES) == EMPTY_VISITOR

    def test_each_key_needs_its_own_entry(self):
        out = pcf.restrict_visitor_filters(self.VALUE, ["field:code", "rel:orgOwnsApp"], TYPES)
        assert out == {
            **EMPTY_VISITOR,
            "attrConditions": {"code": {"contains": "A"}},
            "relationFilters": {"orgOwnsApp": ["id"]},
        }

    def test_a_bare_key_is_not_a_field_key(self):
        """``code`` alone, without the ``field:`` prefix, allows nothing."""
        out = pcf.restrict_visitor_filters(self.VALUE, ["code", "orgOwnsApp", "criticality"], TYPES)
        assert out == EMPTY_VISITOR

    def test_tolerates_missing_keys(self):
        assert pcf.restrict_visitor_filters({}, ALLOWED, TYPES) == EMPTY_VISITOR


class TestLegacyVisitorFilters:
    def test_nothing_sent(self):
        assert pcf.legacy_visitor_filters() == EMPTY_VISITOR

    def test_single_values_become_lists(self):
        tag = uuid.uuid4()
        card = uuid.uuid4()
        other = uuid.uuid4()
        out = pcf.legacy_visitor_filters(
            subtype="micro",
            tag_ids=f" {tag} ,,nope",
            attr_filters='{"criticality": "high", "cloud": true, "count": 3, "off": false}',
            relation_filters=f'{{"orgOwnsApp": "{card}"}}',
            related_type="orgUsesApp",
            related_id=str(other),
        )
        assert out == {
            "subtypeFilters": ["micro"],
            "attrFilters": {
                "criticality": ["high"],
                "cloud": ["true"],
                "count": ["3"],
                "off": ["false"],
            },
            "attrConditions": {},
            "relationFilters": {"orgOwnsApp": [str(card)], "orgUsesApp": [str(other)]},
            "tagFilterIds": [],
            "anyTagIds": [str(tag)],
        }

    def test_malformed_input_is_ignored(self):
        out = pcf.legacy_visitor_filters(
            tag_ids="not-a-uuid",
            attr_filters='{"a": [1], "b": {}, "c": null, "d": ""}',
            relation_filters='{"orgOwnsApp": "nope", "orgUsesApp": ["x"]}',
            related_type="orgOwnsApp",
            related_id="also-not-a-uuid",
        )
        assert out == EMPTY_VISITOR

    @pytest.mark.parametrize("raw", ["not-json", "[1]", '"x"', "{" + " " * 9000 + "}"])
    def test_malformed_json_is_ignored(self, raw):
        out = pcf.legacy_visitor_filters(attr_filters=raw, relation_filters=raw)
        assert out == EMPTY_VISITOR

    def test_related_id_without_a_type_is_ignored(self):
        assert pcf.legacy_visitor_filters(related_id=str(uuid.uuid4())) == EMPTY_VISITOR
        assert pcf.legacy_visitor_filters(related_type="orgOwnsApp") == EMPTY_VISITOR

    def test_related_and_relation_filters_on_one_type_join(self):
        card = uuid.uuid4()
        other = uuid.uuid4()
        out = pcf.legacy_visitor_filters(
            relation_filters=f'{{"orgOwnsApp": "{card}"}}',
            related_type="orgOwnsApp",
            related_id=str(other),
        )
        assert out["relationFilters"] == {"orgOwnsApp": [str(card), str(other)]}
        same = pcf.legacy_visitor_filters(
            relation_filters=f'{{"orgOwnsApp": "{card}"}}',
            related_type="orgOwnsApp",
            related_id=str(card),
        )
        assert same["relationFilters"] == {"orgOwnsApp": [str(card)]}


class TestHasVisitorFilters:
    def test_empty(self):
        assert pcf.has_visitor_filters(EMPTY_VISITOR) is False
        assert pcf.has_visitor_filters({}) is False

    @pytest.mark.parametrize(
        "key,picked",
        [
            ("subtypeFilters", ["a"]),
            ("attrFilters", {"k": ["v"]}),
            ("attrConditions", {"k": {"contains": "v"}}),
            ("relationFilters", {"r": ["id"]}),
            ("tagFilterIds", ["t"]),
            ("anyTagIds", ["t"]),
        ],
    )
    def test_any_pick(self, key, picked):
        assert pcf.has_visitor_filters({**EMPTY_VISITOR, key: picked}) is True


class TestVisitorConditions:
    async def test_no_filter_no_condition(self, db, land):
        assert await pcf.visitor_conditions(db, "Application", EMPTY_VISITOR) == []
        assert await _visitor_names(db, {}) == ALL

    async def test_subtype_with_empty(self, db, land):
        assert await _visitor_names(db, {"subtypeFilters": ["micro"]}) == {"Beta", "Epsilon"}
        both = {"subtypeFilters": ["business", EMPTY_KEY]}
        assert await _visitor_names(db, both) == {"Alpha", "Gamma", "Delta"}

    async def test_a_multiple_select_matches_one_value_among_several(self, db, land):
        assert await _visitor_names(db, {"attrFilters": {"regions": ["us"]}}) == {"Alpha"}
        assert await _visitor_names(db, {"attrFilters": {"regions": ["eu"]}}) == {"Alpha", "Beta"}

    async def test_facet_values_or_empty(self, db, land):
        value = {"attrFilters": {"criticality": ["low", EMPTY_KEY]}}
        assert await _visitor_names(db, value) == {"Beta", "Gamma", "Delta", "Epsilon"}

    async def test_boolean(self, db, land):
        assert await _visitor_names(db, {"attrFilters": {"cloud": ["true"]}}) == {"Alpha", "Beta"}

    async def test_text_condition(self, db, land):
        assert await _visitor_names(db, {"attrConditions": {"code": {"contains": "a"}}}) == {
            "Alpha"
        }

    async def test_relation_with_empty(self, db, land):
        value = {"relationFilters": {"orgOwnsApp": [str(land.corp.id)]}}
        assert await _visitor_names(db, value) == {"Alpha"}
        empty = {"relationFilters": {"orgOwnsApp": [EMPTY_KEY]}}
        assert await _visitor_names(db, empty) == {"Beta", "Gamma", "Delta", "Epsilon"}

    async def test_a_relation_pick_does_not_reach_sub_cards(self, db, land):
        """Include sub-cards is preset-only: a visitor's pick is that card."""
        value = {"relationFilters": {"orgUsesApp": [str(land.corp.id)]}}
        assert await _visitor_names(db, value) == {"Gamma"}

    async def test_tags_or_within_and_across_groups(self, db, land):
        within = {"tagFilterIds": [str(land.finance.id), str(land.sales.id)]}
        assert await _visitor_names(db, within) == {"Alpha", "Beta"}
        across = {"tagFilterIds": [str(land.sales.id), str(land.gold.id)]}
        assert await _visitor_names(db, across) == set()

    async def test_legacy_tags_are_any_of(self, db, land):
        across = {"anyTagIds": [str(land.sales.id), str(land.gold.id)]}
        assert await _visitor_names(db, across) == {"Alpha", "Beta", "Gamma"}
        assert await _visitor_names(db, {"anyTagIds": ["nope"]}) == ALL

    async def test_filters_are_anded(self, db, land):
        value = {
            "subtypeFilters": ["business", "micro"],
            "attrFilters": {"regions": ["eu"]},
        }
        assert await _visitor_names(db, value) == {"Alpha", "Beta"}
        value["attrFilters"]["criticality"] = ["low"]
        assert await _visitor_names(db, value) == {"Beta"}

    async def test_nothing_applies_without_its_allowed_key(self, db, land):
        value = {"subtypeFilters": ["micro"], "tagFilterIds": [str(land.sales.id)]}
        assert await _visitor_names(db, value, allowed=["field:code"]) == ALL

    async def test_malformed_ids_are_dropped(self, db, land):
        value = {"relationFilters": {"orgOwnsApp": ["nope"]}, "tagFilterIds": ["nope"]}
        assert await _visitor_names(db, value) == ALL


class TestPublicVisitorConditions:
    async def _names(self, db, *, filters=None, allowed=ALLOWED, **legacy):
        conditions = await pcf.public_visitor_conditions(
            db,
            "Application",
            allowed=allowed,
            field_types=TYPES,
            filters=filters,
            legacy=legacy,
        )
        rows = await db.execute(
            select(Card.name).where(
                Card.type == "Application", Card.status == "ACTIVE", *conditions
            )
        )
        return set(rows.scalars().all())

    async def test_nothing_sent(self, db, land):
        assert await self._names(db) == ALL

    async def test_filters_alone(self, db, land):
        assert await self._names(db, filters='{"subtypeFilters": ["micro"]}') == {
            "Beta",
            "Epsilon",
        }

    async def test_legacy_alone(self, db, land):
        assert await self._names(db, attr_filters='{"regions": "us"}') == {"Alpha"}

    async def test_both_apply(self, db, land):
        names = await self._names(
            db, filters='{"subtypeFilters": ["micro"]}', attr_filters='{"regions": "eu"}'
        )
        assert names == {"Beta"}

    async def test_each_is_restricted(self, db, land):
        names = await self._names(
            db,
            filters='{"subtypeFilters": ["micro"]}',
            subtype="business",
            allowed=["field:code"],
        )
        assert names == ALL
