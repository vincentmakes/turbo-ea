"""HTTP client wrapper for the Turbo EA REST API."""

from __future__ import annotations

import json as _json
from collections.abc import Iterable, Sequence
from typing import TypeVar

import httpx

from turbo_ea_mcp.config import TURBO_EA_URL

T = TypeVar("T")

# Ids per ``GET /cards?ids=`` request. The bundled edge nginx runs the default
# ``large_client_header_buffers 4 8k``, so a request line over 8 KB is refused
# with 414 before it ever reaches the backend. httpx percent-encodes the comma,
# so an encoded UUID costs 39 bytes: 200 of them make a 7.8 KB request line,
# which fits; 210 do not. The frontend's ``fetchCardsByIds`` uses the same
# figure (#1093).
CARD_IDS_CHUNK = 200


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
        return await self.post_multipart(
            path, file=(filename, content, mime), field=field
        )

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
            return resp.content, resp.headers.get("content-type", "").split(";")[0].strip()

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
        or None if the current token is expired/invalid."""
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.post(
                f"{self._base}/auth/refresh",
                headers=self._headers(),
            )
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
        raise ValueError(
            f"Login failed: HTTP {exc.response.status_code} from {url}"
        ) from exc


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
