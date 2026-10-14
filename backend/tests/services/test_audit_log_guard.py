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
