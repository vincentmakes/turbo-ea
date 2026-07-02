"""OAuth 2.0 token acquisition for email backends.

Two flows are supported:

* **client_credentials** — app-only token from the Microsoft identity platform
  (``login.microsoftonline.com/{tenant}/oauth2/v2.0/token``). Used by the Graph
  backend (scope ``https://graph.microsoft.com/.default``) and by M365 SMTP
  XOAUTH2 (scope ``https://outlook.office365.com/.default``).
* **service_account** — Google service-account JWT-bearer grant (domain-wide
  delegation) for Google Workspace SMTP XOAUTH2 (scope ``https://mail.google.com/``).

Tokens are cached in-memory per credential identity (tenant/endpoint, client,
scope, and — for Google — the impersonated subject) and reused until shortly
before expiry. Secrets and tokens are never logged.
"""

from __future__ import annotations

import asyncio
import base64
import json
import logging
import time

import httpx

logger = logging.getLogger(__name__)

# Refresh this many seconds before the token actually expires.
_EXPIRY_SKEW_SECONDS = 60
_HTTP_TIMEOUT = 20.0

# (cache_key) -> (access_token, expires_at_monotonic)
_token_cache: dict[str, tuple[str, float]] = {}
_lock = asyncio.Lock()


def reset_cache() -> None:
    """Drop all cached tokens (used by tests and after a settings change)."""
    _token_cache.clear()


def microsoft_token_endpoint(tenant_id: str) -> str:
    tenant = (tenant_id or "organizations").strip() or "organizations"
    return f"https://login.microsoftonline.com/{tenant}/oauth2/v2.0/token"


def _cache_get(key: str) -> str | None:
    entry = _token_cache.get(key)
    if not entry:
        return None
    token, expires_at = entry
    if time.monotonic() >= expires_at:
        _token_cache.pop(key, None)
        return None
    return token


def _cache_put(key: str, token: str, expires_in: int) -> None:
    ttl = max(int(expires_in) - _EXPIRY_SKEW_SECONDS, 0)
    _token_cache[key] = (token, time.monotonic() + ttl)


async def get_client_credentials_token(
    *,
    tenant_id: str,
    client_id: str,
    client_secret: str,
    scope: str,
    token_endpoint: str = "",
) -> str:
    """Fetch (or reuse a cached) app-only access token via client credentials."""
    endpoint = (token_endpoint or "").strip() or microsoft_token_endpoint(tenant_id)
    # Tenant and endpoint are part of the key: correcting either must not keep
    # serving the hour-long token minted against the old authority.
    cache_key = f"cc:{tenant_id}:{client_id}:{scope}:{endpoint}"
    cached = _cache_get(cache_key)
    if cached:
        return cached

    async with _lock:
        cached = _cache_get(cache_key)
        if cached:
            return cached

        data = {
            "client_id": client_id,
            "client_secret": client_secret,
            "scope": scope,
            "grant_type": "client_credentials",
        }
        async with httpx.AsyncClient(timeout=_HTTP_TIMEOUT) as client:
            resp = await client.post(endpoint, data=data)
        token, expires_in = _extract_token(resp, "OAuth token request failed")
        _cache_put(cache_key, token, expires_in)
        return token


async def get_service_account_token(
    *,
    service_account_json: str,
    subject: str,
    scope: str,
) -> str:
    """Fetch a Google access token via the service-account JWT-bearer grant.

    ``subject`` is the mailbox to impersonate (domain-wide delegation). The
    service-account key (with private key) is supplied as a JSON string.
    """
    try:
        sa = json.loads(service_account_json)
    except (json.JSONDecodeError, TypeError) as exc:
        raise RuntimeError("Service-account JSON is not valid JSON") from exc

    client_email = sa.get("client_email")
    private_key = sa.get("private_key")
    token_uri = sa.get("token_uri") or "https://oauth2.googleapis.com/token"
    if not client_email or not private_key:
        raise RuntimeError("Service-account JSON missing client_email or private_key")

    cache_key = f"sa:{client_email}:{subject}:{scope}"
    cached = _cache_get(cache_key)
    if cached:
        return cached

    async with _lock:
        cached = _cache_get(cache_key)
        if cached:
            return cached

        assertion = _build_google_assertion(
            client_email=client_email,
            private_key=private_key,
            token_uri=token_uri,
            subject=subject,
            scope=scope,
        )
        data = {
            "grant_type": "urn:ietf:params:oauth:grant-type:jwt-bearer",
            "assertion": assertion,
        }
        async with httpx.AsyncClient(timeout=_HTTP_TIMEOUT) as client:
            resp = await client.post(token_uri, data=data)
        token, expires_in = _extract_token(resp, "Google token request failed")
        _cache_put(cache_key, token, expires_in)
        return token


def _build_google_assertion(
    *,
    client_email: str,
    private_key: str,
    token_uri: str,
    subject: str,
    scope: str,
) -> str:
    """Build the signed JWT for the Google JWT-bearer grant (RS256)."""
    import jwt  # PyJWT — already a backend dependency

    now = int(time.time())
    claims = {
        "iss": client_email,
        "scope": scope,
        "aud": token_uri,
        "iat": now,
        "exp": now + 3600,
    }
    if subject:
        claims["sub"] = subject
    return str(jwt.encode(claims, private_key, algorithm="RS256"))


def build_xoauth2_raw(user: str, access_token: str) -> str:
    """Build the raw (un-encoded) SASL XOAUTH2 initial-client-response.

    ``smtplib.SMTP.auth`` base64-encodes the authobject's return value itself,
    so the raw form is what the XOAUTH2 backend feeds it.
    """
    return f"user={user}\x01auth=Bearer {access_token}\x01\x01"


def build_xoauth2_string(user: str, access_token: str) -> str:
    """Build the base64-encoded SASL XOAUTH2 initial-client-response."""
    return base64.b64encode(build_xoauth2_raw(user, access_token).encode()).decode()


def _extract_token(resp: httpx.Response, error_prefix: str) -> tuple[str, int]:
    """Validate a token-endpoint response and return (access_token, expires_in)."""
    if resp.status_code != 200:
        # Surface the provider's error description without leaking the secret.
        raise RuntimeError(f"{error_prefix} ({resp.status_code}): {safe_error(resp)}")
    payload = resp.json()
    token = payload.get("access_token")
    if not isinstance(token, str) or not token:
        raise RuntimeError(f"{error_prefix}: response did not contain an access_token")
    return token, payload.get("expires_in", 3600)


def safe_error(resp: httpx.Response) -> str:
    """Extract a loggable error message from an httpx response without secrets.

    Handles both OAuth token-endpoint shapes (``error_description`` / ``error``
    string) and Graph's nested ``{"error": {"message": ...}}``.
    """
    try:
        body = resp.json()
        err = body.get("error") if isinstance(body, dict) else None
        if isinstance(err, dict):
            return str(err.get("message") or err)
        return str(body.get("error_description") or err or body)[:300]
    except Exception:
        return resp.text[:200]
