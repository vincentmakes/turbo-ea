"""HTTP client wrapper for the Turbo EA REST API."""

from __future__ import annotations

import httpx

from turbo_ea_mcp.config import TURBO_EA_URL


class TurboEAClient:
    """Thin wrapper around httpx for authenticated Turbo EA API calls."""

    def __init__(self, token: str) -> None:
        self._token = token
        self._base = TURBO_EA_URL.rstrip("/") + "/api/v1"

    def _headers(self) -> dict[str, str]:
        return {"Authorization": f"Bearer {self._token}"}

    async def get(self, path: str, params: dict | None = None) -> dict | list:
        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.get(
                f"{self._base}{path}",
                headers=self._headers(),
                params=params,
            )
            resp.raise_for_status()
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
            raise ValueError(
                "Login failed: invalid email or password."
            ) from exc
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
