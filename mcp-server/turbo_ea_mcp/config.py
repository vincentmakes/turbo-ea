"""Configuration from environment variables."""

from __future__ import annotations

import hashlib
import hmac
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
# Logos are uploaded one HTTP request per card and carry image bytes, so
# the cap is lower than the card cap — 50 images is already several
# megabytes of base64 in the agent's context.
MCP_MAX_LOGOS_PER_CALL: int = int(os.environ.get("MCP_MAX_LOGOS_PER_CALL", "50"))

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

# ── Logo fetching ──────────────────────────────────────────────────────────
#
# `set_card_logos` accepts an `image_url` and downloads it here, at the agent
# edge, rather than in the backend: the bytes then go up the ordinary upload
# route, so an LLM-chosen URL never reaches the process that holds the
# database. It exists because the packs cannot cover every product a customer
# runs and many agents are sandboxed with no route to the open web — telling
# such an agent to "go and fetch the mark yourself" is advice it cannot take.
#
# Off with one variable. An air-gapped install needs no change: the fetch
# simply fails and the row says so.
MCP_LOGO_FETCH_ENABLED: bool = _env_bool("MCP_LOGO_FETCH_ENABLED", True)

# Hosts a logo may be fetched from. **Exact** host match, no wildcards and no
# suffix matching — `evil-raw.githubusercontent.com.attacker.test` must not
# pass. The default set is public, static icon hosting: the request carries a
# file name and nothing about the customer. Deliberately excluded are the
# domain→logo services (`logo.clearbit.com` and friends), where the request IS
# the vendor's domain — that tells a third party which products a customer
# runs, one lookup at a time, and is an operator's decision to make rather
# than ours to ship on by default.
_DEFAULT_LOGO_FETCH_HOSTS = (
    "raw.githubusercontent.com",
    "cdn.jsdelivr.net",
    "cdn.simpleicons.org",
    "upload.wikimedia.org",
)
MCP_LOGO_FETCH_HOSTS: tuple[str, ...] = tuple(
    h.strip().lower()
    for h in os.environ.get("MCP_LOGO_FETCH_HOSTS", "").split(",")
    if h.strip()
) or _DEFAULT_LOGO_FETCH_HOSTS

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

# Origins, beyond the two public URLs above, whose browser-borne requests the
# MCP endpoint accepts. FastMCP's DNS-rebinding guard refuses a request that
# carries any other ``Origin`` header (a request with none always passes).
# Comma-separated; matched as the SDK matches them — exactly, or any port for
# an entry written ``scheme://host:*``. Empty by default.
def parse_origins(raw: str) -> list[str]:
    """Comma-separated origins, trimmed, without a trailing slash (an Origin
    header never carries one)."""
    return [o.strip().rstrip("/") for o in raw.split(",") if o.strip()]


MCP_ALLOWED_ORIGINS: list[str] = parse_origins(os.environ.get("MCP_ALLOWED_ORIGINS", ""))


# Host names, beyond the two public URLs above, that the MCP endpoint accepts
# in the ``Host`` header. For a proxy that forwards a name other than the
# public one — Azure Front Door in front of a Container Apps route sends the
# route's ``*.azurecontainerapps.io`` name — FastMCP's DNS-rebinding guard
# otherwise answers 421. Comma-separated; matched as the SDK matches them —
# exactly (``host`` or ``host:port``), or any port for ``host:*``. No subdomain
# wildcards. The SDK compares the header as the proxy sends it, and proxies
# send host names in lower case, so entries are lower-cased. Empty by default.
def parse_hosts(raw: str) -> list[str]:
    """Comma-separated host names, trimmed, lower-cased and without a trailing
    slash (a Host header never carries one)."""
    hosts = (h.strip().rstrip("/").lower() for h in raw.split(","))
    return [h for h in hosts if h]


MCP_ALLOWED_HOSTS: list[str] = parse_hosts(os.environ.get("MCP_ALLOWED_HOSTS", ""))

# The context string that separates the client-id signing key from every
# other use of SECRET_KEY (the backend signs JWTs and derives its Fernet key
# from the same secret): the raw secret never signs anything here.
_CLIENT_ID_KEY_CONTEXT = b"turbo-ea-mcp/oauth-client-id/v1"


def oauth_client_key(secret: str) -> bytes | None:
    """The key that signs dynamically registered client ids, derived from the
    instance's SECRET_KEY; ``None`` when there is no secret to derive from.

    A registered client id has to survive a restart of this process, because
    clients such as Copilot Studio register once and keep the id for good. So
    the id carries its own redirect URIs under a signature, and the key must
    be the same on every boot — which SECRET_KEY already is."""
    if not secret:
        return None
    return hmac.new(secret.encode(), _CLIENT_ID_KEY_CONTEXT, hashlib.sha256).digest()


MCP_OAUTH_CLIENT_KEY: bytes | None = oauth_client_key(os.environ.get("SECRET_KEY", ""))
