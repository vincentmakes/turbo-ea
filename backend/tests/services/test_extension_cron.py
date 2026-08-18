"""The extension-job cron parser (SDK 1.5) and the job-schedule XOR rule."""

from __future__ import annotations

from datetime import UTC, datetime

import pytest

from app.services.extensions.cron import CronError, next_fire, validate_cron
from app.services.extensions.jobs import validate_job_schedule
from app.services.extensions.sdk import ExtensionJob


def dt(*args) -> datetime:
    return datetime(*args, tzinfo=UTC)


class TestValidate:
    @pytest.mark.parametrize(
        "expr",
        [
            "* * * * *",
            "0 * * * *",
            "*/15 * * * *",
            "0 3 * * *",
            "30 6 1,15 * *",
            "0 0 * * 1-5",
            "0 12 * * 7",
            "5-50/5 8-18 * 3,6,9,12 *",
        ],
    )
    def test_valid_expressions(self, expr):
        validate_cron(expr)

    @pytest.mark.parametrize(
        "expr",
        [
            "",
            "* * * *",
            "* * * * * *",
            "60 * * * *",
            "* 24 * * *",
            "* * 0 * *",
            "* * 32 * *",
            "* * * 13 *",
            "* * * * 8",
            "a * * * *",
            "5-1 * * * *",
            "*/0 * * * *",
            "1,,2 * * * *",
        ],
    )
    def test_invalid_expressions(self, expr):
        with pytest.raises(CronError):
            validate_cron(expr)


class TestNextFire:
    def test_every_minute(self):
        assert next_fire("* * * * *", dt(2026, 8, 18, 10, 30, 45)) == dt(2026, 8, 18, 10, 31)

    def test_strictly_after(self):
        # An exact match on `after` still advances to the NEXT occurrence.
        assert next_fire("30 10 * * *", dt(2026, 8, 18, 10, 30)) == dt(2026, 8, 19, 10, 30)

    def test_hourly_at_minute_zero(self):
        assert next_fire("0 * * * *", dt(2026, 8, 18, 10, 30)) == dt(2026, 8, 18, 11, 0)

    def test_daily_rollover_to_next_day(self):
        assert next_fire("0 3 * * *", dt(2026, 8, 18, 4, 0)) == dt(2026, 8, 19, 3, 0)

    def test_month_rollover(self):
        assert next_fire("0 0 1 * *", dt(2026, 8, 18, 0, 0)) == dt(2026, 9, 1, 0, 0)

    def test_year_rollover(self):
        assert next_fire("0 0 1 1 *", dt(2026, 8, 18, 0, 0)) == dt(2027, 1, 1, 0, 0)

    def test_weekday_only(self):
        # 2026-08-21 is a Friday; 0 0 * * 1-5 next fires Saturday? No — the
        # next midnight in Mon-Fri after Friday 12:00 is Monday 2026-08-24.
        assert next_fire("0 0 * * 1-5", dt(2026, 8, 21, 12, 0)) == dt(2026, 8, 24, 0, 0)

    def test_sunday_as_seven(self):
        # 2026-08-23 is a Sunday; both 0 and 7 must match it.
        assert next_fire("0 9 * * 0", dt(2026, 8, 21, 0, 0)) == dt(2026, 8, 23, 9, 0)
        assert next_fire("0 9 * * 7", dt(2026, 8, 21, 0, 0)) == dt(2026, 8, 23, 9, 0)

    def test_vixie_dom_dow_or_semantics(self):
        # Both restricted → the day matches when EITHER does. From Tue
        # 2026-08-18, "0 0 13 * 5" (13th OR Friday) fires Fri 2026-08-21,
        # not Sun 2026-09-13.
        assert next_fire("0 0 13 * 5", dt(2026, 8, 18, 12, 0)) == dt(2026, 8, 21, 0, 0)

    def test_dom_only_restricted(self):
        assert next_fire("0 0 13 * *", dt(2026, 8, 18, 12, 0)) == dt(2026, 9, 13, 0, 0)

    def test_step_minutes(self):
        assert next_fire("*/15 * * * *", dt(2026, 8, 18, 10, 31)) == dt(2026, 8, 18, 10, 45)

    def test_naive_after_treated_as_utc(self):
        fired = next_fire("0 * * * *", datetime(2026, 8, 18, 10, 30))
        assert fired == dt(2026, 8, 18, 11, 0)
        assert fired.tzinfo is not None

    def test_unsatisfiable_expression_raises(self):
        with pytest.raises(CronError, match="never fires"):
            next_fire("0 0 31 2 *", dt(2026, 1, 1, 0, 0))

    def test_leap_day_found_across_years(self):
        assert next_fire("0 0 29 2 *", dt(2026, 3, 1, 0, 0)) == dt(2028, 2, 29, 0, 0)


class TestJobScheduleValidation:
    async def _run(self, ctx):
        pass

    def test_interval_only_is_valid(self):
        assert validate_job_schedule(ExtensionJob("t", 60, self._run)) is None

    def test_cron_only_is_valid(self):
        job = ExtensionJob(name="t", interval_seconds=None, run=self._run, cron="0 3 * * *")
        assert validate_job_schedule(job) is None

    def test_both_set_is_invalid(self):
        job = ExtensionJob(name="t", interval_seconds=60, run=self._run, cron="0 3 * * *")
        assert validate_job_schedule(job) is not None

    def test_neither_set_is_invalid(self):
        job = ExtensionJob(name="t", interval_seconds=None, run=self._run)
        assert validate_job_schedule(job) is not None

    def test_bad_cron_expression_is_invalid(self):
        job = ExtensionJob(name="t", interval_seconds=None, run=self._run, cron="not a cron")
        assert validate_job_schedule(job) is not None
