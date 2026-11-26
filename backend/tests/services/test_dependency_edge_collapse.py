"""``/reports/dependencies`` collapses two rows of one relation type between the
same pair into one edge. The row that speaks for them must not depend on row
order (the query has no ORDER BY), and must never understate the relation: for
a self-referencing type with A→B ended and B→A undated, the edge is undated.
Pure — the route's choice is ``_speaks_for_collapse``.
"""

from __future__ import annotations

import uuid
from datetime import date
from types import SimpleNamespace

import pytest

from app.api.v1.reports import _speaks_for_collapse

TODAY = date(2030, 6, 1)


def _row(lifecycle, n):
    return SimpleNamespace(lifecycle=lifecycle, id=uuid.UUID(int=n))


def _collapse(rows):
    """The route's fold over its rows, in the given order."""
    held = None
    for r in rows:
        if held is None or _speaks_for_collapse(r, held, TODAY):
            held = r
    return held


ENDED = {"active": "2001-01-01", "endOfLife": "2020-01-01"}
CURRENT = {"active": "2020-01-01", "endOfLife": "2031-01-01"}
PLANNED = {"active": "2031-01-01"}


@pytest.mark.parametrize("order", [(0, 1), (1, 0)])
def test_an_undated_row_makes_the_edge_undated_in_either_order(order):
    rows = [_row(ENDED, 1), _row({}, 2)]
    assert _collapse([rows[i] for i in order]).lifecycle == {}


@pytest.mark.parametrize("order", [(0, 1, 2), (2, 1, 0), (1, 2, 0)])
def test_a_row_in_effect_today_wins_over_planned_and_ended(order):
    rows = [_row(ENDED, 1), _row(PLANNED, 2), _row(CURRENT, 3)]
    assert _collapse([rows[i] for i in order]).lifecycle == CURRENT


@pytest.mark.parametrize("order", [(0, 1), (1, 0)])
def test_with_none_in_effect_the_one_that_never_ends_wins(order):
    rows = [_row(ENDED, 1), _row(PLANNED, 2)]
    assert _collapse([rows[i] for i in order]).lifecycle == PLANNED


@pytest.mark.parametrize("order", [(0, 1), (1, 0)])
def test_equal_dates_go_to_the_smaller_id(order):
    rows = [_row({}, 1), _row({}, 2)]
    assert _collapse([rows[i] for i in order]).id == uuid.UUID(int=1)


def test_the_day_decides_what_is_in_effect():
    # From TODAY both rows are in effect and the later end wins; a day earlier
    # the first has not started, so the one in effect then wins.
    starting = _row({"active": "2030-06-01", "endOfLife": "2030-06-10"}, 1)
    running = _row({"endOfLife": "2030-06-05"}, 2)
    assert _speaks_for_collapse(starting, running, TODAY) is True
    assert _speaks_for_collapse(running, starting, TODAY) is False
    eve = date(2030, 5, 31)
    assert _speaks_for_collapse(starting, running, eve) is False
    assert _speaks_for_collapse(running, starting, eve) is True
