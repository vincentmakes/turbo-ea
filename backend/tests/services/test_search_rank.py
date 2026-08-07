"""The search-ranking contract (discussion #918).

Three implementations must agree on the same tiers — the SQL `case()` used by
most list endpoints, the in-Python `rank_text` used where rows are sorted after
loading (the risk register), and `frontend/src/lib/searchRank.ts`. These tests
pin the Python one against the table of cases the other two are written to; the
frontend's own copy lives in `searchRank.test.ts` and asserts the same rows.
"""

import pytest

from app.services.search_rank import like_literal, rank_text

# (name, query, expected tier) — 0 exact · 1 starts-with · 2 starts a word ·
# 3 contains · 4 no match.
CASES = [
    ("Work", "work", 0),
    ("WORK", "work", 0),
    ("Work", "  WORK  ", 0),
    ("Workday", "work", 1),
    ("Workday Adaptive", "work", 1),
    ("Cloud Work Hub", "work", 2),
    ("SAP/Workday", "work", 2),
    ("Legacy-Workflow", "work", 2),
    ("Data.Warehouse", "warehouse", 2),
    ("Network Work Queue", "work", 2),
    ("Network Monitor", "work", 3),
    ("Reworked Portal", "work", 3),
    ("Payroll", "work", 4),
]


@pytest.mark.parametrize("name,query,expected", CASES)
def test_rank_text_tiers(name, query, expected):
    assert rank_text(name, query) == expected


def test_rank_text_tolerates_a_missing_value():
    # A nullable title must not blow up the sort it feeds.
    assert rank_text(None, "work") == 4


def test_rank_text_matches_everything_for_an_empty_query():
    assert rank_text("Anything", "   ") == 3


def test_ranking_orders_a_realistic_result_set():
    """The headline behaviour: typing `w` surfaces the names starting with W."""
    names = ["Network Monitor", "Cloud Work Hub", "Workday Adaptive", "Workday", "Work"]
    ordered = sorted(names, key=lambda n: (rank_text(n, "work"), n.lower()))
    assert ordered == [
        "Work",
        "Workday",
        "Workday Adaptive",
        "Cloud Work Hub",
        "Network Monitor",
    ]


@pytest.mark.parametrize(
    "raw,escaped",
    [
        ("100%", r"100\%"),
        ("a_b", r"a\_b"),
        ("back\\slash", "back\\\\slash"),
        ("plain", "plain"),
    ],
)
def test_like_literal_escapes_wildcards(raw, escaped):
    assert like_literal(raw) == escaped
