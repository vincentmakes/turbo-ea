"""Turbo EA MCP Server — provides read-only AI tool access to EA data.

Run: python -m turbo_ea_mcp.server --host 0.0.0.0 --port 8001
"""

from __future__ import annotations

import argparse
import json
import logging
import textwrap
from urllib.parse import urlparse

from mcp.server.fastmcp import FastMCP
from mcp.server.transport_security import TransportSecuritySettings
from starlette.applications import Starlette
from starlette.routing import Route

from turbo_ea_mcp import oauth
from turbo_ea_mcp.api_client import TurboEAClient
from turbo_ea_mcp.config import (
    APP_VERSION,
    MCP_PORT,
    MCP_PUBLIC_URL,
    TURBO_EA_PUBLIC_URL,
)

logging.basicConfig(
    level=logging.INFO, format="%(asctime)s %(name)s %(levelname)s %(message)s"
)
logger = logging.getLogger("turbo_ea_mcp")

# ── MCP Server ──────────────────────────────────────────────────────────────


def _build_transport_security() -> TransportSecuritySettings:
    """Allow the configured public hostnames through DNS-rebinding protection.

    FastMCP defaults block any Host header it didn't expect, which makes the
    server return 421 when fronted by a reverse proxy on a real domain. Add
    the hostnames derived from MCP_PUBLIC_URL and TURBO_EA_PUBLIC_URL so the
    public deployment passes the check; localhost stays allowed for stdio
    tests and local development.
    """
    hosts: set[str] = {"localhost", "127.0.0.1"}
    origins: set[str] = set()
    for url in (MCP_PUBLIC_URL, TURBO_EA_PUBLIC_URL):
        parsed = urlparse(url)
        if parsed.hostname:
            hosts.add(parsed.hostname)
        if parsed.netloc:
            hosts.add(parsed.netloc)
        if parsed.scheme and parsed.netloc:
            origins.add(f"{parsed.scheme}://{parsed.netloc}")
    return TransportSecuritySettings(
        allowed_hosts=sorted(hosts),
        allowed_origins=sorted(origins),
    )


mcp = FastMCP(
    "Turbo EA",
    instructions=textwrap.dedent("""\
        Turbo EA is an Enterprise Architecture management platform.
        Use the available tools to query the IT landscape data.
        All data access respects the authenticated user's permissions.
        Data is read-only — you cannot create or modify cards.
    """),
    transport_security=_build_transport_security(),
)


# ── Helpers ─────────────────────────────────────────────────────────────────


def _fmt(data: dict | list) -> str:
    """Format API response as readable JSON."""
    return json.dumps(data, indent=2, default=str)


def _compact(params: dict) -> dict:
    """Drop ``None`` and empty-string values so they don't clutter the URL."""
    return {k: v for k, v in params.items() if v not in (None, "")}


# ── Tools ───────────────────────────────────────────────────────────────────


@mcp.tool()
async def search_cards(
    query: str = "",
    type: str = "",
    status: str = "",
    page: int = 1,
    page_size: int = 20,
) -> str:
    """Search and list cards (EA items) with optional filtering.

    Args:
        query: Free-text search across card name and description.
        type: Filter by card type key (e.g. 'Application', 'ITComponent').
        status: Filter by status ('ACTIVE', 'PHASING_IN', 'PHASING_OUT', 'END_OF_LIFE', 'ARCHIVED').
        page: Page number (default 1).
        page_size: Results per page (default 20, max 100).
    """
    token = await _get_current_token()
    if not token:
        return "Error: Not authenticated. Please reconnect."
    client = TurboEAClient(token)
    params: dict = {"page": page, "page_size": min(page_size, 100)}
    if query:
        params["search"] = query
    if type:
        params["type"] = type
    if status:
        params["status"] = status
    data = await client.get("/cards", params=params)
    return _fmt(data)


@mcp.tool()
async def get_card(card_id: str) -> str:
    """Get detailed information about a specific card by its UUID.

    Args:
        card_id: The UUID of the card.
    """
    token = await _get_current_token()
    if not token:
        return "Error: Not authenticated. Please reconnect."
    client = TurboEAClient(token)
    data = await client.get(f"/cards/{card_id}")
    return _fmt(data)


@mcp.tool()
async def get_card_relations(card_id: str) -> str:
    """Get all relations connected to a specific card.

    Args:
        card_id: The UUID of the card.
    """
    token = await _get_current_token()
    if not token:
        return "Error: Not authenticated. Please reconnect."
    client = TurboEAClient(token)
    data = await client.get("/relations", params={"card_id": card_id})
    return _fmt(data)


@mcp.tool()
async def get_card_hierarchy(card_id: str) -> str:
    """Get the hierarchy (ancestors + children) of a card.

    Args:
        card_id: The UUID of the card.
    """
    token = await _get_current_token()
    if not token:
        return "Error: Not authenticated. Please reconnect."
    client = TurboEAClient(token)
    data = await client.get(f"/cards/{card_id}/hierarchy")
    return _fmt(data)


@mcp.tool()
async def list_card_types() -> str:
    """List all card types in the metamodel with their fields and configuration."""
    token = await _get_current_token()
    if not token:
        return "Error: Not authenticated. Please reconnect."
    client = TurboEAClient(token)
    data = await client.get("/metamodel/types")
    return _fmt(data)


@mcp.tool()
async def get_relation_types(type_key: str = "") -> str:
    """List relation types. Optionally filter by card type key.

    Args:
        type_key: Filter to relations involving this card type (optional).
    """
    token = await _get_current_token()
    if not token:
        return "Error: Not authenticated. Please reconnect."
    client = TurboEAClient(token)
    params = {}
    if type_key:
        params["type_key"] = type_key
    data = await client.get("/metamodel/relation-types", params=params)
    return _fmt(data)


@mcp.tool()
async def get_dashboard() -> str:
    """Get the EA dashboard with KPIs: card counts by type, average data quality,
    approval status distribution, and recent activity."""
    token = await _get_current_token()
    if not token:
        return "Error: Not authenticated. Please reconnect."
    client = TurboEAClient(token)
    data = await client.get("/reports/dashboard")
    return _fmt(data)


@mcp.tool()
async def get_landscape(type_key: str, group_by: str) -> str:
    """Get cards of a type grouped by a related type (landscape view).

    Args:
        type_key: The card type to list (e.g. 'Application').
        group_by: The related type to group by (e.g. 'BusinessCapability').
    """
    token = await _get_current_token()
    if not token:
        return "Error: Not authenticated. Please reconnect."
    client = TurboEAClient(token)
    data = await client.get(
        "/reports/landscape",
        params={"type_key": type_key, "group_by": group_by},
    )
    return _fmt(data)


# ── GRC — Risks ─────────────────────────────────────────────────────────────


@mcp.tool()
async def list_risks(
    status: str = "",
    category: str = "",
    level: str = "",
    owner_id: str = "",
    card_id: str = "",
    source_type: str = "",
    search: str = "",
    overdue: bool = False,
    page: int = 1,
    page_size: int = 50,
) -> str:
    """Paginated, filterable EA Risk Register listing (TOGAF Phase G).

    Args:
        status: Lifecycle state — 'identified', 'analysed', 'mitigation_planned',
            'in_progress', 'mitigated', 'monitoring', 'accepted', 'closed'.
        category: 'security', 'compliance', 'operational', 'technology',
            'financial', 'reputational', 'strategic'.
        level: Residual (or initial when residual is empty) risk level —
            'low', 'medium', 'high', 'critical'.
        owner_id: Filter to risks owned by a specific user UUID.
        card_id: Filter to risks linked to a specific card UUID.
        source_type: How the risk was raised — 'manual',
            'compliance'.
        search: Free-text search across title, description and reference.
        overdue: When true, only return risks past their target resolution
            date that aren't already closed/accepted.
        page: Page number (default 1).
        page_size: Results per page (default 50, max 1000).
    """
    token = await _get_current_token()
    if not token:
        return "Error: Not authenticated. Please reconnect."
    client = TurboEAClient(token)
    data = await client.get(
        "/risks",
        params=_compact(
            {
                "status": status,
                "category": category,
                "level": level,
                "owner_id": owner_id,
                "card_id": card_id,
                "source_type": source_type,
                "search": search,
                "overdue": "true" if overdue else None,
                "page": page,
                "page_size": min(page_size, 1000),
            }
        ),
    )
    return _fmt(data)


@mcp.tool()
async def get_risk(risk_id: str) -> str:
    """Get full detail of a single risk including linked cards and audit data.

    Args:
        risk_id: The risk's UUID (or its reference number like 'R-000123' —
            the backend resolves both).
    """
    token = await _get_current_token()
    if not token:
        return "Error: Not authenticated. Please reconnect."
    client = TurboEAClient(token)
    data = await client.get(f"/risks/{risk_id}")
    return _fmt(data)


@mcp.tool()
async def get_risk_metrics() -> str:
    """KPIs for the Risk Register: counts by status / category / level plus
    the 4×4 initial and residual probability × impact matrices."""
    token = await _get_current_token()
    if not token:
        return "Error: Not authenticated. Please reconnect."
    client = TurboEAClient(token)
    data = await client.get("/risks/metrics")
    return _fmt(data)


@mcp.tool()
async def get_card_risks(card_id: str) -> str:
    """List every risk currently linked to a specific card (M:N).

    Args:
        card_id: The UUID of the card.
    """
    token = await _get_current_token()
    if not token:
        return "Error: Not authenticated. Please reconnect."
    client = TurboEAClient(token)
    data = await client.get(f"/cards/{card_id}/risks")
    return _fmt(data)


# ── GRC — Compliance findings ──────────────────────────────────────────────


@mcp.tool()
async def list_compliance_findings(
    regulation: str = "",
    status: str = "",
    include_auto_resolved: bool = False,
) -> str:
    """Compliance findings bundled by regulation (EU AI Act, GDPR, NIS2,
    DORA, SOC 2, ISO 27001, …).

    Args:
        regulation: Filter to a single regulation key (e.g. 'gdpr', 'eu_ai_act').
        status: AI verdict — 'compliant', 'partial', 'non_compliant',
            'not_applicable', 'review_needed'.
        include_auto_resolved: Include findings a later re-scan no longer
            reports (hidden by default for noise reduction).
    """
    token = await _get_current_token()
    if not token:
        return "Error: Not authenticated. Please reconnect."
    client = TurboEAClient(token)
    data = await client.get(
        "/compliance/compliance",
        params=_compact(
            {
                "regulation": regulation,
                "status": status,
                "include_auto_resolved": "true" if include_auto_resolved else None,
            }
        ),
    )
    return _fmt(data)


@mcp.tool()
async def get_compliance_overview() -> str:
    """Compliance scores + per-regulation status matrix for the Compliance
    dashboard, plus metadata about the last completed scan."""
    token = await _get_current_token()
    if not token:
        return "Error: Not authenticated. Please reconnect."
    client = TurboEAClient(token)
    data = await client.get("/compliance/overview")
    return _fmt(data)


# ── Governance & Delivery ───────────────────────────────────────────────────


@mcp.tool()
async def list_principles() -> str:
    """List the EA principles published in the metamodel (statement,
    rationale, implications), ordered by sort order."""
    token = await _get_current_token()
    if not token:
        return "Error: Not authenticated. Please reconnect."
    client = TurboEAClient(token)
    data = await client.get("/metamodel/principles")
    return _fmt(data)


@mcp.tool()
async def list_adrs(
    initiative_id: str = "",
    card_id: str = "",
    status: str = "",
    search: str = "",
) -> str:
    """List Architecture Decision Records (ADRs).

    Args:
        initiative_id: Filter to ADRs linked to a specific Initiative UUID.
        card_id: Filter to ADRs linked to a specific card UUID.
        status: 'draft', 'in_review', or 'signed'.
        search: Free-text search across title, reference and section content.
    """
    token = await _get_current_token()
    if not token:
        return "Error: Not authenticated. Please reconnect."
    client = TurboEAClient(token)
    data = await client.get(
        "/adr",
        params=_compact(
            {
                "initiative_id": initiative_id,
                "card_id": card_id,
                "status": status,
                "search": search,
            }
        ),
    )
    return _fmt(data)


@mcp.tool()
async def get_adr(adr_id: str) -> str:
    """Get full detail of a single ADR including all section content,
    linked cards, related decisions, and signature trail.

    Args:
        adr_id: The ADR's UUID.
    """
    token = await _get_current_token()
    if not token:
        return "Error: Not authenticated. Please reconnect."
    client = TurboEAClient(token)
    data = await client.get(f"/adr/{adr_id}")
    return _fmt(data)


@mcp.tool()
async def list_soaws(initiative_id: str = "") -> str:
    """List Statements of Architecture Work (SoAW).

    Args:
        initiative_id: Filter to SoAWs linked to a specific Initiative UUID.
    """
    token = await _get_current_token()
    if not token:
        return "Error: Not authenticated. Please reconnect."
    client = TurboEAClient(token)
    data = await client.get(
        "/soaw",
        params=_compact({"initiative_id": initiative_id}),
    )
    return _fmt(data)


# ── Reports ────────────────────────────────────────────────────────────────


@mcp.tool()
async def get_portfolio_report(
    type: str = "Application",
    x_axis: str = "functionalFit",
    y_axis: str = "technicalFit",
    size_field: str = "costTotalAnnual",
    color_field: str = "businessCriticality",
) -> str:
    """Portfolio bubble-chart data for a card type. Defaults plot the
    Application portfolio with functional fit × technical fit, sized by
    annual cost, coloured by business criticality.

    Args:
        type: Card type to report on (default 'Application').
        x_axis: Field key for the x-axis.
        y_axis: Field key for the y-axis.
        size_field: Field key driving bubble size.
        color_field: Field key driving bubble colour.
    """
    token = await _get_current_token()
    if not token:
        return "Error: Not authenticated. Please reconnect."
    client = TurboEAClient(token)
    data = await client.get(
        "/reports/portfolio",
        params={
            "type": type,
            "x_axis": x_axis,
            "y_axis": y_axis,
            "size_field": size_field,
            "color_field": color_field,
        },
    )
    return _fmt(data)


@mcp.tool()
async def get_cost_treemap(
    type: str = "Application",
    cost_field: str = "costTotalAnnual",
    group_by: str = "",
) -> str:
    """Treemap of card cost grouped optionally by a related card type.

    Args:
        type: Card type to aggregate (default 'Application').
        cost_field: Cost field key on that type (default 'costTotalAnnual').
        group_by: Optional related card type key to group spend by
            (e.g. 'BusinessCapability', 'Organization').
    """
    token = await _get_current_token()
    if not token:
        return "Error: Not authenticated. Please reconnect."
    client = TurboEAClient(token)
    data = await client.get(
        "/reports/cost-treemap",
        params=_compact(
            {
                "type": type,
                "cost_field": cost_field,
                "group_by": group_by,
            }
        ),
    )
    return _fmt(data)


@mcp.tool()
async def get_capability_heatmap(metric: str = "app_count") -> str:
    """Hierarchical business-capability heatmap.

    Args:
        metric: What to colour by — 'app_count', 'cost', 'data_quality'.
    """
    token = await _get_current_token()
    if not token:
        return "Error: Not authenticated. Please reconnect."
    client = TurboEAClient(token)
    data = await client.get(
        "/reports/capability-heatmap",
        params=_compact({"metric": metric}),
    )
    return _fmt(data)


@mcp.tool()
async def get_data_quality_report() -> str:
    """Per-card-type data quality / completeness breakdown — surfaces
    which inventory rows have missing required fields."""
    token = await _get_current_token()
    if not token:
        return "Error: Not authenticated. Please reconnect."
    client = TurboEAClient(token)
    data = await client.get("/reports/data-quality")
    return _fmt(data)


# ── Card context ───────────────────────────────────────────────────────────


@mcp.tool()
async def get_card_stakeholders(card_id: str) -> str:
    """List the stakeholders (users + roles) assigned to a card.

    Args:
        card_id: The UUID of the card.
    """
    token = await _get_current_token()
    if not token:
        return "Error: Not authenticated. Please reconnect."
    client = TurboEAClient(token)
    data = await client.get(f"/cards/{card_id}/stakeholders")
    return _fmt(data)


@mcp.tool()
async def get_card_comments(card_id: str) -> str:
    """List the threaded comments on a card, newest first.

    Args:
        card_id: The UUID of the card.
    """
    token = await _get_current_token()
    if not token:
        return "Error: Not authenticated. Please reconnect."
    client = TurboEAClient(token)
    data = await client.get(f"/cards/{card_id}/comments")
    return _fmt(data)


@mcp.tool()
async def get_card_documents(card_id: str) -> str:
    """List the document links attached to a card (URLs with categorisation,
    not file uploads).

    Args:
        card_id: The UUID of the card.
    """
    token = await _get_current_token()
    if not token:
        return "Error: Not authenticated. Please reconnect."
    client = TurboEAClient(token)
    data = await client.get(f"/cards/{card_id}/documents")
    return _fmt(data)


# ── Resources ───────────────────────────────────────────────────────────────


@mcp.resource("turbo-ea://types")
async def resource_types() -> str:
    """All card types in the metamodel."""
    token = await _get_current_token()
    if not token:
        return "Error: Not authenticated."
    client = TurboEAClient(token)
    data = await client.get("/metamodel/types")
    return _fmt(data)


@mcp.resource("turbo-ea://relation-types")
async def resource_relation_types() -> str:
    """All relation types in the metamodel."""
    token = await _get_current_token()
    if not token:
        return "Error: Not authenticated."
    client = TurboEAClient(token)
    data = await client.get("/metamodel/relation-types")
    return _fmt(data)


@mcp.resource("turbo-ea://dashboard")
async def resource_dashboard() -> str:
    """Dashboard KPIs and summary statistics."""
    token = await _get_current_token()
    if not token:
        return "Error: Not authenticated."
    client = TurboEAClient(token)
    data = await client.get("/reports/dashboard")
    return _fmt(data)


# ── Prompts ─────────────────────────────────────────────────────────────────


@mcp.prompt()
def analyze_landscape() -> str:
    """Analyze the IT landscape starting from the dashboard, then exploring
    types and their relationships."""
    return textwrap.dedent("""\
        Analyze the Turbo EA IT landscape. Follow these steps:
        1. Call get_dashboard() to get an overview of the landscape (card counts,
           data quality, approval status).
        2. Call list_card_types() to understand what types of items exist in the
           metamodel (Applications, IT Components, Business Capabilities, etc.).
        3. Call get_relation_types() to understand how these types connect.
        4. Summarize the key findings: how many items of each type, overall data
           quality, and the most important relationships.
    """)


@mcp.prompt()
def find_card(name: str) -> str:
    """Find information about a specific card by name."""
    return textwrap.dedent(f"""\
        Find the card named "{name}" in Turbo EA:
        1. Call search_cards(query="{name}") to find matching cards.
        2. For the best match, call get_card(card_id=...) to get full details.
        3. Call get_card_relations(card_id=...) to see how it connects to other items.
        4. Summarize the card's type, status, key attributes, and relationships.
    """)


@mcp.prompt()
def explore_dependencies(card_name: str) -> str:
    """Explore how a card connects to other items through relations."""
    return textwrap.dedent(f"""\
        Explore the dependencies of "{card_name}":
        1. Call search_cards(query="{card_name}") to find the card.
        2. Call get_card_relations(card_id=...) to get all connections.
        3. For the most important related cards, call get_card(card_id=...)
           to get their details.
        4. Build a dependency map showing what this card depends on and
           what depends on it.
    """)


# ── Token context ──────────────────────────────────────────────────────────

import asyncio
import os

from mcp.server.lowlevel.server import request_ctx as _mcp_request_ctx

# In stdio mode a single user is logged in — store their token here.
_stdio_token: str | None = None


async def _get_current_token() -> str | None:
    """Resolve the authenticated Turbo EA JWT for the current call.

    In stdio mode, returns the long-lived JWT obtained at login.

    In HTTP mode, reads the Bearer header from the MCP request_ctx — which
    the low-level MCP server sets on the session task right before invoking
    a tool handler, with the HTTP Starlette ``Request`` attached. We can't
    rely on a contextvar set in an ASGI middleware because tool handlers
    run in a long-lived session task that doesn't inherit the request
    task's context updates.
    """
    if _stdio_token is not None:
        return _stdio_token
    try:
        ctx = _mcp_request_ctx.get()
    except LookupError:
        return None
    request = getattr(ctx, "request", None)
    if request is None:
        return None
    auth = request.headers.get("authorization", "")
    if not auth.lower().startswith("bearer "):
        return None
    return await oauth.resolve_token(auth[7:])


# ── ASGI application ───────────────────────────────────────────────────────


class RequireBearerForMcp:
    """Return 401 + WWW-Authenticate for unauthenticated /mcp requests.

    Without this, anonymous POSTs are silently accepted, the streamable
    session manager hands out a session id, and the MCP client (Claude
    Desktop's custom connector, the MCP Inspector) never realises it is
    expected to do OAuth — it just keeps making unauthenticated calls.
    Per the MCP spec we respond to unauth'd protocol requests with 401 +
    ``WWW-Authenticate: Bearer resource_metadata="…"`` so the client knows
    where to discover the OAuth metadata and initiate the flow.

    The OAuth and well-known routes themselves remain public — the gate
    only fires for the protocol endpoint at ``/mcp``.
    """

    def __init__(self, app, resource_metadata_url: str):
        self.app = app
        self.resource_metadata_url = resource_metadata_url

    async def __call__(self, scope, receive, send):
        if scope["type"] == "http":
            path = scope.get("path", "")
            if path == "/mcp" or path.startswith("/mcp/"):
                headers = dict(scope.get("headers", []))
                auth = headers.get(b"authorization", b"").decode()
                if not auth.lower().startswith("bearer "):
                    from starlette.responses import JSONResponse

                    response = JSONResponse(
                        {
                            "error": "unauthorized",
                            "error_description": "Bearer token required",
                        },
                        status_code=401,
                        headers={
                            "WWW-Authenticate": (
                                f'Bearer resource_metadata="{self.resource_metadata_url}"'
                            ),
                        },
                    )
                    await response(scope, receive, send)
                    return
        await self.app(scope, receive, send)


def create_app() -> Starlette:
    """Create the full ASGI application with OAuth + MCP routes."""
    # OAuth routes (handled by Starlette, not MCP)
    oauth_routes = [
        Route(
            "/.well-known/oauth-protected-resource",
            oauth.protected_resource_metadata,
            methods=["GET"],
        ),
        Route(
            "/.well-known/oauth-authorization-server",
            oauth.authorization_server_metadata,
            methods=["GET"],
        ),
        # OIDC-style discovery alias — some MCP connectors probe this path
        # instead of (or before) the OAuth 2.1 / RFC 8414 well-known.
        Route(
            "/.well-known/openid-configuration",
            oauth.authorization_server_metadata,
            methods=["GET"],
        ),
        Route("/oauth/authorize", oauth.authorize, methods=["GET"]),
        Route("/oauth/callback", oauth.sso_callback, methods=["GET"]),
        Route("/oauth/token", oauth.token_endpoint, methods=["POST"]),
        Route("/oauth/register", oauth.register_client, methods=["POST"]),
    ]

    async def health(request):
        from starlette.responses import JSONResponse

        return JSONResponse({"status": "ok", "version": APP_VERSION})

    oauth_routes.append(Route("/health", health, methods=["GET"]))

    # streamable_http_app() returns a Starlette app with the MCP protocol route
    # at /mcp by default. Attach OAuth + well-known routes to that same app so
    # the upstream serves both at the right paths without an extra Starlette
    # mount (a mount would push the protocol to /mcp/mcp and trigger a 307
    # redirect for clients hitting /mcp without a trailing slash).
    app = mcp.streamable_http_app()
    app.router.routes.extend(oauth_routes)
    resource_metadata_url = (
        f"{MCP_PUBLIC_URL.rstrip('/')}/.well-known/oauth-protected-resource"
    )
    app.add_middleware(RequireBearerForMcp, resource_metadata_url=resource_metadata_url)

    return app


# ── Stdio mode (for Claude Desktop / local testing) ───────────────────────


async def _refresh_loop(interval: int = 600) -> None:
    """Periodically refresh the JWT so long-running stdio sessions stay alive."""
    global _stdio_token
    while True:
        await asyncio.sleep(interval)
        if _stdio_token is None:
            continue
        try:
            client = TurboEAClient(_stdio_token)
            new_token = await client.refresh_token()
            if new_token:
                _stdio_token = new_token
                logger.info("JWT refreshed successfully")
            else:
                logger.warning("JWT refresh returned no token")
        except Exception:
            logger.exception("JWT refresh failed")


def run_stdio() -> None:
    """Log in with env credentials and run MCP over stdin/stdout."""
    global _stdio_token

    from turbo_ea_mcp.config import TURBO_EA_URL

    email = os.environ.get("TURBO_EA_EMAIL") or os.environ.get("TURBO_EA_USERNAME", "")
    password = os.environ.get("TURBO_EA_PASSWORD", "")
    if not email or not password:
        logger.error("TURBO_EA_EMAIL and TURBO_EA_PASSWORD must be set for stdio mode")
        raise SystemExit(1)

    from turbo_ea_mcp.api_client import login

    logger.info("Logging in to %s as %s …", TURBO_EA_URL, email)
    try:
        _stdio_token = asyncio.run(login(email, password))
    except Exception as exc:
        logger.error("Login failed: %s", exc)
        raise SystemExit(1) from exc

    logger.info("Logged in — starting MCP stdio transport")

    # Patch the MCP server to kick off the refresh loop once the event loop runs
    _original_run = mcp.run

    def _patched_run(**kwargs):
        import threading

        def _start_refresh():
            loop = asyncio.new_event_loop()
            loop.run_until_complete(_refresh_loop())

        t = threading.Thread(target=_start_refresh, daemon=True)
        t.start()
        _original_run(**kwargs)

    _patched_run(transport="stdio")


# ── CLI entry point ─────────────────────────────────────────────────────────


def main():
    parser = argparse.ArgumentParser(description="Turbo EA MCP Server")
    parser.add_argument("--host", default="0.0.0.0", help="Bind host")
    parser.add_argument("--port", type=int, default=MCP_PORT, help="Bind port")
    parser.add_argument(
        "--stdio",
        action="store_true",
        help="Run in stdio mode (for Claude Desktop). "
        "Requires TURBO_EA_EMAIL and TURBO_EA_PASSWORD env vars.",
    )
    args = parser.parse_args()

    if args.stdio:
        run_stdio()
    else:
        import uvicorn

        logger.info(
            "Starting Turbo EA MCP Server v%s on %s:%d",
            APP_VERSION,
            args.host,
            args.port,
        )
        uvicorn.run(create_app(), host=args.host, port=args.port, log_level="info")


if __name__ == "__main__":
    main()
