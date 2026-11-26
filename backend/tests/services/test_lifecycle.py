"""Tests for the shared lifecycle helpers.

Pure unit tests, plus one database-backed class (``TestInEffectSqlMatchesPython``)
that pins the SQL twin of "in effect on a date" to its Python definition over
real rows."""

from __future__ import annotations

from datetime import date, datetime, timezone

import pytest

from app.services.lifecycle import is_live_in_fiscal_year, parse_lifecycle_date


class TestParseLifecycleDate:
    @pytest.mark.parametrize(
        ("value", "expected"),
        [
            ("2026-03-15", date(2026, 3, 15)),
            ("2026-03-15T10:30:00", date(2026, 3, 15)),
            ("2026-03-15T10:30:00+02:00", date(2026, 3, 15)),
            (None, None),
            ("", None),
            ("not a date", None),
            ("2026-13-01", None),
            (12, None),
        ],
    )
    def test_parse(self, value, expected):
        assert parse_lifecycle_date(value) == expected


class TestIsLiveInFiscalYear:
    """The cost report's rule: full annual cost from FY(active) to FY(endOfLife)."""

    def test_counts_every_year_from_active_through_end_of_life_inclusive(self):
        lc = {"active": "2023-06-01", "endOfLife": "2026-11-30"}
        assert [fy for fy in range(2021, 2029) if is_live_in_fiscal_year(lc, fy, 1)] == [
            2023,
            2024,
            2025,
            2026,
        ]

    def test_no_pro_rating_at_either_end(self):
        # Goes live on the last day of the year and retires on the first day of
        # another: both years still count in full.
        lc = {"active": "2024-12-31", "endOfLife": "2026-01-01"}
        assert is_live_in_fiscal_year(lc, 2024, 1)
        assert is_live_in_fiscal_year(lc, 2026, 1)
        assert not is_live_in_fiscal_year(lc, 2027, 1)

    def test_end_of_life_in_an_earlier_year_is_excluded(self):
        lc = {"active": "2018-01-01", "endOfLife": "2022-05-01"}
        assert not is_live_in_fiscal_year(lc, 2023, 1)

    def test_start_month_moves_the_year_boundary(self):
        # October start: 2026-10-15 opens FY2027, 2026-09-30 closes FY2026.
        lc = {"active": "2026-10-15", "endOfLife": "2028-09-30"}
        assert not is_live_in_fiscal_year(lc, 2026, 10)
        assert is_live_in_fiscal_year(lc, 2027, 10)
        assert is_live_in_fiscal_year(lc, 2028, 10)
        assert not is_live_in_fiscal_year(lc, 2029, 10)
        # The same dates on a calendar-year install.
        assert is_live_in_fiscal_year(lc, 2026, 1)
        assert not is_live_in_fiscal_year(lc, 2029, 1)

    def test_no_dates_at_all_counts_in_every_year(self):
        for lc in (None, {}, {"active": ""}):
            assert is_live_in_fiscal_year(lc, 1990, 1)
            assert is_live_in_fiscal_year(lc, 2090, 1)

    @pytest.mark.parametrize("phase", ["plan", "phaseIn"])
    def test_planned_without_an_active_date_never_counts(self, phase):
        lc = {phase: "2020-01-01"}
        assert not is_live_in_fiscal_year(lc, 2020, 1)
        assert not is_live_in_fiscal_year(lc, 2030, 1)

    def test_active_date_wins_over_planned_phases(self):
        lc = {"plan": "2019-01-01", "phaseIn": "2020-01-01", "active": "2021-01-01"}
        assert not is_live_in_fiscal_year(lc, 2020, 1)
        assert is_live_in_fiscal_year(lc, 2021, 1)

    def test_no_active_date_but_phase_out_counts_as_started(self):
        lc = {"phaseOut": "2024-01-01", "endOfLife": "2025-06-01"}
        assert is_live_in_fiscal_year(lc, 2010, 1)
        assert is_live_in_fiscal_year(lc, 2025, 1)
        assert not is_live_in_fiscal_year(lc, 2026, 1)

    def test_no_end_of_life_never_retires(self):
        lc = {"active": "2020-01-01"}
        assert not is_live_in_fiscal_year(lc, 2019, 1)
        assert is_live_in_fiscal_year(lc, 2090, 1)

    def test_unparseable_dates_are_treated_as_absent(self):
        lc = {"active": "someday", "endOfLife": "never"}
        assert is_live_in_fiscal_year(lc, 2026, 1)

    def test_iso_timestamps_are_accepted(self):
        lc = {"active": "2025-02-01T00:00:00", "endOfLife": "2025-12-31T23:59:59"}
        assert is_live_in_fiscal_year(lc, 2025, 1)
        assert not is_live_in_fiscal_year(lc, 2026, 1)


class TestCurrentLifecyclePhase:
    """The phase a card is in today: the latest phase whose date has arrived."""

    @staticmethod
    def _today() -> date:
        from datetime import datetime, timezone

        return datetime.now(timezone.utc).date()

    def test_the_latest_arrived_phase_wins_over_earlier_ones(self):
        from datetime import timedelta

        from app.services.lifecycle import current_lifecycle_phase

        past = (self._today() - timedelta(days=30)).isoformat()
        future = (self._today() + timedelta(days=30)).isoformat()
        assert (
            current_lifecycle_phase({"plan": past, "active": past, "endOfLife": future}) == "active"
        )

    def test_a_phase_starting_today_has_arrived(self):
        from app.services.lifecycle import current_lifecycle_phase

        assert (
            current_lifecycle_phase({"plan": "2000-01-01", "active": self._today().isoformat()})
            == "active"
        )

    def test_all_dates_in_the_future_reads_as_the_earliest_set_phase(self):
        from datetime import timedelta

        from app.services.lifecycle import current_lifecycle_phase

        soon = (self._today() + timedelta(days=10)).isoformat()
        later = (self._today() + timedelta(days=20)).isoformat()
        assert current_lifecycle_phase({"active": later, "phaseIn": soon}) == "phaseIn"

    @pytest.mark.parametrize("lifecycle", [None, {}, {"plan": ""}, {"active": None}])
    def test_nothing_set_is_no_phase(self, lifecycle):
        from app.services.lifecycle import current_lifecycle_phase

        assert current_lifecycle_phase(lifecycle) is None


class _UtcOnlyClock(datetime):
    """UTC already says 1 October; the host's local clock still says 30 September."""

    @classmethod
    def now(cls, tz=None):
        if tz is timezone.utc:
            return datetime(2025, 10, 1, 0, 30, tzinfo=timezone.utc)
        return datetime(2025, 9, 30, 20, 30)


def test_the_current_phase_reads_today_in_utc(monkeypatch):
    from app.services import lifecycle
    from app.services.lifecycle import current_lifecycle_phase

    monkeypatch.setattr(lifecycle, "datetime", _UtcOnlyClock)
    assert current_lifecycle_phase({"phaseIn": "2025-01-01", "active": "2025-10-01"}) == "active"


def test_the_sql_twin_reads_today_in_utc(monkeypatch):
    """``current_lifecycle_phase_sql`` binds the same UTC "today" as its
    Python twin, never the host's local date."""
    from sqlalchemy.dialects import postgresql

    from app.services import lifecycle

    monkeypatch.setattr(lifecycle, "datetime", _UtcOnlyClock)
    compiled = lifecycle.current_lifecycle_phase_sql().compile(dialect=postgresql.dialect())
    bound = set(compiled.params.values())
    assert "2025-10-01" in bound
    assert "2025-09-30" not in bound


# ---------------------------------------------------------------------------
#  current_lifecycle_phase at a given date
# ---------------------------------------------------------------------------


class TestPhaseOnADate:
    LC = {"plan": "2020-01-01", "active": "2022-01-01", "endOfLife": "2025-01-01"}

    @pytest.mark.parametrize(
        ("today", "phase"),
        [
            (date(2019, 12, 31), "plan"),  # every date ahead: the earliest set phase
            (date(2020, 1, 1), "plan"),
            (date(2021, 12, 31), "plan"),
            (date(2022, 1, 1), "active"),
            (date(2024, 12, 31), "active"),
            (date(2025, 1, 1), "endOfLife"),
        ],
    )
    def test_the_phase_on_a_given_day(self, today, phase):
        from app.services.lifecycle import current_lifecycle_phase

        assert current_lifecycle_phase(self.LC, today=today) == phase

    def test_without_a_date_it_reads_today_in_utc(self, monkeypatch):
        from app.services import lifecycle
        from app.services.lifecycle import current_lifecycle_phase

        monkeypatch.setattr(lifecycle, "datetime", _UtcOnlyClock)
        assert current_lifecycle_phase({"plan": "2025-01-01", "active": "2025-10-01"}) == "active"


# ---------------------------------------------------------------------------
#  "In effect on a date" — the Python definition
# ---------------------------------------------------------------------------

#: The day every shape below is judged on.
ON = date(2026, 6, 15)

#: ``(name, lifecycle, in effect on ON)``. The awkward JSONB shapes are the
#: ones a SQL twin gets wrong: an absent key, JSON null, "", a malformed or
#: non-string date, an ISO timestamp, and the boundary days.
IN_EFFECT_SHAPES: list[tuple[str, object, bool]] = [
    ("Empty", {}, True),
    ("TopLevelJsonNull", None, True),
    ("TopLevelArray", ["2020-01-01"], True),
    ("ActiveJsonNull", {"active": None}, True),
    ("ActiveEmptyString", {"active": ""}, True),
    ("ActiveMalformed", {"active": "someday"}, True),
    ("ActiveNumber", {"active": 20200101}, True),
    ("ActiveMalformedButPlanned", {"active": "someday", "plan": "2020-01-01"}, False),
    ("OnlyPlanPast", {"plan": "2020-01-01"}, False),
    ("OnlyPhaseInFuture", {"phaseIn": "2030-01-01"}, False),
    ("PlanMalformed", {"plan": "soon"}, True),
    ("PlanBoolean", {"plan": True}, True),
    ("PlanEmptyString", {"plan": ""}, True),
    ("ActivePast", {"active": "2020-01-01"}, True),
    ("ActiveToday", {"active": "2026-06-15"}, True),
    ("ActiveTomorrow", {"active": "2026-06-16"}, False),
    ("ActiveTimestampToday", {"active": "2026-06-15T23:59:00"}, True),
    ("ActiveTimestampTomorrow", {"active": "2026-06-16T00:00:00Z"}, False),
    ("PlanPastActivePast", {"plan": "2019-01-01", "active": "2020-01-01"}, True),
    ("PlanPastActiveFuture", {"plan": "2019-01-01", "active": "2027-01-01"}, False),
    ("OnlyPhaseOutPast", {"phaseOut": "2020-01-01"}, True),
    ("OnlyEndOfLifeFuture", {"endOfLife": "2027-01-01"}, True),
    ("OnlyEndOfLifeTomorrow", {"endOfLife": "2026-06-16"}, True),
    ("OnlyEndOfLifeToday", {"endOfLife": "2026-06-15"}, False),
    ("OnlyEndOfLifePast", {"endOfLife": "2020-01-01"}, False),
    ("EndOfLifeTimestampToday", {"endOfLife": "2026-06-15T08:00:00+02:00"}, False),
    ("EndOfLifeJsonNull", {"active": "2020-01-01", "endOfLife": None}, True),
    ("EndOfLifeMalformed", {"active": "2020-01-01", "endOfLife": "never"}, True),
    ("ActiveThenEnded", {"active": "2020-01-01", "endOfLife": "2026-06-14"}, False),
    ("ActiveThenEndsLater", {"active": "2020-01-01", "endOfLife": "2026-12-31"}, True),
    ("PlannedAndEnded", {"plan": "2019-01-01", "endOfLife": "2030-01-01"}, False),
]


class TestLifecycleInEffect:
    @pytest.mark.parametrize(
        ("lifecycle", "expected"),
        [(lc, expected) for _, lc, expected in IN_EFFECT_SHAPES],
        ids=[name for name, _, _ in IN_EFFECT_SHAPES],
    )
    def test_the_matrix(self, lifecycle, expected):
        from app.services.lifecycle import lifecycle_in_effect

        assert lifecycle_in_effect(lifecycle, on=ON) is expected

    def test_without_a_date_it_reads_today_in_utc(self, monkeypatch):
        from app.services import lifecycle
        from app.services.lifecycle import lifecycle_in_effect

        monkeypatch.setattr(lifecycle, "datetime", _UtcOnlyClock)
        # UTC says 1 October; the local clock still says 30 September.
        assert lifecycle_in_effect({"active": "2025-10-01"}) is True
        assert lifecycle_in_effect({"endOfLife": "2025-10-01"}) is False

    def test_it_mirrors_the_cost_rule_at_day_granularity(self):
        """The same start rule as ``is_live_in_fiscal_year``: a plan without an
        active date is not started; no start date at all is."""
        from app.services.lifecycle import lifecycle_in_effect

        for lc in ({"plan": "2020-01-01"}, {"phaseIn": "2020-01-01"}):
            assert lifecycle_in_effect(lc, on=date(2090, 1, 1)) is False
            assert not is_live_in_fiscal_year(lc, 2090, 1)
        assert lifecycle_in_effect({}, on=date(1990, 1, 1)) is True


# ---------------------------------------------------------------------------
#  Validating a relation lifecycle
# ---------------------------------------------------------------------------


class TestNormalizeRelationLifecycle:
    def test_a_full_lifecycle_is_kept(self):
        from app.services.lifecycle import normalize_relation_lifecycle

        lc = {
            "plan": "2024-01-01",
            "phaseIn": "2024-03-01",
            "active": "2024-06-01",
            "phaseOut": "2029-01-01",
            "endOfLife": "2030-01-01",
        }
        assert normalize_relation_lifecycle(lc) == lc

    @pytest.mark.parametrize("value", [None, {}])
    def test_nothing_is_an_empty_lifecycle(self, value):
        from app.services.lifecycle import normalize_relation_lifecycle

        assert normalize_relation_lifecycle(value) == {}

    def test_empty_values_are_dropped(self):
        from app.services.lifecycle import normalize_relation_lifecycle

        assert normalize_relation_lifecycle(
            {"plan": None, "active": "", "endOfLife": "2030-01-01"}
        ) == {"endOfLife": "2030-01-01"}

    @pytest.mark.parametrize(
        ("raw", "stored"),
        [
            ("2026-03-15T10:30:00", "2026-03-15"),
            ("2026-03-15T23:30:00+02:00", "2026-03-15"),
            ("2026-3-5", "2026-03-05"),
        ],
    )
    def test_dates_are_stored_as_zero_padded_days(self, raw, stored):
        from app.services.lifecycle import normalize_relation_lifecycle

        assert normalize_relation_lifecycle({"active": raw}) == {"active": stored}

    def test_phase_order_is_not_checked(self):
        from app.services.lifecycle import normalize_relation_lifecycle

        lc = {"active": "2030-01-01", "endOfLife": "2020-01-01"}
        assert normalize_relation_lifecycle(lc) == lc

    @pytest.mark.parametrize("key", ["retired", "Active", "", "lifecycle"])
    def test_an_unknown_phase_is_refused_by_name(self, key):
        from app.services.lifecycle import normalize_relation_lifecycle

        with pytest.raises(ValueError, match=repr(key)):
            normalize_relation_lifecycle({key: "2026-01-01"})

    @pytest.mark.parametrize("value", ["someday", "2026-13-01", "2026-02-30", 20260101, True, []])
    def test_an_unreadable_date_is_refused_by_phase(self, value):
        from app.services.lifecycle import normalize_relation_lifecycle

        with pytest.raises(ValueError, match="'endOfLife'"):
            normalize_relation_lifecycle({"endOfLife": value})

    @pytest.mark.parametrize("value", ["2026-01-01", ["active"], 3])
    def test_a_lifecycle_must_be_an_object(self, value):
        from app.services.lifecycle import normalize_relation_lifecycle

        with pytest.raises(ValueError, match="must be an object"):
            normalize_relation_lifecycle(value)

    def test_whatever_it_stores_the_sql_twin_can_read(self):
        """Every stored date matches the SQL guard and starts with its day."""
        import re

        from app.services.lifecycle import _SQL_DATE_PATTERN, normalize_relation_lifecycle

        stored = normalize_relation_lifecycle(
            {"plan": "2026-1-5", "active": "2026-03-15T10:30:00Z", "endOfLife": "2030-12-31"}
        )
        assert all(re.match(_SQL_DATE_PATTERN, v) for v in stored.values())
        assert stored == {"plan": "2026-01-05", "active": "2026-03-15", "endOfLife": "2030-12-31"}


# ---------------------------------------------------------------------------
#  The SQL twin must select exactly the rows the Python definition does
# ---------------------------------------------------------------------------


@pytest.fixture
async def relation_shapes(db):
    from tests.conftest import create_card, create_card_type, create_relation, create_relation_type

    await create_card_type(db, key="Application", label="Application")
    await create_card_type(db, key="ITComponent", label="IT Component")
    await create_relation_type(db, key="app_to_itc", label="uses")
    app = await create_card(db, name="App")
    itc = await create_card(db, card_type="ITComponent", name="Server")
    rows = []
    for name, lifecycle, _ in IN_EFFECT_SHAPES:
        rel = await create_relation(db, source_id=app.id, target_id=itc.id, lifecycle=lifecycle)
        rel.description = name
        rows.append(rel)
    await db.flush()
    return rows


def _expected_in_effect() -> set[str]:
    return {name for name, _, expected in IN_EFFECT_SHAPES if expected}


class TestInEffectSqlMatchesPython:
    """Reports and flags will ask "is this relation in effect" in SQL, the
    write path and the frontend in code. Two implementations of one question
    is how a count of 37 comes to list 34 rows, so they are pinned equal."""

    async def test_sql_matches_python_over_every_shape(self, db, relation_shapes):
        from sqlalchemy import select

        from app.models.relation import Relation
        from app.services.lifecycle import lifecycle_in_effect, lifecycle_in_effect_sql

        rows = await db.execute(
            select(Relation.description).where(lifecycle_in_effect_sql(Relation, today=ON))
        )
        sql = set(rows.scalars().all())
        python = {r.description for r in relation_shapes if lifecycle_in_effect(r.lifecycle, on=ON)}
        assert sql == python == _expected_in_effect()

    async def test_the_negation_is_the_exact_complement(self, db, relation_shapes):
        """Every branch is two-valued, so NOT selects the rest — no row is
        lost to a NULL (the ``_jsonb_absent`` trap)."""
        from sqlalchemy import not_, select

        from app.models.relation import Relation
        from app.services.lifecycle import lifecycle_in_effect_sql

        rows = await db.execute(
            select(Relation.description).where(not_(lifecycle_in_effect_sql(Relation, today=ON)))
        )
        everything = {name for name, _, _ in IN_EFFECT_SHAPES}
        assert set(rows.scalars().all()) == everything - _expected_in_effect()

    async def test_an_alias_reads_the_same(self, db, relation_shapes):
        from sqlalchemy import select
        from sqlalchemy.orm import aliased

        from app.models.relation import Relation
        from app.services.lifecycle import lifecycle_in_effect_sql

        alias = aliased(Relation)
        rows = await db.execute(
            select(alias.description).where(lifecycle_in_effect_sql(alias, today=ON))
        )
        assert set(rows.scalars().all()) == _expected_in_effect()

    async def test_a_sql_null_lifecycle_is_in_effect(self, db):
        """``relations.lifecycle`` is NOT NULL, but the twin takes any entity
        with a lifecycle column — a card's may be SQL NULL."""
        from sqlalchemy import null, select, update

        from app.models.card import Card
        from app.services.lifecycle import lifecycle_in_effect, lifecycle_in_effect_sql
        from tests.conftest import create_card, create_card_type

        await create_card_type(db, key="Application", label="Application")
        card = await create_card(db, name="NoLifecycle")
        await db.execute(update(Card).where(Card.id == card.id).values(lifecycle=null()))
        rows = await db.execute(select(Card.name).where(lifecycle_in_effect_sql(Card, today=ON)))
        assert "NoLifecycle" in set(rows.scalars().all())
        assert lifecycle_in_effect(None, on=ON) is True

    async def test_a_new_relation_defaults_to_an_empty_lifecycle(self, db):
        """The column's server default is ``{}`` — always in effect."""
        from app.models.relation import Relation
        from tests.conftest import create_card, create_card_type, create_relation_type

        await create_card_type(db, key="Application", label="Application")
        await create_card_type(db, key="ITComponent", label="IT Component")
        await create_relation_type(db, key="app_to_itc", label="uses")
        app = await create_card(db, name="App")
        itc = await create_card(db, card_type="ITComponent", name="Server")
        rel = Relation(type="app_to_itc", source_id=app.id, target_id=itc.id)
        db.add(rel)
        await db.flush()
        await db.refresh(rel)
        assert rel.lifecycle == {}


def test_the_in_effect_sql_twin_reads_today_in_utc(monkeypatch):
    from sqlalchemy.dialects import postgresql

    from app.models.relation import Relation
    from app.services import lifecycle

    monkeypatch.setattr(lifecycle, "datetime", _UtcOnlyClock)
    compiled = lifecycle.lifecycle_in_effect_sql(Relation).compile(dialect=postgresql.dialect())
    bound = set(compiled.params.values())
    assert "2025-10-01" in bound
    assert "2025-09-30" not in bound


def test_the_in_effect_sql_twin_never_casts_to_date():
    """One malformed row must not fail a whole report, which a cast would."""
    from sqlalchemy.dialects import postgresql

    from app.models.relation import Relation
    from app.services.lifecycle import lifecycle_in_effect_sql

    sql = str(
        lifecycle_in_effect_sql(Relation, today=ON).compile(dialect=postgresql.dialect())
    ).lower()
    assert "::date" not in sql and "cast(" not in sql


# ---------------------------------------------------------------------------
#  link_keys_in_effect — a collapse of several relation rows into one link
# ---------------------------------------------------------------------------


class TestLinkKeysInEffect:
    ON = date(2030, 6, 1)

    def test_an_undated_key_is_always_in_effect(self):
        from app.services.lifecycle import link_keys_in_effect

        assert link_keys_in_effect({}, {"a"}, on=self.ON) == {"a"}

    def test_a_dated_key_needs_one_row_in_effect(self):
        from app.services.lifecycle import link_keys_in_effect

        dated = {
            "ended": [{"endOfLife": "2030-06-01"}],
            "planned": [{"active": "2030-06-02"}],
            "both": [{"endOfLife": "2030-05-01"}, {"active": "2030-06-01"}],
            "current": [{"active": "2030-01-01", "endOfLife": "2030-06-02"}],
        }
        assert link_keys_in_effect(dated, set(), on=self.ON) == {"both", "current"}

    def test_an_undated_row_wins_over_an_ended_one(self):
        from app.services.lifecycle import link_keys_in_effect

        assert link_keys_in_effect({"a": [{"endOfLife": "2001-01-01"}]}, ["a"], on=self.ON) == {"a"}

    def test_the_day_is_threaded(self):
        from app.services.lifecycle import link_keys_in_effect

        dated = {"a": [{"active": "2030-06-01"}]}
        assert link_keys_in_effect(dated, (), on=date(2030, 5, 31)) == set()
        assert link_keys_in_effect(dated, (), on=self.ON) == {"a"}


# ---------------------------------------------------------------------------
#  lifecycle_breadth — which row speaks for a collapse of several
# ---------------------------------------------------------------------------


class TestLifecycleBreadth:
    ON = date(2030, 6, 1)

    def _widest(self, *lifecycles):
        from app.services.lifecycle import lifecycle_breadth

        return max(lifecycles, key=lambda lc: lifecycle_breadth(lc, on=self.ON))

    def test_undated_is_widest(self):
        from app.services.lifecycle import lifecycle_breadth

        assert lifecycle_breadth({}, on=self.ON) == (2, date.max)
        assert lifecycle_breadth(None, on=self.ON) == (2, date.max)
        assert self._widest({"endOfLife": "2001-01-01"}, {}) == {}
        assert self._widest({}, {"active": "2001-01-01"}) == {}

    def test_in_effect_beats_not_in_effect(self):
        from app.services.lifecycle import lifecycle_breadth

        current = {"active": "2030-01-01", "endOfLife": "2030-07-01"}
        planned = {"active": "2031-01-01"}  # never ends, but not in effect
        assert lifecycle_breadth(current, on=self.ON) == (1, date(2030, 7, 1))
        assert lifecycle_breadth(planned, on=self.ON) == (0, date.max)
        assert self._widest(planned, current) == current
        assert self._widest(current, planned) == current

    def test_then_the_latest_end_and_no_end_is_latest(self):
        early = {"endOfLife": "2020-01-01"}
        late = {"endOfLife": "2025-01-01"}
        assert self._widest(early, late) == late
        assert self._widest(late, early) == late
        open_ended = {"active": "2030-01-01"}
        ending = {"active": "2030-01-01", "endOfLife": "2040-01-01"}
        assert self._widest(ending, open_ended) == open_ended

    def test_the_day_is_threaded(self):
        from app.services.lifecycle import lifecycle_breadth

        lc = {"active": "2030-06-01"}
        assert lifecycle_breadth(lc, on=date(2030, 5, 31))[0] == 0
        assert lifecycle_breadth(lc, on=self.ON)[0] == 1
