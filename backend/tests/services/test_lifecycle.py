"""Unit tests for the shared lifecycle helpers (no database)."""

from __future__ import annotations

from datetime import date

import pytest

from app.services.lifecycle import (
    fiscal_year_span,
    is_live_in_fiscal_year,
    parse_lifecycle_date,
)


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


class TestFiscalYearSpan:
    def test_no_dates_is_the_current_year_padded(self):
        assert fiscal_year_span([None, {}, {"plan": "2010-01-01"}], 1, 2026) == (2025, 2027)

    def test_covers_active_and_end_of_life_dates_padded_by_one(self):
        lifecycles = [
            {"active": "2021-04-01", "endOfLife": "2024-01-01"},
            {"active": "2027-07-01", "endOfLife": "2031-03-01"},
        ]
        assert fiscal_year_span(lifecycles, 1, 2026) == (2020, 2032)

    def test_always_includes_the_current_year(self):
        lifecycles = [{"active": "2010-01-01", "endOfLife": "2012-01-01"}]
        assert fiscal_year_span(lifecycles, 1, 2026) == (2009, 2027)

    def test_uses_the_start_month(self):
        # 2026-10-15 is FY2027 on an October start.
        lifecycles = [{"endOfLife": "2026-10-15"}]
        assert fiscal_year_span(lifecycles, 10, 2026) == (2025, 2028)

    def test_ignores_phases_that_do_not_move_a_card_in_or_out(self):
        lifecycles = [{"plan": "2000-01-01", "phaseIn": "2001-01-01", "phaseOut": "2040-01-01"}]
        assert fiscal_year_span(lifecycles, 1, 2026) == (2025, 2027)
