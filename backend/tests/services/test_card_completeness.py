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

from app.services.card_completeness import (
    LinkFacts,
    missing_mandatory,
    optional_relation_sides,
)
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


# ── The batched pieces: config, facts, verdict ─────────────────────
# `missing_mandatory` is the single-card composition of these; the batched
# data-quality rescore uses them directly, so each is pinned on its own.


def _cfg():
    import uuid as _uuid

    from app.services.card_completeness import (
        MandatoryConfig,
        MandatorySide,
        MandatoryTagGroup,
    )

    g1, g2 = _uuid.uuid4(), _uuid.uuid4()
    return (
        MandatoryConfig(
            sides=(
                MandatorySide("relA", "owns", "source", "Organization", "relA"),
                MandatorySide("relB", "is used by", "target", "Interface", "relB"),
                MandatorySide("relS", "reports to", "source", "App", "relS__out"),
            ),
            tag_groups=(MandatoryTagGroup(g1, "Criticality"), MandatoryTagGroup(g2, "Region")),
        ),
        g1,
        g2,
    )


class TestEvaluate:
    async def test_reports_exactly_what_is_unheld(self):
        from app.services.card_completeness import LinkFacts, evaluate

        cfg, g1, g2 = _cfg()
        facts = LinkFacts(sides=frozenset({("relA", "source")}), tag_groups=frozenset({g2}))
        assert evaluate(cfg, facts) == {
            "relations": [
                {
                    "key": "relB",
                    "label": "is used by",
                    "side": "target",
                    "other_type_key": "Interface",
                },
                {
                    "key": "relS",
                    "label": "reports to",
                    "side": "source",
                    "other_type_key": "App",
                },
            ],
            "tag_groups": [{"id": str(g1), "name": "Criticality"}],
            "relations_applicable": 3,
            "tag_groups_applicable": 2,
        }

    async def test_a_side_is_held_only_on_its_own_end(self):
        from app.services.card_completeness import LinkFacts, evaluate

        cfg, _, _ = _cfg()
        # relB held as a *source* does not satisfy relB's incoming side.
        state = evaluate(cfg, LinkFacts(sides=frozenset({("relB", "source")})))
        assert [m["key"] for m in state["relations"]] == ["relA", "relB", "relS"]

    async def test_everything_held_misses_nothing(self):
        from app.services.card_completeness import LinkFacts, evaluate

        cfg, g1, g2 = _cfg()
        facts = LinkFacts(
            sides=frozenset({("relA", "source"), ("relB", "target"), ("relS", "source")}),
            tag_groups=frozenset({g1, g2}),
        )
        state = evaluate(cfg, facts)
        assert (state["relations"], state["tag_groups"]) == ([], [])
        assert (state["relations_applicable"], state["tag_groups_applicable"]) == (3, 2)

    async def test_optional_sides_drop_out_by_side_key(self):
        from app.services.card_completeness import NO_LINKS, evaluate

        cfg, _, _ = _cfg()
        # "relS" is the bare key; the self-pair side is filed under relS__out.
        state = evaluate(cfg, NO_LINKS, frozenset({"relA", "relS"}))
        assert [m["key"] for m in state["relations"]] == ["relB", "relS"]
        assert state["relations_applicable"] == 2
        state = evaluate(cfg, NO_LINKS, frozenset({"relS__out"}))
        assert [m["key"] for m in state["relations"]] == ["relA", "relB"]
        # Tag groups are never exempted by a subtype.
        assert state["tag_groups_applicable"] == 2

    async def test_an_empty_config_requires_nothing(self):
        from app.services.card_completeness import NO_LINKS, MandatoryConfig, evaluate

        assert evaluate(MandatoryConfig(), NO_LINKS) == {
            "relations": [],
            "tag_groups": [],
            "relations_applicable": 0,
            "tag_groups_applicable": 0,
        }


@pytest.fixture
def statements(db):
    from sqlalchemy import event as sa_event

    recorded: list[str] = []
    bind = db.sync_session.get_bind()

    def _record(conn, cursor, statement, parameters, context, executemany):
        recorded.append(statement)

    sa_event.listen(bind, "before_cursor_execute", _record)
    yield recorded
    sa_event.remove(bind, "before_cursor_execute", _record)


class TestLoadMandatoryConfig:
    async def test_relation_sides(self, db):
        from app.services.card_completeness import MandatorySide, load_mandatory_config

        await create_card_type(db, key="Organization")
        await create_card_type(db, key="Application")
        selfpair = await create_relation_type(
            db,
            key="relOrgReports",
            label="reports to",
            reverse_label="is reported to by",
            source_type_key="Organization",
            target_type_key="Organization",
        )
        selfpair.source_mandatory = True
        selfpair.target_mandatory = True
        incoming = await create_relation_type(
            db,
            key="relAppToOrg",
            label="is owned by",
            source_type_key="Application",
            target_type_key="Organization",
        )
        incoming.target_mandatory = True
        incoming.reverse_label = None
        # Mandatory only on the Application end: nothing for Organization.
        other_end = await create_relation_type(
            db,
            key="relAppUsesOrg",
            label="uses",
            source_type_key="Application",
            target_type_key="Organization",
        )
        other_end.source_mandatory = True
        hidden = await create_relation_type(
            db,
            key="relGone",
            label="gone",
            source_type_key="Organization",
            target_type_key="Application",
            is_hidden=True,
        )
        hidden.source_mandatory = True
        await db.flush()

        cfg = await load_mandatory_config(db, "Organization")
        assert sorted(cfg.sides, key=lambda s: (s.key, s.side)) == [
            MandatorySide("relAppToOrg", "is owned by", "target", "Application", "relAppToOrg"),
            MandatorySide(
                "relOrgReports", "reports to", "source", "Organization", "relOrgReports__out"
            ),
            MandatorySide(
                "relOrgReports",
                "is reported to by",
                "target",
                "Organization",
                "relOrgReports__in",
            ),
        ]
        assert cfg.tag_groups == ()

    async def test_tag_groups_in_one_tag_query(self, db, statements):
        from app.models.tag import Tag, TagGroup
        from app.services.card_completeness import MandatoryTagGroup, load_mandatory_config

        await create_card_type(db, key="Application")
        everywhere = TagGroup(name="Everywhere", mandatory=True)
        scoped = TagGroup(name="Scoped", mandatory=True, restrict_to_types=["Application"])
        elsewhere = TagGroup(name="Elsewhere", mandatory=True, restrict_to_types=["Provider"])
        empty = TagGroup(name="Empty", mandatory=True)
        optional = TagGroup(name="Optional", mandatory=False)
        db.add_all([everywhere, scoped, elsewhere, empty, optional])
        await db.flush()
        for group in (everywhere, scoped, scoped, elsewhere, optional):
            db.add(Tag(tag_group_id=group.id, name=f"t-{group.name}"))
        await db.flush()

        statements.clear()
        cfg = await load_mandatory_config(db, "Application")
        assert sorted(cfg.tag_groups, key=lambda g: g.name) == [
            MandatoryTagGroup(everywhere.id, "Everywhere"),
            MandatoryTagGroup(scoped.id, "Scoped"),
        ]
        # relation types, tag groups, which groups have a tag.
        assert len(statements) == 3

    async def test_no_applicable_group_skips_the_tag_query(self, db, statements):
        from app.services.card_completeness import load_mandatory_config

        await create_card_type(db, key="Application")
        statements.clear()
        assert (await load_mandatory_config(db, "Application")).tag_groups == ()
        assert len(statements) == 2


class TestLoadLinkFacts:
    async def test_facts_per_card(self, db, env, statements):
        from app.models.tag import CardTag, Tag, TagGroup
        from app.services.card_completeness import LinkFacts, load_link_facts, load_mandatory_config

        await create_card_type(db, key="Provider")
        incoming = await create_relation_type(
            db,
            key="relProviderToApp",
            label="supplies",
            source_type_key="Provider",
            target_type_key="Application",
        )
        incoming.target_mandatory = True
        group = TagGroup(name="Criticality", mandatory=True)
        other = TagGroup(name="Free", mandatory=False)
        db.add_all([group, other])
        await db.flush()
        tag, free = Tag(tag_group_id=group.id, name="High"), Tag(tag_group_id=other.id, name="X")
        db.add_all([tag, free])
        org = await create_card(db, card_type="Organization", name="Acme")
        prov = await create_card(db, card_type="Provider", name="Vendor")
        a = await create_card(db, name="A")
        b = await create_card(db, name="B")
        c = await create_card(db, name="C")
        await create_relation(db, type_key="relAppToOrg", source_id=a.id, target_id=org.id)
        await create_relation(db, type_key="relAppToOrg", source_id=a.id, target_id=org.id)
        await create_relation(db, type_key="relProviderToApp", source_id=prov.id, target_id=a.id)
        # B is the *target* of an relAppToOrg row: that is not its outgoing side.
        await create_relation(db, type_key="relAppToOrg", source_id=org.id, target_id=b.id)
        # B holds an outgoing relation of a non-mandatory type.
        await create_relation_type(db, key="relLoose", label="loose", source_type_key="Application")
        await create_relation(db, type_key="relLoose", source_id=b.id, target_id=org.id)
        db.add_all([CardTag(card_id=a.id, tag_id=tag.id), CardTag(card_id=b.id, tag_id=free.id)])
        await db.flush()

        cfg = await load_mandatory_config(db, "Application")
        statements.clear()
        facts = await load_link_facts(db, cfg, [a.id, b.id, c.id])
        assert len(statements) == 3
        assert facts == {
            a.id: LinkFacts(
                sides=frozenset({("relAppToOrg", "source"), ("relProviderToApp", "target")}),
                tag_groups=frozenset({group.id}),
            ),
            b.id: LinkFacts(),
            c.id: LinkFacts(),
        }

    async def test_nothing_to_check_issues_no_query(self, db, statements):
        from app.services.card_completeness import MandatoryConfig, load_link_facts

        card = await create_card(db, card_type="Application", name="Lonely")
        statements.clear()
        assert await load_link_facts(db, MandatoryConfig(), [card.id]) == {card.id: LinkFacts()}
        assert await load_link_facts(db, _cfg()[0], []) == {}
        assert statements == []
