"""The pure parts of the Data quality leaderboard: the ranking and the key check.

The database query is covered by ``tests/api/test_dashboards_leaderboard.py``.
"""

from __future__ import annotations

import uuid

from app.services.dashboard_leaderboard import LeaderboardError, first_unknown, rank_rows

ALICE, BOB, CAROL, DAN = (uuid.UUID(int=n) for n in range(1, 5))


def _payload(rows):
    return [r.model_dump() for r in rows]


def test_rank_by_average_shares_a_rank_on_a_tie_and_skips_the_place():
    rows = [
        (ALICE, "Alice", 3, 90.0),
        (BOB, "Bob", 5, 75.5),
        (CAROL, "Carol", 4, 75.5),
        (DAN, "Dan", 9, 60.0),
    ]
    ranked = rank_rows(rows, "average_quality")
    assert [r.rank for r in ranked] == [1, 2, 2, 4]
    assert _payload(ranked)[0] == {
        "rank": 1,
        "user": {"id": str(ALICE), "display_name": "Alice"},
        "cards": 3,
        "average_quality": 90.0,
    }


def test_rank_by_count_ties_on_the_count_not_the_average():
    rows = [
        (ALICE, "Alice", 7, 40.0),
        (BOB, "Bob", 7, 95.0),
        (CAROL, "Carol", 6, 95.0),
    ]
    assert [r.rank for r in rank_rows(rows, "card_count")] == [1, 1, 3]
    # The same rows ranked by average tie the other pair.
    assert [r.rank for r in rank_rows(rows, "average_quality")] == [1, 2, 2]


def test_rank_rows_casts_the_database_types():
    from decimal import Decimal

    (row,) = rank_rows([(ALICE, "Alice", 2, Decimal("66.7"))], "average_quality")
    assert row.average_quality == 66.7
    assert isinstance(row.average_quality, float)
    assert row.user.id == str(ALICE)


def test_rank_rows_of_nothing_is_empty():
    assert rank_rows([], "average_quality") == []


def test_first_unknown():
    assert first_unknown(["Application", "Nope", "Gone"], ["Application"]) == "Nope"
    assert first_unknown(["Application"], ("Application", "ITComponent")) is None
    assert first_unknown([], []) is None


def test_leaderboard_error_carries_its_code():
    err = LeaderboardError("unknown_role")
    assert err.code == "unknown_role"
    assert str(err) == "unknown_role"
