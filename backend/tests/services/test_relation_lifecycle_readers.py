"""Current-state readers of relations stop counting a relation not in effect.

A relation may carry its own lifecycle (migration 180). Every service that
COUNTS relations — the orphaned flag, the dashboards' relation flags and the
card query's hops, the formula context, mandatory-relation completeness, a
portal's relation filters, PPM grouping and the TurboLens loaders — applies the
one definition in ``services/lifecycle.py``. Each test here runs the reader
over the four relations in ``tests/relation_windows.py``: an undated one and
one in effect count, a planned one and an ended one do not.

Integration tests requiring a PostgreSQL test database (the pure helper at the
bottom needs none).
"""

from __future__ import annotations

import json
from datetime import date, timedelta
from types import SimpleNamespace

import pytest
from sqlalchemy import select
from sqlalchemy.orm import aliased

from app.models.card import Card
from app.services.lifecycle import live_relations_in_fiscal_year
from tests.conftest import create_card, create_card_type, create_relation, create_relation_type
from tests.relation_windows import COUNTING, FUTURE, TODAY, WINDOWS


@pytest.fixture
async def star(db):
    """One Application ("Hub") linked out to one IT Component per window over
    ``relHubToItc``, plus one IT Component with no relation at all."""
    await create_card_type(db, key="Application", label="Application")
    await create_card_type(db, key="ITComponent", label="IT Component")
    await create_relation_type(
        db, key="relHubToItc", source_type_key="Application", target_type_key="ITComponent"
    )
    hub = await create_card(db, card_type="Application", name="Hub")
    peers = {}
    for name, lifecycle in WINDOWS.items():
        peers[name] = await create_card(db, card_type="ITComponent", name=name)
        await create_relation(
            db,
            type_key="relHubToItc",
            source_id=hub.id,
            target_id=peers[name].id,
            lifecycle=lifecycle,
        )
    lonely = await create_card(db, card_type="ITComponent", name="lonely")
    return SimpleNamespace(hub=hub, peers=peers, lonely=lonely)


async def _names(db, *conditions) -> list[str]:
    rows = await db.execute(select(Card.name).where(*conditions).order_by(Card.name))
    return list(rows.scalars().all())


# ── card_flags: orphaned ─────────────────────────────────────────────────────


class TestOrphaned:
    async def test_a_card_whose_only_relation_is_planned_or_ended_is_orphaned(self, db, star):
        from app.services.card_flags import orphaned_condition

        names = await _names(db, orphaned_condition(), Card.type == "ITComponent")
        assert names == ["ended", "lonely", "planned"]

    async def test_the_hub_stays_connected_while_one_relation_counts(self, db, star):
        from app.services.card_flags import orphaned_condition

        assert await _names(db, orphaned_condition(), Card.type == "Application") == []

    async def test_a_hub_with_only_ended_relations_is_orphaned(self, db, star):
        from app.models.relation import Relation
        from app.services.card_flags import orphaned_condition

        rels = (await db.execute(select(Relation))).scalars().all()
        for rel in rels:
            rel.lifecycle = WINDOWS["ended"]
        await db.flush()
        assert await _names(db, orphaned_condition(), Card.type == "Application") == ["Hub"]

    async def test_connected_ids_are_both_ends_of_the_counting_relations(self, db, star):
        from app.services.card_flags import connected_card_ids

        ids = set((await db.execute(connected_card_ids())).scalars().all())
        assert ids == {star.hub.id, *(star.peers[n].id for n in COUNTING)}

    async def test_the_day_is_a_parameter(self, db, star):
        """On the day the planned relation starts it connects; the ended one
        stays ended."""
        from app.services.card_flags import connected_card_ids, orphaned_condition

        later = TODAY + timedelta(days=30)
        ids = set((await db.execute(connected_card_ids(today=later))).scalars().all())
        assert star.peers["planned"].id in ids
        assert star.peers["ended"].id not in ids
        names = await _names(db, orphaned_condition(today=later), Card.type == "ITComponent")
        # The "current" relation ends on that very day: endOfLife is inclusive.
        assert names == ["current", "ended", "lonely"]


# ── dashboard_query: the relation flags and the card query's hops ────────────


class TestDashboardRelationBuilders:
    async def test_relation_exists_counts_only_relations_in_effect(self, db, star):
        from app.services.dashboard_query import RelationSide, relation_exists

        other = aliased(Card)
        side = RelationSide(relation_type="relHubToItc", card_is_source=False)
        assert (
            await _names(db, Card.type == "ITComponent", relation_exists(Card, side, other))
            == COUNTING
        )

    async def test_relation_exists_threads_the_day(self, db, star):
        from app.services.dashboard_query import RelationSide, relation_exists

        other = aliased(Card)
        side = RelationSide(relation_type="relHubToItc", card_is_source=False)
        later = TODAY + timedelta(days=30)
        names = await _names(
            db, Card.type == "ITComponent", relation_exists(Card, side, other, today=later)
        )
        assert names == ["planned", "undated"]

    async def test_relation_exists_keeps_its_own_conditions(self, db, star):
        from app.services.dashboard_query import RelationSide, relation_exists

        other = aliased(Card)
        side = RelationSide(relation_type="relHubToItc", card_is_source=True)
        cond = relation_exists(Card, side, other, other.name == "planned")
        assert await _names(db, Card.type == "Application", cond) == []
        cond = relation_exists(Card, side, other, other.name == "current")
        assert await _names(db, Card.type == "Application", cond) == ["Hub"]

    async def test_relation_join_gives_one_row_per_counting_relation(self, db, star):
        from app.services.dashboard_query import RelationSide, relation_join

        far = aliased(Card)
        side = RelationSide(relation_type="relHubToItc", card_is_source=True)
        stmt = relation_join(select(far.name).select_from(Card), Card, side, far)
        rows = await db.execute(stmt.where(Card.id == star.hub.id).order_by(far.name))
        assert list(rows.scalars().all()) == COUNTING

    async def test_relation_join_threads_the_day(self, db, star):
        from app.services.dashboard_query import RelationSide, relation_join

        far = aliased(Card)
        side = RelationSide(relation_type="relHubToItc", card_is_source=True)
        stmt = relation_join(
            select(far.name).select_from(Card), Card, side, far, today=TODAY + timedelta(days=30)
        )
        rows = await db.execute(stmt.where(Card.id == star.hub.id).order_by(far.name))
        assert list(rows.scalars().all()) == ["planned", "undated"]


# ── dashboard_query.run_query: every relation reader reads the query's day ──

#: A day before every dated window: only the undated relation is in effect —
#: the ended one had not started yet (``active`` 2001), the others neither.
LONG_AGO = date(2000, 1, 1)
#: The day the planned relation starts and the current one ends (inclusive).
LATER = TODAY + timedelta(days=30)


async def _dash(db, today=None, **kwargs):
    from app.services.card_read_scope import CardReadScope
    from app.services.dashboard_query import DashboardQuery, resolve_query, run_query

    resolved = await resolve_query(db, DashboardQuery(**kwargs))
    return await run_query(db, resolved, CardReadScope.everything(), today=today)


def _named(result, key="key") -> dict[str, object]:
    """``{card name: value}`` of a card-keyed result."""
    return {result["labels"][row[key]]: row["value"] for row in result["rows"]}


class TestDashboardQueryDay:
    async def test_the_sankey_counts_relations_in_effect_on_the_day(self, db, star):
        query = {"relation_type": "relHubToItc", "group_by": "type", "group_by_2": "card"}
        today = await _dash(db, **query)
        assert _named(today, "target") == dict.fromkeys(COUNTING, 1)
        assert today["total"] == 2
        later = await _dash(db, today=LATER, **query)
        assert _named(later, "target") == {"planned": 1, "undated": 1}
        long_ago = await _dash(db, today=LONG_AGO, **query)
        assert _named(long_ago, "target") == {"undated": 1}

    async def test_a_related_dimension_groups_by_relations_in_effect(self, db, star):
        query = {"card_type": "Application", "group_by": "related:relHubToItc"}
        today = await _dash(db, **query)
        assert _named(today) == dict.fromkeys(COUNTING, 1)
        assert today["total"] == 1  # the hub, once
        assert _named(await _dash(db, today=LATER, **query)) == {"planned": 1, "undated": 1}
        assert _named(await _dash(db, today=LONG_AGO, **query)) == {"undated": 1}

    async def test_the_relations_measure_counts_relations_in_effect(self, db, star):
        query = {
            "card_type": "ITComponent",
            "group_by": "card",
            "metric": "sum",
            "metric_field": "@relations:relHubToItc",
        }

        def nonzero(result):
            return {name: v for name, v in _named(result).items() if v}

        assert nonzero(await _dash(db, **query)) == dict.fromkeys(COUNTING, 1)
        assert nonzero(await _dash(db, today=LATER, **query)) == {"planned": 1, "undated": 1}
        assert nonzero(await _dash(db, today=LONG_AGO, **query)) == {"undated": 1}

    async def test_the_relation_flag_reads_the_day_on_both_paths(self, db, star):
        flagged = {"card_type": "ITComponent", "flags": "related:relHubToItc"}
        # The grouped fast path (a bare total) …
        assert (await _dash(db, **flagged))["total"] == 2
        assert (await _dash(db, today=LONG_AGO, **flagged))["total"] == 1
        # … and the per-card path.
        per_card = {**flagged, "group_by": "card"}
        assert set(_named(await _dash(db, **per_card))) == set(COUNTING)
        assert set(_named(await _dash(db, today=LATER, **per_card))) == {"planned", "undated"}
        unflagged = {
            "card_type": "ITComponent",
            "flags": "unrelated:relHubToItc",
            "group_by": "card",
        }
        assert set(_named(await _dash(db, today=LONG_AGO, **unflagged))) == {
            "current",
            "ended",
            "lonely",
            "planned",
        }

    async def test_the_orphaned_flag_reads_the_day_on_both_paths(self, db, star):
        orphaned = {"card_type": "ITComponent", "flags": "orphaned"}
        assert (await _dash(db, **orphaned))["total"] == 3
        assert (await _dash(db, today=LONG_AGO, **orphaned))["total"] == 4
        per_card = {**orphaned, "group_by": "card"}
        assert set(_named(await _dash(db, **per_card))) == {"ended", "lonely", "planned"}
        assert set(_named(await _dash(db, today=LATER, **per_card))) == {
            "current",
            "ended",
            "lonely",
        }


# ── card_query: hops read the query's day ────────────────────────────────────


class TestCardQueryHopsDay:
    RAW = {"type": "Application", "related": [{"relation": "relHubToItc", "type": "ITComponent"}]}

    async def _hub_matches(self, db, raw, today=None) -> bool:
        from app.services.card_query import compile_card_query, parse_card_query
        from app.services.card_read_scope import CardReadScope

        clauses = await compile_card_query(
            db, parse_card_query(raw), CardReadScope.everything(), today=today
        )
        return await _names(db, Card.status == "ACTIVE", *clauses) == ["Hub"]

    async def test_a_hop_reaches_only_through_relations_in_effect_on_the_day(self, db, star):
        def to(name):
            hop = {
                "relation": "relHubToItc",
                "type": "ITComponent",
                "where": {"cards": [str(star.peers[name].id)]},
            }
            return {"type": "Application", "related": [hop]}

        today = {n: await self._hub_matches(db, to(n)) for n in WINDOWS}
        assert today == {"undated": True, "current": True, "planned": False, "ended": False}
        later = {n: await self._hub_matches(db, to(n), today=LATER) for n in WINDOWS}
        assert later == {"undated": True, "current": False, "planned": True, "ended": False}
        long_ago = {n: await self._hub_matches(db, to(n), today=LONG_AGO) for n in WINDOWS}
        assert long_ago == {"undated": True, "current": False, "planned": False, "ended": False}

    async def test_a_negated_hop_reads_the_day_too(self, db, star):
        hop = {
            "relation": "relHubToItc",
            "type": "ITComponent",
            "where": {"cards": [str(star.peers["planned"].id)]},
            "negate": True,
        }
        raw = {"type": "Application", "related": [hop]}
        assert await self._hub_matches(db, raw) is True
        assert await self._hub_matches(db, raw, today=LATER) is False

    async def test_the_matches_of_a_hop_read_the_day(self, db, star):
        from app.services.card_query import parse_card_query, resolve_card_query
        from app.services.card_query_matches import card_query_matches, match_nodes
        from app.services.card_read_scope import CardReadScope

        groups = await resolve_card_query(db, parse_card_query(self.RAW))
        scope = CardReadScope.everything()

        async def matched(today=None):
            found = await card_query_matches(
                db, match_nodes(groups, ["0:0"]), [star.hub.id], scope, today=today, limit=None
            )
            return sorted(c["name"] for c in found[str(star.hub.id)]["0:0"]["cards"])

        assert await matched() == COUNTING
        assert await matched(LATER) == ["planned", "undated"]
        assert await matched(LONG_AGO) == ["undated"]


# ── the formula context ──────────────────────────────────────────────────────


class TestCalculationContext:
    async def test_relations_and_relation_count_hold_only_relations_in_effect(self, db, star):
        from app.services.calculation_engine import build_shared_context

        shared = await build_shared_context(db, star.hub)
        assert sorted(e["name"] for e in shared["relations"]["relHubToItc"]) == COUNTING
        assert shared["relation_count"] == {"relHubToItc": 2}

    async def test_the_far_end_sees_its_side_the_same_way(self, db, star):
        from app.services.calculation_engine import build_shared_context

        for name, expected in (("undated", 1), ("current", 1), ("planned", 0), ("ended", 0)):
            shared = await build_shared_context(db, star.peers[name])
            assert shared["relation_count"] == {"relHubToItc": expected}, name


# ── mandatory relations ──────────────────────────────────────────────────────


class TestMandatoryRelations:
    async def test_a_mandatory_side_is_held_only_through_a_relation_in_effect(self, db, star):
        from app.services.card_completeness import (
            MandatoryConfig,
            MandatorySide,
            load_link_facts,
        )

        config = MandatoryConfig(
            sides=(
                MandatorySide(
                    key="relHubToItc",
                    label="is used by",
                    side="target",
                    other_type_key="Application",
                    side_key="relHubToItc",
                ),
            )
        )
        ids = [p.id for p in star.peers.values()]
        facts = await load_link_facts(db, config, ids)
        held = {name: facts[p.id].sides for name, p in star.peers.items()}
        assert held == {
            "undated": frozenset({("relHubToItc", "target")}),
            "current": frozenset({("relHubToItc", "target")}),
            "planned": frozenset(),
            "ended": frozenset(),
        }

    async def test_the_source_side_needs_one_relation_in_effect(self, db, star):
        from app.models.relation import Relation
        from app.services.card_completeness import (
            MandatoryConfig,
            MandatorySide,
            load_link_facts,
        )

        config = MandatoryConfig(
            sides=(
                MandatorySide(
                    key="relHubToItc",
                    label="uses",
                    side="source",
                    other_type_key="ITComponent",
                    side_key="relHubToItc",
                ),
            )
        )
        facts = await load_link_facts(db, config, [star.hub.id])
        assert facts[star.hub.id].sides == frozenset({("relHubToItc", "source")})
        for rel in (await db.execute(select(Relation))).scalars().all():
            rel.lifecycle = WINDOWS["planned"]
        await db.flush()
        facts = await load_link_facts(db, config, [star.hub.id])
        assert facts[star.hub.id].sides == frozenset()


# ── portal relation filters ──────────────────────────────────────────────────


class TestPortalRelationFilters:
    async def test_a_picked_card_matches_only_through_a_relation_in_effect(self, db, star):
        from app.services.portal_card_filters import relation_condition

        for name, matches in (
            ("undated", ["Hub"]),
            ("current", ["Hub"]),
            ("planned", []),
            ("ended", []),
        ):
            cond = relation_condition(
                "relHubToItc", [str(star.peers[name].id)], relation_type_keys=["relHubToItc"]
            )
            assert await _names(db, Card.type == "Application", cond) == matches, name

    async def test_empty_means_no_relation_in_effect(self, db, star):
        from app.services.portal_card_filters import EMPTY_KEY, relation_condition

        cond = relation_condition("relHubToItc", [EMPTY_KEY], relation_type_keys=["relHubToItc"])
        names = await _names(db, Card.type == "ITComponent", cond)
        assert names == ["ended", "lonely", "planned"]

    async def test_a_relation_subtype_matches_only_through_a_relation_in_effect(self, db, star):
        from app.models.relation import Relation
        from app.services.portal_card_filters import relation_subtype_condition

        for rel in (await db.execute(select(Relation))).scalars().all():
            rel.attributes = {"usage": "core"}
        await db.flush()
        cond = relation_subtype_condition(
            "relHubToItc::usage", ["core"], relation_type_keys=["relHubToItc"]
        )
        assert await _names(db, Card.type == "ITComponent", cond) == COUNTING


# ── PPM grouping ─────────────────────────────────────────────────────────────


class TestPpmGroupMap:
    async def test_an_initiative_is_grouped_only_through_a_relation_in_effect(self, db):
        from app.services.ppm_portfolio_service import build_group_map

        await create_card_type(db, key="Initiative", label="Initiative")
        await create_card_type(db, key="Organization", label="Organization")
        await create_relation_type(
            db, key="relInitToOrg", source_type_key="Initiative", target_type_key="Organization"
        )
        org = await create_card(db, card_type="Organization", name="Finance")
        inits = {}
        for name, lifecycle in WINDOWS.items():
            inits[name] = await create_card(db, card_type="Initiative", name=name)
            await create_relation(
                db,
                type_key="relInitToOrg",
                source_id=inits[name].id,
                target_id=org.id,
                lifecycle=lifecycle,
            )
        groups = await build_group_map(db, [i.id for i in inits.values()], "Organization")
        assert groups == {
            inits["undated"].id: (org.id, "Finance"),
            inits["current"].id: (org.id, "Finance"),
        }


# ── TurboLens loaders ────────────────────────────────────────────────────────


@pytest.fixture
async def vendors(db):
    """One Application linked to one Provider per window."""
    await create_card_type(db, key="Application", label="Application")
    await create_card_type(db, key="Provider", label="Provider")
    await create_relation_type(
        db, key="relAppToProvider", source_type_key="Application", target_type_key="Provider"
    )
    app = await create_card(db, card_type="Application", name="Billing")
    for name, lifecycle in WINDOWS.items():
        provider = await create_card(db, card_type="Provider", name=name)
        await create_relation(
            db,
            type_key="relAppToProvider",
            source_id=app.id,
            target_id=provider.id,
            lifecycle=lifecycle,
        )
    return app


class TestTurboLensLoaders:
    async def test_architect_landscape_names_only_current_vendors(self, db, vendors):
        from app.services.turbolens_architect import load_landscape

        land = await load_landscape(db)
        apps = {a["name"]: a for a in land["apps"]}
        assert sorted(json.loads(apps["Billing"]["vendors"])) == COUNTING

    async def test_duplicate_detection_names_only_current_vendors(self, db, vendors):
        from app.services.turbolens_duplicates import _load_cards_by_type

        by_type = await _load_cards_by_type(db, ["Application"])
        assert sorted(by_type["Application"][0]["vendors"]) == COUNTING

    async def test_vendor_analysis_names_only_current_vendors(self, db, vendors):
        from app.services.turbolens_vendors import _load_cards_with_vendors

        rows, providers = await _load_cards_with_vendors(db)
        assert [(r["name"], sorted(r["vendors"])) for r in rows] == [("Billing", COUNTING)]
        assert sorted(p["name"] for p in providers) == sorted(WINDOWS)


# ── the fiscal-year rule for relations (pure) ────────────────────────────────


class TestLiveRelationsInFiscalYear:
    def _rel(self, name, lifecycle):
        return SimpleNamespace(name=name, lifecycle=lifecycle)

    def test_keeps_the_relations_live_in_the_year_in_order(self):
        rels = [
            self._rel("undated", {}),
            self._rel("ends-this-year", {"active": "2020-03-01", "endOfLife": "2026-01-01"}),
            self._rel("ended-last-year", {"endOfLife": "2025-12-31"}),
            self._rel("starts-this-year", {"active": "2026-12-31"}),
            self._rel("starts-next-year", {"active": "2027-01-01"}),
            self._rel("only-planned", {"plan": "2020-01-01"}),
        ]
        kept = live_relations_in_fiscal_year(rels, 2026, 1)
        assert [r.name for r in kept] == ["undated", "ends-this-year", "starts-this-year"]

    def test_the_start_month_moves_the_year(self):
        """With an April start, 2026-02-01 falls in fiscal year 2026 and
        2026-05-01 in fiscal year 2027."""
        rels = [
            self._rel("ends-feb", {"endOfLife": "2026-02-01"}),
            self._rel("starts-may", {"active": "2026-05-01"}),
        ]
        assert [r.name for r in live_relations_in_fiscal_year(rels, 2026, 4)] == ["ends-feb"]
        assert [r.name for r in live_relations_in_fiscal_year(rels, 2027, 4)] == ["starts-may"]

    def test_an_empty_input_is_an_empty_list(self):
        assert live_relations_in_fiscal_year([], 2026, 1) == []


def test_the_windows_are_what_the_tests_say_they_are():
    """The shared fixture: the first two count today, the last two do not."""
    from app.services.lifecycle import lifecycle_in_effect

    assert {n for n, lc in WINDOWS.items() if lifecycle_in_effect(lc)} == set(COUNTING)
    assert lifecycle_in_effect(WINDOWS["planned"], on=TODAY + timedelta(days=30))
    assert FUTURE == (TODAY + timedelta(days=30)).isoformat()
