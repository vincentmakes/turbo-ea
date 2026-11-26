"""Relation lifecycles for the "does a dated relation still count" tests.

Every current-state reader of relations (``lifecycle_in_effect`` /
``lifecycle_in_effect_sql``) is tested over the same four relations: two that
count today — one with no dates at all, one whose window spans today — and two
that do not — one that has not started, one that has ended. Built relative to
today's UTC date so the tests never rot.

The cost reports work at fiscal-year granularity instead
(``live_relations_in_fiscal_year``); their tests build their own dates.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

TODAY = datetime.now(timezone.utc).date()
PAST = (TODAY - timedelta(days=30)).isoformat()
FUTURE = (TODAY + timedelta(days=30)).isoformat()

#: name → lifecycle. The first two count today, the last two do not.
WINDOWS: dict[str, dict[str, str]] = {
    "undated": {},
    "current": {"active": PAST, "endOfLife": FUTURE},
    "planned": {"plan": PAST, "active": FUTURE},
    "ended": {"active": "2001-01-01", "endOfLife": PAST},
}

#: The names of the windows that count today, sorted.
COUNTING = ["current", "undated"]
