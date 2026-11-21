"""Extension operations offered to AI assistants (SDK 1.18).

An extension holding the manifest grant ``core.agent.tools`` may implement the
OPTIONAL ``get_agent_tools()`` hook (duck-typed like ``get_event_handlers``,
so older extensions load untouched) returning :class:`AgentTool` rows. Each
row names one route on the extension's own router; the core MCP server lists
the live rows (``GET /extensions/agent-tools``) and calls the route itself
with the person's token.

The registry adds no authority. ``require_extension`` (installed, enabled,
licensed) gates the route on every call, the route's own permission check
still runs, and the catalogue shows a tool only to people holding its
declared permission. What the registry does is refuse, at startup, every
declaration it cannot vouch for — dropped and logged, never fatal and never
blocking boot:

- a name outside ``^[a-z][a-z0-9_]{0,62}$`` or used twice by one extension;
- a ``(method, path)`` that is not a route on the router core mounted;
- a configuration path (settings, credentials, connection tests, demo data,
  administration) — configuration stays in the web UI;
- a file download (a last path segment with a file extension);
- a permission that is neither the extension's own ``ext.{key}.*`` key nor a
  registered core key, or that is an administration key;
- path parameters that differ from the route's, or query parameters the route
  does not take;
- an argument schema that is not a JSON-schema object, or none at all where
  the route's body is a bare ``dict`` (nothing to derive one from);
- a ``read`` kind on anything but GET / POST, a ``write`` / ``destructive``
  kind on a GET.

Liveness is re-checked on every read through ``extension_registry.grants_for``,
so disabling the extension or a lapsed licence withdraws its tools at once,
without a restart.
"""

from __future__ import annotations

import dataclasses
import json
import logging
import re
from collections.abc import Iterable, Sequence
from typing import Any

from fastapi import APIRouter
from fastapi.routing import APIRoute
from pydantic import BaseModel, TypeAdapter

from app.services.extensions.loader import LoadReport
from app.services.extensions.registry import ExtensionInfo, extension_registry
from app.services.extensions.sdk import AGENT_TOOL_KINDS, AgentTool

logger = logging.getLogger(__name__)

#: The manifest grant that unlocks offering agent tools.
GRANT = "core.agent.tools"

NAME_PATTERN = re.compile(r"^[a-z][a-z0-9_]{0,62}$")
METHODS = frozenset({"GET", "POST", "PUT", "PATCH", "DELETE"})
READ_METHODS = frozenset({"GET", "POST"})
#: Methods whose arguments all travel in the query string (the MCP server
#: sends no body with them), so the route may take no body either.
QUERY_METHODS = frozenset({"GET", "DELETE"})
MAX_TITLE_LENGTH = 200
MAX_DESCRIPTION_LENGTH = 4000
MAX_TOOLS_PER_EXTENSION = 100

#: Words that mark a configuration route. Matched against each literal path
#: segment split on ``-`` / ``_`` / ``.``, so ``connection-settings`` and
#: ``admin_users`` are configuration too.
CONFIG_WORDS = frozenset(
    {
        "settings",
        "setting",
        "config",
        "configs",
        "configuration",
        "demo",
        "admin",
        "secret",
        "secrets",
        "credential",
        "credentials",
    }
)
#: Whole segments that mark a configuration route.
CONFIG_SEGMENTS = frozenset({"test-connection", "test_connection"})

_FILE_EXTENSION = re.compile(r"\.[A-Za-z0-9]{1,10}$")
_PATH_PARAM = re.compile(r"\{([^}:]+)(?::[^}]*)?\}")
_TOKEN_SPLIT = re.compile(r"[-_.]")


class AgentToolError(ValueError):
    """A declaration the registry refuses; the message says why."""


#: extension key -> its accepted, normalised tools. Empty on a stock install.
_tools: dict[str, list[AgentTool]] = {}


def reset_tools() -> None:
    """Drop every registration. Test helper — mirrors ``reset_types``."""
    _tools.clear()


# ---------------------------------------------------------------------------
# Pure checks
# ---------------------------------------------------------------------------


def config_segment(path: str) -> str | None:
    """The first literal segment of ``path`` that marks configuration, else None."""
    for segment in str(path).split("/"):
        literal = _PATH_PARAM.sub("", segment).lower()
        if not literal:
            continue
        if literal in CONFIG_SEGMENTS:
            return segment
        if any(token in CONFIG_WORDS for token in _TOKEN_SPLIT.split(literal)):
            return segment
    return None


def is_file_download(path: str) -> bool:
    """True when the last path segment ends in a file extension (``/export.csv``).

    ``_FILE_EXTENSION`` is anchored at the end and cannot match a ``/``, so it
    only ever sees the last segment; no split is needed."""
    return bool(_FILE_EXTENSION.search(str(path).rstrip("/")))


def path_params_of(path: str) -> tuple[str, ...]:
    """The parameter names in a route path, in order (``{id}``, ``{rest:path}``)."""
    return tuple(_PATH_PARAM.findall(str(path)))


def permission_problem(ext_key: str, permission: str, known: Iterable[str]) -> str | None:
    """None when ``permission`` may gate an agent tool of ``ext_key``, else why not."""
    perm = str(permission or "")
    if not perm:
        return "no permission declared"
    own = f"ext.{ext_key}."
    admin = f"{own}admin"
    if perm == admin or perm.startswith(f"{admin}.") or perm.startswith(f"{admin}_"):
        return f"permission {perm!r} is the extension's administration key"
    if perm.startswith("ext.") and not perm.startswith(own):
        return f"permission {perm!r} belongs to another extension"
    if perm.startswith("admin."):
        return f"permission {perm!r} is an administration key"
    if perm not in set(known):
        return f"permission {perm!r} is not a registered permission key"
    return None


def kind_problem(kind: str, method: str) -> str | None:
    """None when ``kind`` fits ``method``, else why not."""
    if kind not in AGENT_TOOL_KINDS:
        return f"kind {kind!r} is not one of {list(AGENT_TOOL_KINDS)}"
    if kind == "read" and method not in READ_METHODS:
        return f"a read tool must be GET or POST, not {method}"
    if kind != "read" and method == "GET":
        return f"a {kind} tool cannot be a GET route"
    return None


def schema_problem(schema: Any) -> str | None:
    """None when ``schema`` is a usable JSON-schema object, else why not."""
    if not isinstance(schema, dict):
        return "input_schema must be a JSON-schema object (a dict)"
    if schema.get("type") != "object":
        return 'input_schema must have "type": "object"'
    properties = schema.get("properties", {})
    if not isinstance(properties, dict):
        return "input_schema properties must be an object"
    required = schema.get("required", [])
    if not isinstance(required, list) or not all(isinstance(r, str) for r in required):
        return "input_schema required must be a list of strings"
    try:
        json.dumps(schema)
    except (TypeError, ValueError):
        return "input_schema must be JSON-serialisable"
    return None


def find_route(routes: Sequence[Any], method: str, path: str) -> APIRoute | None:
    """The route on the extension router serving ``method path``, else None."""
    for route in routes:
        if isinstance(route, APIRoute) and route.path == path and method in (route.methods or ()):
            return route
    return None


def _query_fields(route: APIRoute) -> dict[str, Any]:
    """The route's query parameters (its dependencies' included), keyed by wire name."""
    fields: dict[str, Any] = {}
    seen: set[int] = set()
    pending = [route.dependant]
    while pending:
        dependant = pending.pop()
        if id(dependant) in seen:
            continue
        seen.add(id(dependant))
        for field in dependant.query_params:
            fields.setdefault(field.alias, field)
        pending.extend(dependant.dependencies)
    return fields


def _field_schema(field: Any) -> dict[str, Any]:
    try:
        return dict(TypeAdapter(field.field_info.annotation).json_schema())
    except Exception:  # noqa: BLE001 - an exotic type still gets a property
        return {}


def body_model(route: APIRoute) -> type[BaseModel] | None:
    """The pydantic model the route reads its body into, or None (no body, or a bare dict)."""
    body = route.body_field
    if body is None:
        return None
    annotation = body.field_info.annotation
    if isinstance(annotation, type) and issubclass(annotation, BaseModel):
        return annotation
    return None


def derive_input_schema(route: APIRoute, method: str, query_params: Sequence[str]) -> dict | None:
    """An argument schema built from the route, or None when there is nothing to build from.

    A GET or DELETE takes every query parameter of the route; any other method takes
    its body model's properties plus the declared query parameters. A route
    whose body is not a pydantic model (a bare ``dict``) yields None — the
    declaration must then carry its own schema.
    """
    query = _query_fields(route)
    properties: dict[str, Any] = {}
    required: list[str] = []
    defs: dict[str, Any] = {}
    if method in QUERY_METHODS:
        names = list(query)
    else:
        if route.body_field is not None:
            model = body_model(route)
            if model is None:
                return None
            schema = model.model_json_schema()
            properties.update(schema.get("properties") or {})
            required.extend(schema.get("required") or [])
            defs = dict(schema.get("$defs") or {})
        names = [name for name in query_params if name in query]
    for name in names:
        field = query[name]
        properties[name] = _field_schema(field)
        if field.field_info.is_required():
            required.append(name)
    out: dict[str, Any] = {"type": "object", "properties": properties}
    if required:
        out["required"] = required
    if defs:
        out["$defs"] = defs
    return out


def with_path_params(schema: dict[str, Any], path_params: Sequence[str]) -> dict[str, Any]:
    """``schema`` with every path parameter as a required string property."""
    if not path_params:
        return schema
    out = dict(schema)
    properties = dict(out.get("properties") or {})
    required = list(out.get("required") or [])
    for name in path_params:
        properties.setdefault(name, {"type": "string"})
        if name not in required:
            required.append(name)
    out["properties"] = properties
    out["required"] = required
    return out


def _string_tuple(value: Any, what: str) -> tuple[str, ...]:
    if isinstance(value, str) or not isinstance(value, (list, tuple)):
        raise AgentToolError(f"{what} must be a list of names")
    if not all(isinstance(item, str) and item for item in value):
        raise AgentToolError(f"{what} must be a list of names")
    return tuple(value)


def check_agent_tool(
    ext_key: str,
    tool: Any,
    routes: Sequence[Any],
    known_permissions: Iterable[str],
) -> AgentTool:
    """The normalised tool when ``tool`` is acceptable for ``ext_key``; raises otherwise."""
    if not isinstance(tool, AgentTool):
        raise AgentToolError("not an AgentTool")
    if not isinstance(tool.name, str) or not NAME_PATTERN.match(tool.name):
        raise AgentToolError(f"name {tool.name!r} must match {NAME_PATTERN.pattern}")
    for what, text, limit in (
        ("title", tool.title, MAX_TITLE_LENGTH),
        ("description", tool.description, MAX_DESCRIPTION_LENGTH),
    ):
        if not isinstance(text, str) or not text.strip():
            raise AgentToolError(f"{what} is empty")
        if len(text) > limit:
            raise AgentToolError(f"{what} is longer than {limit} characters")
    method = str(tool.method).upper()
    if method not in METHODS:
        raise AgentToolError(f"method {tool.method!r} is not one of {sorted(METHODS)}")
    path = str(tool.path or "")
    if not path.startswith("/"):
        raise AgentToolError(f"path {path!r} must start with /")
    segment = config_segment(path)
    if segment is not None:
        raise AgentToolError(f"path {path!r} is a configuration route ({segment!r})")
    if is_file_download(path):
        raise AgentToolError(f"path {path!r} is a file download")
    problem = permission_problem(ext_key, tool.permission, known_permissions)
    if problem:
        raise AgentToolError(problem)
    problem = kind_problem(tool.kind, method)
    if problem:
        raise AgentToolError(problem)
    if tool.supports_dry_run and method in QUERY_METHODS:
        raise AgentToolError(f"a {method} route cannot take dry_run in its body")
    route = find_route(routes, method, path)
    if route is None:
        raise AgentToolError(f"no {method} {path} route on the extension's router")
    if method in QUERY_METHODS and route.body_field is not None:
        raise AgentToolError(f"a {method} route offered as a tool cannot take a body")
    path_params = _string_tuple(tool.path_params, "path_params")
    if set(path_params) != set(path_params_of(route.path)) or len(path_params) != len(
        set(path_params)
    ):
        raise AgentToolError(
            f"path_params {list(path_params)} must equal the route's "
            f"{list(path_params_of(route.path))}"
        )
    query_params = _string_tuple(tool.query_params, "query_params")
    route_query = _query_fields(route)
    unknown_query = [name for name in query_params if name not in route_query]
    if unknown_query:
        raise AgentToolError(f"query_params {unknown_query} are not query parameters of the route")
    if set(query_params) & set(path_params):
        raise AgentToolError("a name cannot be both a path and a query parameter")
    schema = tool.input_schema
    if schema is None:
        schema = derive_input_schema(route, method, query_params)
        if schema is None:
            raise AgentToolError("the route takes a bare dict body, so input_schema is required")
    problem = schema_problem(schema)
    if problem:
        raise AgentToolError(problem)
    return dataclasses.replace(
        tool,
        method=method,
        input_schema=with_path_params(dict(schema), path_params),
        path_params=path_params,
        query_params=query_params,
        supports_dry_run=bool(tool.supports_dry_run),
    )


def collect_tools(
    ext_key: str,
    tools: Iterable[Any],
    router: APIRouter,
    known_permissions: Iterable[str],
) -> list[AgentTool]:
    """Every acceptable declaration in ``tools``; each refused one is logged and dropped."""
    known = set(known_permissions)
    accepted: list[AgentTool] = []
    names: set[str] = set()
    for tool in tools:
        label = getattr(tool, "name", repr(tool))
        if len(accepted) >= MAX_TOOLS_PER_EXTENSION:
            logger.warning(
                "Extension %s declares more than %d agent tools — %r and the rest skipped",
                ext_key,
                MAX_TOOLS_PER_EXTENSION,
                label,
            )
            break
        try:
            normalised = check_agent_tool(ext_key, tool, router.routes, known)
        except AgentToolError as exc:
            logger.warning("Extension %s agent tool %r skipped: %s", ext_key, label, exc)
            continue
        if normalised.name in names:
            logger.warning(
                "Extension %s agent tool %r skipped: the name is already used", ext_key, label
            )
            continue
        names.add(normalised.name)
        accepted.append(normalised)
    return accepted


# ---------------------------------------------------------------------------
# Startup + live reads
# ---------------------------------------------------------------------------


def register_extension_tools(ext_key: str, manifest: dict, instance: Any, router: Any) -> int:
    """Collect and register one extension's tools; returns how many were accepted."""
    _tools.pop(ext_key, None)
    hook = getattr(instance, "get_agent_tools", None)
    if hook is None:
        return 0
    grants = manifest.get("grants") or []
    if GRANT not in grants:
        logger.warning(
            "Extension %s offers agent tools but does not declare the %s grant — tools skipped",
            ext_key,
            GRANT,
        )
        return 0
    if router is None:
        logger.warning("Extension %s offers agent tools but mounts no router — skipped", ext_key)
        return 0
    try:
        declared = list(hook() or [])
    except Exception:  # noqa: BLE001 - a broken hook never blocks boot
        logger.exception("Extension %s get_agent_tools() failed", ext_key)
        return 0
    from app.core.permissions import ALL_APP_PERMISSION_KEYS

    accepted = collect_tools(ext_key, declared, router, ALL_APP_PERMISSION_KEYS)
    if accepted:
        _tools[ext_key] = accepted
        logger.info("Registered %d agent tool(s) for extension %s", len(accepted), ext_key)
    return len(accepted)


def start_agent_tools(report: LoadReport) -> None:
    """Register every loaded extension's agent tools at startup."""
    reset_tools()
    for ext in report.loaded:
        if ext.instance is None:
            continue
        try:
            register_extension_tools(ext.key, ext.manifest or {}, ext.instance, ext.router)
        except Exception:  # noqa: BLE001 - never fatal
            logger.exception("Extension %s agent tools could not be registered", ext.key)


def live_tools() -> list[tuple[ExtensionInfo, list[AgentTool]]]:
    """``(extension, tools)`` for every extension whose tools may be offered right now."""
    out: list[tuple[ExtensionInfo, list[AgentTool]]] = []
    for key in sorted(_tools):
        info = extension_registry.get(key)
        if info is None or GRANT not in extension_registry.grants_for(key):
            continue
        out.append((info, list(_tools[key])))
    return out


def tool_payload(tool: AgentTool) -> dict[str, Any]:
    """The wire shape of one tool in ``GET /extensions/agent-tools``."""
    return {
        "name": tool.name,
        "title": tool.title,
        "description": tool.description,
        "kind": tool.kind,
        "method": tool.method,
        "path": tool.path,
        "path_params": list(tool.path_params),
        "query_params": list(tool.query_params),
        "input_schema": tool.input_schema or {"type": "object", "properties": {}},
        "supports_dry_run": tool.supports_dry_run,
    }


async def catalogue_for(db: Any, user: Any) -> list[dict[str, Any]]:
    """The live catalogue as ``user`` may see it: each extension with the tools
    whose permission the caller holds; an extension left with none is omitted.

    The same check the route itself makes (``PermissionService``), so a role
    that cannot call a tool's route never learns the tool exists.
    """
    from app.services.permission_service import PermissionService

    verdicts: dict[str, bool] = {}
    out: list[dict[str, Any]] = []
    for info, tools in live_tools():
        visible: list[dict[str, Any]] = []
        for tool in tools:
            if tool.permission not in verdicts:
                verdicts[tool.permission] = await PermissionService.check_permission(
                    db, user, tool.permission
                )
            if verdicts[tool.permission]:
                visible.append(tool_payload(tool))
        if visible:
            out.append(
                {"key": info.key, "name": info.name, "version": info.version, "tools": visible}
            )
    return out
