"""End-of-life status as a card-query condition (``services/eol_query.py``).

The per-pair statuses must agree with ``resolve_eol_statuses`` (the
inventory's End of life column), the manual twin with ``manual_eol_status``,
and the SQL condition must select exactly the cards whose status was asked
for. Every set below is exact, with control cards that must not match: an
archived card (which still matches its own status once archived cards are
asked for), a card of a type that does not track EOL, a half link.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import pytest
from sqlalchemy import null, select, update
from sqlalchemy.dialects import postgresql
from sqlalchemy.orm import aliased

from app.models.card import Card
from app.models.eol_custom_cycle import EolCustomCycle
from app.models.eol_custom_product import EolCustomProduct
from app.services import eol_service
from app.services.card_query import ResolvedHop, ResolvedNode
from app.services.eol_custom_service import load_custom_cycles
from app.services.eol_query import (
    EOL_STATUS_VALUES,
    asks_eol_status,
    eol_condition_types,
    eol_pair_statuses,
    eol_pairs_for_types,
    eol_status_condition,
    has_eol_condition,
    load_eol_pair_statuses,
    manual_eol_status_sql,
)
from tests.conftest import create_card, create_card_type

TODAY = datetime.now(timezone.utc).date()


def _day(offset: int) -> str:
    return (TODAY + timedelta(days=offset)).isoformat()


PAST = _day(-30)
NEAR = _day(60)
FAR = _day(400)

#: Upstream cycles, as endoflife.date answers them.
UPSTREAM = {
    "nginx": [
        {"cycle": "0.1", "eol": PAST, "support": PAST},
        {"cycle": "1.0", "eol": PAST, "support": PAST},
        {"cycle": "1.1", "eol": NEAR, "support": NEAR},
        {"cycle": "1.2", "eol": FAR, "support": PAST},
        {"cycle": "1.3", "eol": FAR, "support": FAR},
        {"cycle": "1.4", "eol": False, "support": True},
    ],
}

#: Every linked pair of the fixture and the status it must resolve to.
EXPECTED_PAIRS = {
    # Only the archived AppArchived carries it.
    ("nginx", "0.1"): "eol",
    ("nginx", "1.0"): "eol",
    ("nginx", "1.1"): "approaching",
    ("nginx", "1.2"): "approaching",
    ("nginx", "1.3"): "supported",
    ("nginx", "1.4"): "supported",
    ("nginx", "9.9"): "unknown",
    ("custom:inhouse", "2"): "eol",
    ("custom:inhouse", "3"): "supported",
    ("custom:gone", "1"): "unknown",
}


@pytest.fixture
def upstream(monkeypatch):
    """``fetch_cycles_for_products`` answering from ``UPSTREAM``; the products
    it was asked for are recorded."""
    asked: list[set[str]] = []

    async def fake(products: set[str]) -> dict[str, list[dict]]:
        asked.append(set(products))
        return {p: UPSTREAM[p] for p in products if p in UPSTREAM}

    monkeypatch.setattr(eol_service, "fetch_cycles_for_products", fake)
    return asked


def _link(product: str, cycle: str) -> dict:
    return {"eol_product": product, "eol_cycle": cycle}


@pytest.fixture
async def eol_land(db):
    """Applications and IT Components in every EOL status, plus controls."""
    await create_card_type(db, key="Application")
    await create_card_type(db, key="ITComponent")
    await create_card_type(db, key="Organization")
    db.add(EolCustomProduct(key="inhouse", title="In-house"))
    await db.flush()
    db.add_all(
        [
            EolCustomCycle(product_key="inhouse", cycle="2", eol=PAST, support=False),
            EolCustomCycle(product_key="inhouse", cycle="3", eol=FAR, support=FAR),
        ]
    )
    cards = [
        ("Application", "AppEol", _link("nginx", "1.0"), {}),
        ("Application", "AppSoon", _link("nginx", "1.1"), {}),
        ("ITComponent", "ItcSupportEnded", _link("nginx", "1.2"), {}),
        ("ITComponent", "ItcSupported", _link("nginx", "1.3"), {}),
        ("ITComponent", "ItcNoEol", _link("nginx", "1.4"), {}),
        ("ITComponent", "ItcCycleGone", _link("nginx", "9.9"), {}),
        ("Application", "AppCustomEol", _link("custom:inhouse", "2"), {}),
        ("Application", "AppCustomOk", _link("custom:inhouse", "3"), {}),
        ("Application", "AppCustomGone", _link("custom:gone", "1"), {}),
        # A link wins over a manual date, as in resolve_eol_statuses.
        ("Application", "AppLinkAndManual", _link("nginx", "1.3"), {"endOfLife": PAST}),
        ("Application", "AppManualSoon", {}, {"endOfLife": NEAR}),
        ("Application", "AppManualPast", {}, {"endOfLife": PAST}),
        # Half a link is no link: the manual date decides.
        ("ITComponent", "ItcHalfManual", {"eol_product": "nginx"}, {"endOfLife": FAR}),
        ("ITComponent", "ItcHalfBare", {"eol_product": "nginx"}, {}),
        ("Application", "AppBare", {}, {"phaseOut": PAST}),
        # A type that does not track EOL here: never in any answer.
        ("Organization", "OrgLinked", _link("nginx", "1.0"), {}),
        ("Organization", "OrgBare", {}, {}),
    ]
    for type_key, name, attributes, lifecycle in cards:
        await create_card(
            db, card_type=type_key, name=name, attributes=attributes, lifecycle=lifecycle
        )
    # Archived, with a pair no active card shares: read all the same, and
    # matched only when archived cards are asked for.
    await create_card(db, name="AppArchived", status="ARCHIVED", attributes=_link("nginx", "0.1"))
    await create_card(db, name="AppArchivedBare", status="ARCHIVED")
    await db.flush()


EOL_TYPES = ("Application", "ITComponent")


async def _statuses(db) -> dict[tuple[str, str], str]:
    pairs = await eol_pairs_for_types(db, EOL_TYPES)
    custom = await load_custom_cycles(db, {p for p, _ in pairs})
    return await load_eol_pair_statuses(pairs, custom)


async def _matching(db, values: list[str], card=Card, status: str = "ACTIVE") -> set[str]:
    statuses = await _statuses(db)
    condition = eol_status_condition(card, values, statuses, eol_types=EOL_TYPES)
    rows = await db.execute(select(card.name).where(card.status == status, condition))
    return set(rows.scalars().all())


# ---------------------------------------------------------------------------
# Pairs and their statuses
# ---------------------------------------------------------------------------


class TestPairs:
    async def test_reads_the_links_of_every_card_of_the_types(self, db, eol_land):
        """Archived cards included: ``("nginx", "0.1")`` is on AppArchived only."""
        assert await eol_pairs_for_types(db, EOL_TYPES) == set(EXPECTED_PAIRS)

    async def test_one_type(self, db, eol_land):
        assert await eol_pairs_for_types(db, ["ITComponent"]) == {
            ("nginx", "1.2"),
            ("nginx", "1.3"),
            ("nginx", "1.4"),
            ("nginx", "9.9"),
        }

    async def test_no_type_reads_nothing(self, db, eol_land):
        assert await eol_pairs_for_types(db, []) == set()

    async def test_every_pair_resolves(self, db, eol_land, upstream):
        assert await _statuses(db) == EXPECTED_PAIRS
        # The custom products are asked for too, and simply not sent upstream
        # by fetch_cycles_for_products itself.
        assert upstream == [{"nginx", "custom:inhouse", "custom:gone"}]

    async def test_matches_the_inventory_column(self, db, eol_land, upstream):
        """Each pair's status is what ``resolve_eol_statuses`` shows for a card
        linked to it."""
        pairs = set(EXPECTED_PAIRS)
        custom = await load_custom_cycles(db, {p for p, _ in pairs})
        cards = [
            SimpleNamespace(id=f"{p}|{c}", attributes=_link(p, c), lifecycle={}) for p, c in pairs
        ]
        resolved = await eol_service.resolve_eol_statuses(cards, custom)
        column = {tuple(card_id.split("|")): e["status"] for card_id, e in resolved.items()}
        assert column == EXPECTED_PAIRS == await load_eol_pair_statuses(pairs, custom)

    def test_pure_classification(self):
        pairs = [("nginx", "1.0"), ("custom:x", "1"), ("custom:x", "2"), ("python", "3")]
        custom = {"custom:x": [{"cycle": "1", "eol": FAR, "support": PAST}]}
        assert eol_pair_statuses(pairs, UPSTREAM, custom) == {
            ("nginx", "1.0"): "eol",
            ("custom:x", "1"): "approaching",
            ("custom:x", "2"): "unknown",
            ("python", "3"): "unknown",
        }

    def test_a_custom_product_is_never_read_from_upstream(self):
        """A custom link looks in the custom cycles only, even when the
        upstream map happens to hold the same key."""
        upstream = {"custom:x": [{"cycle": "1", "eol": PAST}]}
        assert eol_pair_statuses([("custom:x", "1")], upstream, {}) == {
            ("custom:x", "1"): "unknown"
        }
        custom = {"nginx": [{"cycle": "1.0", "eol": FAR, "support": FAR}]}
        assert eol_pair_statuses([("nginx", "1.0")], UPSTREAM, custom) == {("nginx", "1.0"): "eol"}

    async def test_upstream_down_reads_unknown(self, monkeypatch):
        async def down(products):
            return {}

        monkeypatch.setattr(eol_service, "fetch_cycles_for_products", down)
        assert await load_eol_pair_statuses({("nginx", "1.0")}, {}) == {("nginx", "1.0"): "unknown"}


# ---------------------------------------------------------------------------
# The manual twin
# ---------------------------------------------------------------------------

LIFECYCLES: list = [
    # Every whole-lifecycle value Python reads as falsy is "unknown".
    None,
    {},
    [],
    "",
    0,
    False,
    {"endOfLife": None},
    {"endOfLife": ""},
    {"endOfLife": "garbage"},
    {"endOfLife": f"{PAST}T10:00:00"},
    {"endOfLife": 20200101},
    {"endOfLife": True},
    {"endOfLife": FAR},
    {"endOfLife": PAST},
    {"endOfLife": NEAR},
    {"endOfLife": TODAY.isoformat()},
    {"endOfLife": _day(1)},
    {"endOfLife": _day(eol_service.APPROACHING_DAYS)},
    {"endOfLife": _day(eol_service.APPROACHING_DAYS + 1)},
    {"phaseOut": PAST},
    {"phaseOut": TODAY.isoformat()},
    {"phaseOut": _day(1)},
    {"phaseOut": "nope"},
    # Text that sorts before today but is no YYYY-MM-DD date: the date guard
    # keeps it from reading as a passed phase-out.
    {"phaseOut": ""},
    {"phaseOut": 20200101},
    {"phaseOut": f"{PAST}T10:00:00"},
    {"endOfLife": FAR, "phaseOut": PAST},
    {"endOfLife": PAST, "phaseOut": PAST},
    {"endOfLife": FAR, "phaseOut": FAR},
    {"active": PAST},
]


class TestManualTwin:
    async def _parity(self, db, card) -> dict[str, str]:
        await create_card_type(db, key="Application")
        for i, lifecycle in enumerate(LIFECYCLES):
            await create_card(db, name=f"c{i}", lifecycle=lifecycle)
        # ``None`` above is stored as the JSON ``null``; a SQL NULL lifecycle
        # (a row written outside the ORM) is a shape of its own.
        sql_null = await create_card(db, name="sql_null")
        await db.execute(update(Card).where(Card.id == sql_null.id).values(lifecycle=null()))
        assert await db.scalar(select(Card.id).where(Card.lifecycle.is_(None))) == sql_null.id
        rows = await db.execute(select(card.name, manual_eol_status_sql(card, today=TODAY)))
        return dict(rows.all())

    @staticmethod
    def _expected() -> dict[str, str]:
        expected = {f"c{i}": eol_service.manual_eol_status(lc) for i, lc in enumerate(LIFECYCLES)}
        return {**expected, "sql_null": eol_service.manual_eol_status(None)}

    async def test_matches_python_for_every_shape(self, db):
        got = await self._parity(db, Card)
        expected = self._expected()
        assert got == expected
        assert expected["sql_null"] == "unknown"
        assert set(expected.values()) == {"eol", "approaching", "supported", "unknown"}

    async def test_matches_python_on_an_alias(self, db):
        got = await self._parity(db, aliased(Card))
        assert got == self._expected()

    async def test_the_default_day_is_the_utc_date(self, db, monkeypatch):
        """Without ``today`` the day is the UTC clock's, as in the Python
        twin — not the server's local one. The clock below answers a different
        year for any zone but UTC."""
        from app.services import eol_query

        class Clock:
            @staticmethod
            def now(tz=None):
                return (
                    datetime(2030, 6, 1, tzinfo=tz) if tz is timezone.utc else datetime(2000, 1, 1)
                )

        monkeypatch.setattr(eol_query, "datetime", Clock)
        await create_card_type(db, key="Application")
        await create_card(db, name="t", lifecycle={"endOfLife": "2020-01-01"})
        status = await db.scalar(select(manual_eol_status_sql()).where(Card.name == "t"))
        assert status == "eol"

    async def test_today_defaults_to_the_utc_clock(self, db):
        await create_card_type(db, key="Application")
        await create_card(db, name="t", lifecycle={"endOfLife": TODAY.isoformat()})
        status = await db.scalar(select(manual_eol_status_sql()).where(Card.name == "t"))
        assert status == "eol"

    async def test_an_explicit_today_moves_the_status(self, db):
        await create_card_type(db, key="Application")
        await create_card(db, name="t", lifecycle={"endOfLife": NEAR, "phaseOut": _day(5)})
        sql = manual_eol_status_sql(Card, today=TODAY - timedelta(days=200))
        assert await db.scalar(select(sql).where(Card.name == "t")) == "supported"
        sql = manual_eol_status_sql(Card, today=TODAY + timedelta(days=10))
        assert await db.scalar(select(sql).where(Card.name == "t")) == "approaching"


# ---------------------------------------------------------------------------
# The condition
# ---------------------------------------------------------------------------


class TestCondition:
    @pytest.mark.parametrize(
        ("values", "expected"),
        [
            (["eol"], {"AppEol", "AppCustomEol", "AppManualPast"}),
            (
                ["approaching"],
                {"AppSoon", "ItcSupportEnded", "AppManualSoon"},
            ),
            (
                ["supported"],
                {"ItcSupported", "ItcNoEol", "AppCustomOk", "AppLinkAndManual", "ItcHalfManual"},
            ),
            (["unknown"], {"ItcCycleGone", "AppCustomGone"}),
            (["__empty__"], {"ItcHalfBare", "AppBare"}),
            (
                ["eol", "__empty__"],
                {"AppEol", "AppCustomEol", "AppManualPast", "ItcHalfBare", "AppBare"},
            ),
        ],
    )
    async def test_selects_exactly_the_status(self, db, eol_land, upstream, values, expected):
        assert await _matching(db, values) == expected

    async def test_every_value_partitions_the_tracked_cards(self, db, eol_land, upstream):
        got = await _matching(db, list(EOL_STATUS_VALUES))
        rows = await db.execute(
            select(Card.name).where(Card.status == "ACTIVE", Card.type.in_(EOL_TYPES))
        )
        assert got == set(rows.scalars().all())
        assert "OrgLinked" not in got and "OrgBare" not in got

    @pytest.mark.parametrize(
        ("values", "expected"),
        [
            (["eol"], {"AppArchived"}),
            (["approaching"], set()),
            (["supported"], set()),
            (["unknown"], set()),
            (["__empty__"], {"AppArchivedBare"}),
        ],
    )
    async def test_an_archived_card_matches_its_own_status(
        self, db, eol_land, upstream, values, expected
    ):
        """AppArchived's pair is on no active card, yet it reads ``eol``."""
        assert await _matching(db, values, status="ARCHIVED") == expected

    async def test_every_value_partitions_the_archived_cards(self, db, eol_land, upstream):
        assert await _matching(db, list(EOL_STATUS_VALUES), status="ARCHIVED") == {
            "AppArchived",
            "AppArchivedBare",
        }

    async def test_compiles_against_an_alias(self, db, eol_land, upstream):
        assert await _matching(db, ["unknown"], aliased(Card)) == {"ItcCycleGone", "AppCustomGone"}

    async def test_no_matching_pair_is_a_false_clause(self, db, eol_land):
        """With no pair in the asked status the linked branch is ``false``,
        not an empty ``IN ()``; the manual branch still answers."""
        condition = eol_status_condition(Card, ["eol"], {}, eol_types=EOL_TYPES)
        rows = await db.execute(select(Card.name).where(Card.status == "ACTIVE", condition))
        assert set(rows.scalars().all()) == {"AppManualPast"}

    async def test_empty_alone_reads_no_pair_status(self, db, eol_land):
        """``__empty__`` is the coverage bucket ``missing``: the pair statuses
        handed in are never consulted."""
        poisoned = {("nginx", "1.0"): "eol", ("nginx", "1.3"): "eol"}
        for statuses in ({}, poisoned):
            condition = eol_status_condition(Card, ["__empty__"], statuses, eol_types=EOL_TYPES)
            rows = await db.execute(select(Card.name).where(Card.status == "ACTIVE", condition))
            assert set(rows.scalars().all()) == {"ItcHalfBare", "AppBare"}

    async def test_eol_types_narrow_every_branch(self, db, eol_land, upstream):
        statuses = await _statuses(db)
        condition = eol_status_condition(
            Card, list(EOL_STATUS_VALUES), statuses, eol_types=("ITComponent",)
        )
        rows = await db.execute(select(Card.name).where(Card.status == "ACTIVE", condition))
        assert set(rows.scalars().all()) == {
            "ItcSupportEnded",
            "ItcSupported",
            "ItcNoEol",
            "ItcCycleGone",
            "ItcHalfManual",
            "ItcHalfBare",
        }

    async def test_today_reaches_the_manual_branch(self, db, eol_land, upstream):
        statuses = await _statuses(db)
        later = TODAY + timedelta(days=90)
        condition = eol_status_condition(
            Card, ["eol"], statuses, eol_types=("Application",), today=later
        )
        rows = await db.execute(select(Card.name).where(Card.status == "ACTIVE", condition))
        assert set(rows.scalars().all()) == {
            "AppEol",
            "AppCustomEol",
            "AppManualPast",
            "AppManualSoon",
        }


class TestBoundParameters:
    """The matching pairs travel as two array parameters, however many."""

    @staticmethod
    def _params(pairs: dict[tuple[str, str], str]) -> dict:
        condition = eol_status_condition(Card, ["eol"], pairs, eol_types=EOL_TYPES, today=TODAY)
        statement = select(Card.name).where(condition)
        return statement.compile(dialect=postgresql.asyncpg.dialect()).params

    def test_the_parameter_count_does_not_grow_with_the_pairs(self):
        many = {(f"p{i}", f"c{i}"): "eol" for i in range(3000)}
        one = {("p0", "c0"): "eol"}
        assert len(self._params(many)) == len(self._params(one))
        # The two arrays, and no other parameter holding the pairs.
        lists = [v for v in self._params(many).values() if isinstance(v, list) and len(v) > 2]
        assert lists == [[p for p, _ in sorted(many)], [c for _, c in sorted(many)]]

    async def test_three_thousand_pairs_run(self, db, eol_land, upstream):
        """3,000 asked pairs — the fixture's own among them — run in one
        statement and select exactly the fixture's end-of-life cards."""
        pairs = {(f"product{i}", f"{i}"): "eol" for i in range(3000)}
        pairs.update(await _statuses(db))
        condition = eol_status_condition(Card, ["eol"], pairs, eol_types=EOL_TYPES)
        rows = await db.execute(select(Card.name).where(Card.status == "ACTIVE", condition))
        assert set(rows.scalars().all()) == {"AppEol", "AppCustomEol", "AppManualPast"}

    async def test_a_product_and_cycle_are_matched_as_a_pair(self, db, eol_land):
        """A product from one asked pair and a cycle from another never make
        a match: ``("nginx", "1.3")`` is not asked although both halves are."""
        pairs = {("nginx", "1.0"): "eol", ("other", "1.3"): "eol", ("nginx", "x"): "supported"}
        condition = eol_status_condition(Card, ["eol"], pairs, eol_types=("ITComponent",))
        rows = await db.execute(select(Card.name).where(Card.status == "ACTIVE", condition))
        assert set(rows.scalars().all()) == set()
        condition = eol_status_condition(Card, ["eol"], pairs, eol_types=EOL_TYPES)
        rows = await db.execute(select(Card.name).where(Card.status == "ACTIVE", condition))
        assert set(rows.scalars().all()) == {"AppEol", "AppManualPast"}


class TestConditionTypes:
    def _node(self, type_: str, eol: tuple[str, ...] = (), *hops: ResolvedNode) -> ResolvedNode:
        node = ResolvedNode(type_, None, {})
        node.eol_status = eol
        node.hops = [ResolvedHop(None, False, hop) for hop in hops]  # type: ignore[arg-type]
        return node

    def test_every_node_of_every_line(self):
        deep = self._node("ITComponent", ("eol",))
        groups = [
            [self._node("Organization", (), self._node("Application", (), deep))],
            [self._node("Application", ("unknown",)), self._node("Application")],
        ]
        assert eol_condition_types(groups) == {"ITComponent", "Application"}

    def test_none_without_a_condition(self):
        groups = [[self._node("Organization", (), self._node("Application"))]]
        assert eol_condition_types(groups) == set()
        assert has_eol_condition(groups) is False

    def test_empty_alone_needs_no_pairs_but_is_a_condition(self):
        deep = self._node("ITComponent", ("__empty__",))
        groups = [[self._node("Organization", (), self._node("Application", (), deep))]]
        assert eol_condition_types(groups) == set()
        assert has_eol_condition(groups) is True
        groups.append([self._node("Application", ("__empty__", "unknown"))])
        assert eol_condition_types(groups) == {"Application"}

    def test_has_a_condition_on_a_later_line(self):
        groups = [[self._node("Organization")], [self._node("Application", ("eol",))]]
        assert has_eol_condition(groups) is True

    @pytest.mark.parametrize(
        ("values", "asks"),
        [
            (("eol",), True),
            (("approaching",), True),
            (("supported",), True),
            (("unknown",), True),
            (("__empty__", "supported"), True),
            (("__empty__",), False),
            ((), False),
        ],
    )
    def test_asks_eol_status(self, values, asks):
        assert asks_eol_status(values) is asks
