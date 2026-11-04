"""The MCP server talks to Turbo EA over its HTTP API — never to the database.

Every read and write the server makes goes through ``api_client`` as the
signed-in user, so the backend's permission checks, card read scope and audit
trail apply to an AI client exactly as they do to the web UI. A module that
imported the backend's ``app`` package, or a database driver, would have a way
around all three — and would also fail in the mcp-server image, which ships
none of them. This scan fails on any such import under ``turbo_ea_mcp/``.
"""

from __future__ import annotations

import ast
from pathlib import Path

import pytest

PACKAGE = Path(__file__).resolve().parents[1] / "turbo_ea_mcp"

FORBIDDEN = frozenset({"sqlalchemy", "asyncpg", "psycopg", "psycopg2", "app"})


def _forbidden_imports(source: str) -> list[tuple[int, str]]:
    """``(line, module)`` for every import whose top-level package is forbidden."""
    found = []
    for node in ast.walk(ast.parse(source)):
        if isinstance(node, ast.Import):
            names = [alias.name for alias in node.names]
        elif isinstance(node, ast.ImportFrom) and node.level == 0 and node.module:
            names = [node.module]
        else:
            continue
        found += [(node.lineno, name) for name in names if name.split(".")[0] in FORBIDDEN]
    return found


def test_the_scan_covers_the_package():
    assert len(list(PACKAGE.rglob("*.py"))) >= 5


def test_no_module_imports_the_backend_or_a_database_driver():
    offenders = [
        f"{path.relative_to(PACKAGE).as_posix()}:{line} {module}"
        for path in sorted(PACKAGE.rglob("*.py"))
        for line, module in _forbidden_imports(path.read_text(encoding="utf-8"))
    ]
    assert not offenders, (
        "turbo_ea_mcp must reach Turbo EA through its HTTP API (api_client), never the "
        f"backend package or the database: {offenders}"
    )


@pytest.mark.parametrize(
    "snippet",
    [
        "import sqlalchemy",
        "from sqlalchemy.ext.asyncio import AsyncSession",
        "import asyncpg, httpx",
        "import psycopg2.extras",
        "from psycopg import connect",
        "from app.models.card import Card",
        "import app.database",
        "def f():\n    from app.services import x\n",
    ],
)
def test_scanner_flags_a_forbidden_import(snippet):
    assert _forbidden_imports(snippet)


@pytest.mark.parametrize(
    "snippet",
    [
        "import httpx",
        "from turbo_ea_mcp import api_client",
        "from . import app",
        "from .app import thing",
        "import apple",
        "from application import x",
        "import sqlalchemy_utils_like_name as s",
    ],
)
def test_scanner_ignores_near_misses(snippet):
    assert _forbidden_imports(snippet) == []
