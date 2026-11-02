"""Read the backend's own source for the static guard tests.

The convention guards (``tests/services/test_route_auth_guard.py``,
``test_no_raw_sql_guard.py``, ``test_api_conventions_guard.py``,
``test_permission_keys_guard.py``) all walk ``app/`` as text or as an AST.
This module is the one place that knows where ``app/`` is and what a route
handler looks like, so every guard agrees on both.

Importable without a database or the app itself — it never imports ``app``.
A test that uses it reads source instead of running it, so it carries
``pytestmark = pytest.mark.source_scan`` (``tests/mutation_plugin.py``).
"""

from __future__ import annotations

import ast
from dataclasses import dataclass, field
from pathlib import Path

APP = Path(__file__).resolve().parents[1] / "app"
API_V1 = APP / "api" / "v1"

_HTTP_METHODS = frozenset({"get", "post", "put", "patch", "delete"})


def iter_py(sub: str = "") -> dict[str, str]:
    """Every ``.py`` file under ``app/<sub>``, keyed by its posix path relative to ``app/``."""
    root = APP / sub if sub else APP
    return {
        path.relative_to(APP).as_posix(): path.read_text(encoding="utf-8")
        for path in sorted(root.rglob("*.py"))
    }


def api_modules() -> dict[str, str]:
    """``app/api/v1/*.py`` keyed by file name."""
    return {path.name: path.read_text(encoding="utf-8") for path in sorted(API_V1.glob("*.py"))}


@dataclass
class RouteHandler:
    module: str
    func_name: str
    lineno: int
    is_async: bool
    methods: list[str] = field(default_factory=list)
    dependency_names: set[str] = field(default_factory=set)

    @property
    def key(self) -> str:
        return f"{self.module}:{self.func_name}"


def dotted_name(node: ast.AST) -> str | None:
    """``get_current_user`` for a Name, ``deps.get_current_user`` for an Attribute."""
    if isinstance(node, ast.Name):
        return node.id
    if isinstance(node, ast.Attribute):
        base = dotted_name(node.value)
        return f"{base}.{node.attr}" if base else node.attr
    return None


def _depends_targets(node: ast.AST) -> set[str]:
    """The callee of every ``Depends(...)`` inside ``node``.

    ``Depends(get_current_user)`` gives ``get_current_user``;
    ``Depends(require_permission("x"))`` gives ``require_permission`` (the
    factory the inner call names).
    """
    found: set[str] = set()
    for sub in ast.walk(node):
        if not (isinstance(sub, ast.Call) and dotted_name(sub.func) in ("Depends", "Security")):
            continue
        if not sub.args:
            continue
        target = sub.args[0]
        if isinstance(target, ast.Call):
            target = target.func
        name = dotted_name(target)
        if name:
            found.add(name.rsplit(".", 1)[-1])
    return found


def _route_methods(func: ast.FunctionDef | ast.AsyncFunctionDef) -> list[ast.Call]:
    """The route decorators on ``func``: ``@<any router>.get(...)`` and friends."""
    return [
        dec
        for dec in func.decorator_list
        if isinstance(dec, ast.Call)
        and isinstance(dec.func, ast.Attribute)
        and dec.func.attr in _HTTP_METHODS
        and isinstance(dec.func.value, ast.Name)
    ]


def handlers_in(module: str, text: str) -> list[RouteHandler]:
    """Every route handler in one module's source."""
    handlers = []
    for node in ast.walk(ast.parse(text)):
        if not isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            continue
        decorators = _route_methods(node)
        if not decorators:
            continue
        deps: set[str] = set()
        for dec in decorators:
            deps |= _depends_targets(dec)
        args = node.args
        for arg in [*args.posonlyargs, *args.args, *args.kwonlyargs]:
            if arg.annotation is not None:
                deps |= _depends_targets(arg.annotation)
        for default in [*args.defaults, *args.kw_defaults]:
            if default is not None:
                deps |= _depends_targets(default)
        handlers.append(
            RouteHandler(
                module=module,
                func_name=node.name,
                lineno=node.lineno,
                is_async=isinstance(node, ast.AsyncFunctionDef),
                methods=[dec.func.attr.upper() for dec in decorators],  # type: ignore[union-attr]
                dependency_names=deps,
            )
        )
    return handlers


def route_handlers() -> list[RouteHandler]:
    """Every route handler under ``app/api/v1/``."""
    return [handler for name, text in api_modules().items() for handler in handlers_in(name, text)]


def router_level_dependencies(module_text: str) -> set[str]:
    """Names inside ``APIRouter(..., dependencies=[Depends(x), ...])`` in a module."""
    found: set[str] = set()
    for node in ast.walk(ast.parse(module_text)):
        if isinstance(node, ast.Call) and dotted_name(node.func) == "APIRouter":
            for kw in node.keywords:
                if kw.arg == "dependencies":
                    found |= _depends_targets(kw.value)
    return found


def routers_defined(module_text: str) -> set[str]:
    """The module-level names assigned an ``APIRouter(...)``."""
    names: set[str] = set()
    for node in ast.parse(module_text).body:
        if (
            isinstance(node, ast.Assign)
            and isinstance(node.value, ast.Call)
            and dotted_name(node.value.func) == "APIRouter"
        ):
            names |= {t.id for t in node.targets if isinstance(t, ast.Name)}
    return names
