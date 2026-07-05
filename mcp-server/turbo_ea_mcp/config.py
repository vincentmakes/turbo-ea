"""Configuration from environment variables."""

from __future__ import annotations

import os
from pathlib import Path


def _read_version() -> str:
    """Read the app version from the VERSION file."""
    for candidate in (
        Path(__file__).resolve().parent.parent / "VERSION",
        Path("VERSION"),
    ):
        if candidate.is_file():
            return candidate.read_text().strip()
    return "0.0.0"


# Internal backend URL (Docker: http://backend:8000)
TURBO_EA_URL: str = os.environ.get("TURBO_EA_URL", "http://localhost:8000")

# Public URL of the Turbo EA instance (used for OAuth redirect URIs)
TURBO_EA_PUBLIC_URL: str = os.environ.get(
    "TURBO_EA_PUBLIC_URL", "http://localhost:8920"
)

# Port for the MCP server
MCP_PORT: int = int(os.environ.get("MCP_PORT", "8001"))

# MCP server public base URL (for OAuth metadata)
MCP_PUBLIC_URL: str = os.environ.get("MCP_PUBLIC_URL", f"http://localhost:{MCP_PORT}")

APP_VERSION: str = _read_version()


def _env_bool(name: str, default: bool) -> bool:
    raw = os.environ.get(name)
    if raw is None:
        return default
    return raw.strip().lower() in ("1", "true", "yes", "on")


# ── Write-tool guardrails ──────────────────────────────────────────────────
#
# Per-call size caps for the artifact-import write tools. The backend bulk
# endpoints accept up to 2000 cards / 5000 relations to keep the Excel
# importer fast on large rosters; when an LLM is in the loop we want
# something an attentive reviewer can scan in a dry-run preview. Operators
# can raise these if their use case demands it.
MCP_MAX_CARDS_PER_CALL: int = int(os.environ.get("MCP_MAX_CARDS_PER_CALL", "200"))
MCP_MAX_RELATIONS_PER_CALL: int = int(
    os.environ.get("MCP_MAX_RELATIONS_PER_CALL", "500")
)

# Kill switch — set to ``false`` to disable all MCP write tools without a
# code redeploy. Read tools keep working.
MCP_WRITES_ENABLED: bool = _env_bool("MCP_WRITES_ENABLED", True)

# Block the destructive ``action: "delete"`` path on ``upsert_relations_bulk``.
# The web-UI relation bulk endpoint still supports it; turning this on is an
# explicit operator choice.
MCP_ALLOW_RELATION_DELETE: bool = _env_bool("MCP_ALLOW_RELATION_DELETE", False)

# Above this row count, a commit must echo back the ``confirm_token`` issued
# by the prior dry-run. The backend has its own floor (currently 20); the
# MCP wrapper enforces this value first so the agent gets a clear error
# before the backend round-trip.
MCP_BATCH_CONFIRMATION_THRESHOLD: int = int(
    os.environ.get("MCP_BATCH_CONFIRMATION_THRESHOLD", "20")
)

# When ``True`` (default), the MCP wrapper refuses a commit call that has no
# matching prior dry-run in the same session. Operators can opt out for
# trusted automation pipelines that explicitly do not want the second
# round-trip.
MCP_REQUIRE_DRYRUN_FIRST: bool = _env_bool("MCP_REQUIRE_DRYRUN_FIRST", True)

# ── OAuth authorization-server guardrails ──────────────────────────────────
#
# Exact redirect URIs always accepted at ``/oauth/authorize`` even for clients
# that did not dynamically register (RFC 7591). Empty by default, which means
# a client must register its redirect URI before it can be used — an authorize
# request with an unknown client or an unregistered redirect URI is rejected.
# This is an escape hatch for first-party / non-DCR integrations that pin a
# fixed redirect. Comma-separated; exact string match only, no wildcards.
MCP_OAUTH_ALLOWED_REDIRECT_URIS: list[str] = [
    u.strip()
    for u in os.environ.get("MCP_OAUTH_ALLOWED_REDIRECT_URIS", "").split(",")
    if u.strip()
]
