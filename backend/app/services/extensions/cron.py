"""Tiny 5-field cron parser for extension job scheduling (SDK 1.5).

Deliberately minimal and dependency-free: numeric fields only (no month or
weekday names), supporting ``*``, ``*/step``, ``a``, ``a-b``, ``a-b/step``
and comma lists. Expressions are evaluated in **UTC**. Day-of-month and
day-of-week follow the classic vixie-cron rule: when BOTH are restricted
the day matches if EITHER does; when only one is restricted, that one
decides. Sunday is both ``0`` and ``7``.

This exists so :class:`~app.services.extensions.sdk.ExtensionJob` can carry
a ``cron`` schedule without pulling a scheduling dependency into core.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

_FIELD_RANGES = (
    ("minute", 0, 59),
    ("hour", 0, 23),
    ("day-of-month", 1, 31),
    ("month", 1, 12),
    ("day-of-week", 0, 7),
)

# Bound the next-fire search. 4 years and a bit covers every satisfiable
# expression including Feb-29-only schedules; anything unmatched by then is
# genuinely unsatisfiable (e.g. day-of-month 31 in February only).
_MAX_SEARCH_DAYS = 366 * 4 + 4


class CronError(ValueError):
    """Raised for a malformed or unsatisfiable cron expression."""


@dataclass(frozen=True)
class _CronSpec:
    minutes: frozenset[int]
    hours: frozenset[int]
    days_of_month: frozenset[int]
    months: frozenset[int]
    days_of_week: frozenset[int]  # 0..6, Sunday = 0 (7 folded in)
    dom_restricted: bool
    dow_restricted: bool

    def day_matches(self, day: datetime) -> bool:
        month_ok = day.month in self.months
        if not month_ok:
            return False
        dom_ok = day.day in self.days_of_month
        # Python: Monday=0..Sunday=6 → cron: Sunday=0..Saturday=6.
        dow_ok = (day.weekday() + 1) % 7 in self.days_of_week
        if self.dom_restricted and self.dow_restricted:
            return dom_ok or dow_ok  # vixie OR semantics
        if self.dom_restricted:
            return dom_ok
        if self.dow_restricted:
            return dow_ok
        return True


def _parse_field(raw: str, name: str, lo: int, hi: int) -> tuple[frozenset[int], bool]:
    """Return ``(values, restricted)`` — restricted is False only for ``*``."""
    values: set[int] = set()
    restricted = True
    for part in raw.split(","):
        part = part.strip()
        if not part:
            raise CronError(f"{name}: empty list entry in {raw!r}")
        step = 1
        if "/" in part:
            part, step_raw = part.split("/", 1)
            try:
                step = int(step_raw)
            except ValueError as e:
                raise CronError(f"{name}: bad step in {raw!r}") from e
            if step < 1:
                raise CronError(f"{name}: step must be >= 1 in {raw!r}")
        if part == "*":
            if step == 1 and raw.strip() == "*":
                restricted = False
            start, end = lo, hi
        elif "-" in part:
            a, _, b = part.partition("-")
            try:
                start, end = int(a), int(b)
            except ValueError as e:
                raise CronError(f"{name}: bad range in {raw!r}") from e
        else:
            try:
                start = end = int(part)
            except ValueError as e:
                raise CronError(f"{name}: bad value in {raw!r}") from e
        if start > end:
            raise CronError(f"{name}: inverted range in {raw!r}")
        if start < lo or end > hi:
            raise CronError(f"{name}: value out of range {lo}-{hi} in {raw!r}")
        values.update(range(start, end + 1, step))
    if not values:
        raise CronError(f"{name}: no values in {raw!r}")
    return frozenset(values), restricted


def _parse(expr: str) -> _CronSpec:
    fields = expr.split()
    if len(fields) != 5:
        raise CronError(f"cron expression must have 5 fields, got {len(fields)}: {expr!r}")
    parsed: list[tuple[frozenset[int], bool]] = []
    for raw, (name, lo, hi) in zip(fields, _FIELD_RANGES, strict=True):
        parsed.append(_parse_field(raw, name, lo, hi))
    (minutes, _), (hours, _), (dom, dom_r), (months, _), (dow_raw, dow_r) = parsed
    # Fold cron's Sunday=7 alias onto 0.
    dow = frozenset(0 if v == 7 else v for v in dow_raw)
    return _CronSpec(
        minutes=minutes,
        hours=hours,
        days_of_month=dom,
        months=months,
        days_of_week=dow,
        dom_restricted=dom_r,
        dow_restricted=dow_r,
    )


def validate_cron(expr: str) -> None:
    """Raise :class:`CronError` if ``expr`` is not a valid 5-field expression."""
    _parse(expr)


def next_fire(expr: str, after: datetime) -> datetime:
    """The first UTC instant strictly after ``after`` matching ``expr``.

    ``after`` may be naive (treated as UTC) or timezone-aware; the result is
    always timezone-aware UTC with seconds/microseconds zeroed.
    """
    spec = _parse(expr)
    if after.tzinfo is None:
        after = after.replace(tzinfo=UTC)
    else:
        after = after.astimezone(UTC)
    # Strictly after: start from the next whole minute.
    candidate = (after + timedelta(minutes=1)).replace(second=0, microsecond=0)

    day = candidate
    for offset in range(_MAX_SEARCH_DAYS):
        if offset > 0:
            day = (candidate + timedelta(days=offset)).replace(hour=0, minute=0)
        if not spec.day_matches(day):
            continue
        for hour in sorted(spec.hours):
            if hour < day.hour:
                continue
            for minute in sorted(spec.minutes):
                if hour == day.hour and minute < day.minute:
                    continue
                return day.replace(hour=hour, minute=minute)
    raise CronError(f"cron expression never fires: {expr!r}")
