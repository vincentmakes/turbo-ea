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
        # The update check's network round-trip is bounded by a 10s timeout, but
        # a connection held for 10s of every daily run is still a connection
        # held for no reason.
        ("app/services/update_check.py", "run_update_check", "fetch_latest_release("),
        # Same reasoning for the store catalogue probe: a 6s timeout is short,
        # but a connection pinned for 6s of every daily run is pinned for no
        # reason at all.
        (
            "app/services/extension_store_check.py",
            "run_extension_store_check",
            "fetch_store_catalog_safe(",
        ),
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


def test_manual_store_check_releases_the_request_session_first():
    """``POST /settings/extension-store-check`` runs the daily probe on demand.

    The probe opens its own short sessions, but the *request* has one too — the
    permission check has already used it, so without an explicit close FastAPI's
    yield-dependency keeps that connection checked out for the whole outbound
    round-trip to the store. One admin clicking a button is cheap; the rule is
    not conditional on how often the path is hit.
    """
    body = _function_source("app/api/v1/settings.py", "run_extension_store_check_now")
    fetch_at = body.find("await fetch_store_catalog_safe(")
    assert fetch_at != -1, "the endpoint must be the one making the fetch"
    commit_at = body.rfind("await db.commit()", 0, fetch_at)
    assert commit_at != -1, (
        "run_extension_store_check_now must `await db.commit()` before the fetch — "
        "the commit is what hands the connection back, and get_db is a "
        "yield-dependency that would otherwise pin it for the whole round-trip."
    )
    write_at = body.find("await record_result(")
    assert fetch_at < write_at, "the writes must come after the fetch, on a fresh transaction"


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


# ---------------------------------------------------------------------------
# Extension notification channels must be enqueue-only
# ---------------------------------------------------------------------------


class TestNotificationChannelDispatch:
    """``create_notification`` calls ``dispatch`` with its transaction open.

    Every other channel in this file is a background job that can be told to
    close its session first. This one cannot: the dispatch happens mid-request,
    right after the notification row is flushed, so the *only* thing keeping it
    safe is that ``dispatch`` neither awaits nor touches the network. Making it
    a coroutine would put an extension's delivery path inside every notification
    sender's transaction.
    """

    def test_dispatch_is_a_plain_function(self):
        tree = ast.parse(_source("app/services/extensions/notification_channels.py"))
        for node in tree.body:
            if isinstance(node, ast.AsyncFunctionDef) and node.name == "dispatch":
                raise AssertionError("dispatch must stay synchronous — enqueue only")
            if isinstance(node, ast.FunctionDef) and node.name == "dispatch":
                return
        raise AssertionError("dispatch not found in notification_channels.py")

    def test_dispatch_body_never_awaits(self):
        # AST, not a text search: the docstring names ``await`` on purpose.
        tree = ast.parse(_source("app/services/extensions/notification_channels.py"))
        target = next(
            n
            for n in tree.body
            if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef)) and n.name == "dispatch"
        )
        awaits = [n for n in ast.walk(target) if isinstance(n, ast.Await)]
        assert not awaits, "dispatch must not await — it runs inside an open transaction"

    def test_create_notification_does_not_await_the_dispatch(self):
        """The call must be a bare expression statement, never an await."""
        module = "app/services/notification_service.py"
        tree = ast.parse(_source(module))
        target = None
        for node in ast.walk(tree):
            if isinstance(node, ast.AsyncFunctionDef) and node.name == "create_notification":
                target = node
                break
        assert target is not None, "create_notification not found"

        found = False
        for node in ast.walk(target):
            if not isinstance(node, ast.Call):
                continue
            func = node.func
            if isinstance(func, ast.Attribute) and func.attr == "dispatch":
                found = True
                parents = [
                    p for p in ast.walk(target) if isinstance(p, ast.Await) and p.value is node
                ]
                assert not parents, "dispatch must not be awaited in create_notification"
        assert found, "create_notification no longer dispatches to extension channels"
