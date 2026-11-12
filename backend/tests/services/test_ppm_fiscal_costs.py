"""Unit tests: an Initiative's PPM budget and actuals for one fiscal year.

``app.services.ppm_fiscal_costs`` is what the Cost report and the dashboard's
cost sum read an Initiative's ``costBudget`` / ``costActual`` through
(discussion #1362). The pure functions are pinned with exact numbers; the
loader's no-query fast path with a session that fails on any query; and the
loader against ``build_ppm_map``'s ``byYear`` so the report and a
``ppm.byYear`` formula cannot disagree.
"""

from __future__ import annotations

from datetime import date

import pytest

from app.services import card_write_service
from app.services.calculation_ppm import build_ppm_map
from app.services.ppm_fiscal_costs import (
    ACTUAL_FIELD,
    BUDGET_FIELD,
    EMPTY,
    PPM_COST_FIELDS,
    FiscalCosts,
    LineSums,
    actual_in_year,
    applies,
    budget_in_year,
    load_fiscal_costs,
)
from tests.conftest import create_budget_line, create_card, create_card_type, create_cost_line


def test_the_constants():
    assert BUDGET_FIELD == "costBudget"
    assert ACTUAL_FIELD == "costActual"
    assert PPM_COST_FIELDS == frozenset({"costBudget", "costActual"})
    # One definition: calculations skip exactly the fields the report slices.
    assert card_write_service._PPM_MANAGED_FIELDS is PPM_COST_FIELDS


def S(in_year: float, all_lines: float) -> LineSums:  # noqa: N802 - reads like a literal
    return LineSums(in_year=in_year, all_lines=all_lines)


class TestBudgetInYear:
    def test_sums_the_years_lines_and_all_lines(self):
        rows = [("a", 2026, 25_000.0), ("a", 2027, 25_000.0), ("a", 2026, 1_500.5)]
        assert budget_in_year(rows, 2026) == {"a": S(26_500.5, 51_500.5)}

    def test_lines_only_in_other_years_register_at_zero(self):
        assert budget_in_year([("a", 2025, 10.0), ("a", 2027, 20.0)], 2026) == {"a": S(0.0, 30.0)}

    def test_initiatives_are_kept_apart_and_keyed_by_string(self):
        rows = [(1, 2026, 10.0), (2, 2026, 20.0), (2, 2025, 40.0)]
        assert budget_in_year(rows, 2026) == {"1": S(10.0, 10.0), "2": S(20.0, 60.0)}

    def test_a_null_amount_adds_nothing(self):
        assert budget_in_year([("a", 2026, None), ("a", 2026, 5.0)], 2026) == {"a": S(5.0, 5.0)}

    def test_no_rows_is_empty(self):
        assert budget_in_year([], 2026) == {}


class TestActualInYear:
    def test_january_start_is_the_calendar_year(self):
        rows = [
            ("a", 2025, 12, 1.0),
            ("a", 2026, 1, 10.0),
            ("a", 2026, 12, 100.0),
            ("a", 2027, 1, 1_000.0),
        ]
        assert actual_in_year(rows, 2026, 1) == {"a": S(110.0, 1_111.0)}

    def test_october_start_month_on_and_before_the_boundary(self):
        rows = [
            ("a", 2025, 9, 1.0),  # closes FY2025
            ("a", 2025, 10, 10.0),  # opens FY2026
            ("a", 2026, 9, 100.0),  # closes FY2026
            ("a", 2026, 10, 1_000.0),  # opens FY2027
        ]
        assert actual_in_year(rows, 2026, 10) == {"a": S(110.0, 1_111.0)}
        assert actual_in_year(rows, 2027, 10) == {"a": S(1_000.0, 1_111.0)}
        assert actual_in_year(rows, 2025, 10) == {"a": S(1.0, 1_111.0)}

    def test_undated_rows_count_in_all_lines_and_in_no_year(self):
        assert actual_in_year([("a", None, None, 500.0)], 2026, 1) == {"a": S(0.0, 500.0)}
        assert actual_in_year([("a", None, None, 500.0), ("a", 2026, 3, 7.0)], 2026, 1) == {
            "a": S(7.0, 507.0)
        }

    def test_a_half_dated_row_counts_in_no_year(self):
        assert actual_in_year([("a", 2026, None, 5.0), ("b", None, 3, 6.0)], 2026, 1) == {
            "a": S(0.0, 5.0),
            "b": S(0.0, 6.0),
        }

    def test_sql_numerics_are_accepted(self):
        # ``extract`` returns a Decimal / float year and month.
        assert actual_in_year([("a", 2026.0, 3.0, 5.0)], 2026, 1) == {"a": S(5.0, 5.0)}

    def test_initiatives_are_kept_apart_and_a_null_actual_adds_nothing(self):
        rows = [("a", 2026, 1, 1.0), ("b", 2026, 1, 2.0), ("b", 2026, 2, None)]
        assert actual_in_year(rows, 2026, 1) == {"a": S(1.0, 1.0), "b": S(2.0, 2.0)}


class TestFiscalCosts:
    costs = FiscalCosts(
        by_field={
            BUDGET_FIELD: {
                "a": S(25_000.0, 50_000.0),  # two years
                "one": S(25_000.0, 25_000.0),  # this year only
                "z": S(0.0, 40_000.0),  # other years only
            },
            ACTUAL_FIELD: {"a": S(300.0, 300.0)},
        }
    )

    def test_a_sliced_value_replaces_the_stored_one(self):
        assert self.costs.value("a", BUDGET_FIELD, {"costBudget": 50_000}) == 25_000.0
        assert self.costs.lifetime("a", BUDGET_FIELD) == 50_000.0

    def test_the_lifetime_comes_from_the_lines_not_the_attribute(self):
        """Lines written without the cost sync (seeder, import, workspace
        applier) leave the attribute missing or stale: the lines still say."""
        for attrs in ({}, {"costBudget": 0}, {"costBudget": 1_000}, None):
            assert self.costs.value("a", BUDGET_FIELD, attrs) == 25_000.0
            assert self.costs.lifetime("a", BUDGET_FIELD) == 50_000.0
            assert self.costs.total("a", [BUDGET_FIELD], attrs) == (25_000.0, 50_000.0)

    def test_no_lifetime_when_the_year_is_the_whole(self):
        assert self.costs.value("one", BUDGET_FIELD, {"costBudget": 25_000}) == 25_000.0
        assert self.costs.lifetime("one", BUDGET_FIELD) is None
        assert self.costs.total("one", [BUDGET_FIELD], {}) == (25_000.0, None)
        assert self.costs.lifetime("a", ACTUAL_FIELD) is None

    def test_a_slice_of_zero_still_replaces(self):
        assert self.costs.value("z", BUDGET_FIELD, {"costBudget": 40_000}) == 0.0
        assert self.costs.lifetime("z", BUDGET_FIELD) == 40_000.0
        assert self.costs.is_sliced("z", BUDGET_FIELD)

    def test_no_lines_keeps_the_stored_value_through_cost_value(self):
        assert self.costs.value("b", BUDGET_FIELD, {"costBudget": "1200"}) == 1200.0
        assert self.costs.value("b", BUDGET_FIELD, {"costBudget": "abc"}) == 0
        assert self.costs.value("b", BUDGET_FIELD, None) == 0
        assert self.costs.lifetime("b", BUDGET_FIELD) is None
        assert not self.costs.is_sliced("b", BUDGET_FIELD)

    def test_fields_are_independent(self):
        assert self.costs.value("one", ACTUAL_FIELD, {"costActual": 9}) == 9
        assert self.costs.lifetime("one", ACTUAL_FIELD) is None
        assert not self.costs.is_sliced("one", ACTUAL_FIELD)

    def test_card_ids_are_compared_as_strings(self):
        costs = FiscalCosts(by_field={BUDGET_FIELD: {"1": S(3.0, 4.0)}})
        assert costs.value(1, BUDGET_FIELD, {}) == 3.0
        assert costs.lifetime(1, BUDGET_FIELD) == 4.0

    def test_total_over_several_fields(self):
        attrs = {"costBudget": 50_000, "costActual": 3_000}
        # Budget sliced with a lifetime; actual sliced, whole in the year.
        assert self.costs.total("a", [BUDGET_FIELD, ACTUAL_FIELD], attrs) == (25_300.0, 50_300.0)
        # Budget whole in the year, actual typed: nothing outside the year.
        assert self.costs.total("one", [BUDGET_FIELD, ACTUAL_FIELD], attrs) == (28_000.0, None)
        # Other years only, actual typed: the typed actual adds to both.
        assert self.costs.total("z", [BUDGET_FIELD, ACTUAL_FIELD], attrs) == (3_000.0, 43_000.0)
        # Nothing sliced: no total, integers stay integers.
        year, whole = self.costs.total("b", [BUDGET_FIELD, ACTUAL_FIELD], attrs)
        assert (year, whole) == (53_000, None)
        assert isinstance(year, int)
        assert self.costs.total("b", [], attrs) == (0, None)

    def test_empty_slices_nothing(self):
        assert EMPTY.value("a", BUDGET_FIELD, {"costBudget": 5}) == 5
        assert EMPTY.lifetime("a", BUDGET_FIELD) is None


@pytest.mark.parametrize(
    "card_type, fields, expected",
    [
        ("Initiative", ["costBudget"], True),
        ("Initiative", ["costTotalAnnual", "costActual"], True),
        ("Initiative", ["costTotalAnnual"], False),
        ("Application", ["costBudget"], False),
        (None, ["costBudget"], False),
        ("Initiative", [], False),
    ],
)
def test_applies(card_type, fields, expected):
    assert applies(card_type, fields) is expected


class _CountingSession:
    """Counts queries; the fast path must leave it at zero."""

    def __init__(self) -> None:
        self.queries = 0

    async def execute(self, *args, **kwargs):
        self.queries += 1
        raise AssertionError("the fast path issued a query")


@pytest.mark.parametrize(
    "card_type, fields, ids",
    [
        ("Application", ["costTotalAnnual"], ["x"]),
        ("Application", ["costBudget"], ["x"]),
        ("Initiative", ["costTotalAnnual"], ["x"]),
        ("Initiative", ["costBudget"], []),
    ],
)
async def test_the_loader_issues_no_query_off_the_initiative_fields(card_type, fields, ids):
    session = _CountingSession()
    costs = await load_fiscal_costs(
        session,  # type: ignore[arg-type]
        card_type=card_type,
        field_keys=fields,
        initiative_ids=ids,
        fiscal_year=2026,
        start_month=1,
    )
    assert costs is EMPTY
    assert session.queries == 0


class TestLoader:
    async def _two_initiatives(self, db):
        await create_card_type(db, key="Initiative", label="Initiative")
        a = await create_card(db, card_type="Initiative", name="A")
        b = await create_card(db, card_type="Initiative", name="B")
        none = await create_card(db, card_type="Initiative", name="No lines")
        for year, amount in ((2025, 1.0), (2026, 10.0), (2026, 20.0), (2027, 100.0)):
            await create_budget_line(db, initiative_id=a.id, fiscal_year=year, amount=amount)
        await create_budget_line(db, initiative_id=b.id, fiscal_year=2027, amount=5.0)
        for day, actual in (
            (date(2025, 9, 30), 1.0),
            (date(2025, 10, 1), 10.0),
            (date(2026, 9, 30), 100.0),
            (date(2026, 10, 1), 1_000.0),
            (None, 10_000.0),
        ):
            await create_cost_line(db, initiative_id=a.id, actual=actual, date=day)
        await create_cost_line(db, initiative_id=b.id, actual=7.0, date=None)
        return a, b, none

    async def test_loads_each_field_for_the_given_ids_only(self, db):
        a, b, none = await self._two_initiatives(db)
        costs = await load_fiscal_costs(
            db,
            card_type="Initiative",
            field_keys=[BUDGET_FIELD, ACTUAL_FIELD],
            initiative_ids=[a.id, b.id, none.id],
            fiscal_year=2026,
            start_month=10,
        )
        assert costs.by_field == {
            BUDGET_FIELD: {str(a.id): S(30.0, 131.0), str(b.id): S(0.0, 5.0)},
            ACTUAL_FIELD: {str(a.id): S(110.0, 11_111.0), str(b.id): S(0.0, 7.0)},
        }
        only_a = await load_fiscal_costs(
            db,
            card_type="Initiative",
            field_keys=[ACTUAL_FIELD],
            initiative_ids=[a.id],
            fiscal_year=2026,
            start_month=10,
        )
        assert only_a.by_field == {ACTUAL_FIELD: {str(a.id): S(110.0, 11_111.0)}}

    @pytest.mark.parametrize("start_month", [1, 4, 10])
    async def test_agrees_with_build_ppm_map_by_year(self, db, start_month):
        a, b, none = await self._two_initiatives(db)
        ids = [a.id, b.id, none.id]
        ppm = await build_ppm_map(db, ids, start_month=start_month, today=date(2026, 6, 1))
        for year in (2025, 2026, 2027, 2028):
            costs = await load_fiscal_costs(
                db,
                card_type="Initiative",
                field_keys=[BUDGET_FIELD, ACTUAL_FIELD],
                initiative_ids=ids,
                fiscal_year=year,
                start_month=start_month,
            )
            for card in (a, b):
                by_year = {row["year"]: row for row in ppm[str(card.id)]["byYear"]}
                row = by_year.get(year, {"totalBudget": 0.0, "totalActual": 0.0})
                assert costs.value(card.id, BUDGET_FIELD, {}) == row["totalBudget"]
                assert costs.value(card.id, ACTUAL_FIELD, {}) == row["totalActual"]
                # The all-lines figure is ``ppm.totalBudget`` / ``ppm.totalActual``
                # (undated cost lines included).
                payload = ppm[str(card.id)]
                assert (
                    costs.by_field[BUDGET_FIELD][str(card.id)].all_lines == (payload["totalBudget"])
                )
                assert (
                    costs.by_field[ACTUAL_FIELD][str(card.id)].all_lines == (payload["totalActual"])
                )
