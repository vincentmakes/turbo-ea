"""EOL coverage predicates and status classification.

`card_flags` owns what "this card has no end-of-life information" means, and
`eol_service` owns what "end of life" / "approaching" mean. Three surfaces read
them — the inventory filter and column, the Data Quality tile, the EOL report —
so a disagreement here is a user clicking a count of 37 and landing on a list
of something else.
"""

from __future__ import annotations

from datetime import date, datetime, timedelta, timezone

import pytest
from sqlalchemy import func, select

from app.models.card import Card
from app.services.card_flags import (
    EOL_BUCKETS,
    EOL_TYPES,
    eol_bucket_condition,
    has_eol_coverage,
    has_eol_link,
    has_manual_eol,
)
from app.services.eol_service import (
    APPROACHING_DAYS,
    eol_status,
    find_cycle,
    manual_eol_status,
)
from tests.conftest import create_card, create_card_type, create_role, create_user


def _iso(days_from_now: int) -> str:
    return (datetime.now(timezone.utc).date() + timedelta(days=days_from_now)).isoformat()


class TestCoveragePredicates:
    def test_link_needs_both_halves(self):
        assert has_eol_link({"eol_product": "nginx", "eol_cycle": "1.25"}) is True
        # Half a link resolves to nothing upstream, so it is not coverage.
        assert has_eol_link({"eol_product": "nginx"}) is False
        assert has_eol_link({"eol_cycle": "1.25"}) is False
        assert has_eol_link({}) is False
        assert has_eol_link(None) is False

    def test_empty_strings_are_not_a_link(self):
        assert has_eol_link({"eol_product": "", "eol_cycle": ""}) is False

    def test_manual_date_is_coverage_in_its_own_right(self):
        assert has_manual_eol({"endOfLife": "2027-01-01"}) is True
        assert has_manual_eol({"active": "2020-01-01"}) is False
        assert has_manual_eol({}) is False
        assert has_manual_eol(None) is False

    def test_coverage_is_either_source(self):
        assert has_eol_coverage({"eol_product": "nginx", "eol_cycle": "1.25"}, None) is True
        assert has_eol_coverage(None, {"endOfLife": "2027-01-01"}) is True
        assert has_eol_coverage({}, {"active": "2020-01-01"}) is False

    def test_eligible_types(self):
        assert set(EOL_TYPES) == {"Application", "ITComponent"}


class TestApiStatus:
    def test_past_date_is_eol(self):
        assert eol_status(_iso(-1), None) == "eol"

    def test_true_is_eol_without_a_date(self):
        assert eol_status(True, None) == "eol"

    def test_within_the_window_is_approaching(self):
        assert eol_status(_iso(APPROACHING_DAYS - 5), None) == "approaching"

    def test_beyond_the_window_is_supported(self):
        assert eol_status(_iso(APPROACHING_DAYS + 60), None) == "supported"

    def test_ended_active_support_is_approaching(self):
        """Security-only maintenance is a warning even with the EOL date far off."""
        assert eol_status(_iso(400), _iso(-10)) == "approaching"

    def test_absent_upstream_data_is_unknown(self):
        assert eol_status(None, None) == "unknown"

    def test_unparseable_date_does_not_raise(self):
        assert eol_status("not-a-date", None) == "supported"


class TestManualStatus:
    def test_past_end_of_life(self):
        assert manual_eol_status({"endOfLife": _iso(-1)}) == "eol"

    def test_approaching_end_of_life(self):
        assert manual_eol_status({"endOfLife": _iso(30)}) == "approaching"

    def test_phase_out_started(self):
        assert manual_eol_status({"phaseOut": _iso(-3)}) == "approaching"

    def test_no_lifecycle_is_unknown(self):
        assert manual_eol_status(None) == "unknown"
        assert manual_eol_status({}) == "unknown"


class TestFindCycle:
    def test_matches_on_string_form(self):
        """Upstream cycles are sometimes numbers, the card always stores text."""
        cycles = [{"cycle": 1.25, "eol": "2027-01-01"}, {"cycle": "1.24"}]
        assert find_cycle(cycles, "1.25")["eol"] == "2027-01-01"

    def test_missing_cycle_returns_none(self):
        assert find_cycle([{"cycle": "1.24"}], "9.9") is None


@pytest.mark.parametrize(
    ("eol_value", "expected"),
    [(date.today().isoformat(), "eol"), (None, "unknown")],
)
def test_today_counts_as_reached(eol_value, expected):
    """A cycle whose EOL date is today is out of support, not "one day left"."""
    assert eol_status(eol_value, None) == expected


# ---------------------------------------------------------------------------
#  The Python predicates and their SQL twins must select the same rows
# ---------------------------------------------------------------------------

#: One card per awkward JSONB shape. `JsonNulls` is the case a `->`-based null
#: test misses; `Bare` / `NoAttrs` are the ones a naive `NOT (a AND b)` drops,
#: because `->>` yields SQL NULL and `NOT NULL` is not TRUE.
EOL_SHAPES = [
    ("Bare", {}, {}),
    ("NoAttrs", None, None),
    ("Linked", {"eol_product": "nginx", "eol_cycle": "1.25"}, {}),
    ("ProductOnly", {"eol_product": "nginx"}, {}),
    ("CycleOnly", {"eol_cycle": "1.25"}, {}),
    ("EmptyStrings", {"eol_product": "", "eol_cycle": ""}, {}),
    ("JsonNulls", {"eol_product": None, "eol_cycle": None}, {}),
    ("Manual", {}, {"endOfLife": "2027-01-01"}),
    ("ManualEmpty", {}, {"endOfLife": ""}),
    ("OtherPhaseOnly", {}, {"active": "2020-01-01"}),
    ("BothSources", {"eol_product": "nginx", "eol_cycle": "1.25"}, {"endOfLife": "2027-01-01"}),
]


def _python_bucket(card) -> str:
    """The dashboard's own classification, in the order its loop applies it."""
    if has_eol_link(card.attributes):
        return "linked"
    if has_manual_eol(card.lifecycle):
        return "manual"
    return "missing"


@pytest.fixture
async def eol_shapes(db):
    await create_role(db, key="admin", label="Admin", permissions={"*": True})
    admin = await create_user(db, email="admin@test.com", role="admin")
    await create_card_type(db, key="ITComponent", label="IT Component")
    await create_card_type(db, key="BusinessCapability", label="Business Capability")
    cards = [
        await create_card(
            db,
            card_type="ITComponent",
            name=name,
            attributes=attrs,
            lifecycle=lifecycle,
            user_id=admin.id,
        )
        for name, attrs, lifecycle in EOL_SHAPES
    ]
    # A type that carries no end of life at all must stay out of every bucket.
    await create_card(db, card_type="BusinessCapability", name="Payments", user_id=admin.id)
    await db.flush()
    return cards


class TestSqlMatchesPython:
    """The Data Quality chart counts in Python over loaded cards; its
    drill-down panel queries in SQL. Two implementations of one question is
    exactly how a count of 37 comes to list 34 cards."""

    @pytest.mark.parametrize("bucket", EOL_BUCKETS)
    async def test_sql_bucket_matches_the_python_predicate(self, db, eol_shapes, bucket):
        rows = await db.execute(select(Card.name).where(eol_bucket_condition(bucket)))
        assert set(rows.scalars().all()) == {
            c.name for c in eol_shapes if _python_bucket(c) == bucket
        }

    async def test_half_a_link_is_missing_not_linked(self, db, eol_shapes):
        """The rows a `NOT (product AND cycle)` would silently discard."""
        rows = await db.execute(select(Card.name).where(eol_bucket_condition("missing")))
        names = set(rows.scalars().all())
        for shape in ("ProductOnly", "CycleOnly", "EmptyStrings", "JsonNulls", "Bare", "NoAttrs"):
            assert shape in names, shape

    async def test_a_link_wins_over_a_manual_date(self, db, eol_shapes):
        """Same precedence as the dashboard's if/elif, so a card is counted once."""
        rows = await db.execute(select(Card.name).where(eol_bucket_condition("linked")))
        assert "BothSources" in set(rows.scalars().all())

    async def test_buckets_are_exhaustive_and_disjoint(self, db, eol_shapes):
        total = await db.execute(
            select(func.count()).select_from(Card).where(Card.type.in_(EOL_TYPES))
        )
        seen: set[str] = set()
        counted = 0
        for bucket in EOL_BUCKETS:
            rows = await db.execute(select(Card.name).where(eol_bucket_condition(bucket)))
            names = set(rows.scalars().all())
            assert not (names & seen), f"{bucket} overlaps an earlier bucket"
            seen |= names
            counted += len(names)
        assert counted == total.scalar_one()

    async def test_a_type_with_no_end_of_life_is_in_no_bucket(self, db, eol_shapes):
        for bucket in EOL_BUCKETS:
            rows = await db.execute(select(Card.name).where(eol_bucket_condition(bucket)))
            assert "Payments" not in set(rows.scalars().all())

    def test_unknown_bucket_raises(self):
        with pytest.raises(ValueError):
            eol_bucket_condition("bogus")
