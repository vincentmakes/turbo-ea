"""Fiscal-year arithmetic: which year a date belongs to, and the stored start month.

A fiscal year is named after the calendar year it ends in, so the edges that
matter are the start month itself (it opens the *next* year's name), January
(no shift at all) and every malformed stored setting (falls back to January).
"""

from __future__ import annotations

from datetime import date, datetime, timezone

import pytest

from app.models.app_settings import AppSettings
from app.services import fiscal_year as fiscal_year_module
from app.services.fiscal_year import (
    _fiscal_year,
    current_fiscal_year,
    fiscal_year_for,
    get_fiscal_year_start,
)


class TestFiscalYear:
    @pytest.mark.parametrize(
        "year, month, start, expected",
        [
            (2025, 1, 1, 2025),  # January start: the calendar year
            (2025, 12, 1, 2025),
            (2025, 1, 2, 2025),  # the month before a February start
            (2025, 2, 2, 2026),  # a February start opens the next year's name
            (2025, 9, 10, 2025),
            (2025, 10, 10, 2026),
            (2025, 11, 12, 2025),
            (2025, 12, 12, 2026),
            (2025, 12, 13, 2025),  # an impossible start month shifts nothing
            (2025, 12, 0, 2025),
        ],
    )
    def test_named_after_the_year_it_ends_in(self, year, month, start, expected):
        assert _fiscal_year(year, month, start) == expected

    def test_a_date(self):
        assert fiscal_year_for(date(2025, 10, 15), 10) == 2026
        assert fiscal_year_for(date(2025, 9, 30), 10) == 2025

    def test_no_date_is_no_year(self):
        assert fiscal_year_for(None, 10) is None


async def _stored(db, general):
    db.add(AppSettings(id="default", general_settings=general))
    await db.flush()
    return await get_fiscal_year_start(db)


class TestStoredStartMonth:
    async def test_no_settings_row_is_january(self, db):
        assert await get_fiscal_year_start(db) == 1

    @pytest.mark.parametrize("month", [1, 2, 11, 12])
    async def test_a_valid_month_is_read_as_stored(self, db, month):
        assert await _stored(db, {"fiscalYearStart": month}) == month

    @pytest.mark.parametrize(
        "general",
        [
            {},
            None,
            {"fiscalYearStart": None},
            {"fiscalYearStart": 0},
            {"fiscalYearStart": 13},
            {"fiscalYearStart": -3},
            {"fiscalYearStart": "3"},
            {"fiscalYearStart": 3.0},
        ],
    )
    async def test_anything_else_falls_back_to_january(self, db, general):
        assert await _stored(db, general) == 1


class _UtcOnlyClock(datetime):
    """UTC already says 1 October; the host's local clock still says 30 September."""

    @classmethod
    def now(cls, tz=None):
        if tz is timezone.utc:
            return datetime(2025, 10, 1, 0, 30, tzinfo=timezone.utc)
        return datetime(2025, 9, 30, 20, 30)


def test_today_is_read_in_utc(monkeypatch):
    monkeypatch.setattr(fiscal_year_module, "datetime", _UtcOnlyClock)
    assert current_fiscal_year(10) == 2026
