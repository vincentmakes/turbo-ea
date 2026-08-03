"""Guards against holding a pooled DB connection across non-database work.

A session checks a connection out of the pool on its first ``execute()`` and
keeps it — in an open transaction — until it commits or closes. The pool is
small (``DB_POOL_SIZE + DB_MAX_OVERFLOW``, 30 by default) on a *single* uvicorn
process, so anything that holds a session across slow non-DB work starves it.

This bit the product twice:

* ``GET /events/stream`` held one connection per open browser tab
  (discussion #901, fixed in 2.38.0 — guarded in ``tests/api/test_events.py``).
* The background jobs held one across LLM round-trips and whole-file parses.
  Unlike the stream, those transactions *write*, so they also held back the
  vacuum horizon for the entire job.

These are source-level guards, in the same style as the store-URL constant guard
in ``test_startup.py``. They need no database, so they run everywhere.
"""

from __future__ import annotations

import ast
import inspect
import pathlib
import re

import pytest

BACKEND = pathlib.Path(__file__).resolve().parents[2]


def _source(relative: str) -> str:
    return (BACKEND / relative).read_text(encoding="utf-8")


def _function_source(module_relative: str, func_name: str) -> str:
    """Return the source of one top-level function, without importing anything."""
    tree = ast.parse(_source(module_relative))
    for node in tree.body:
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)) and node.name == func_name:
            segment = ast.get_source_segment(_source(module_relative), node)
            assert segment, f"could not read source of {func_name}"
            return segment
    raise AssertionError(f"{func_name} not found in {module_relative}")


# ---------------------------------------------------------------------------
# call_ai must not borrow the caller's session
# ---------------------------------------------------------------------------


class TestCallAiTakesNoSession:
    """``call_ai`` used to read the AI config on the caller's session and then
    make the HTTP round-trip, so the caller's connection stayed checked out for
    the whole LLM call — once per batch, for the length of an entire analysis.

    It also must not commit or roll back a session it was handed: a helper
    cannot know what the caller has pending.
    """

    def test_signature_has_no_session_parameter(self):
        from sqlalchemy.ext.asyncio import AsyncSession

        from app.services.turbolens_ai import call_ai

        params = inspect.signature(call_ai).parameters
        assert "db" not in params
        assert not any(p.annotation is AsyncSession for p in params.values())

    def test_opens_its_own_short_lived_session(self):
        body = _function_source("app/services/turbolens_ai.py", "call_ai")
        assert "async with async_session()" in body

    def test_no_call_site_still_passes_a_session(self):
        for module in (
            "app/services/turbolens_architect.py",
            "app/services/turbolens_vendors.py",
            "app/services/turbolens_duplicates.py",
            "app/services/compliance_scanner.py",
        ):
            src = _source(module)
            assert "call_ai(db" not in src, f"{module} still passes a session to call_ai"
            assert not re.search(r"call_ai\(\n\s*db,", src), f"{module} still passes a session"


# ---------------------------------------------------------------------------
# Background jobs must not parse inside an open transaction
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("module", "func", "slow_call"),
    [
        ("app/api/v1/migration.py", "_parse_and_stage_job", "source.parse("),
        ("app/api/v1/workspace.py", "_preview_job", "parse_bundle("),
        ("app/api/v1/workspace.py", "_apply_job", "parse_bundle("),
    ],
)
def test_parse_happens_outside_any_session_block(module: str, func: str, slow_call: str):
    """The parse must sit at function level, not nested inside ``async with
    async_session()``.

    Reading a whole LeanIX export or workspace bundle is minutes of synchronous
    work; doing it with a session open pinned a connection for the duration.
    """
    body = _function_source(module, func)
    lines = body.split("\n")

    session_indent: int | None = None
    for line in lines:
        stripped = line.strip()
        if not stripped:
            continue
        indent = len(line) - len(line.lstrip())

        if session_indent is not None and indent <= session_indent:
            session_indent = None  # the `async with` block ended
        if "async with async_session()" in stripped:
            session_indent = indent
            continue
        if slow_call in stripped:
            assert session_indent is None, (
                f"{func} calls {slow_call} inside an `async with async_session()` block — "
                "parse with no connection held, then reopen a session for the writes."
            )


# ---------------------------------------------------------------------------
# AI batch loops must not keep the transaction open across the LLM calls
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("module", "func"),
    [
        ("app/services/turbolens_vendors.py", "analyse_vendors"),
        ("app/services/turbolens_vendors.py", "resolve_vendors"),
        ("app/services/turbolens_duplicates.py", "detect_duplicates"),
        ("app/services/turbolens_duplicates.py", "assess_modernization"),
    ],
)
def test_transaction_is_closed_before_the_first_ai_call(module: str, func: str):
    """There must be a ``commit()`` between the initial reads and the LLM loop.

    Without it the transaction opened by those reads stays open for every
    round-trip of the analysis.
    """
    body = _function_source(module, func)
    first_ai = body.find("call_ai(")
    assert first_ai != -1, f"{func} no longer calls call_ai — update this guard"
    assert "await db.commit()" in body[:first_ai], (
        f"{func} reaches its first call_ai without committing — the reads above it "
        "hold a connection for the whole LLM loop."
    )
