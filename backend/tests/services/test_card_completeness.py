"""Mandatory relation sides, scoped per subtype (#1296).

A subtype may list mandatory relation sides it does not need in
``card_types.subtypes[*].optional_relations`` — side keys in the
``side_key`` vocabulary (bare key for a cross-type relation type, ``__out`` /
``__in`` for a self-referencing one). ``missing_mandatory`` drops such a side
for a card of that subtype: it is neither missing nor applicable, so the
approval gate and the data-quality relations bucket follow from one place.
"""

from __future__ import annotations

import pytest

from app.services.card_completeness import missing_mandatory, optional_relation_sides
from tests.conftest import create_card, create_card_type, create_relation, create_relation_type

pytestmark = pytest.mark.asyncio

SUBTYPES = [
    {"key": "saas", "label": "SaaS", "optional_relations": ["relAppToOrg"]},
    {"key": "inhouse", "label": "In-house", "optional_relations": []},
]


class TestOptionalRelationSides:
    """The pure lookup of a card's subtype's exemption list."""

    async def test_the_subtype_list_is_returned_as_a_set(self):
        assert optional_relation_sides(SUBTYPES, "saas") == frozenset({"relAppToOrg"})

    async def test_another_subtype_exempts_nothing(self):
        assert optional_relation_sides(SUBTYPES, "inhouse") == frozenset()

    async def test_no_subtype_or_an_unknown_one_exempts_nothing(self):
        assert optional_relation_sides(SUBTYPES, None) == frozenset()
        assert optional_relation_sides(SUBTYPES, "") == frozenset()
        assert optional_relation_sides(SUBTYPES, "gone") == frozenset()

    async def test_malformed_data_exempts_nothing(self):
        assert optional_relation_sides(None, "saas") == frozenset()
        assert optional_relation_sides({"saas": []}, "saas") == frozenset()
        assert optional_relation_sides(["saas"], "saas") == frozenset()
        assert optional_relation_sides([{"key": "saas"}], "saas") == frozenset()
        assert (
            optional_relation_sides([{"key": "saas", "optional_relations": "relX"}], "saas")
            == frozenset()
        )
        # Non-string entries are ignored, the rest still count.
        assert optional_relation_sides(
            [{"key": "saas", "optional_relations": ["relX", 3, None]}], "saas"
        ) == frozenset({"relX"})


@pytest.fixture
async def env(db):
    """Application (with subtypes) → Organization, mandatory on the source side."""
    await create_card_type(db, key="Application", label="Application", subtypes=SUBTYPES)
    await create_card_type(db, key="Organization", label="Organization")
    rt = await create_relation_type(
        db,
        key="relAppToOrg",
        label="is owned by",
        source_type_key="Application",
        target_type_key="Organization",
    )
    rt.source_mandatory = True
    await db.flush()
    return rt


class TestMissingMandatory:
    async def test_an_exempted_side_is_skipped_for_its_subtype(self, db, env):
        card = await create_card(db, card_type="Application", name="CRM", subtype="saas")
        state = await missing_mandatory(db, card)
        assert state["relations"] == []
        assert state["relations_applicable"] == 0

    async def test_the_side_is_still_required_for_another_subtype(self, db, env):
        card = await create_card(db, card_type="Application", name="ERP", subtype="inhouse")
        state = await missing_mandatory(db, card)
        assert [m["key"] for m in state["relations"]] == ["relAppToOrg"]
        assert state["relations_applicable"] == 1

    async def test_the_side_is_still_required_without_a_subtype(self, db, env):
        card = await create_card(db, card_type="Application", name="Wiki")
        state = await missing_mandatory(db, card)
        assert [m["side"] for m in state["relations"]] == ["source"]
        assert state["relations_applicable"] == 1

    async def test_a_satisfied_side_is_applicable_and_not_missing(self, db, env):
        card = await create_card(db, card_type="Application", name="ERP", subtype="inhouse")
        org = await create_card(db, card_type="Organization", name="Acme")
        await create_relation(db, type_key="relAppToOrg", source_id=card.id, target_id=org.id)
        state = await missing_mandatory(db, card)
        assert state["relations"] == []
        assert state["relations_applicable"] == 1

    async def test_an_explicit_set_overrides_the_lookup(self, db, env):
        # The data-quality scorer passes the set it already computed.
        card = await create_card(db, card_type="Application", name="Wiki")
        state = await missing_mandatory(db, card, optional_sides=frozenset({"relAppToOrg"}))
        assert state["relations_applicable"] == 0
        state = await missing_mandatory(db, card, optional_sides=frozenset())
        assert state["relations_applicable"] == 1

    async def test_an_unknown_key_is_ignored(self, db, env):
        from sqlalchemy import select

        from app.models.card_type import CardType

        ct = (await db.execute(select(CardType).where(CardType.key == "Application"))).scalar_one()
        ct.subtypes = [{"key": "saas", "label": "SaaS", "optional_relations": ["relNoSuchThing"]}]
        await db.flush()
        card = await create_card(db, card_type="Application", name="CRM", subtype="saas")
        state = await missing_mandatory(db, card)
        assert [m["key"] for m in state["relations"]] == ["relAppToOrg"]

    async def test_the_target_side_reads_its_own_key(self, db, env):
        # A cross-type key names the side on THIS card type: on Organization the
        # bare key is the target side, so an Organization subtype exempts it.
        from sqlalchemy import select

        from app.models.card_type import CardType

        env.source_mandatory = False
        env.target_mandatory = True
        ct = (await db.execute(select(CardType).where(CardType.key == "Organization"))).scalar_one()
        ct.subtypes = [
            {"key": "team", "label": "Team", "optional_relations": ["relAppToOrg"]},
            {"key": "bu", "label": "Business Unit"},
        ]
        await db.flush()
        team = await create_card(db, card_type="Organization", name="Squad", subtype="team")
        bu = await create_card(db, card_type="Organization", name="Sales", subtype="bu")
        assert (await missing_mandatory(db, team))["relations_applicable"] == 0
        missing = (await missing_mandatory(db, bu))["relations"]
        assert [(m["key"], m["side"]) for m in missing] == [("relAppToOrg", "target")]


class TestSelfPair:
    """A self-referencing type has two sides on one card type: ``__out`` and
    ``__in`` exempt each independently."""

    @pytest.fixture
    async def org_env(self, db):
        await create_card_type(
            db,
            key="Organization",
            label="Organization",
            subtypes=[
                {"key": "leaf", "label": "Leaf", "optional_relations": ["relOrgReports__out"]},
                {"key": "root", "label": "Root", "optional_relations": ["relOrgReports__in"]},
                {
                    "key": "free",
                    "label": "Free",
                    "optional_relations": ["relOrgReports__out", "relOrgReports__in"],
                },
                # The bare key names no side of a self-pair.
                {"key": "bare", "label": "Bare", "optional_relations": ["relOrgReports"]},
            ],
        )
        rt = await create_relation_type(
            db,
            key="relOrgReports",
            label="reports to",
            reverse_label="is reported to by",
            source_type_key="Organization",
            target_type_key="Organization",
        )
        rt.source_mandatory = True
        rt.target_mandatory = True
        await db.flush()

    async def _sides(self, db, subtype):
        card = await create_card(db, card_type="Organization", name=subtype, subtype=subtype)
        state = await missing_mandatory(db, card)
        return state["relations_applicable"], sorted(m["side"] for m in state["relations"])

    async def test_out_exempts_only_the_source_side(self, db, org_env):
        assert await self._sides(db, "leaf") == (1, ["target"])

    async def test_in_exempts_only_the_target_side(self, db, org_env):
        assert await self._sides(db, "root") == (1, ["source"])

    async def test_both_keys_exempt_both_sides(self, db, org_env):
        assert await self._sides(db, "free") == (0, [])

    async def test_the_bare_key_exempts_neither_side(self, db, org_env):
        assert await self._sides(db, "bare") == (2, ["source", "target"])
