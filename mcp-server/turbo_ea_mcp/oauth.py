"""OAuth 2.1 Authorization Server for AI tool clients.

The MCP server acts as both an OAuth AS (for AI tools) and a Protected
Resource (for MCP requests).  User authentication is delegated to the
corporate SSO provider via Turbo EA's existing ``POST /auth/sso/callback``.

Flow:
1. AI tool fetches ``/.well-known/oauth-protected-resource`` → points here
2. AI tool fetches ``/.well-known/oauth-authorization-server`` → discovers endpoints
3. AI tool redirects user to ``GET /oauth/authorize`` with PKCE
4. We redirect to SSO provider (Entra ID / Google / Okta / OIDC)
5. User authenticates, SSO redirects back to ``GET /oauth/callback``
6. We exchange the SSO code via Turbo EA backend → get Turbo EA JWT
7. We issue an opaque access_token + refresh_token to the AI tool
8. AI tool uses the access_token on MCP requests
"""

from __future__ import annotations

import hashlib
import logging
import secrets
import time
from dataclasses import dataclass, field
from urllib.parse import urlencode

from starlette.requests import Request
from starlette.responses import JSONResponse, RedirectResponse, Response

from turbo_ea_mcp import api_client
from turbo_ea_mcp.config import MCP_PUBLIC_URL

logger = logging.getLogger(__name__)

# Token lifetimes (seconds)
ACCESS_TOKEN_TTL = 3600  # 1 hour
REFRESH_TOKEN_TTL = 30 * 24 * 3600  # 30 days
AUTH_CODE_TTL = 600  # 10 minutes
# Proactive refresh: renew the Turbo EA JWT when less than this much TTL remains
TURBO_JWT_REFRESH_BUFFER = 3600  # 1 hour


@dataclass
class PendingAuth:
    """In-flight authorization request awaiting SSO callback."""

    client_id: str
    redirect_uri: str
    scope: str
    state: str
    code_challenge: str
    code_challenge_method: str
    created_at: float = field(default_factory=time.time)


@dataclass
class AuthCode:
    """Issued authorization code awaiting token exchange."""

    code: str
    client_id: str
    redirect_uri: str
    scope: str
    code_challenge: str
    turbo_jwt: str
    created_at: float = field(default_factory=time.time)
    used: bool = False


@dataclass
class TokenEntry:
    """Issued access_token → Turbo EA JWT mapping."""

    turbo_jwt: str
    turbo_jwt_exp: float
    refresh_token: str
    scope: str
    created_at: float = field(default_factory=time.time)


class OAuthStore:
    """In-memory store for OAuth state.  Suitable for a single-instance
    deployment — tokens are lost on restart (users simply re-authenticate)."""

    def __init__(self) -> None:
        self.pending: dict[str, PendingAuth] = {}  # keyed by our internal state
        self.codes: dict[str, AuthCode] = {}  # keyed by code
        self.tokens: dict[str, TokenEntry] = {}  # keyed by access_token
        self.refresh_tokens: dict[str, str] = {}  # refresh_token → access_token

    def cleanup_expired(self) -> None:
        now = time.time()
        # Pending auths
        expired = [k for k, v in self.pending.items() if now - v.created_at > AUTH_CODE_TTL]
        for k in expired:
            del self.pending[k]
        # Auth codes
        expired = [k for k, v in self.codes.items() if now - v.created_at > AUTH_CODE_TTL]
        for k in expired:
            del self.codes[k]


store = OAuthStore()

# ── SSO config cache (refreshed periodically) ──────────────────────────────

_sso_config_cache: dict | None = None
_sso_config_ts: float = 0.0
_SSO_CONFIG_TTL = 300  # 5 minutes


async def _get_sso_config() -> dict:
    global _sso_config_cache, _sso_config_ts
    now = time.time()
    if _sso_config_cache is None or now - _sso_config_ts > _SSO_CONFIG_TTL:
        _sso_config_cache = await api_client.get_sso_config()
        _sso_config_ts = now
    return _sso_config_cache


# ── Metadata endpoints (RFC 9728 + RFC 8414) ───────────────────────────────


async def protected_resource_metadata(_request: Request) -> Response:
    """RFC 9728 — tells AI tools where our authorization server is."""
    return JSONResponse({
        "resource": MCP_PUBLIC_URL,
        "authorization_servers": [MCP_PUBLIC_URL],
        "scopes_supported": ["mcp:read"],
        "bearer_methods_supported": ["header"],
        "resource_name": "Turbo EA",
    })


async def authorization_server_metadata(_request: Request) -> Response:
    """RFC 8414 — tells AI tools how to authenticate."""
    base = MCP_PUBLIC_URL.rstrip("/")
    return JSONResponse({
        "issuer": base,
        "authorization_endpoint": f"{base}/oauth/authorize",
        "token_endpoint": f"{base}/oauth/token",
        "registration_endpoint": f"{base}/oauth/register",
        "response_types_supported": ["code"],
        "grant_types_supported": ["authorization_code", "refresh_token"],
        "code_challenge_methods_supported": ["S256"],
        "scopes_supported": ["mcp:read"],
        "token_endpoint_auth_methods_supported": ["none"],
    })


# ── Dynamic Client Registration (RFC 7591) ─────────────────────────────────


async def register_client(request: Request) -> Response:
    """Minimal dynamic registration — accept any client as a public client."""
    try:
        body = await request.json()
    except Exception:
        return JSONResponse({"error": "invalid_request"}, status_code=400)

    client_id = secrets.token_urlsafe(24)
    client_name = body.get("client_name", "MCP Client")
    redirect_uris = body.get("redirect_uris", [])

    return JSONResponse({
        "client_id": client_id,
        "client_name": client_name,
        "redirect_uris": redirect_uris,
        "grant_types": ["authorization_code", "refresh_token"],
        "response_types": ["code"],
        "token_endpoint_auth_method": "none",
    }, status_code=201)


# ── Authorization endpoint ──────────────────────────────────────────────────


async def authorize(request: Request) -> Response:
    """Start the authorization flow — redirect user to SSO provider."""
    store.cleanup_expired()

    params = request.query_params
    response_type = params.get("response_type", "")
    client_id = params.get("client_id", "")
    redirect_uri = params.get("redirect_uri", "")
    scope = params.get("scope", "mcp:read")
    state = params.get("state", "")
    code_challenge = params.get("code_challenge", "")
    code_challenge_method = params.get("code_challenge_method", "")

    if response_type != "code":
        return JSONResponse(
            {"error": "unsupported_response_type"}, status_code=400
        )
    if not code_challenge or code_challenge_method != "S256":
        return JSONResponse(
            {"error": "invalid_request", "error_description": "PKCE S256 required"},
            status_code=400,
        )

    # Get SSO config from Turbo EA
    sso_config = await _get_sso_config()
    if not sso_config.get("enabled"):
        return JSONResponse(
            {"error": "server_error", "error_description": "SSO not configured"},
            status_code=503,
        )

    # Store pending auth
    internal_state = secrets.token_urlsafe(32)
    store.pending[internal_state] = PendingAuth(
        client_id=client_id,
        redirect_uri=redirect_uri,
        scope=scope,
        state=state,
        code_challenge=code_challenge,
        code_challenge_method=code_challenge_method,
    )

    # Build SSO authorization URL (provider-agnostic — the backend provides
    # the correct authorization_endpoint regardless of provider)
    callback_url = f"{MCP_PUBLIC_URL.rstrip('/')}/oauth/callback"
    sso_params = {
        "client_id": sso_config["client_id"],
        "response_type": "code",
        "redirect_uri": callback_url,
        "scope": "openid email profile",
        "response_mode": "query",
        "state": internal_state,
    }

    authorization_endpoint = sso_config["authorization_endpoint"]
    return RedirectResponse(
        f"{authorization_endpoint}?{urlencode(sso_params)}",
        status_code=302,
    )


# ── SSO callback ────────────────────────────────────────────────────────────


def _estimate_jwt_expiry(token: str) -> float:
    """Decode the Turbo EA JWT payload (without verification) to extract exp."""
    import base64
    import json

    try:
        parts = token.split(".")
        if len(parts) != 3:
            return time.time() + 3600
        # Pad the base64 payload
        payload_b64 = parts[1] + "=" * (4 - len(parts[1]) % 4)
        payload = json.loads(base64.urlsafe_b64decode(payload_b64))
        return float(payload.get("exp", time.time() + 3600))
    except Exception:
        return time.time() + 3600


async def sso_callback(request: Request) -> Response:
    """Handle the redirect back from the SSO provider."""
    params = request.query_params
    error = params.get("error")
    if error:
        logger.warning("SSO callback error: %s — %s", error, params.get("error_description", ""))
        return JSONResponse(
            {"error": "access_denied", "error_description": "SSO authentication failed"},
            status_code=403,
        )

    sso_code = params.get("code", "")
    internal_state = params.get("state", "")

    if not sso_code or not internal_state:
        return JSONResponse({"error": "invalid_request"}, status_code=400)

    pending = store.pending.pop(internal_state, None)
    if not pending:
        return JSONResponse(
            {"error": "invalid_request", "error_description": "Unknown or expired state"},
            status_code=400,
        )

    # Exchange the SSO code via Turbo EA's existing SSO callback
    callback_url = f"{MCP_PUBLIC_URL.rstrip('/')}/oauth/callback"
    try:
        data = await api_client.exchange_sso_code(sso_code, callback_url)
    except Exception:
        logger.exception("Failed to exchange SSO code with Turbo EA backend")
        # Redirect back to the AI tool with an error
        error_params = urlencode({
            "error": "server_error",
            "error_description": "Token exchange failed",
            "state": pending.state,
        })
        return RedirectResponse(f"{pending.redirect_uri}?{error_params}", status_code=302)

    turbo_jwt = data.get("access_token", "")
    if not turbo_jwt:
        error_params = urlencode({
            "error": "server_error",
            "error_description": "No token received",
            "state": pending.state,
        })
        return RedirectResponse(f"{pending.redirect_uri}?{error_params}", status_code=302)

    # Generate our own authorization code for the AI tool
    our_code = secrets.token_urlsafe(48)
    store.codes[our_code] = AuthCode(
        code=our_code,
        client_id=pending.client_id,
        redirect_uri=pending.redirect_uri,
        scope=pending.scope,
        code_challenge=pending.code_challenge,
        turbo_jwt=turbo_jwt,
    )

    # Redirect back to the AI tool with the authorization code
    redirect_params = urlencode({"code": our_code, "state": pending.state})
    return RedirectResponse(f"{pending.redirect_uri}?{redirect_params}", status_code=302)


# ── Token endpoint ──────────────────────────────────────────────────────────


def _verify_pkce(code_verifier: str, code_challenge: str) -> bool:
    """Verify PKCE S256: SHA256(verifier) == challenge."""
    digest = hashlib.sha256(code_verifier.encode("ascii")).digest()
    import base64

    computed = base64.urlsafe_b64encode(digest).rstrip(b"=").decode("ascii")
    return secrets.compare_digest(computed, code_challenge)


async def token_endpoint(request: Request) -> Response:
    """Exchange authorization code or refresh token for access token."""
    try:
        form = await request.form()
        body = dict(form)
    except Exception:
        try:
            body = await request.json()
        except Exception:
            return JSONResponse({"error": "invalid_request"}, status_code=400)

    grant_type = body.get("grant_type", "")

    if grant_type == "authorization_code":
        return await _handle_code_exchange(body)
    elif grant_type == "refresh_token":
        return await _handle_refresh(body)
    else:
        return JSONResponse({"error": "unsupported_grant_type"}, status_code=400)


async def _handle_code_exchange(body: dict) -> Response:
    """Exchange authorization code for access + refresh tokens."""
    code = body.get("code", "")
    code_verifier = body.get("code_verifier", "")

    auth_code = store.codes.get(code)
    if not auth_code:
        return JSONResponse(
            {"error": "invalid_grant", "error_description": "Unknown or expired code"},
            status_code=400,
        )

    if auth_code.used:
        # Code replay — revoke any tokens issued from this code
        store.codes.pop(code, None)
        return JSONResponse(
            {"error": "invalid_grant", "error_description": "Code already used"},
            status_code=400,
        )

    # Mark as used
    auth_code.used = True

    # Validate PKCE
    if not code_verifier or not _verify_pkce(code_verifier, auth_code.code_challenge):
        store.codes.pop(code, None)
        return JSONResponse(
            {"error": "invalid_grant", "error_description": "PKCE verification failed"},
            status_code=400,
        )

    # Clean up the code
    store.codes.pop(code, None)

    # Issue our tokens
    access_token = secrets.token_urlsafe(48)
    refresh_token = secrets.token_urlsafe(48)

    store.tokens[access_token] = TokenEntry(
        turbo_jwt=auth_code.turbo_jwt,
        turbo_jwt_exp=_estimate_jwt_expiry(auth_code.turbo_jwt),
        refresh_token=refresh_token,
        scope=auth_code.scope,
    )
    store.refresh_tokens[refresh_token] = access_token

    return JSONResponse({
        "access_token": access_token,
        "token_type": "Bearer",
        "expires_in": ACCESS_TOKEN_TTL,
        "refresh_token": refresh_token,
        "scope": auth_code.scope,
    })


async def _handle_refresh(body: dict) -> Response:
    """Use a refresh token to get a new access token with a refreshed JWT."""
    refresh_token = body.get("refresh_token", "")

    old_access = store.refresh_tokens.get(refresh_token)
    if not old_access:
        return JSONResponse(
            {"error": "invalid_grant", "error_description": "Unknown refresh token"},
            status_code=400,
        )

    old_entry = store.tokens.get(old_access)
    if not old_entry:
        store.refresh_tokens.pop(refresh_token, None)
        return JSONResponse(
            {"error": "invalid_grant", "error_description": "Token entry not found"},
            status_code=400,
        )

    # Attempt to refresh the underlying Turbo EA JWT
    from turbo_ea_mcp.api_client import TurboEAClient

    client = TurboEAClient(old_entry.turbo_jwt)
    new_jwt = await client.refresh_token()

    if new_jwt:
        turbo_jwt = new_jwt
        turbo_jwt_exp = _estimate_jwt_expiry(new_jwt)
    else:
        # Refresh failed — the Turbo EA JWT is expired and can't be renewed.
        # The user needs to re-authenticate.
        store.tokens.pop(old_access, None)
        store.refresh_tokens.pop(refresh_token, None)
        return JSONResponse(
            {"error": "invalid_grant", "error_description": "Session expired, re-authenticate"},
            status_code=400,
        )

    # Rotate tokens
    store.tokens.pop(old_access, None)
    store.refresh_tokens.pop(refresh_token, None)

    new_access = secrets.token_urlsafe(48)
    new_refresh = secrets.token_urlsafe(48)

    store.tokens[new_access] = TokenEntry(
        turbo_jwt=turbo_jwt,
        turbo_jwt_exp=turbo_jwt_exp,
        refresh_token=new_refresh,
        scope=old_entry.scope,
    )
    store.refresh_tokens[new_refresh] = new_access

    return JSONResponse({
        "access_token": new_access,
        "token_type": "Bearer",
        "expires_in": ACCESS_TOKEN_TTL,
        "refresh_token": new_refresh,
        "scope": old_entry.scope,
    })


# ── Token resolution (used by the MCP server on each request) ──────────────


async def resolve_token(access_token: str) -> str | None:
    """Resolve an MCP access token to a Turbo EA JWT.  Proactively
    refreshes the JWT if it's close to expiry."""
    entry = store.tokens.get(access_token)
    if not entry:
        return None

    now = time.time()

    # Proactive refresh: if the Turbo EA JWT is within the buffer of expiry
    if entry.turbo_jwt_exp - now < TURBO_JWT_REFRESH_BUFFER:
        from turbo_ea_mcp.api_client import TurboEAClient

        client = TurboEAClient(entry.turbo_jwt)
        new_jwt = await client.refresh_token()
        if new_jwt:
            entry.turbo_jwt = new_jwt
            entry.turbo_jwt_exp = _estimate_jwt_expiry(new_jwt)
        else:
            # JWT expired and can't be refreshed — token is invalid
            store.tokens.pop(access_token, None)
            store.refresh_tokens.pop(entry.refresh_token, None)
            return None

    return entry.turbo_jwt
