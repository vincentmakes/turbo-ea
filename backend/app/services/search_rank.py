"""Shared relevance ranking for free-text search (discussion #918).

Every search box in the app orders its results the same way: exact match first,
then names that *start* with the term, then names where the term starts a word,
then plain substring matches, alphabetically within each tier.

This started life on the card list, where users asked for regex anchors (`^w`
= "starts with w") because typing `w` buried the obvious answers under every
substring match. Ranking solves that with no syntax to learn — and once one
search behaved that way, every other one behaving differently was its own
surprise, so the rule lives here and every endpoint applies it.

The client mirrors these tiers in `frontend/src/lib/searchRank.ts` so a picker
can re-rank its loaded page during the debounce window without the order
jumping when the server response lands. Change one and change the other.
"""

from __future__ import annotations

import re
from typing import Any

from sqlalchemy import case, func
from sqlalchemy.orm import InstrumentedAttribute
from sqlalchemy.sql.elements import ColumnElement

# Every caller ranks or filters a *mapped column* — `Card.name`, `Risk.title`,
# `ArchitectureDecision.reference_number`. `ColumnElement` is the wrong
# annotation for those: SQLAlchemy's mapped attributes are
# `InstrumentedAttribute`, which does not derive from it, and nullable columns
# arrive as `InstrumentedAttribute[str | None]`. `Any` on the parameter keeps
# both accepted without pretending the two hierarchies are related.
SearchColumn = InstrumentedAttribute[Any]

__all__ = ["like_literal", "rank_text", "search_rank", "search_filter"]


def like_literal(value: str) -> str:
    """Escape LIKE wildcards so a user's `100%` or `a_b` matches literally.

    Pair with ``escape="\\\\"`` on the ``like``/``ilike`` call.
    """
    return value.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


# POSIX-regex metacharacters. We build the pattern and the user supplies only a
# literal, so escaping these leaves no operator under the caller's control —
# hence no ReDoS surface (which is exactly why we do NOT accept user regex).
_REGEX_META = r"\.^$|()[]{}*+?"


def _regex_literal(value: str) -> str:
    return "".join("\\" + c if c in _REGEX_META else c for c in value)


def search_rank(column: SearchColumn, search: str) -> ColumnElement[int]:
    """Relevance rank for ``search`` against ``column``: lower sorts first.

    0 exact · 1 starts-with · 2 starts a word · 3 contains · 4 no match on this
    column (it matched some *other* searched column, e.g. a description).

    Rank 2 uses a regex rather than ``LIKE '% q%'`` because word boundaries in
    real names are as often ``-``, ``/``, ``.`` or ``(`` as a space
    ("Workday-HCM", "SAP/Workday", "R-000123").

    Pass the column you want ranked — normally the one a human reads as the
    thing's name (``Card.name``, ``Risk.title``, ``ArchitectureDecision.title``).
    """
    lowered = search.lower()
    like = like_literal(lowered)
    target = func.lower(column)
    return case(
        (target == lowered, 0),
        (target.like(f"{like}%", escape="\\"), 1),
        (target.op("~", is_comparison=True)(r"(^|[^[:alnum:]])" + _regex_literal(lowered)), 2),
        (target.like(f"%{like}%", escape="\\"), 3),
        else_=4,
    )


def search_filter(column: SearchColumn, search: str) -> ColumnElement[bool]:
    """Case-insensitive "contains" for one column, with wildcards escaped.

    Use instead of a hand-rolled ``col.ilike(f"%{search}%")``: unescaped, a term
    containing ``%`` or ``_`` silently behaves as a wildcard, so searching for
    `100%` matches everything.
    """
    return column.ilike(f"%{like_literal(search)}%", escape="\\")


# Word boundaries in real names are as often `-`, `/`, `.` or `(` as a space.
_WORD_BOUNDARY = re.compile(r"[^a-z0-9]")


def rank_text(value: str | None, search: str) -> int:
    """In-Python mirror of :func:`search_rank`, for endpoints that sort rows
    after loading them (the risk register computes fields Postgres can't).

    Returns the same tiers as the SQL form so a user cannot tell which
    implementation ordered their results; `tests/services/test_search_rank.py`
    pins the two against one another.
    """
    q = search.strip().lower()
    if not q:
        return 3
    name = (value or "").lower()
    if name == q:
        return 0
    if name.startswith(q):
        return 1
    at = name.find(q)
    if at < 0:
        return 4
    while at >= 0:
        if at > 0 and _WORD_BOUNDARY.match(name[at - 1]):
            return 2
        at = name.find(q, at + 1)
    return 3
