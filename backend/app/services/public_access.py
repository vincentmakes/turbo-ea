"""Shared plumbing for published, account-less resources.

Two things in the product are reachable without an app session: **web portals**
(a filtered card catalogue at ``/portal/{slug}``) and **published diagrams** (a
read-only render at ``/embed/diagram/{slug}``, added for the Confluence-embed
case in discussion #905). Both offer the same two access modes — ``public``
(anyone with the link) and ``sso`` (the visitor authenticates against the org
IdP for an ephemeral session that creates **no** ``users`` row) — and both gate
on an optional email-domain allowlist.

That shared surface lives here rather than being copied per resource, because
it is exactly the code where a divergence becomes a security bug: the email
claim must come from the *signature-verified* token and never from client
input, an explicit ``email_verified: false`` must be rejected, Google's hosted
domain must be enforced, and the allowlist must be applied to the verified
address. One implementation, used by both.

The session cookie itself is minted by ``create_portal_token`` and carries a
``res`` discriminator so a grant for one resource kind can never satisfy
another's check (see ``portal_token_matches``).
"""

from __future__ import annotations

import logging

from fastapi import HTTPException, Response
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.services import sso_service

logger = logging.getLogger(__name__)

# One cookie name for every published resource. Collisions between two
# resources are prevented by the per-resource cookie *path*, not the name, so a
# visitor can hold sessions for several published resources at once.
PUBLIC_ACCESS_COOKIE = "portal_access"


def set_access_cookie(response: Response, token: str, *, path: str, secure: bool) -> None:
    """Set the httpOnly session cookie for one published resource.

    - httponly: not readable from JS
    - samesite "lax": set on the same-origin SPA POST to the callback
    - secure: HTTPS only (auto-detected from the request)
    - path: scoped to this one resource's public endpoints, so the browser
      never sends a diagram's grant to a portal (or to the rest of the API)
    """
    response.set_cookie(
        key=PUBLIC_ACCESS_COOKIE,
        value=token,
        httponly=True,
        samesite="lax",
        secure=secure,
        path=path,
        max_age=settings.PORTAL_TOKEN_EXPIRE_MINUTES * 60,
    )


def clear_access_cookie(response: Response, *, path: str) -> None:
    """Drop a resource's session cookie (used when a resource is unpublished)."""
    response.delete_cookie(key=PUBLIC_ACCESS_COOKIE, path=path)


async def build_sso_gate_config(db: AsyncSession, *, context: str) -> dict | None:
    """Return the config a public page needs to start the IdP redirect.

    ``None`` when SSO is disabled or misconfigured — the caller omits it and the
    frontend shows an "SSO unavailable" message rather than a broken button. A
    misconfigured IdP must never surface as a 500 on a public page.
    """
    sso = await sso_service.get_sso_config(db)
    if not sso.get("enabled"):
        return None
    try:
        cfg = sso_service.get_provider_config(sso)
        auth_endpoint = cfg["authorization_endpoint"]
        if cfg.get("discovery_required"):
            discovery = await sso_service.discover_oidc(sso.get("issuer_url", ""))
            auth_endpoint = discovery["authorization_endpoint"]
        provider = sso.get("provider", "microsoft")
        out = {
            "provider": provider,
            "provider_name": sso_service.PROVIDER_LABELS.get(provider, provider),
            "client_id": sso.get("client_id", ""),
            "authorization_endpoint": auth_endpoint,
            "scopes": cfg["scopes"],
        }
        if cfg.get("extra_auth_params"):
            out["extra_auth_params"] = cfg["extra_auth_params"]
        return out
    except Exception:
        logger.exception("Failed to build SSO gate config for %s", context)
        return None


async def resolve_sso_visitor_email(
    db: AsyncSession,
    *,
    code: str,
    redirect_uri: str,
    allowed_email_domains: list[str] | None,
    denied_message: str,
) -> str:
    """Exchange an SSO authorization code for a verified visitor email.

    Every check here derives from the **signature-verified** id_token, never
    from client input. Raises the appropriate HTTPException on any failure;
    returns the lowercased email on success. Creates no user account.
    """
    claims, sso, provider = await sso_service.exchange_code_for_claims(db, code, redirect_uri)

    email = (claims.get("email") or claims.get("preferred_username") or "").lower().strip()
    if not email:
        raise HTTPException(401, "No email claim in SSO token. Ensure email scope is granted.")
    # Reject only an explicit false — many providers omit the claim entirely.
    if claims.get("email_verified") is False:
        raise HTTPException(403, "Your email address is not verified with the identity provider.")

    # Google hosted-domain enforcement (mirrors the login callback).
    if provider == "google" and sso.get("domain") and claims.get("hd", "") != sso["domain"]:
        raise HTTPException(403, f"Sign-in restricted to {sso['domain']} accounts.")

    # Per-resource email-domain allowlist. Empty ⇒ any user the IdP authenticates.
    domains = allowed_email_domains or []
    if domains:
        allowed = {d.lower().strip() for d in domains if d}
        if email.split("@")[-1] not in allowed:
            raise HTTPException(403, denied_message)

    return email


def normalise_access_mode(mode: str | None) -> str:
    """Coerce an access mode to one of the two supported values."""
    return "sso" if (mode or "public") == "sso" else "public"


def normalise_email_domains(domains: list[str] | None) -> list[str] | None:
    """Lowercase + de-blank an email-domain allowlist. Empty list ⇒ None."""
    if not domains:
        return None
    cleaned = sorted({d.lower().strip().lstrip("@") for d in domains if d and d.strip()})
    return cleaned or None
