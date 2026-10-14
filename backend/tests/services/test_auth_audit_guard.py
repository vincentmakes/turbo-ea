"""Guard: a recorded authentication failure is committed before it is raised.

``get_db`` never commits, so an audit row flushed on a path that then raises
``HTTPException`` is rolled back with the request — the failed sign-in leaves
no trace, which is the one record a security log exists to keep. ``auth.py``
therefore routes every recorded refusal through ``_fail`` (record → commit →
raise). These scans fail when a route that records starts raising around it,
when ``_fail`` loses its commit, or when a ``_fail`` call is not awaited (an
un-awaited coroutine never raises, so the request would carry on as if the
check had passed).

Reads ``app/api/v1/auth.py`` as text, so it is a ``source_scan`` and is
deselected under mutmut (``tests/mutation_plugin.py``).
"""

from __future__ import annotations

import ast
from collections import Counter
from pathlib import Path

import pytest

pytestmark = pytest.mark.source_scan

_AUTH = Path(__file__).resolve().parents[2] / "app" / "api" / "v1" / "auth.py"

# The routes that write to the audit log (plan: "Action catalogue → auth").
RECORDING_ROUTES = frozenset(
    {
        "register",
        "login",
        "logout",
        "impersonate_role",
        "stop_impersonating",
        "sso_callback",
        "proxy_session",
        "set_password",
        "forgot_password",
        "reset_password",
    }
)

# ``raise HTTPException`` that a recording route deliberately does NOT record,
# keyed by (route, status code) → how many such raises the route holds. An exact
# count, so a new unrecorded raise and a stale entry both fail.
UNRECORDED_RAISES: dict[tuple[str, int], tuple[int, str]] = {
    ("register", 403): (3, "registration closed (SSO, proxy auth, admin switch): not an attempt"),
    ("register", 400): (1, "email already registered: a form error, and recording it enumerates"),
    ("impersonate_role", 400): (4, "malformed View-as-role request by an admin, not a sign-in"),
    ("impersonate_role", 404): (1, "unknown role key: a stale UI, not a sign-in"),
    ("stop_impersonating", 400): (1, "no impersonation to stop: a stale UI"),
    ("proxy_session", 404): (1, "feature off: the route must look absent, so it records nothing"),
    ("set_password", 400): (1, "password strength: a form error before any account is touched"),
    ("reset_password", 400): (1, "password strength: a form error before any account is touched"),
}


def _tree() -> ast.Module:
    return ast.parse(_AUTH.read_text(encoding="utf-8"))


def _functions() -> dict[str, ast.AsyncFunctionDef | ast.FunctionDef]:
    return {
        node.name: node
        for node in _tree().body
        if isinstance(node, (ast.AsyncFunctionDef, ast.FunctionDef))
    }


def _is_call_to(node: ast.AST, name: str) -> bool:
    if not isinstance(node, ast.Call):
        return False
    func = node.func
    if isinstance(func, ast.Name):
        return func.id == name
    if isinstance(func, ast.Attribute):
        return func.attr == name
    return False


def _is_audit_record(node: ast.AST) -> bool:
    return (
        isinstance(node, ast.Call)
        and isinstance(node.func, ast.Attribute)
        and node.func.attr == "record"
        and isinstance(node.func.value, ast.Name)
        and node.func.value.id == "audit_log"
    )


def _http_exception_raises(fn: ast.AST) -> list[ast.Raise]:
    return [
        node
        for node in ast.walk(fn)
        if isinstance(node, ast.Raise)
        and node.exc is not None
        and _is_call_to(node.exc, "HTTPException")
    ]


def _status_of(call: ast.Call) -> int | None:
    for kw in call.keywords:
        if kw.arg == "status_code" and isinstance(kw.value, ast.Constant):
            return kw.value.value
    if call.args and isinstance(call.args[0], ast.Constant):
        return call.args[0].value
    return None


def _records(fn: ast.AST) -> bool:
    return any(_is_audit_record(n) or _is_call_to(n, "_fail") for n in ast.walk(fn))


def test_the_scan_sees_raises_and_records():
    """Non-vacuity: the helpers recognise the shapes the real assertions rely on."""
    sample = ast.parse(
        "async def f(db):\n"
        "    await audit_log.record(db, action='x', category='auth')\n"
        "    await _fail(db, 401, 'no', action='x')\n"
        "    raise HTTPException(status_code=418, detail='teapot')\n"
        "    raise\n"
    ).body[0]
    raises = _http_exception_raises(sample)
    assert [_status_of(r.exc) for r in raises] == [418]
    assert _records(sample)


def test_every_recording_route_exists_and_records():
    functions = _functions()
    missing = sorted(RECORDING_ROUTES - functions.keys())
    assert not missing, f"Routes renamed or removed from auth.py: {missing}"
    silent = sorted(name for name in RECORDING_ROUTES if not _records(functions[name]))
    assert not silent, f"These auth routes no longer write to the audit log: {silent}"


def test_fail_records_then_commits_then_raises():
    fail = _functions()["_fail"]
    assert isinstance(fail, ast.AsyncFunctionDef), "_fail must be async so it can commit"
    # Drop the docstring, keep the three statements in order.
    statements = [
        s for s in fail.body if not (isinstance(s, ast.Expr) and isinstance(s.value, ast.Constant))
    ]
    assert len(statements) == 3, ast.unparse(fail)
    record, commit, raise_ = statements
    assert isinstance(record, ast.Expr) and isinstance(record.value, ast.Await)
    assert _is_audit_record(record.value.value)
    keywords = {kw.arg: kw.value for kw in record.value.value.keywords}
    assert isinstance(keywords.get("outcome"), ast.Constant)
    assert keywords["outcome"].value == "failure"
    assert isinstance(commit, ast.Expr) and isinstance(commit.value, ast.Await)
    assert ast.unparse(commit.value.value) == "db.commit()"
    assert isinstance(raise_, ast.Raise) and _is_call_to(raise_.exc, "HTTPException")
    assert ast.unparse(raise_.exc) == "HTTPException(status_code, detail)"


def test_recording_routes_raise_only_through_fail():
    functions = _functions()
    found: Counter[tuple[str, int]] = Counter()
    for name in sorted(RECORDING_ROUTES):
        for node in _http_exception_raises(functions[name]):
            status = _status_of(node.exc)
            assert status is not None, (
                f"{name}:{node.lineno} raises HTTPException with a non-literal status"
            )
            found[(name, status)] += 1

    unexpected = {key: n for key, n in found.items() if key not in UNRECORDED_RAISES}
    assert not unexpected, (
        "These auth routes raise HTTPException directly instead of through _fail(), "
        "so the failure is either not recorded or recorded and then rolled back: "
        f"{unexpected}. Use `await _fail(db, status, detail, action=...)`, or list the "
        "raise in UNRECORDED_RAISES with the reason it is not an audit event."
    )
    for key, (count, _reason) in UNRECORDED_RAISES.items():
        assert found.get(key, 0) == count, (
            f"{key}: expected {count} unrecorded raise(s), found {found.get(key, 0)}; "
            "update UNRECORDED_RAISES"
        )


def test_every_fail_call_is_awaited():
    """``_fail(...)`` without ``await`` builds a coroutine and moves on: the
    request would continue past the check it was meant to end."""
    tree = _tree()
    awaited = {id(node.value) for node in ast.walk(tree) if isinstance(node, ast.Await)}
    calls = [node for node in ast.walk(tree) if _is_call_to(node, "_fail")]
    assert calls, "auth.py no longer calls _fail at all"
    bare = [node.lineno for node in calls if id(node) not in awaited]
    assert not bare, f"_fail() called without await at line(s) {bare}"


def test_helper_refusals_are_caught_and_recorded():
    """A refusal raised inside a helper (the SSO code exchange, provisioning,
    the proxy checks) is caught in the route and recorded: every
    ``except HTTPException`` in a recording route either calls ``_fail`` or
    re-raises unchanged (the proxy route's 5xx misconfiguration path)."""
    functions = _functions()
    handlers = [
        (name, node)
        for name in sorted(RECORDING_ROUTES)
        for node in ast.walk(functions[name])
        if isinstance(node, ast.ExceptHandler)
        and isinstance(node.type, ast.Name)
        and node.type.id == "HTTPException"
    ]
    assert {name for name, _ in handlers} >= {"sso_callback", "proxy_session"}
    for name, handler in handlers:
        body_calls_fail = any(_is_call_to(n, "_fail") for n in ast.walk(handler))
        assert body_calls_fail, f"{name}:{handler.lineno} swallows an HTTPException unrecorded"
