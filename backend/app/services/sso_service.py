"""Shared SSO / OIDC machinery.

Extracted from ``app.api.v1.auth`` so more than one caller can reuse the
OAuth2 authorization-code exchange and JWKS ``id_token`` verification without
importing route internals. Today the callers are:

- ``app.api.v1.auth`` — user login (provisions / resolves a ``users`` row).
- ``app.api.v1.web_portals`` — SSO-gated portal access (account-less; mints a
  portal-session token, never a user).

Both share ``exchange_code_for_claims`` (config load → provider cfg → OIDC
discovery if needed → token POST → signature verification) and then diverge on
what they do with the verified claims.
"""

from __future__ import annotations

import logging
from typing import Any

import httpx
import jwt
from fastapi import HTTPException
from jwt import PyJWKClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.encryption import decrypt_value
from app.models.app_settings import AppSettings

logger = logging.getLogger(__name__)


PROVIDER_LABELS = {
    "microsoft": "Microsoft",
    "google": "Google",
    "okta": "Okta",
    "oidc": "SSO",
}


# ---------------------------------------------------------------------------
# Settings access
# ---------------------------------------------------------------------------


async def get_general_settings(db: AsyncSession) -> dict:
    """Read general_settings from app_settings."""
    result = await db.execute(select(AppSettings).where(AppSettings.id == "default"))
    row = result.scalar_one_or_none()
    if row is None or not row.general_settings:
        return {}
    return dict(row.general_settings)


async def get_sso_config(db: AsyncSession) -> dict:
    """Read SSO configuration from app_settings."""
    general = await get_general_settings(db)
    sso = general.get("sso") or {}
    return sso if isinstance(sso, dict) else {}


# ---------------------------------------------------------------------------
# JWKS + OIDC discovery (cached)
# ---------------------------------------------------------------------------

_jwks_clients: dict[str, PyJWKClient] = {}
_oidc_discovery_cache: dict[str, dict] = {}


def get_jwks_client(jwks_url: str) -> PyJWKClient:
    if jwks_url not in _jwks_clients:
        # PyJWKClient defaults to stdlib urllib, whose `Python-urllib/x.y`
        # User-Agent is blocked with 403 by many WAFs (Cloudflare bot
        # protection in particular) sitting in front of OIDC providers.
        _jwks_clients[jwks_url] = PyJWKClient(
            jwks_url,
            cache_keys=True,
            headers={"User-Agent": "turbo-ea/jwks-client"},
        )
    return _jwks_clients[jwks_url]


async def discover_oidc(issuer_url: str) -> dict:
    """Fetch and cache the OpenID Connect discovery document."""
    if issuer_url in _oidc_discovery_cache:
        return _oidc_discovery_cache[issuer_url]
    discovery_url = f"{issuer_url.rstrip('/')}/.well-known/openid-configuration"
    async with httpx.AsyncClient(timeout=10.0) as client:
        resp = await client.get(discovery_url)
        resp.raise_for_status()
        doc: dict = resp.json()
        _oidc_discovery_cache[issuer_url] = doc
        return doc


def get_provider_config(sso: dict) -> dict:
    """Build provider-specific URLs and settings from the SSO configuration.

    Returns a dict with: authorization_endpoint, token_endpoint, jwks_uri,
    issuer, scopes, extra_auth_params, subject_claim.
    """
    provider = sso.get("provider", "microsoft")
    tenant = sso.get("tenant_id", "organizations")
    domain = sso.get("domain", "")
    issuer_url = sso.get("issuer_url", "")

    if provider == "microsoft":
        base = f"https://login.microsoftonline.com/{tenant}"
        return {
            "authorization_endpoint": f"{base}/oauth2/v2.0/authorize",
            "token_endpoint": f"{base}/oauth2/v2.0/token",
            "jwks_uri": f"{base}/discovery/v2.0/keys",
            "issuer": f"{base}/v2.0",
            "scopes": "openid email profile",
            "extra_auth_params": {},
            "subject_claim": "oid",  # fallback to "sub"
        }
    elif provider == "google":
        cfg: dict[str, Any] = {
            "authorization_endpoint": "https://accounts.google.com/o/oauth2/v2/auth",
            "token_endpoint": "https://oauth2.googleapis.com/token",
            "jwks_uri": "https://www.googleapis.com/oauth2/v3/certs",
            "issuer": "https://accounts.google.com",
            "scopes": "openid email profile",
            "extra_auth_params": {},
            "subject_claim": "sub",
        }
        if domain:
            cfg["extra_auth_params"]["hd"] = domain
        return cfg
    elif provider == "okta":
        if not domain:
            raise ValueError("Okta domain is required")
        base = f"https://{domain}/oauth2/default"
        return {
            "authorization_endpoint": f"{base}/v1/authorize",
            "token_endpoint": f"{base}/v1/token",
            "jwks_uri": f"{base}/v1/keys",
            "issuer": base,
            "scopes": "openid email profile",
            "extra_auth_params": {},
            "subject_claim": "sub",
        }
    elif provider == "oidc":
        if not issuer_url:
            raise ValueError("Issuer URL is required for Generic OIDC")
        # Use manually-configured endpoints if provided; otherwise
        # flag that auto-discovery is required.
        manual_auth = sso.get("authorization_endpoint", "")
        manual_token = sso.get("token_endpoint", "")
        manual_jwks = sso.get("jwks_uri", "")
        has_manual_endpoints = bool(manual_auth and manual_token and manual_jwks)
        return {
            "authorization_endpoint": manual_auth,
            "token_endpoint": manual_token,
            "jwks_uri": manual_jwks,
            "issuer": issuer_url.rstrip("/"),
            "scopes": "openid email profile",
            "extra_auth_params": {},
            "subject_claim": "sub",
            "discovery_required": not has_manual_endpoints,
        }
    else:
        raise ValueError(f"Unknown SSO provider: {provider}")


def verify_id_token(token: str, client_id: str, jwks_uri: str, issuer: str) -> dict:
    jwks_client = get_jwks_client(jwks_uri)
    signing_key = jwks_client.get_signing_key_from_jwt(token)
    algorithms = ["RS256", "RS384", "RS512", "ES256", "ES384", "ES512", "PS256"]
    try:
        return jwt.decode(
            token,
            signing_key.key,
            algorithms=algorithms,
            audience=client_id,
            issuer=issuer,
        )
    except jwt.InvalidIssuerError:
        # Retry with opposite trailing-slash variant — providers like
        # Authentik may include/omit a trailing slash in the iss claim.
        alt_issuer = issuer + "/" if not issuer.endswith("/") else issuer.rstrip("/")
        return jwt.decode(
            token,
            signing_key.key,
            algorithms=algorithms,
            audience=client_id,
            issuer=alt_issuer,
        )


# ---------------------------------------------------------------------------
# High-level authorization-code exchange
# ---------------------------------------------------------------------------


async def exchange_code_for_claims(
    db: AsyncSession, code: str, redirect_uri: str
) -> tuple[dict, dict, str]:
    """Exchange an authorization code for verified id_token claims.

    Returns ``(verified_claims, sso_config, provider)``. Raises ``HTTPException``
    with the same status codes the login callback historically used. Does NOT do
    the Google hosted-domain check, user provisioning, or any portal / account
    logic — the caller owns those after it has the verified claims.
    """
    sso = await get_sso_config(db)
    if not sso.get("enabled"):
        raise HTTPException(400, "SSO is not enabled")

    provider = sso.get("provider", "microsoft")
    client_id = sso.get("client_id", "")
    client_secret = decrypt_value(sso.get("client_secret", ""))

    if not client_id or not client_secret:
        raise HTTPException(500, "SSO is not properly configured")

    try:
        provider_cfg = get_provider_config(sso)
    except ValueError as exc:
        raise HTTPException(500, f"SSO provider misconfigured: {exc}")

    token_url = provider_cfg["token_endpoint"]
    jwks_uri = provider_cfg["jwks_uri"]
    issuer = provider_cfg["issuer"]

    # For Generic OIDC, resolve endpoints from discovery document
    if provider_cfg.get("discovery_required"):
        try:
            discovery = await discover_oidc(sso.get("issuer_url", ""))
            token_url = discovery["token_endpoint"]
            jwks_uri = discovery["jwks_uri"]
            issuer = discovery.get("issuer", issuer)
        except Exception:
            logger.exception("Failed to fetch OIDC discovery document")
            raise HTTPException(
                502, "SSO authentication failed. Could not reach identity provider."
            )

    # Exchange the authorization code for tokens
    logger.info("SSO token exchange: POST %s (provider=%s)", token_url, provider)
    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            token_response = await client.post(
                token_url,
                data={
                    "grant_type": "authorization_code",
                    "client_id": client_id,
                    "client_secret": client_secret,
                    "code": code,
                    "redirect_uri": redirect_uri,
                    "scope": provider_cfg["scopes"],
                },
                headers={"Content-Type": "application/x-www-form-urlencoded"},
            )
    except httpx.ConnectError:
        logger.exception(
            "SSO token exchange: cannot connect to %s — check Docker networking", token_url
        )
        raise HTTPException(
            502,
            "Cannot reach identity provider for token exchange. "
            "Check that the backend container can reach the token endpoint.",
        )
    except httpx.HTTPError:
        logger.exception("SSO token exchange request failed to %s", token_url)
        raise HTTPException(502, "SSO authentication failed. Identity provider is unavailable.")

    if token_response.status_code != 200:
        error_data = (
            token_response.json()
            if token_response.headers.get("content-type", "").startswith("application/json")
            else {}
        )
        error_desc = error_data.get("error_description", "Token exchange failed")
        error_code = error_data.get("error", "unknown")
        logger.error(
            "SSO token exchange failed (%s): status=%s error=%s desc=%s",
            provider,
            token_response.status_code,
            error_code,
            error_desc,
        )
        raise HTTPException(401, f"SSO authentication failed: {error_desc}")

    tokens = token_response.json()
    id_token = tokens.get("id_token")
    if not id_token:
        logger.error(
            "SSO token response missing id_token (%s). Keys received: %s",
            provider,
            list(tokens.keys()),
        )
        raise HTTPException(401, "No id_token received from identity provider")

    # ── Verify the id_token signature ──
    try:
        claims = verify_id_token(id_token, client_id, jwks_uri, issuer)
    except jwt.InvalidIssuerError:
        unverified = jwt.decode(id_token, options={"verify_signature": False})
        actual_issuer = unverified.get("iss", "unknown")
        logger.error(
            "SSO id_token issuer mismatch (%s): expected=%s actual=%s",
            provider,
            issuer,
            actual_issuer,
        )
        raise HTTPException(
            401,
            f"SSO token issuer mismatch: expected {issuer!r}, "
            f"got {actual_issuer!r}. Check issuer URL in SSO settings.",
        )
    except jwt.InvalidAudienceError:
        unverified = jwt.decode(id_token, options={"verify_signature": False})
        actual_aud = unverified.get("aud", "unknown")
        logger.error(
            "SSO id_token audience mismatch (%s): expected=%s actual=%s",
            provider,
            client_id,
            actual_aud,
        )
        raise HTTPException(401, "SSO token audience mismatch. Check Client ID in SSO settings.")
    except Exception:
        logger.exception("Failed to verify SSO id_token (%s, jwks=%s)", provider, jwks_uri)
        raise HTTPException(
            401,
            "Failed to verify SSO token signature. "
            "Check JWKS URI and that the backend can reach it.",
        )

    return claims, sso, provider
