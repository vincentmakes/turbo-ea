"""Turbo EA MCP Server — provides read-only AI tool access to EA data.

Run: python -m turbo_ea_mcp.server --host 0.0.0.0 --port 8001
"""

from __future__ import annotations

import argparse
import json
import logging
import textwrap

from mcp.server.fastmcp import FastMCP
from starlette.applications import Starlette
from starlette.middleware import Middleware
from starlette.routing import Route

from turbo_ea_mcp import oauth
from turbo_ea_mcp.api_client import TurboEAClient
from turbo_ea_mcp.config import APP_VERSION, MCP_PORT

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(levelname)s %(message)s")
logger = logging.getLogger("turbo_ea_mcp")

# ── MCP Server ──────────────────────────────────────────────────────────────

mcp = FastMCP(
    "Turbo EA",
    instructions=textwrap.dedent("""\
        Turbo EA is an Enterprise Architecture management platform.
        Use the available tools to query the IT landscape data.
        All data access respects the authenticated user's permissions.
        Data is read-only — you cannot create or modify cards.
    """),
)


# ── Helpers ─────────────────────────────────────────────────────────────────


def _fmt(data: dict | list) -> str:
    """Format API response as readable JSON."""
    return json.dumps(data, indent=2, default=str)


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
    token = _get_current_token()
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
    token = _get_current_token()
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
    token = _get_current_token()
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
    token = _get_current_token()
    if not token:
        return "Error: Not authenticated. Please reconnect."
    client = TurboEAClient(token)
    data = await client.get(f"/cards/{card_id}/hierarchy")
    return _fmt(data)


@mcp.tool()
async def list_card_types() -> str:
    """List all card types in the metamodel with their fields and configuration."""
    token = _get_current_token()
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
    token = _get_current_token()
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
    token = _get_current_token()
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
    token = _get_current_token()
    if not token:
        return "Error: Not authenticated. Please reconnect."
    client = TurboEAClient(token)
    data = await client.get(
        "/reports/landscape",
        params={"type_key": type_key, "group_by": group_by},
    )
    return _fmt(data)


# ── Resources ───────────────────────────────────────────────────────────────


@mcp.resource("turbo-ea://types")
async def resource_types() -> str:
    """All card types in the metamodel."""
    token = _get_current_token()
    if not token:
        return "Error: Not authenticated."
    client = TurboEAClient(token)
    data = await client.get("/metamodel/types")
    return _fmt(data)


@mcp.resource("turbo-ea://relation-types")
async def resource_relation_types() -> str:
    """All relation types in the metamodel."""
    token = _get_current_token()
    if not token:
        return "Error: Not authenticated."
    client = TurboEAClient(token)
    data = await client.get("/metamodel/relation-types")
    return _fmt(data)


@mcp.resource("turbo-ea://dashboard")
async def resource_dashboard() -> str:
    """Dashboard KPIs and summary statistics."""
    token = _get_current_token()
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
import contextvars
import os

_current_token: contextvars.ContextVar[str | None] = contextvars.ContextVar(
    "_current_token", default=None
)

# In stdio mode a single user is logged in — store their token here.
_stdio_token: str | None = None


def _get_current_token() -> str | None:
    if _stdio_token is not None:
        return _stdio_token
    return _current_token.get()


# ── ASGI application ───────────────────────────────────────────────────────


class AuthMiddleware:
    """Extract Bearer token from MCP requests and resolve to Turbo EA JWT."""

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] == "http":
            headers = dict(scope.get("headers", []))
            auth = headers.get(b"authorization", b"").decode()
            if auth.startswith("Bearer "):
                mcp_token = auth[7:]
                turbo_jwt = await oauth.resolve_token(mcp_token)
                if turbo_jwt:
                    _current_token.set(turbo_jwt)
                else:
                    _current_token.set(None)
            else:
                _current_token.set(None)
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
        Route("/oauth/authorize", oauth.authorize, methods=["GET"]),
        Route("/oauth/callback", oauth.sso_callback, methods=["GET"]),
        Route("/oauth/token", oauth.token_endpoint, methods=["POST"]),
        Route("/oauth/register", oauth.register_client, methods=["POST"]),
    ]

    # Mount the MCP server's ASGI app under /mcp
    mcp_app = mcp.sse_app()

    async def health(request):
        from starlette.responses import JSONResponse

        return JSONResponse({"status": "ok", "version": APP_VERSION})

    oauth_routes.append(Route("/health", health, methods=["GET"]))

    app = Starlette(
        routes=oauth_routes,
        middleware=[Middleware(AuthMiddleware)],
    )
    app.mount("/mcp", mcp_app)

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

    email = os.environ.get("TURBO_EA_USERNAME", "")
    password = os.environ.get("TURBO_EA_PASSWORD", "")
    if not email or not password:
        logger.error(
            "TURBO_EA_USERNAME and TURBO_EA_PASSWORD must be set for stdio mode"
        )
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
        "Requires TURBO_EA_USERNAME and TURBO_EA_PASSWORD env vars.",
    )
    args = parser.parse_args()

    if args.stdio:
        run_stdio()
    else:
        import uvicorn

        logger.info(
            "Starting Turbo EA MCP Server v%s on %s:%d",
            APP_VERSION, args.host, args.port,
        )
        uvicorn.run(create_app(), host=args.host, port=args.port, log_level="info")


if __name__ == "__main__":
    main()
