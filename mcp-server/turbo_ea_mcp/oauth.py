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
7. At the token exchange we open a durable MCP session in the backend
   (``POST /auth/mcp/sessions``) and hand the AI tool its tokens
8. AI tool uses the access_token on MCP requests, and the refresh_token to
   renew it (``POST /auth/mcp/sessions/refresh``)

Nothing about a connection is kept in this process, so it survives a restart:

- the **access token** is the session's Turbo EA JWT sealed with Fernet under
  a key derived from SECRET_KEY (``tea1a.`` + the Fernet token), carrying its
  own expiry; ``resolve_token`` opens it without asking the backend;
- the **refresh token** is the backend's own (``tea1r.…``): its signature is
  checked here (the key derives from SECRET_KEY too), then it is relayed unchanged.
  The backend rotates it on every use and ends the session when a replaced one
  comes back, and only this server can present it (its service proof).

Without SECRET_KEY, or against a backend that cannot open a session, sign-in
still works with the SSO JWT sealed as the access token and no refresh token:
the connection ends when that JWT does, after an hour at most.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import logging
import re
import secrets
import time
from dataclasses import dataclass, field
from urllib.parse import urlencode

from cryptography.fernet import Fernet, InvalidToken
from starlette.requests import Request
from starlette.responses import JSONResponse, RedirectResponse, Response

from turbo_ea_mcp import api_client
from turbo_ea_mcp.api_client import RefreshUnavailableError
from turbo_ea_mcp.config import (
    MCP_OAUTH_ALLOWED_REDIRECT_URIS,
    MCP_OAUTH_CLIENT_KEY,
    MCP_OAUTH_TOKEN_KEY,
    MCP_PUBLIC_URL,
    MCP_REFRESH_TOKEN_KEY,
)

logger = logging.getLogger(__name__)

# Lifetime of an authorization code and of a sign-in in flight (seconds). The
# tokens' lifetimes are the backend's: an access token lasts as long as the
# Turbo EA JWT it seals, a refresh token as long as its backend session.
AUTH_CODE_TTL = 600  # 10 minutes

# The longest a degraded connection's access token lasts (seconds). With no
# session behind it, the SSO JWT it seals cannot be revoked and would otherwise
# live as long as that JWT does (24 h by default), so it is cut to an hour.
DEGRADED_ACCESS_TOKEN_SECONDS = 3600

DEFAULT_CLIENT_NAME = "MCP Client"

# Registration bounds. A client id carries its redirect URIs (see
# ``mint_client_id``), and it travels in the /oauth/authorize query string
# beside a percent-encoded redirect_uri, so the id is capped well inside an
# 8 KB request line, the budget kept for proxies on nginx's default buffers
# (the bundled edge allows 16 KB per line, #1445): an id the server accepted
# must stay usable.
MAX_REDIRECT_URIS = 10
MAX_REDIRECT_URI_LENGTH = 1024
MAX_CLIENT_ID_LENGTH = 2048
MAX_CLIENT_NAME_LENGTH = 200
# The part of ``client_name`` a client id carries, so the name survives a
# restart (the admin table and the audit log tell tools apart by it) without
# making the id long.
MAX_CLIENT_ID_NAME_LENGTH = 100
# Registrations kept in memory. Only a ``client_name`` past its first 100
# characters is lost when one falls out — the id itself carries the rest and
# still authorizes — so the cache is bounded rather than
# letting open registration grow memory without limit.
MAX_CACHED_CLIENTS = 1000

# A module constant rather than a literal at the call: header names are
# case-insensitive, so a mutated spelling could never fail a test.
RETRY_AFTER = "Retry-After"  # pragma: no mutate, header names are case-insensitive

# RFC 6749 §5.1: a response carrying tokens must not be cached.
_TOKEN_RESPONSE_HEADERS = {"Cache-Control": "no-store", "Pragma": "no-cache"}


@dataclass
class RegisteredClient:
    """A dynamically-registered OAuth client (RFC 7591).

    The ``redirect_uris`` recorded here are the *only* URIs an authorization
    code will ever be sent to for this client — see ``_redirect_uri_registered``
    and the validation in ``authorize``."""

    client_id: str
    redirect_uris: list[str]
    client_name: str = DEFAULT_CLIENT_NAME
    created_at: float = field(default_factory=time.time)


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
    client_name: str = DEFAULT_CLIENT_NAME


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
    client_name: str = DEFAULT_CLIENT_NAME


class OAuthStore:
    """In-memory store for the OAuth state of sign-ins in flight.

    Issued tokens are not kept here (see the module docstring): they survive
    a restart. A sign-in in flight — ``pending`` and ``codes``, a few seconds
    to minutes — is lost with this process, so a restart mid-sign-in fails
    that attempt, and several replicas need sticky routing. ``clients`` is a
    cache: a client id carries its own registration."""

    def __init__(self) -> None:
        self.clients: dict[str, RegisteredClient] = {}  # keyed by client_id
        self.pending: dict[str, PendingAuth] = {}  # keyed by our internal state
        self.codes: dict[str, AuthCode] = {}  # keyed by code

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

# ── Self-describing client ids ─────────────────────────────────────────────
#
# Copilot Studio registers once and stores the client id in its connector; it
# never registers again. A registration that lived only in ``store.clients``
# was therefore gone after any restart of this process, and the connector was
# left failing at /oauth/authorize for good. The id now carries the client's
# redirect URIs, signed, so ``authorize`` can rebuild the registration from
# the id alone and the exact-match check below is unchanged.

_CLIENT_ID_PREFIX = "tea1."

# True when no SECRET_KEY reached this process: ids are then signed with a
# key that dies with it — and so are access tokens sealed, and no session can
# be opened. Every key here comes from the one SECRET_KEY, so this one flag
# says it for all of them. ``create_app`` warns; stdio mode never registers.
CLIENT_KEY_IS_EPHEMERAL = MCP_OAUTH_CLIENT_KEY is None
_client_id_key: bytes = MCP_OAUTH_CLIENT_KEY or secrets.token_bytes(32)


def _b64encode(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


def _client_id_signature(payload: str) -> str:
    digest = hmac.new(_client_id_key, payload.encode(), hashlib.sha256).digest()
    return _b64encode(digest)


# The tightest JSON separators, so a client id stays short.
_SEP = (",", ":")


def mint_client_id(redirect_uris: list[str], client_name: str = DEFAULT_CLIENT_NAME) -> str:
    """A client id that names its own redirect URIs and client name (its first
    100 characters) under a signature.

    The nonce keeps two registrations of the same URIs apart. The name is
    written as UTF-8 rather than as JSON escapes, so a non-ASCII one does not
    balloon the id."""
    claims = {
        "r": redirect_uris,
        "c": client_name[:MAX_CLIENT_ID_NAME_LENGTH],
        "n": secrets.token_urlsafe(8),
    }
    # Not mutated: json.dumps reads ensure_ascii for its truth, so None writes the same.
    raw = json.dumps(claims, separators=_SEP, ensure_ascii=False)  # pragma: no mutate, see above
    payload = _b64encode(raw.encode())
    return f"{_CLIENT_ID_PREFIX}{payload}.{_client_id_signature(payload)}"


def client_from_id(client_id: str) -> RegisteredClient | None:
    """The registration a minted client id describes, or ``None`` for an id
    that was not minted here with the current key."""
    if len(client_id) > MAX_CLIENT_ID_LENGTH or not client_id.startswith(_CLIENT_ID_PREFIX):
        return None
    payload, _, signature = client_id[len(_CLIENT_ID_PREFIX) :].partition(".")
    expected = _client_id_signature(payload)
    if not hmac.compare_digest(expected.encode(), signature.encode()):
        return None
    try:
        claims = json.loads(base64.urlsafe_b64decode(payload + "=="))
    except ValueError:
        return None
    uris = claims.get("r") if isinstance(claims, dict) else None
    if not _valid_redirect_uris(uris):
        return None
    # An id minted before the name was signed into it carries none.
    name = claims.get("c")
    if not isinstance(name, str) or not name.strip():
        name = DEFAULT_CLIENT_NAME
    return RegisteredClient(client_id=client_id, redirect_uris=list(uris), client_name=name)


def _lookup_client(client_id: str) -> RegisteredClient | None:
    """The registration behind ``client_id``: this process's record first,
    else the one the id itself carries."""
    return store.clients.get(client_id) or client_from_id(client_id)


# ── Sealed access tokens ───────────────────────────────────────────────────
#
# The access token an AI tool holds is the Turbo EA JWT behind its session,
# sealed, so any process given the same SECRET_KEY can open it and none has to
# remember it. The refresh token is the backend's and is never sealed here: a
# ``tea1r.`` token cannot open as an access token.

_ACCESS_TOKEN_PREFIX = "tea1a."
# Mirrors the backend's ``REFRESH_PREFIX`` (app/services/mcp_session_service.py);
# anything else is refused before the backend is asked.
_REFRESH_TOKEN_PREFIX = "tea1r."
# Mirrors the backend's ``MAX_REFRESH_TOKEN_LENGTH``: nothing longer is one.
MAX_REFRESH_TOKEN_LENGTH = 200
_ACCESS_TOKEN_TYPE = "access"

# Without SECRET_KEY the sealing key dies with the process, like the client-id
# key: tokens issued before a restart no longer open after it.
_token_fernet = Fernet(base64.urlsafe_b64encode(MCP_OAUTH_TOKEN_KEY or secrets.token_bytes(32)))


def seal_access_token(turbo_jwt: str, expires_at: float) -> str:
    """The access token handed to an AI tool for ``turbo_jwt``, valid until
    ``expires_at`` (a Unix time)."""
    claims = {"typ": _ACCESS_TOKEN_TYPE, "jwt": turbo_jwt, "exp": expires_at}
    sealed = _token_fernet.encrypt(json.dumps(claims, separators=(",", ":")).encode())
    return _ACCESS_TOKEN_PREFIX + sealed.decode()


def _open_access_token(access_token: str) -> str | None:
    """The Turbo EA JWT an unexpired access token seals; ``None`` for anything
    else — another prefix, a token sealed with another key, a refresh token,
    an expired or malformed one."""
    if not access_token.startswith(_ACCESS_TOKEN_PREFIX):
        return None
    try:
        claims = json.loads(_token_fernet.decrypt(access_token[len(_ACCESS_TOKEN_PREFIX) :]))
    except (InvalidToken, ValueError):
        return None
    if not isinstance(claims, dict) or claims.get("typ") != _ACCESS_TOKEN_TYPE:
        return None
    turbo_jwt, expires_at = claims.get("jwt"), claims.get("exp")
    if not isinstance(turbo_jwt, str) or not turbo_jwt:
        return None
    if not isinstance(expires_at, (int, float)) or expires_at <= time.time():
        return None
    return turbo_jwt


# The backend's refresh-token key (``config.refresh_token_key``): a refresh
# token is checked here before it is relayed, so a flood of junk tokens on
# /oauth/token never reaches the backend, whose per-address rate limit would
# count it against this container and turn real renewals away with it.
_refresh_token_key: bytes | None = MCP_REFRESH_TOKEN_KEY


def _refresh_token_signed(token: object) -> bool:
    """Whether ``token`` is a refresh token the backend signed: the check of
    ``parse_refresh_token`` (app/services/mcp_session_service.py) — at most
    200 characters, ``tea1r.<session>.<generation>.<signature>`` with the
    signature base64url(HMAC-SHA256(key, "<session>.<generation>")), no
    padding. Never ``True`` without SECRET_KEY: there is no key to check with,
    and no refresh token was issued."""
    if _refresh_token_key is None:
        return False
    if not isinstance(token, str) or len(token) > MAX_REFRESH_TOKEN_LENGTH:
        return False
    # Every token the backend signs is ASCII; a lone surrogate would not encode.
    if not token.isascii() or not token.startswith(_REFRESH_TOKEN_PREFIX):
        return False
    body, _, signature = token[len(_REFRESH_TOKEN_PREFIX) :].rpartition(".")
    expected = _b64encode(hmac.new(_refresh_token_key, body.encode(), hashlib.sha256).digest())
    return hmac.compare_digest(expected.encode(), signature.encode())


def _valid_redirect_uris(uris: object) -> bool:
    return (
        isinstance(uris, list)
        and 0 < len(uris) <= MAX_REDIRECT_URIS
        and all(isinstance(u, str) and 0 < len(u) <= MAX_REDIRECT_URI_LENGTH for u in uris)
    )


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
    return JSONResponse(
        {
            "resource": MCP_PUBLIC_URL,
            "authorization_servers": [MCP_PUBLIC_URL],
            "scopes_supported": ["mcp:read"],
            "bearer_methods_supported": ["header"],
            "resource_name": "Turbo EA",
        }
    )


async def authorization_server_metadata(_request: Request) -> Response:
    """RFC 8414 — tells AI tools how to authenticate."""
    base = MCP_PUBLIC_URL.rstrip("/")
    return JSONResponse(
        {
            "issuer": base,
            "authorization_endpoint": f"{base}/oauth/authorize",
            "token_endpoint": f"{base}/oauth/token",
            "registration_endpoint": f"{base}/oauth/register",
            "response_types_supported": ["code"],
            "grant_types_supported": ["authorization_code", "refresh_token"],
            "code_challenge_methods_supported": ["S256"],
            "scopes_supported": ["mcp:read"],
            "token_endpoint_auth_methods_supported": ["none"],
        }
    )


# ── Dynamic Client Registration (RFC 7591) ─────────────────────────────────


async def register_client(request: Request) -> Response:
    """Dynamic registration (RFC 7591) — register a public client and record
    the redirect URIs it is allowed to receive authorization codes on.

    The recorded ``redirect_uris`` are authoritative: ``authorize`` will only
    redirect a code to a URI this client registered here."""
    try:
        body = await request.json()
    except Exception:
        return JSONResponse({"error": "invalid_request"}, status_code=400)
    if not isinstance(body, dict):
        return JSONResponse({"error": "invalid_request"}, status_code=400)

    client_name = body.get("client_name")
    if not isinstance(client_name, str) or not client_name.strip():
        client_name = DEFAULT_CLIENT_NAME
    client_name = client_name[:MAX_CLIENT_NAME_LENGTH]
    redirect_uris = body.get("redirect_uris", [])

    # A client with no valid redirect URIs can never pass authorize-time
    # validation, so reject it up front (RFC 7591 §3.2.2 error code).
    if not isinstance(redirect_uris, list) or not all(
        isinstance(u, str) and u for u in redirect_uris
    ):
        return JSONResponse(
            {
                "error": "invalid_client_metadata",
                "error_description": "redirect_uris must be a non-empty list of strings",
            },
            status_code=400,
        )
    if not redirect_uris:
        return JSONResponse(
            {
                "error": "invalid_client_metadata",
                "error_description": "at least one redirect_uri is required",
            },
            status_code=400,
        )
    if len(redirect_uris) > MAX_REDIRECT_URIS or any(
        len(u) > MAX_REDIRECT_URI_LENGTH for u in redirect_uris
    ):
        return JSONResponse(
            {
                "error": "invalid_client_metadata",
                "error_description": (
                    f"at most {MAX_REDIRECT_URIS} redirect_uris of at most "
                    f"{MAX_REDIRECT_URI_LENGTH} characters each"
                ),
            },
            status_code=400,
        )

    issued_at = time.time()
    client_id = mint_client_id(list(redirect_uris), client_name)
    if len(client_id) > MAX_CLIENT_ID_LENGTH:
        return JSONResponse(
            {
                "error": "invalid_client_metadata",
                "error_description": "redirect_uris are too long in total",
            },
            status_code=400,
        )
    while len(store.clients) >= MAX_CACHED_CLIENTS:
        del store.clients[next(iter(store.clients))]
    store.clients[client_id] = RegisteredClient(
        client_id=client_id,
        redirect_uris=list(redirect_uris),
        client_name=client_name,
        created_at=issued_at,
    )

    return JSONResponse(
        {
            "client_id": client_id,
            "client_id_issued_at": int(issued_at),
            "client_name": client_name,
            "redirect_uris": redirect_uris,
            "grant_types": ["authorization_code", "refresh_token"],
            "response_types": ["code"],
            "token_endpoint_auth_method": "none",
        },
        status_code=201,
    )


def _redirect_uri_registered(client: RegisteredClient | None, redirect_uri: str | None) -> bool:
    """True iff ``redirect_uri`` is an exact match of a URI the client
    registered, or of an operator-configured static allowlist entry.

    Exact string comparison only — no prefix/substring/port normalization,
    which would reopen the redirection bypass this guards against."""
    if not redirect_uri:
        return False
    allowed: set[str] = set(MCP_OAUTH_ALLOWED_REDIRECT_URIS)
    if client is not None:
        allowed.update(client.redirect_uris)
    return redirect_uri in allowed


# ── Authorization endpoint ──────────────────────────────────────────────────


async def authorize(request: Request) -> Response:
    """Start the authorization flow — redirect user to SSO provider."""
    store.cleanup_expired()

    params = request.query_params
    # An absent parameter fails the same checks an empty one would.
    response_type = params.get("response_type")
    client_id = params.get("client_id", "")
    redirect_uri = params.get("redirect_uri")
    scope = params.get("scope", "mcp:read")
    state = params.get("state", "")
    code_challenge = params.get("code_challenge")
    code_challenge_method = params.get("code_challenge_method")

    if response_type != "code":
        return JSONResponse({"error": "unsupported_response_type"}, status_code=400)
    if not code_challenge or code_challenge_method != "S256":
        return JSONResponse(
            {"error": "invalid_request", "error_description": "PKCE S256 required"},
            status_code=400,
        )

    # Validate the redirect_uri against the client's registration BEFORE doing
    # anything else. On failure we return a direct error to the user agent and
    # never issue a redirect to the supplied URI — redirecting an unvalidated
    # redirect_uri is exactly the flaw this guards against (an attacker could
    # otherwise have a victim's authorization code delivered to their own URI).
    client = _lookup_client(client_id)
    if not _redirect_uri_registered(client, redirect_uri):
        return JSONResponse(
            {
                "error": "invalid_request",
                "error_description": ("redirect_uri is not registered for this client"),
            },
            status_code=400,
        )

    # Get SSO config from Turbo EA
    sso_config = await _get_sso_config()
    if not sso_config.get("enabled"):
        return JSONResponse(
            {"error": "server_error", "error_description": "SSO not configured"},
            status_code=503,
        )

    # Store pending auth (token_urlsafe's default is 32 random bytes)
    internal_state = secrets.token_urlsafe()
    store.pending[internal_state] = PendingAuth(
        client_id=client_id,
        redirect_uri=redirect_uri,
        scope=scope,
        state=state,
        code_challenge=code_challenge,
        code_challenge_method=code_challenge_method,
        client_name=client.client_name if client is not None else DEFAULT_CLIENT_NAME,
    )

    # Build SSO authorization URL (provider-agnostic — the backend provides
    # the correct authorization_endpoint regardless of provider)
    callback_url = f"{MCP_PUBLIC_URL.rstrip('/')}/oauth/callback"
    sso_params = {
        "client_id": sso_config["client_id"],
        "response_type": "code",
        "redirect_uri": callback_url,
        # The scopes the app's own login asks for, extra scopes included (a groups
        # claim for the directory role map); the base set when the backend sends none.
        "scope": sso_config.get("scopes") or "openid email profile",
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
    """The ``exp`` of a Turbo EA JWT, read without verification; an hour from
    now when the token has none or cannot be read at all."""
    try:
        _, payload, _ = token.split(".")
        # base64url drops its padding; the decoder ignores any surplus "=".
        return float(json.loads(base64.urlsafe_b64decode(payload + "=="))["exp"])
    except Exception:  # noqa: BLE001 — any unreadable token gets the default
        return time.time() + 3600


async def sso_callback(request: Request) -> Response:
    """Handle the redirect back from the SSO provider."""
    params = request.query_params
    error = params.get("error")
    if error:
        logger.warning("SSO callback error: %s — %s", error, params.get("error_description", ""))
        return JSONResponse(
            {
                "error": "access_denied",
                "error_description": "SSO authentication failed",
            },
            status_code=403,
        )

    sso_code = params.get("code")
    internal_state = params.get("state")

    if not sso_code or not internal_state:
        return JSONResponse({"error": "invalid_request"}, status_code=400)

    pending = store.pending.pop(internal_state, None)
    if not pending:
        return JSONResponse(
            {
                "error": "invalid_request",
                "error_description": "Unknown or expired state",
            },
            status_code=400,
        )

    # Exchange the SSO code via Turbo EA's existing SSO callback
    callback_url = f"{MCP_PUBLIC_URL.rstrip('/')}/oauth/callback"
    try:
        data = await api_client.exchange_sso_code(sso_code, callback_url)
    except Exception:
        logger.exception("Failed to exchange SSO code with Turbo EA backend")
        # Redirect back to the AI tool with an error
        error_params = urlencode(
            {
                "error": "server_error",
                "error_description": "Token exchange failed",
                "state": pending.state,
            }
        )
        return RedirectResponse(f"{pending.redirect_uri}?{error_params}", status_code=302)

    turbo_jwt = data.get("access_token")
    if not turbo_jwt:
        error_params = urlencode(
            {
                "error": "server_error",
                "error_description": "No token received",
                "state": pending.state,
            }
        )
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
        client_name=pending.client_name,
    )

    # Redirect back to the AI tool with the authorization code. Safe because
    # pending.redirect_uri was validated against the client's registration in
    # authorize() before this PendingAuth was ever stored — authorize() is the
    # only writer of store.pending.
    redirect_params = urlencode({"code": our_code, "state": pending.state})
    return RedirectResponse(f"{pending.redirect_uri}?{redirect_params}", status_code=302)


# ── Token endpoint ──────────────────────────────────────────────────────────


# RFC 7636 §4.1: a code verifier is made of the unreserved characters only.
_VERIFIER_ALPHABET = re.compile(r"[A-Za-z0-9\-._~]+")


def _verify_pkce(code_verifier: str, code_challenge: str) -> bool:
    """Verify PKCE S256: SHA256(verifier) == challenge.

    A verifier with a character outside RFC 7636's alphabet — a non-ASCII one
    among them — never matches, whatever challenge was computed for it; and the
    challenge is compared as bytes, so one outside ASCII fails rather than
    raising."""
    if not _VERIFIER_ALPHABET.fullmatch(code_verifier):
        return False
    digest = hashlib.sha256(code_verifier.encode("ascii")).digest()
    encoded = base64.urlsafe_b64encode(digest)
    # A SHA-256 digest's last base64url character is never an X (its low two
    # bits are always zero), so a strip set that gained an X strips the same.
    computed = encoded.rstrip(b"=").decode()  # pragma: no mutate, never ends in X
    return secrets.compare_digest(computed.encode(), code_challenge.encode())


async def _read_token_body(request: Request) -> dict | None:
    """The token request's parameters: a JSON object when the client says it
    sent JSON, else the form (RFC 6749's encoding), falling back to JSON when
    the form cannot be parsed. ``None`` when neither yields an object.

    The content type is read first because ``request.form()`` does not raise
    on a JSON body — it returns an empty form, so a JSON request used to be
    answered ``unsupported_grant_type``."""
    # Not mutated: header names are case-insensitive and any non-JSON default reads as form.
    content_type = request.headers.get("content-type", "")  # pragma: no mutate, see above
    media_type = content_type.split(";")[0].strip().lower()
    if media_type != "application/json":
        try:
            return dict(await request.form())
        except Exception:  # noqa: BLE001, S110 — an unparseable form tries JSON next
            pass
    try:
        body = await request.json()
    except Exception:  # noqa: BLE001 — anything unreadable is a bad request
        return None
    return body if isinstance(body, dict) else None


async def token_endpoint(request: Request) -> Response:
    """Exchange authorization code or refresh token for access token."""
    body = await _read_token_body(request)
    if body is None:
        return JSONResponse({"error": "invalid_request"}, status_code=400)

    grant_type = body.get("grant_type")

    if grant_type == "authorization_code":
        return await _handle_code_exchange(body)
    elif grant_type == "refresh_token":
        return await _handle_refresh(body)
    else:
        return JSONResponse({"error": "unsupported_grant_type"}, status_code=400)


async def _handle_code_exchange(body: dict) -> Response:
    """Exchange an authorization code for an access token and, when the
    backend opened a session for it, a refresh token."""
    code = body.get("code", "")
    code_verifier = body.get("code_verifier")
    redirect_uri = body.get("redirect_uri", "")

    auth_code = store.codes.get(code)
    if not auth_code:
        return JSONResponse(
            {"error": "invalid_grant", "error_description": "Unknown or expired code"},
            status_code=400,
        )

    if auth_code.used:
        # Code replay (or a second exchange racing the first): refuse it and
        # drop the code.
        del store.codes[code]
        return JSONResponse(
            {"error": "invalid_grant", "error_description": "Code already used"},
            status_code=400,
        )

    # Mark as used
    auth_code.used = True

    # Bind the token request to the authorization request: the redirect_uri
    # here must exactly equal the one the code was issued for (RFC 6749
    # §4.1.3). Combined with PKCE, this means an intercepted code is useless to
    # anyone who did not initiate the original, validated authorize request.
    if redirect_uri != auth_code.redirect_uri:
        del store.codes[code]
        return JSONResponse(
            {
                "error": "invalid_grant",
                "error_description": "redirect_uri mismatch",
            },
            status_code=400,
        )

    # If the client identified itself, it must match the code's client.
    req_client_id = body.get("client_id")
    if req_client_id and req_client_id != auth_code.client_id:
        del store.codes[code]
        return JSONResponse(
            {
                "error": "invalid_grant",
                "error_description": "client_id mismatch",
            },
            status_code=400,
        )

    # Validate PKCE
    if not code_verifier or not _verify_pkce(code_verifier, auth_code.code_challenge):
        del store.codes[code]
        return JSONResponse(
            {"error": "invalid_grant", "error_description": "PKCE verification failed"},
            status_code=400,
        )

    # Open the durable session behind the tokens. An outage leaves the code
    # usable, so the client's retry can still sign in.
    try:
        session = await api_client.create_mcp_session(
            auth_code.turbo_jwt, auth_code.client_name, auth_code.scope
        )
    except RefreshUnavailableError:
        logger.warning("Turbo EA backend unavailable while opening an MCP session", exc_info=True)
        auth_code.used = False
        return _temporarily_unavailable()

    # A concurrent exchange may already have dropped the code.
    store.codes.pop(code, None)
    if session is None:
        # Degraded: the SSO JWT itself, no refresh token, for at most an hour —
        # nothing can revoke it. The person then signs in again.
        return _token_response(
            auth_code.turbo_jwt, auth_code.scope, lifetime=DEGRADED_ACCESS_TOKEN_SECONDS
        )
    return _token_response(
        session.access_token,
        session.scope,
        lifetime=session.expires_in,
        refresh_token=session.refresh_token,
    )


def _temporarily_unavailable() -> Response:
    """The backend could not answer; the client should retry shortly."""
    return JSONResponse(
        {
            "error": "temporarily_unavailable",
            "error_description": "Turbo EA is not reachable, retry shortly",
        },
        status_code=503,
        headers={RETRY_AFTER: "5"},
    )


def _token_response(
    turbo_jwt: str,
    scope: str,
    *,
    lifetime: int | None = None,
    refresh_token: str | None = None,
) -> Response:
    """A token response sealing ``turbo_jwt``. The access token never outlives
    the JWT, nor ``lifetime`` seconds when the backend gave one; the
    ``refresh_token`` field is left out when there is none to give."""
    now = time.time()
    expires_at = _estimate_jwt_expiry(turbo_jwt)
    if lifetime is not None:
        expires_at = min(expires_at, now + lifetime)
    payload: dict = {
        "access_token": seal_access_token(turbo_jwt, expires_at),
        "token_type": "Bearer",
        "expires_in": int(expires_at - now),
    }
    if refresh_token is not None:
        payload["refresh_token"] = refresh_token
    payload["scope"] = scope
    return JSONResponse(payload, headers=_TOKEN_RESPONSE_HEADERS)


async def _handle_refresh(body: dict) -> Response:
    """Renew a connection through its backend session: a new sealed access
    token and the rotated refresh token."""
    refresh_token = body.get("refresh_token")
    # Checked here, not only by the backend: see ``_refresh_token_key``.
    if not _refresh_token_signed(refresh_token):
        return JSONResponse(
            {"error": "invalid_grant", "error_description": "Unknown refresh token"},
            status_code=400,
        )

    try:
        session = await api_client.refresh_mcp_session(refresh_token)
    except RefreshUnavailableError:
        # The backend could not answer; the session is fine and the refresh
        # token still good, so the client's retry can succeed once it is back.
        logger.warning("Turbo EA backend unavailable during token refresh", exc_info=True)
        return _temporarily_unavailable()

    if session is None:
        # Unknown, ended, expired or replayed, or the account may no longer
        # sign in: the person has to sign in again.
        return JSONResponse(
            {
                "error": "invalid_grant",
                "error_description": "Session expired, re-authenticate",
            },
            status_code=400,
        )

    return _token_response(
        session.access_token,
        session.scope,
        lifetime=session.expires_in,
        refresh_token=session.refresh_token,
    )


# ── Token resolution (used by the MCP server on each request) ──────────────


async def resolve_token(access_token: str) -> str | None:
    """Resolve an MCP access token to the Turbo EA JWT it seals.

    ``None`` means the token is not one of ours, was sealed under another key,
    or has expired; the gate then answers 401 ``invalid_token`` and the client
    renews it with its refresh token. No backend call is made: the backend
    checks the JWT, and the session it is bound to, on every request."""
    return _open_access_token(access_token)
