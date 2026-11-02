"""Guard: the three structural conventions every new route and model follows.

CLAUDE.md, *Backend Conventions*:

- "Use ``async def`` for all route handlers and database operations." A sync
  handler runs on FastAPI's thread pool, and an async session awaited from one
  is a bug waiting for load.
- "New routes must be registered in ``backend/app/api/v1/router.py``." A
  router that is defined but never included serves nothing, and its tests
  (which build the app) would 404 rather than say why.
- "New models … must be imported in ``backend/app/models/__init__.py``." A
  model missing there is missing from ``Base.metadata`` wherever only the
  package is imported — Alembic autogenerate and the test schema among them.

Reads ``app/`` as source, so it is a ``source_scan`` and is deselected under
mutmut (``tests/mutation_plugin.py``).
"""

from __future__ import annotations

import ast
import re

import pytest

from tests.app_source import API_V1, APP, api_modules, handlers_in, route_handlers, routers_defined

pytestmark = pytest.mark.source_scan

ROUTER_MODULE = "router.py"

MODELS_NOT_IMPORTED: dict[str, str] = {
    "provenance.py": "mixin and helpers only, no table; imported by the models that use it",
}


# ---------------------------------------------------------------------------
# (a) async handlers
# ---------------------------------------------------------------------------


def test_every_route_handler_is_async():
    handlers = route_handlers()
    assert len(handlers) >= 500  # a broken matcher would pass everything
    sync = [h.key for h in handlers if not h.is_async]
    assert not sync, f"Route handlers must be `async def`: {sync}"


def test_the_handler_scan_tells_sync_from_async():
    text = """
@router.get("/a")
async def a():
    ...

@router.get("/b")
def b():
    ...
"""
    assert {h.func_name: h.is_async for h in handlers_in("x.py", text)} == {"a": True, "b": False}


# ---------------------------------------------------------------------------
# (b) every router is included
# ---------------------------------------------------------------------------


def _defined_routers() -> set[tuple[str, str]]:
    return {
        (name.removesuffix(".py"), var)
        for name, text in api_modules().items()
        if name != ROUTER_MODULE
        for var in routers_defined(text)
    }


def _included_routers(router_text: str) -> set[tuple[str, str]]:
    included = set()
    for node in ast.walk(ast.parse(router_text)):
        if (
            isinstance(node, ast.Call)
            and isinstance(node.func, ast.Attribute)
            and node.func.attr == "include_router"
            and node.args
            and isinstance(node.args[0], ast.Attribute)
            and isinstance(node.args[0].value, ast.Name)
        ):
            included.add((node.args[0].value.id, node.args[0].attr))
    return included


def test_every_router_is_included():
    defined = _defined_routers()
    assert len(defined) >= 50
    missing = sorted(defined - _included_routers((API_V1 / ROUTER_MODULE).read_text()))
    assert not missing, (
        f"These routers are defined but never included in app/api/v1/{ROUTER_MODULE} — "
        f"add api_router.include_router(<module>.<router>): {missing}"
    )


def test_the_router_scan_reads_several_routers_per_module():
    text = 'router = APIRouter(prefix="/x")\nother_router = APIRouter()\nnot_a_router = dict()\n'
    assert routers_defined(text) == {"router", "other_router"}
    router_text = "api_router.include_router(x.router)\napi_router.include_router(y.other)\n"
    assert _included_routers(router_text) == {("x", "router"), ("y", "other")}


# ---------------------------------------------------------------------------
# (c) every model is imported in app/models/__init__.py
# ---------------------------------------------------------------------------

_MODEL_IMPORT = re.compile(r"^from app\.models\.(\w+) import", re.MULTILINE)


def _model_files() -> set[str]:
    return {p.name for p in (APP / "models").glob("*.py") if p.name != "__init__.py"}


def _imported_models() -> set[str]:
    init = (APP / "models" / "__init__.py").read_text(encoding="utf-8")
    return {f"{module}.py" for module in _MODEL_IMPORT.findall(init)}


def test_every_model_is_imported_in_the_package():
    missing = sorted(_model_files() - _imported_models() - set(MODELS_NOT_IMPORTED))
    assert not missing, (
        "These model files are not imported in app/models/__init__.py, so their tables "
        f"may be missing from Base.metadata — import them there: {missing}"
    )


def test_models_allowlist_is_not_stale():
    files, imported = _model_files(), _imported_models()
    for name in MODELS_NOT_IMPORTED:
        assert name in files, f"models/{name} no longer exists; drop it from MODELS_NOT_IMPORTED"
        assert name not in imported, (
            f"models/{name} is now imported in __init__.py; drop it from MODELS_NOT_IMPORTED"
        )


def test_the_model_import_scan_reads_parenthesised_imports():
    init = "from app.models.a import A\nfrom app.models.b import (\n    B,\n)\nimport os\n"
    assert {f"{m}.py" for m in _MODEL_IMPORT.findall(init)} == {"a.py", "b.py"}
