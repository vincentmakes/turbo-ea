"""HTTP client wrapper for the Turbo EA REST API."""

from __future__ import annotations

import json as _json
import logging
import time
from collections.abc import Iterable, Sequence
from typing import TypeVar

import httpx
import jwt
from pydantic import BaseModel, Field, ValidationError

from turbo_ea_mcp.config import MCP_SERVICE_AUTH_KEY, TURBO_EA_URL

logger = logging.getLogger(__name__)

T = TypeVar("T")

# Ids per ``GET /cards?ids=`` request. A request line over 8 KB is refused with
# 414 by an nginx on its default ``large_client_header_buffers 4 8k``, and
# operators put such proxies in front; the bundled edge nginx allows 16 KB per
# header line so a sign-in proxy's headers fit beside it (#1445). httpx
# percent-encodes the comma,
# so an encoded UUID costs 39 bytes: 200 of them make a 7.8 KB request line,
# which fits; 210 do not. The frontend's ``fetchCardsByIds`` uses the same
# figure (#1093).
CARD_IDS_CHUNK = 200

# Module constant, not a literal at the call: httpx header lookups ignore
# case, so a mutated spelling of the literal could never fail a test.
_CONTENT_TYPE = "content-type"


def chunked(items: Sequence[T], size: int) -> list[list[T]]:
    """Split ``items`` into consecutive lists of at most ``size``."""
    if size < 1:
        raise ValueError("chunk size must be >= 1")
    return [list(items[i : i + size]) for i in range(0, len(items), size)]


def _raise_for_status_with_detail(resp: httpx.Response) -> None:
    """Like ``resp.raise_for_status()`` but with the backend's error body
    appended to the exception message.

    FastAPI 4xx responses carry a ``detail`` payload that names the failing
    field (e.g. 422 validation errors). The bare ``HTTPStatusError`` message
    is only the status line + URL, which made payload bugs like #802
    undiagnosable from the MCP side. The original status text is preserved
    at the start of the message — callers string-match on it (e.g. "403").
    """
    if resp.is_success:
        return
    detail: str
    try:
        detail = _json.dumps(resp.json().get("detail"))
    except Exception:
        detail = resp.text[:2000]
    try:
        resp.raise_for_status()
    except httpx.HTTPStatusError as exc:
        raise httpx.HTTPStatusError(
            f"{exc}\nBackend detail: {detail}",
            request=exc.request,
            response=exc.response,
        ) from None


class RefreshUnavailableError(Exception):
    """The backend could not be asked to refresh a JWT (unreachable, or a 5xx).

    Distinct from a refusal: the session behind the token is still good."""


class TurboEAClient:
    """Thin wrapper around httpx for authenticated Turbo EA API calls."""

    def __init__(self, token: str, batch_id: str | None = None) -> None:
        self._token = token
        self._batch_id = batch_id
        self._base = TURBO_EA_URL.rstrip("/") + "/api/v1"

    def _headers(self) -> dict[str, str]:
        # `X-Turbo-EA-Origin` lets the backend tag emitted events with
        # ``origin: "mcp"`` so admins can filter MCP-driven writes out of
        # the audit log separately from web-UI actions.
        #
        # `X-Turbo-EA-Batch` (when present) carries the mutation-batch id
        # opened by the MCP tool wrapper. The backend's
        # ``capture_request_origin`` middleware mirrors it into the
        # ``request_batch_id`` contextvar so ``event_bus.publish`` stamps
        # every emitted event with the same id — that's how the change-
        # history endpoint can return a whole batch's audit trail in a
        # single query and how rollback knows which events to reverse.
        h = {
            "Authorization": f"Bearer {self._token}",
            "X-Turbo-EA-Origin": "mcp",
        }
        if self._batch_id:
            h["X-Turbo-EA-Batch"] = self._batch_id
        return h

    async def get(self, path: str, params: dict | None = None) -> dict | list:
        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.get(
                f"{self._base}{path}",
                headers=self._headers(),
                params=params,
            )
            _raise_for_status_with_detail(resp)
            if resp.status_code == 204:
                return {}
            return resp.json()

    async def get_cards_by_ids(self, ids: Iterable[str]) -> list[dict]:
        """Fetch cards by id in batches, so no single URL can hit the proxy's
        request-line limit.

        Dedupes and drops falsy ids (first-seen order kept) and makes no
        request when nothing is left. Archived cards are included — the
        endpoint deliberately skips its ACTIVE filter when ``ids`` is given —
        and hard-deleted ones are simply absent, so key the result by id
        rather than by position. All-or-nothing: one failed batch raises.
        """
        unique = list(dict.fromkeys(i for i in ids if i))
        items: list[dict] = []
        for chunk in chunked(unique, CARD_IDS_CHUNK):
            page = await self.get(
                "/cards", params={"ids": ",".join(chunk), "page_size": len(chunk)}
            )
            if isinstance(page, dict):
                items.extend(page.get("items", []))
        return items

    async def post(self, path: str, json: dict | None = None) -> dict | list:
        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.post(
                f"{self._base}{path}",
                headers=self._headers(),
                json=json,
            )
            _raise_for_status_with_detail(resp)
            if resp.status_code == 204:
                return {}
            return resp.json()

    async def post_multipart(
        self,
        path: str,
        *,
        data: dict[str, str] | None = None,
        file: tuple[str, bytes, str] | None = None,
        field: str = "file",
    ) -> dict | list:
        """POST multipart/form-data — a file, some plain fields, or both.

        The image endpoints take a real upload rather than JSON, and one of
        them also accepts a bare form field instead of a file (a brand-icon
        slug, resolved server-side). ``_headers()`` supplies the origin and
        batch ids as usual; the content type is left to httpx so it sets the
        multipart boundary.
        """
        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.post(
                f"{self._base}{path}",
                headers=self._headers(),
                files={field: file} if file else None,
                data=data or None,
            )
            _raise_for_status_with_detail(resp)
            if resp.status_code == 204:
                return {}
            return resp.json()

    async def post_file(
        self,
        path: str,
        filename: str,
        content: bytes,
        mime: str,
        field: str = "file",
    ) -> dict | list:
        """POST a single file as multipart/form-data."""
        return await self.post_multipart(path, file=(filename, content, mime), field=field)

    async def get_bytes(self, path: str, params: dict | None = None) -> tuple[bytes, str]:
        """GET a binary artefact, returning ``(content, content_type)``.

        ``get()`` JSON-decodes, which is wrong for the image endpoints. The
        content type comes back with the bytes so a caller needs no second
        request to learn what it received.
        """
        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.get(
                f"{self._base}{path}",
                headers=self._headers(),
                params=params,
            )
            _raise_for_status_with_detail(resp)
            return resp.content, resp.headers.get(_CONTENT_TYPE, "").split(";")[0].strip()

    async def put(self, path: str, json: dict | None = None) -> dict | list:
        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.put(
                f"{self._base}{path}",
                headers=self._headers(),
                json=json,
            )
            _raise_for_status_with_detail(resp)
            if resp.status_code == 204:
                return {}
            return resp.json()

    async def patch(self, path: str, json: dict | None = None) -> dict | list:
        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.patch(
                f"{self._base}{path}",
                headers=self._headers(),
                json=json,
            )
            _raise_for_status_with_detail(resp)
            if resp.status_code == 204:
                return {}
            return resp.json()

    async def delete(self, path: str) -> dict | list:
        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.delete(
                f"{self._base}{path}",
                headers=self._headers(),
            )
            _raise_for_status_with_detail(resp)
            if resp.status_code == 204:
                return {}
            return resp.json()

    async def refresh_token(self) -> str | None:
        """Call POST /auth/refresh to get a new JWT. Returns the new token
        or None if the current token is expired/invalid.

        Raises ``RefreshUnavailableError`` when the backend could not answer — it
        is unreachable or replied 5xx — because that says nothing about the
        token, and a caller that treated it as a rejection would end a
        session over a restarting backend."""
        async with httpx.AsyncClient(timeout=10.0) as client:
            try:
                resp = await client.post(
                    f"{self._base}/auth/refresh",
                    headers=self._headers(),
                )
            except httpx.HTTPError as exc:
                raise RefreshUnavailableError(str(exc)) from exc
            if resp.status_code >= 500:
                raise RefreshUnavailableError(f"backend answered {resp.status_code}")
            if resp.status_code == 200:
                data = resp.json()
                new_token = data.get("access_token")
                if new_token:
                    self._token = new_token
                    return new_token
        return None


async def login(email: str, password: str) -> str:
    """Authenticate with email/password. Returns the JWT access token."""
    url = f"{TURBO_EA_URL}/api/v1/auth/login"
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.post(url, json={"email": email, "password": password})
            resp.raise_for_status()
            data = resp.json()
            token = data.get("access_token")
            if not token:
                raise ValueError("No access_token in login response")
            return token
    except httpx.ConnectError as exc:
        raise ConnectionError(
            f"Cannot connect to {TURBO_EA_URL} — is the server running and reachable "
            f"from this machine? (Detail: {exc})"
        ) from exc
    except httpx.TimeoutException as exc:
        raise ConnectionError(
            f"Connection to {TURBO_EA_URL} timed out after 10s. "
            f"Check the URL and network connectivity."
        ) from exc
    except httpx.HTTPStatusError as exc:
        if exc.response.status_code == 401:
            raise ValueError("Login failed: invalid email or password.") from exc
        raise ValueError(f"Login failed: HTTP {exc.response.status_code} from {url}") from exc


async def get_sso_config() -> dict:
    """Fetch SSO configuration (public, no auth needed)."""
    async with httpx.AsyncClient(timeout=10.0) as client:
        resp = await client.get(f"{TURBO_EA_URL}/api/v1/auth/sso/config")
        resp.raise_for_status()
        return resp.json()


async def get_mcp_status() -> dict:
    """Fetch MCP status (public, no auth needed)."""
    async with httpx.AsyncClient(timeout=10.0) as client:
        resp = await client.get(f"{TURBO_EA_URL}/api/v1/settings/mcp/status")
        resp.raise_for_status()
        return resp.json()


async def exchange_sso_code(code: str, redirect_uri: str) -> dict:
    """Exchange an SSO authorization code for a Turbo EA JWT via the
    existing SSO callback endpoint."""
    async with httpx.AsyncClient(timeout=15.0) as client:
        resp = await client.post(
            f"{TURBO_EA_URL}/api/v1/auth/sso/callback",
            json={"code": code, "redirect_uri": redirect_uri},
        )
        resp.raise_for_status()
        return resp.json()


# ── MCP sessions (the durable connection behind an AI tool's tokens) ──────
#
# The backend keeps one row per AI tool connection and rotates its refresh
# token on every use (backend/app/api/v1/mcp_sessions.py). Both calls carry a
# one-minute proof that this is the instance's own MCP server, signed with a
# key both sides derive from SECRET_KEY, so a refresh token is worth nothing
# presented anywhere else.

# The header the backend reads the proof from (``SERVICE_HEADER`` in mcp_sessions.py).
_SERVICE_HEADER = "X-Turbo-EA-Service"
# The claims the backend's ``verify_mcp_service_token`` requires.
_SERVICE_ISSUER = "turbo-ea-mcp"
_SERVICE_AUDIENCE = "turbo-ea-backend"
SERVICE_TOKEN_TTL = 60  # seconds
# The backend refuses a longer ``client_name`` or ``scope`` with a 422.
MAX_SESSION_FIELD_LENGTH = 200
_SESSIONS_PATH = "/api/v1/auth/mcp/sessions"


class McpSessionTokens(BaseModel):
    """What the backend answers when it opens or renews an MCP session."""

    access_token: str = Field(min_length=1)
    refresh_token: str = Field(min_length=1)
    expires_in: int
    scope: str


def service_token() -> str | None:
    """A proof, valid for a minute, that the caller is this instance's MCP
    server; ``None`` when no SECRET_KEY reached this process."""
    if MCP_SERVICE_AUTH_KEY is None:
        return None
    now = int(time.time())
    claims = {
        "iss": _SERVICE_ISSUER,
        "aud": _SERVICE_AUDIENCE,
        "iat": now,
        "exp": now + SERVICE_TOKEN_TTL,
    }
    return jwt.encode(claims, MCP_SERVICE_AUTH_KEY, algorithm="HS256")


def _unavailable(resp: httpx.Response) -> bool:
    """A 5xx, or a 429: the backend could not answer now, which says nothing
    about the session."""
    return resp.status_code >= 500 or resp.status_code == 429


def _session_tokens(resp: httpx.Response) -> McpSessionTokens:
    try:
        return McpSessionTokens.model_validate_json(resp.content)
    except ValidationError as exc:
        raise RefreshUnavailableError("backend sent an unreadable MCP session") from exc


async def _post_session(path: str, headers: dict[str, str], body: dict) -> httpx.Response:
    async with httpx.AsyncClient(timeout=10.0) as client:
        try:
            resp = await client.post(f"{TURBO_EA_URL}{path}", headers=headers, json=body)
        except httpx.HTTPError as exc:
            raise RefreshUnavailableError(str(exc)) from exc
    if _unavailable(resp):
        raise RefreshUnavailableError(f"backend answered {resp.status_code}")
    return resp


# Statuses on which the backend cannot open a session for this server: 401 is
# a refused proof (another SECRET_KEY), 404 / 405 a backend older than this server.
_NO_SESSION_STATUSES = frozenset({401, 404, 405})


async def create_mcp_session(
    turbo_jwt: str, client_name: str, scope: str
) -> McpSessionTokens | None:
    """Open a durable session for the person behind ``turbo_jwt``.

    ``None`` when this server cannot open one — no SECRET_KEY here, a proof
    the backend refuses, or a backend older than this server — and the caller
    then hands out a connection that will not renew. Raises
    ``RefreshUnavailableError`` when the backend could not answer (unreachable,
    5xx, 429) or answered something else, so the sign-in can be retried."""
    proof = service_token()
    if proof is None:
        logger.warning(
            "SECRET_KEY is not set for the MCP server: AI tool connections will "
            "not renew. Pass the instance's SECRET_KEY to the mcp-server container."
        )
        return None
    resp = await _post_session(
        _SESSIONS_PATH,
        {"Authorization": f"Bearer {turbo_jwt}", _SERVICE_HEADER: proof},
        {
            "client_name": client_name[:MAX_SESSION_FIELD_LENGTH],
            "scope": scope[:MAX_SESSION_FIELD_LENGTH],
        },
    )
    if resp.status_code in _NO_SESSION_STATUSES:
        logger.warning(
            "Turbo EA did not open an MCP session (HTTP %s): AI tool connections "
            "will not renew until the MCP server's SECRET_KEY matches the "
            "backend's and the backend is upgraded to this MCP server's version.",
            resp.status_code,
        )
        return None
    if not resp.is_success:
        raise RefreshUnavailableError(f"backend answered {resp.status_code}")
    return _session_tokens(resp)


async def refresh_mcp_session(refresh_token: str) -> McpSessionTokens | None:
    """Renew a session: a new access token and the next refresh token.

    ``None`` is a refusal (the token is unknown, ended, expired or replayed,
    or the account may no longer sign in): the person has to sign in again.
    Raises ``RefreshUnavailableError`` when the backend could not answer, the
    same contract as ``TurboEAClient.refresh_token``."""
    proof = service_token()
    if proof is None:
        return None
    resp = await _post_session(
        f"{_SESSIONS_PATH}/refresh",
        {_SERVICE_HEADER: proof},
        {"refresh_token": refresh_token},
    )
    if not resp.is_success:
        return None
    return _session_tokens(resp)
