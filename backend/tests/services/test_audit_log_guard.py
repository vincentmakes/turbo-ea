"""Recurrence guard: every admin write route records itself in the audit log.

PR B of discussion #1185 gave each administrative write an ``audit_log.record``
row (``admin.user.*``, ``admin.role.*``, ``admin.settings.updated``, …). The
regression this pins is a *new* route added to an admin module without one: it
would change who may do what, or how the instance behaves, and leave nothing in
Admin → Settings → Audit log → Security & admin for a reviewer to find.

The scan is an AST walk over the route modules under ``app/api/v1/``:

- In a **pure-admin** module every handler decorated ``@router.post`` /
  ``patch`` / ``put`` / ``delete`` must record, or sit in
  ``NOT_AN_ADMIN_ACTION`` with the reason it is not an admin action (a
  self-service preference, a probe that changes nothing, a content write the
  card History already records as an event).
- In a **mixed** module (mostly content routes) only the named handlers must.

"Records" means the handler's own source calls ``audit_log.record(`` or a
module-level helper that does — ``settings.py``'s ``_audit_setting`` is the
canonical one — so a handler that delegates is not a false failure.

The export half scans every GET route the same way: one that looks like a bulk
export (an ``export`` path segment, a ``Content-Disposition`` header, or a CSV /
zip / JSON response) must record, or sit in ``NOT_A_BULK_EXPORT`` with the
reason it is not one.

Reads the source as text, so mutmut's rewritten copy would be scanned: marked
``source_scan`` and deselected under mutmut (``tests/mutation_plugin.py``).
"""

from __future__ import annotations

import ast
import re
from pathlib import Path

import pytest

pytestmark = pytest.mark.source_scan

_V1 = Path(__file__).resolve().parents[2] / "app" / "api" / "v1"

_WRITE_VERBS = frozenset({"post", "patch", "put", "delete"})
_RECORD = re.compile(r"\baudit_log\.record\(")

# Every mutating route in these modules is an administrative action.
PURE_ADMIN_MODULES = (
    "users.py",
    "roles.py",
    "stakeholder_roles.py",
    "settings.py",
    "metamodel.py",
    "tags.py",
    "calculations.py",
    "extensions.py",
    "workspace.py",
    "migration.py",
    "servicenow.py",
    "web_portals.py",
    "principles_catalogue.py",
)

# Mostly content routes; only these handlers are administrative.
MIXED_MODULES = {
    "diagrams.py": ("publish_diagram", "unpublish_diagram"),
    "surveys.py": ("send_survey", "close_survey"),
    "ops.py": ("create_rescue_access", "revoke_rescue_access"),
}

# ``<module>::<handler>`` → why it writes nothing to the audit log.
NOT_AN_ADMIN_ACTION = {
    "users.py::update_notification_preferences": (
        "self-service preference: the caller edits only their own notification opt-ins"
    ),
    "users.py::update_ui_preferences": (
        "self-service preference: the caller edits only their own UI preferences"
    ),
    "settings.py::test_email_settings": (
        "probe: sends a test email to the caller with the stored settings, changes nothing"
    ),
    "settings.py::test_ai_connection": (
        "probe: checks connectivity to the stored AI provider, changes nothing"
    ),
    "settings.py::run_extension_store_check_now": (
        "probe: runs the daily store check on demand; writes only its own check status"
    ),
    "calculations.py::test_calculation": (
        "probe: dry-runs a formula against one card and returns the result, writes nothing"
    ),
    "calculations.py::validate_formula_endpoint": (
        "probe: syntax-checks a formula, writes nothing"
    ),
    "servicenow.py::test_connection": (
        "probe: checks connectivity to the stored ServiceNow instance, changes nothing"
    ),
    "servicenow.py::preview_mapping": ("probe: previews what a mapping would pull, writes nothing"),
    "tags.py::assign_tags": (
        "content write on a card: recorded as a tag.added card event in its History"
    ),
    "tags.py::remove_tag": (
        "content write on a card: recorded as a tag.removed card event in its History"
    ),
    "extensions.py::open_billing_portal": (
        "mints a store billing-portal link for the browser to open; changes nothing locally"
    ),
    "web_portals.py::portal_sso_callback": (
        "an anonymous visitor signing in to a public portal, not an administrator acting"
    ),
}


def _is_write_route(node: ast.AST) -> bool:
    if not isinstance(node, ast.AsyncFunctionDef):
        return False
    for dec in node.decorator_list:
        func = dec.func if isinstance(dec, ast.Call) else dec
        if (
            isinstance(func, ast.Attribute)
            and func.attr in _WRITE_VERBS
            and isinstance(func.value, ast.Name)
            and func.value.id == "router"
        ):
            return True
    return False


def _calls(source: str, names: set[str]) -> bool:
    return any(re.search(rf"\b{re.escape(name)}\(", source) for name in names)


def recording_helpers(tree: ast.Module, source: str) -> set[str]:
    """Module-level functions that call ``audit_log.record`` — directly or via
    another such helper — and are not routes themselves."""
    helpers: dict[str, str] = {
        node.name: ast.get_source_segment(source, node) or ""
        for node in tree.body
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)) and not _is_write_route(node)
    }
    found = {name for name, text in helpers.items() if _RECORD.search(text)}
    while True:
        more = {name for name, text in helpers.items() if name not in found and _calls(text, found)}
        if not more:
            return found
        found |= more


def records(handler_source: str, helpers: set[str]) -> bool:
    """True when a handler's source writes an audit row itself or through a helper."""
    return bool(_RECORD.search(handler_source)) or _calls(handler_source, helpers)


def _write_routes(module: str) -> dict[str, bool]:
    """``{handler name: records?}`` for every write route in ``module``."""
    source = (_V1 / module).read_text(encoding="utf-8")
    tree = ast.parse(source)
    helpers = recording_helpers(tree, source)
    return {
        node.name: records(ast.get_source_segment(source, node) or "", helpers)
        for node in tree.body
        if _is_write_route(node)
    }


def test_every_admin_write_route_records():
    unrecorded = []
    for module in PURE_ADMIN_MODULES:
        for name, recorded in _write_routes(module).items():
            if not recorded and f"{module}::{name}" not in NOT_AN_ADMIN_ACTION:
                unrecorded.append(f"{module}::{name}")
    for module, names in MIXED_MODULES.items():
        routes = _write_routes(module)
        for name in names:
            assert name in routes, f"{module}::{name} is no longer a write route; update the list"
            if not routes[name]:
                unrecorded.append(f"{module}::{name}")
    assert not unrecorded, (
        "These admin write routes do not record an audit row — call "
        "app.services.audit_log.record (or a module helper that does) before the "
        "commit, or list the handler in NOT_AN_ADMIN_ACTION with the reason it is "
        f"not an admin action: {unrecorded}"
    )


def test_allowlist_is_not_stale():
    for entry in NOT_AN_ADMIN_ACTION:
        module, name = entry.split("::")
        assert module in PURE_ADMIN_MODULES, f"{entry}: {module} is not a scanned module"
        routes = _write_routes(module)
        assert name in routes, f"{entry} is no longer a write route; drop it from the allowlist"
        assert not routes[name], f"{entry} now records an audit row; drop it from the allowlist"


def test_scan_sees_delegated_record():
    source = (
        "async def _audit_setting(db, user, key, old, new):\n"
        "    await audit_log.record(db, action='admin.settings.updated', category='admin')\n"
        "\n"
        "async def _audit_twice(db):\n"
        "    await _audit_setting(db, None, 'k', 1, 2)\n"
        "\n"
        "def _unrelated():\n"
        "    return 1\n"
    )
    helpers = recording_helpers(ast.parse(source), source)
    assert helpers == {"_audit_setting", "_audit_twice"}
    assert records("    await _audit_setting(db, user, 'currency', old, new)\n", helpers)
    assert records("    await _audit_twice(db)\n", helpers)
    assert records("    await audit_log.record(db, action='x', category='admin')\n", set())
    assert not records("    await _unrelated()\n", helpers)
    assert not records("    await event_bus.publish('x', {})\n", helpers)


def test_settings_helper_is_recognised():
    source = (_V1 / "settings.py").read_text(encoding="utf-8")
    assert "_audit_setting" in recording_helpers(ast.parse(source), source)


def test_scan_sees_only_router_write_verbs():
    source = (
        "@router.get('/x')\nasync def read(): ...\n"
        "@router.patch('/x')\nasync def write(): ...\n"
        "@other.post('/x')\nasync def elsewhere(): ...\n"
        "@router.delete('/x', status_code=204)\nasync def remove(): ...\n"
    )
    tree = ast.parse(source)
    assert [n.name for n in tree.body if _is_write_route(n)] == ["write", "remove"]


# Read routes that hand data out of the instance (PR C of discussion #1185).
# Every GET route under ``app/api/v1/`` is scanned; one that looks like a bulk
# export (``is_bulk_export``) must record an audit row, directly or through a
# module helper, or sit in ``NOT_A_BULK_EXPORT`` with the reason it is not one.
# The OData bookmark feed is deliberately not recorded (Excel and Power BI poll
# it on a schedule, see the comment on ``bookmark_odata_feed``), and it carries
# none of the signals below, so it needs no allowlist entry.
_EXPORT_SEGMENT = re.compile(r"(?:^|/)export(?:/|$)")
_BULK_MEDIA_TYPES = frozenset({"text/csv", "application/zip", "application/json"})
_RESPONSE_CALLS = frozenset({"Response", "StreamingResponse"})

# The bulk exports the scan finds today. A new one appears here, records, and
# the self-test below is updated with it; that is the point of the scan.
KNOWN_BULK_EXPORTS = frozenset(
    {
        "cards.py::export_json",
        "cards.py::export_csv",
        "workspace.py::export_workspace",
        "migration.py::export_workspace",
        "ops.py::ops_export",
        # Records ``access.audit_log.exported``: exporting the log is itself
        # on the log.
        "audit_log.py::export_audit_log",
    }
)

# ``<module>::<handler>`` → why it is a download but not a bulk export.
NOT_A_BULK_EXPORT = {
    "bpm.py::export_bpmn": (
        "one process diagram the caller is already viewing, gated per card like the viewer"
    ),
    "bpm.py::export_svg": (
        "a picture of one process diagram the caller is already viewing, gated per card"
    ),
    "file_attachments.py::download_file_attachment": (
        "one file someone attached to a card, gated per card like the Resources tab"
    ),
    "migration.py::download_error_report": (
        "the importer's own diagnostics for an upload the admin made, not landscape data"
    ),
    "risk_mitigation_tasks.py::export_mitigation_tasks": (
        "a JSON read of the tasks under the risks the Register page already lists; the "
        "workbook is built in the browser, like the Inventory's Excel export"
    ),
}


def _is_get_route(node: ast.AST) -> bool:
    """A handler served on GET by a router (``router`` or any ``*_router``)."""
    if not isinstance(node, ast.AsyncFunctionDef):
        return False
    return _get_route_path(node) is not None


def _is_router(value: ast.AST) -> bool:
    return isinstance(value, ast.Name) and (value.id == "router" or value.id.endswith("_router"))


def _get_route_path(node: ast.AsyncFunctionDef) -> str | None:
    """The path of the GET decorator on ``node`` (``""`` if not a literal), else ``None``."""
    for dec in node.decorator_list:
        call = dec if isinstance(dec, ast.Call) else None
        func = call.func if call else dec
        if not (isinstance(func, ast.Attribute) and _is_router(func.value)):
            continue
        if func.attr == "api_route":
            methods = next(
                (k.value for k in (call.keywords if call else []) if k.arg == "methods"), None
            )
            verbs = (
                {e.value.upper() for e in methods.elts if isinstance(e, ast.Constant)}
                if isinstance(methods, (ast.List, ast.Tuple, ast.Set))
                else set()
            )
            if "GET" not in verbs:
                continue
        elif func.attr != "get":
            continue
        first = call.args[0] if call and call.args else None
        return (
            first.value if isinstance(first, ast.Constant) and isinstance(first.value, str) else ""
        )
    return None


def _returns_bulk_media(node: ast.AST) -> bool:
    """A ``Response(`` / ``StreamingResponse(`` call with a bulk ``media_type`` literal."""
    for call in ast.walk(node):
        if not isinstance(call, ast.Call):
            continue
        name = call.func.id if isinstance(call.func, ast.Name) else None
        if name not in _RESPONSE_CALLS:
            continue
        for kw in call.keywords:
            if (
                kw.arg == "media_type"
                and isinstance(kw.value, ast.Constant)
                and kw.value.value in _BULK_MEDIA_TYPES
            ):
                return True
    return False


def _sets_content_disposition(node: ast.AST) -> bool:
    return any(
        isinstance(c, ast.Constant) and c.value == "Content-Disposition" for c in ast.walk(node)
    )


def is_bulk_export(node: ast.AsyncFunctionDef) -> bool:
    """True when a GET handler hands a file or a bulk payload out of the instance.

    Any one signal is enough: an ``export`` segment in the route path (the JSON
    card export returns a plain list and has no other tell), a
    ``Content-Disposition`` header, or a response built with a CSV / zip / JSON
    media type.
    """
    path = _get_route_path(node)
    if path is None:
        return False
    return (
        bool(_EXPORT_SEGMENT.search(path))
        or _sets_content_disposition(node)
        or _returns_bulk_media(node)
    )


def _bulk_exports() -> dict[str, bool]:
    """``{"<module>::<handler>": records?}`` for every bulk-export GET route."""
    found: dict[str, bool] = {}
    for path in sorted(_V1.glob("*.py")):
        source = path.read_text(encoding="utf-8")
        tree = ast.parse(source)
        gets = [n for n in tree.body if _is_get_route(n)]
        helpers = recording_helpers(tree, source) - {n.name for n in gets}
        for node in gets:
            if is_bulk_export(node):
                found[f"{path.name}::{node.name}"] = records(
                    ast.get_source_segment(source, node) or "", helpers
                )
    return found


def _read_routes(module: str) -> dict[str, bool]:
    """``{handler name: records?}`` for every GET route in ``module``."""
    source = (_V1 / module).read_text(encoding="utf-8")
    tree = ast.parse(source)
    helpers = recording_helpers(tree, source) - {
        node.name for node in tree.body if _is_get_route(node)
    }
    return {
        node.name: records(ast.get_source_segment(source, node) or "", helpers)
        for node in tree.body
        if _is_get_route(node)
    }


def test_every_bulk_export_records():
    unrecorded = [
        name
        for name, recorded in _bulk_exports().items()
        if not recorded and name not in NOT_A_BULK_EXPORT
    ]
    assert not unrecorded, (
        "These GET routes hand data out of the instance without an audit row — "
        "call app.services.audit_log.record (an access.export.* action, or a "
        "module helper that records one) and commit before building the response, "
        "or list the handler in NOT_A_BULK_EXPORT with the reason it is not a bulk "
        f"export: {unrecorded}"
    )


def test_the_detector_finds_the_known_bulk_exports():
    detected = set(_bulk_exports()) - set(NOT_A_BULK_EXPORT)
    assert detected == KNOWN_BULK_EXPORTS


def test_bulk_export_allowlist_is_not_stale():
    exports = _bulk_exports()
    for entry in NOT_A_BULK_EXPORT:
        assert entry in exports, f"{entry} is no longer detected; drop it from the allowlist"
        assert not exports[entry], f"{entry} now records an audit row; drop it from the allowlist"
    assert not set(NOT_A_BULK_EXPORT) & KNOWN_BULK_EXPORTS


def test_export_records_name_the_access_category():
    for entry in KNOWN_BULK_EXPORTS:
        module = entry.split("::")[0]
        source = (_V1 / module).read_text(encoding="utf-8")
        assert re.search(
            r'action="access\.(export\.(cards|workspace|migration)|audit_log\.exported)"',
            source,
        ), module


def test_odata_feed_is_deliberately_not_recorded():
    routes = _read_routes("bookmarks.py")
    assert routes["bookmark_odata_feed"] is False
    assert "bookmarks.py::bookmark_odata_feed" not in _bulk_exports()
    source = (_V1 / "bookmarks.py").read_text(encoding="utf-8")
    assert "Deliberately not recorded in the audit log" in source


def test_scan_sees_only_router_get_verb():
    source = (
        "@router.get('/x')\nasync def read(): ...\n"
        "@router.post('/x')\nasync def write(): ...\n"
        "@other.get('/x')\nasync def elsewhere(): ...\n"
        "@status_router.get('/y')\nasync def sub_read(): ...\n"
        "@router.api_route('/z', methods=['GET', 'HEAD'])\nasync def any_read(): ...\n"
        "@router.api_route('/z', methods=['POST'])\nasync def any_write(): ...\n"
    )
    tree = ast.parse(source)
    assert [n.name for n in tree.body if _is_get_route(n)] == ["read", "sub_read", "any_read"]


def _handler(source: str) -> ast.AsyncFunctionDef:
    node = ast.parse(source).body[0]
    assert isinstance(node, ast.AsyncFunctionDef)
    return node


@pytest.mark.parametrize(
    "source",
    [
        "@router.get('/export/json')\nasync def h():\n    return []\n",
        "@router.get('/export')\nasync def h():\n    return []\n",
        "@router.get('/x')\nasync def h():\n"
        "    return Response(b'', headers={'Content-Disposition': 'attachment'})\n",
        "@router.get('/x')\nasync def h():\n"
        "    return StreamingResponse(iter([]), media_type='text/csv')\n",
        "@router.get('/x')\nasync def h():\n"
        "    return Response(b'', media_type='application/zip')\n",
        "@router.get('/x')\nasync def h():\n"
        "    return Response(b'', media_type='application/json')\n",
    ],
)
def test_detector_signals(source):
    assert is_bulk_export(_handler(source))


@pytest.mark.parametrize(
    "source",
    [
        "@router.get('/cards')\nasync def h():\n    return []\n",
        "@router.get('/exporters')\nasync def h():\n    return []\n",
        "@router.get('/x')\nasync def h():\n    return Response(b'', media_type='image/png')\n",
        "@router.get('/x')\nasync def h():\n    return other(media_type='text/csv')\n",
        "@router.post('/export')\nasync def h():\n    return []\n",
    ],
)
def test_detector_ignores(source):
    assert not is_bulk_export(_handler(source))
