"""Guard: no raw SQL strings in the application.

CLAUDE.md, *Backend Conventions*: "No raw SQL: Use SQLAlchemy ORM for all
database queries." A ``text("UPDATE cards …")`` bypasses the model — its
column ``onupdate`` defaults, its types, the mapper's knowledge of what
changed — and is invisible to every scan that looks for ``update(Card)`` or
``select(Card)``. This scan fails on any ``text(`` (bare, ``sa.text(`` or
``sqlalchemy.text(``) under ``app/``, unless the module is in ``RAW_SQL_OK``
with the reason the ORM cannot express it. Alembic migrations live outside
``app/`` and are not scanned.

Reads ``app/`` as source, so it is a ``source_scan`` and is deselected under
mutmut (``tests/mutation_plugin.py``).
"""

from __future__ import annotations

import re

import pytest

from tests.app_source import iter_py

pytestmark = pytest.mark.source_scan

# ``\btext\(`` already matches ``sa.text(`` and ``sqlalchemy.text(`` (the dot is
# a word boundary); ``_clip_text(`` and ``context(`` do not match.
RAW_SQL = re.compile(r"\btext\(")

RAW_SQL_OK: dict[str, str] = {
    "services/startup_lock.py": "pg_advisory_lock / unlock have no ORM form",
    "api/v1/auth.py": "pg_advisory_xact_lock serialises first-user registration",
    "main.py": "reads alembic_version, which has no model",
    "services/card_lifecycle.py": "recursive descendants CTE, a documented performance choice",
}


def _raw_sql_modules() -> dict[str, str]:
    return {
        rel: text
        for rel, text in iter_py().items()
        if not rel.startswith("alembic/") and RAW_SQL.search(text)
    }


def test_no_raw_sql_outside_the_allowlist():
    offenders = sorted(rel for rel in _raw_sql_modules() if rel not in RAW_SQL_OK)
    assert not offenders, (
        "These modules build SQL from strings with text(...) — express the query with "
        "SQLAlchemy constructs (select / update / insert / func / column operators), or, "
        f"if the ORM genuinely cannot, list the module in RAW_SQL_OK with the reason: {offenders}"
    )


def test_allowlist_is_not_stale():
    files = iter_py()
    found = _raw_sql_modules()
    for rel in RAW_SQL_OK:
        assert rel in files, f"{rel} no longer exists; drop it from RAW_SQL_OK"
        assert rel in found, f"{rel} no longer uses text(...); drop it from RAW_SQL_OK"


@pytest.mark.parametrize(
    "snippet",
    [
        'await db.execute(text("UPDATE cards SET name = :n"))',
        'stmt = sa.text("SELECT 1")',
        "stmt = sqlalchemy.text(\n    'SELECT 1'\n)",
        "from sqlalchemy import text\nq = text('x')",
    ],
)
def test_scanner_sees_raw_sql(snippet):
    assert RAW_SQL.search(snippet)


@pytest.mark.parametrize(
    "near_miss",
    [
        "value = _clip_text(raw)",
        "ctx = build_context(user)",
        "from sqlalchemy import Text",
        "column = mapped_column(Text)",
        "label = rich_text (value)",
    ],
)
def test_scanner_ignores_near_misses(near_miss):
    assert not RAW_SQL.search(near_miss)
