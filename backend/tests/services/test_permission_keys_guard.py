"""Guard: every permission key the code checks is a key the registry defines.

CLAUDE.md, *Backend Conventions*: "New permission keys must be added to
``backend/app/core/permissions.py`` (the single source of truth for all valid
permission keys)." A check against a key the registry does not know can never
be granted to a role through the admin UI — so it either locks every
non-admin out of the route for good, or, worse, a typo in a deny check never
matches anything. Nothing at run time says so.

The scan reads every call to a permission check under ``app/`` by AST and
takes the string literals it passes as a key: positional arguments (the key's
position differs per helper — ``require_permission("x")`` in ``deps.py``,
``PermissionService.require_permission(db, user, "x")``) and the keyword
arguments that name a permission. ``card_type_key`` / ``type_key`` are card
types, not permissions, and are skipped. Each must be in
``ALL_APP_PERMISSION_KEYS`` or ``ALL_CARD_PERMISSION_KEYS``.

Reads ``app/`` as source, so it is a ``source_scan`` and is deselected under
mutmut (``tests/mutation_plugin.py``).
"""

from __future__ import annotations

import ast

import pytest

from app.core.permissions import ALL_APP_PERMISSION_KEYS, ALL_CARD_PERMISSION_KEYS
from tests.app_source import dotted_name, iter_py

pytestmark = pytest.mark.source_scan

CHECKS = frozenset(
    {
        "require_permission",
        "has_permission",
        "check_permission",
        "has_app_permission",
        "has_card_permission",
        "_ensure_permission_on_each",
    }
)
KEY_KWARGS = frozenset({"permission", "app_perm", "card_perm", "app_permission", "card_permission"})


def _literal_keys(source: str) -> list[tuple[int, str]]:
    """``(line, key)`` for every permission key passed as a literal in ``source``."""
    found = []
    for node in ast.walk(ast.parse(source)):
        if not isinstance(node, ast.Call):
            continue
        name = dotted_name(node.func)
        if not name or name.rsplit(".", 1)[-1] not in CHECKS:
            continue
        values = [*node.args, *(kw.value for kw in node.keywords if kw.arg in KEY_KWARGS)]
        found += [
            (node.lineno, v.value)
            for v in values
            if isinstance(v, ast.Constant) and isinstance(v.value, str)
        ]
    return found


def _all_literal_keys() -> list[tuple[str, int, str]]:
    return [
        (rel, line, key) for rel, text in iter_py().items() for line, key in _literal_keys(text)
    ]


def test_the_scan_finds_the_checks():
    # A broken matcher would find nothing and pass everything.
    assert len(_all_literal_keys()) >= 60


def test_every_checked_permission_key_is_registered():
    known = ALL_APP_PERMISSION_KEYS | ALL_CARD_PERMISSION_KEYS
    unknown = [
        f"{rel}:{line} {key!r}" for rel, line, key in _all_literal_keys() if key not in known
    ]
    assert not unknown, (
        "These permission checks name a key app/core/permissions.py does not define — "
        f"fix the typo, or register the key there: {unknown}"
    )


def test_scanner_reads_every_shape_of_check():
    source = """
@router.post("/x", dependencies=[Depends(require_permission("bogus.key"))])
async def x(db, user):
    await PermissionService.require_permission(db, user, "inventory.edit")
    await PermissionService.check_permission(db, user, "a.b", card.id, "card.c")
    await _ensure_permission_on_each(db, user, ids, app_perm="d.e", card_perm="card.f")
    await PermissionService.has_app_permission(db, user, perm_var)
    await require_permission("g.h", card_type_key="Application")
    await has_permissions(db, user, "not.a.check")
"""
    assert sorted(key for _, key in _literal_keys(source)) == [
        "a.b",
        "bogus.key",
        "card.c",
        "card.f",
        "d.e",
        "g.h",
        "inventory.edit",
    ]
    assert "bogus.key" not in ALL_APP_PERMISSION_KEYS | ALL_CARD_PERMISSION_KEYS
