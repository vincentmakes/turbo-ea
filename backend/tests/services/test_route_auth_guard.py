"""Guard: every route handler authenticates its caller, or is public on purpose.

CLAUDE.md, *Security Requirements*: "New endpoints must use
``Depends(get_current_user)`` or ``Depends(require_permission(...))``". A
handler that takes only ``Depends(get_db)`` is reachable by anyone who can
reach the server — ``GET /stakeholder-roles`` was, until this guard found it.

A handler passes when one of its dependencies (in the decorator's
``dependencies=[...]``, a parameter default, or an ``Annotated[...]``
parameter) names an authenticating dependency, when its router carries one
router-wide, or when it sits behind its module's own public-access gate (a
published diagram's or portal's account-less session). Everything else is in
``PUBLIC`` with the reason anonymous access is intended — a new public route is
a decision someone writes down here, never an omission.

Reads ``app/`` as source, so it is a ``source_scan`` and is deselected under
mutmut (``tests/mutation_plugin.py``).
"""

from __future__ import annotations

import pytest

from tests.app_source import (
    api_modules,
    handlers_in,
    route_handlers,
    router_level_dependencies,
)

pytestmark = pytest.mark.source_scan

# Dependencies that resolve the caller (``app/api/deps.py``); ``get_optional_user``
# is the shape of an endpoint that serves both, and shapes its answer on it. It
# counts here, so this guard proves a handler *considered* the caller, not that
# it shaped its answer: a handler that takes the optional user and ignores it
# passes, and only a behavioural test catches that.
AUTH = frozenset(
    {"get_current_user", "require_permission", "get_optional_user", "get_card_read_scope"}
)

# Router-wide authentication: ``ops.py`` verifies every request's Ed25519
# signature (``app/core/ops_auth.py``) through ``APIRouter(dependencies=...)``.
ROUTER_AUTH = frozenset({"verify_ops_request"})

# A module's own gate for account-less access to a published artefact
# (``app/services/public_access.py``). Only honoured in the module that owns it.
PUBLIC_GATES: dict[str, frozenset[str]] = {
    "diagrams.py": frozenset({"require_public_diagram"}),
    "web_portals.py": frozenset({"require_portal_access"}),
}

PUBLIC: dict[str, str] = {
    # -- Sign-in itself: the caller has no session yet.
    "auth.py:register": "creates the account; nobody is signed in yet",
    "auth.py:login": "exchanges credentials for the session cookie",
    "auth.py:sso_config_endpoint": "the login page needs the IdP config to start SSO",
    "auth.py:sso_callback": "exchanges the IdP's code for a session",
    "auth.py:proxy_session": "trusts the reverse proxy's identity header; 404s when off",
    "auth.py:validate_setup_token": "an invited user checks their link before having a password",
    "auth.py:set_password": "an invited user sets a first password with the emailed token",
    "auth.py:forgot_password": "a locked-out user asks for a reset mail",
    "auth.py:validate_reset_token": "the reset page checks its token before showing the form",
    "auth.py:reset_password": "the emailed token is the credential",
    # -- Boot-time display settings the login page and shell read before sign-in.
    "settings.py:get_bootstrap": "every boot-time setting the shell needs before sign-in",
    "settings.py:get_currency": "display currency, read at boot",
    "settings.py:get_date_format": "display date format, read at boot",
    "settings.py:get_app_title": "the title the login page shows",
    "settings.py:get_navbar_style": "navbar colours, painted before sign-in",
    "settings.py:get_bpm_enabled": "module toggle the shell reads at boot",
    "settings.py:get_ppm_enabled": "module toggle the shell reads at boot",
    "settings.py:get_file_uploads_enabled": "feature toggle the shell reads at boot",
    "settings.py:get_grc_enabled": "module toggle the shell reads at boot",
    "settings.py:get_sponsor_button_enabled": "user-menu toggle read at boot",
    "settings.py:get_bpm_separate_approver": "a workflow toggle; a boolean with nothing behind it",
    "settings.py:get_turbolens_enabled": "module toggle the shell reads at boot",
    "settings.py:get_bpm_row_order": "display order of BPM process types; no instance data",
    "settings.py:get_fiscal_year_start": "fiscal-year month for date display; one integer",
    "settings.py:get_archive_retention_days": "purge horizon shown on archived cards; one int",
    "settings.py:get_logo": "an <img> on the login page loads it",
    "settings.py:get_favicon": "the browser loads it before any sign-in",
    "settings.py:get_sso_status": "the login page decides whether to offer SSO; no secrets",
    "settings.py:get_registration_settings": "the login page decides whether to offer sign-up",
    "settings.py:get_enabled_locales": "the login page's language picker",
    "settings.py:get_principles_display": "a display toggle; a boolean with nothing behind it",
    "settings.py:get_mcp_status": "MCP clients probe availability before OAuth; no secrets",
    # -- Published artefacts: the entry points in front of their access gates.
    "diagrams.py:get_diagram_gate": "names the access mode an embed page must satisfy; no XML",
    "diagrams.py:diagram_sso_callback": "exchanges the IdP's code for a diagram-scoped cookie",
    "web_portals.py:get_portal_gate": "names the access mode a portal viewer must satisfy",
    "web_portals.py:portal_sso_callback": "exchanges the IdP's code for a portal-scoped cookie",
    # -- Bytes an <img> or import() loads, which cannot carry a credential.
    "card_logos.py:get_card_logo": "an <img> in app and portals; the bytes only, by unguessable id",
    "card_logos.py:get_brand_icon": "CC0 artwork shipped in the image; no instance data",
    "extensions.py:get_extension_asset": "dynamic import() carries no header; code is not secret",
    # -- Authenticates by hand.
    "events.py:event_stream": "checks the token itself so no pooled session spans the stream",
}


def _ungated(handlers, modules) -> list[str]:
    router_deps = {name: router_level_dependencies(text) for name, text in modules.items()}
    out = []
    for handler in handlers:
        names = handler.dependency_names | router_deps.get(handler.module, set())
        if names & (AUTH | ROUTER_AUTH | PUBLIC_GATES.get(handler.module, frozenset())):
            continue
        out.append(handler.key)
    return out


def test_the_scan_finds_the_routes():
    # A broken matcher would find nothing and pass everything.
    assert len(route_handlers()) >= 500


def test_every_route_authenticates_or_is_public_on_purpose():
    ungated = [key for key in _ungated(route_handlers(), api_modules()) if key not in PUBLIC]
    assert not ungated, (
        "These route handlers authenticate nobody — add Depends(get_current_user) or "
        "Depends(require_permission(...)), or, if anonymous access is the point, list "
        f"them in PUBLIC with the reason: {ungated}"
    )


def test_allowlist_is_not_stale():
    ungated = set(_ungated(route_handlers(), api_modules()))
    known = {handler.key for handler in route_handlers()}
    for key in PUBLIC:
        assert key in known, f"{key} is no longer a route handler; drop it from PUBLIC"
        assert key in ungated, f"{key} now authenticates its caller; drop it from PUBLIC"


# ---------------------------------------------------------------------------
# Scanner self-tests
# ---------------------------------------------------------------------------

_SNIPPET = """
from typing import Annotated
router = APIRouter()
other_router = APIRouter(dependencies=[Depends(verify_ops_request)])

@router.get("/annotated")
async def annotated(user: Annotated[User, Depends(get_current_user)]):
    ...

@router.post("/factory", dependencies=[Depends(require_permission("x.y"))])
async def factory(db: AsyncSession = Depends(get_db)):
    ...

@router.get("/db-only")
async def db_only(db: AsyncSession = Depends(get_db)):
    ...

@other_router.delete("/router-wide")
def router_wide(db=Depends(deps.get_db)):
    ...

def helper(user=Depends(get_current_user)):
    ...
"""


def test_scanner_reads_every_way_a_dependency_is_declared():
    handlers = {h.func_name: h for h in handlers_in("snippet.py", _SNIPPET)}
    assert set(handlers) == {"annotated", "factory", "db_only", "router_wide"}
    assert handlers["annotated"].dependency_names == {"get_current_user"}
    assert handlers["factory"].dependency_names == {"require_permission", "get_db"}
    assert handlers["db_only"].dependency_names == {"get_db"}
    assert handlers["router_wide"].dependency_names == {"get_db"}
    assert handlers["router_wide"].is_async is False
    assert handlers["router_wide"].methods == ["DELETE"]
    assert router_level_dependencies(_SNIPPET) == {"verify_ops_request"}


def test_scanner_flags_a_db_only_route_and_nothing_else():
    handlers = handlers_in("snippet.py", _SNIPPET)
    # The router-wide dependency counts for every route in its module.
    assert _ungated(handlers, {"snippet.py": _SNIPPET}) == []
    no_router_auth = _SNIPPET.replace("Depends(verify_ops_request)", "Depends(get_db)")
    assert _ungated(handlers_in("snippet.py", no_router_auth), {"snippet.py": no_router_auth}) == [
        "snippet.py:db_only",
        "snippet.py:router_wide",
    ]


def test_a_public_gate_only_counts_in_its_own_module():
    text = """
@router.get("/x")
async def x(d=Depends(require_public_diagram)):
    ...
"""
    assert _ungated(handlers_in("diagrams.py", text), {"diagrams.py": text}) == []
    assert _ungated(handlers_in("cards.py", text), {"cards.py": text}) == ["cards.py:x"]
