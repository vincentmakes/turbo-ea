"""A persisted event is published before the route's last commit.

``event_bus.publish(..., db=db)`` adds an ``Event`` row (and the request's
auto-batch) to the session and flushes it. Nothing commits after a route
handler's last ``await db.commit()``, so a publish placed after it is rolled
back when the request's session closes: live listeners get the event, the
activity feed, the card history and rollback never do. The decision and SoAW
review routes all had that shape until 2.200.0.

The test session is shared with the request, so an API test cannot see the
loss without help (``publish_commit_log`` in ``conftest.py``); this scan fails
the shape itself in every route handler of the modules in ``MODULES``. There
is no allowlist: a handler that needs to publish after its commit has a bug.
"""

from __future__ import annotations

import ast

import pytest

from tests.app_source import API_V1, dotted_name, handlers_in

pytestmark = pytest.mark.source_scan

# Route modules whose handlers are scanned. Add a module here when it gains
# routes that publish persisted events.
MODULES = (
    "adr.py",
    "soaw.py",
    "document_comments.py",
    "document_history.py",
    "mentions.py",
)

# Helpers that publish a persisted event themselves.
PUBLISHING_HELPERS = frozenset({"_publish_adr_card_event"})


def _position(node: ast.AST) -> tuple[int, int]:
    return (node.lineno, node.col_offset)


def _is_commit(node: ast.AST) -> bool:
    """``await db.commit()``."""
    return (
        isinstance(node, ast.Await)
        and isinstance(node.value, ast.Call)
        and dotted_name(node.value.func) == "db.commit"
    )


def _persisted_publish(node: ast.AST) -> str | None:
    """The callee of a call that writes an event row, else ``None``."""
    if not isinstance(node, ast.Call):
        return None
    name = dotted_name(node.func)
    if name == "event_bus.publish" and any(kw.arg == "db" for kw in node.keywords):
        return name
    if name in PUBLISHING_HELPERS:
        return name
    return None


def late_publishes(module: str, source: str) -> list[str]:
    """``module:handler:line callee`` for every persisted publish that follows
    its route handler's last ``await db.commit()`` in source order."""
    handler_names = {h.func_name for h in handlers_in(module, source)}
    found: list[str] = []
    for func in ast.walk(ast.parse(source)):
        if not isinstance(func, ast.AsyncFunctionDef) or func.name not in handler_names:
            continue
        commits = [_position(node) for node in ast.walk(func) if _is_commit(node)]
        if not commits:
            continue
        last_commit = max(commits)
        for node in ast.walk(func):
            callee = _persisted_publish(node)
            if callee is not None and _position(node) > last_commit:
                found.append(f"{module}:{func.name}:{node.lineno} {callee}")
    return sorted(found)


@pytest.mark.parametrize("module", MODULES)
def test_no_persisted_publish_after_the_last_commit(module):
    source = (API_V1 / module).read_text(encoding="utf-8")
    assert late_publishes(module, source) == []


def test_the_scanned_modules_have_handlers_that_publish():
    """Non-vacuity: the scan reads real handlers with real persisted publishes."""
    publishing = {}
    for module in MODULES:
        source = (API_V1 / module).read_text(encoding="utf-8")
        tree = ast.parse(source)
        publishing[module] = sum(1 for node in ast.walk(tree) if _persisted_publish(node))
    # The collaboration modules publish nothing yet; the comment routes will.
    assert publishing == {
        "adr.py": 8,
        "soaw.py": 4,
        "document_comments.py": 0,
        "document_history.py": 0,
        "mentions.py": 0,
    }


# ── the scan bites ──────────────────────────────────────────────────────────

_LATE = """
@router.post("/{adr_id}/sign")
async def sign(adr_id: str, db=Depends(get_db), user=Depends(get_current_user)):
    adr.status = "signed"
    await db.commit()
    await db.refresh(adr)
    await event_bus.publish("adr.signed", {"id": adr_id}, db=db, user_id=user.id)
    return adr


@router.post("/{adr_id}/cards")
async def link(adr_id: str, db=Depends(get_db), user=Depends(get_current_user)):
    await db.commit()
    await _publish_adr_card_event(db, adr, "adr.linked", card_id, actor_id=user.id)
"""

_ON_TIME = """
@router.post("/{adr_id}/sign")
async def sign(adr_id: str, db=Depends(get_db), user=Depends(get_current_user)):
    adr.status = "signed"
    await event_bus.publish("adr.signed", {"id": adr_id}, db=db, user_id=user.id)
    await db.commit()
    await db.refresh(adr)
    # Live-only (no db=): nothing to lose.
    await event_bus.publish("adr.viewed", {"id": adr_id})
    return adr


@router.post("/{adr_id}/cards")
async def link(adr_id: str, db=Depends(get_db), user=Depends(get_current_user)):
    await _publish_adr_card_event(db, adr, "adr.linked", card_id, actor_id=user.id)
    await db.commit()


async def helper_not_a_route(db):
    await db.commit()
    await event_bus.publish("x.y", {}, db=db)
"""


def test_a_publish_after_the_last_commit_fails():
    assert late_publishes("synthetic.py", _LATE) == [
        "synthetic.py:link:14 _publish_adr_card_event",
        "synthetic.py:sign:7 event_bus.publish",
    ]


def test_a_publish_before_the_last_commit_passes():
    assert late_publishes("synthetic.py", _ON_TIME) == []


def test_only_the_last_commit_counts():
    """A publish between two commits is committed by the second one."""
    source = """
@router.post("/x")
async def two_commits(db=Depends(get_db)):
    await db.commit()
    await event_bus.publish("x.done", {}, db=db)
    await db.commit()
"""
    assert late_publishes("synthetic.py", source) == []


def test_a_handler_without_a_commit_is_not_judged():
    source = """
@router.get("/x")
async def read_only(db=Depends(get_db)):
    await event_bus.publish("x.read", {}, db=db)
"""
    assert late_publishes("synthetic.py", source) == []
