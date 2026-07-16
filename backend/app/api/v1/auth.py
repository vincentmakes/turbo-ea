from __future__ import annotations

import logging
import secrets
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel
from sqlalchemy import delete, func, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.config import settings
from app.core.rate_limit import limiter
from app.core.security import create_access_token, hash_password, verify_password
from app.database import get_db
from app.models.sso_invitation import SsoInvitation
from app.models.user import User
from app.schemas.auth import (
    ImpersonateRequest,
    LoginRequest,
    RegisterRequest,
    TokenResponse,
    UserResponse,
)
from app.services import email_service, sso_service

# SSO / OIDC machinery lives in ``app.services.sso_service`` so more than one
# route module can reuse it (user login here, SSO-gated portals in
# ``web_portals``). The underscore-aliased re-exports keep this module's route
# bodies — and ``app.api.v1.users`` which imports ``_get_sso_config`` — working
# unchanged.
from app.services.sso_service import PROVIDER_LABELS
from app.services.sso_service import discover_oidc as _discover_oidc
from app.services.sso_service import get_general_settings as _get_general_settings
from app.services.sso_service import get_provider_config as _get_provider_config

router = APIRouter(prefix="/auth", tags=["auth"])
logger = logging.getLogger(__name__)

AUTH_COOKIE = "access_token"


def _is_secure_request(request: Request) -> bool:
    """Detect whether the original client connection used HTTPS.

    Checks X-Forwarded-Proto (set by reverse proxies / TLS terminators)
    and falls back to the request URL scheme. This avoids hardcoding
    Secure=True for 'production' environments that run behind plain HTTP
    (e.g. local-network deployments without TLS).
    """
    forwarded_proto = request.headers.get("x-forwarded-proto", "")
    return forwarded_proto == "https" or request.url.scheme == "https"


def _set_auth_cookie(response: Response, token: str, *, secure: bool) -> None:
    """Set an httpOnly cookie carrying the JWT.

    - httponly: prevents JS from reading the token (XSS-safe)
    - samesite "lax": sent on same-site navigations, blocked cross-site
    - secure: only over HTTPS (auto-detected from the request)
    - path restricted to /api so the cookie isn't sent for static assets
    """
    response.set_cookie(
        key=AUTH_COOKIE,
        value=token,
        httponly=True,
        samesite="lax",
        secure=secure,
        path="/api",
        max_age=settings.ACCESS_TOKEN_EXPIRE_MINUTES * 60,
    )


def _clear_auth_cookie(response: Response, *, secure: bool) -> None:
    """Delete the auth cookie."""
    response.delete_cookie(
        key=AUTH_COOKIE,
        httponly=True,
        samesite="lax",
        secure=secure,
        path="/api",
    )


# ---------------------------------------------------------------------------
# Standard auth endpoints
# ---------------------------------------------------------------------------


async def _default_role_key(db: AsyncSession) -> str:
    """Return the admin-configured default role key, falling back to "member".

    Prefers a non-archived role flagged ``is_default``. Mirrors the lookup the
    roles admin UI writes via ``PATCH /roles/{key}`` (see ``api/v1/roles.py``),
    which enforces at most one default role, so ``.first()`` is safe.
    """
    from app.models.role import Role

    result = await db.execute(
        select(Role).where(
            Role.is_default == True,  # noqa: E712
            Role.is_archived == False,  # noqa: E712
        )
    )
    role = result.scalars().first()
    return role.key if role else "member"


@router.post("/register", response_model=TokenResponse)
@limiter.limit("5/minute")
async def register(
    request: Request,
    response: Response,
    body: RegisterRequest,
    db: AsyncSession = Depends(get_db),
):
    general = await _get_general_settings(db)

    # ── M1: Use advisory lock to prevent race condition on first-user admin ──
    await db.execute(text("SELECT pg_advisory_xact_lock(1)"))
    count_result = await db.execute(select(func.count(User.id)))
    user_count = count_result.scalar()
    is_first_user = user_count == 0
    role = "admin" if is_first_user else await _default_role_key(db)

    # Always allow first-user bootstrap registration
    if not is_first_user:
        # Block registration when SSO is enabled
        sso_config = general.get("sso", {})
        if sso_config.get("enabled"):
            raise HTTPException(
                403, "Registration is disabled when SSO is enabled. Sign in via SSO."
            )

        # Block registration when admin has disabled self-registration
        if not general.get("registrationEnabled", True):
            raise HTTPException(403, "Self-registration is disabled. Contact an administrator.")

    existing = await db.execute(select(User).where(User.email == body.email))
    if existing.scalar_one_or_none():
        raise HTTPException(400, "Email already registered")

    user = User(
        email=body.email,
        display_name=body.display_name,
        password_hash=hash_password(body.password),
        role=role,
        auth_provider="local",
    )
    db.add(user)
    await db.commit()
    await db.refresh(user)
    token = create_access_token(user.id, user.role)
    _set_auth_cookie(response, token, secure=_is_secure_request(request))
    return TokenResponse(access_token=token)


@router.post("/login", response_model=TokenResponse)
@limiter.limit("10/minute")
async def login(
    request: Request,
    response: Response,
    body: LoginRequest,
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(User).where(User.email == body.email))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(401, "Invalid credentials")
    # Block password login for SSO-only users
    if user.auth_provider == "sso":
        raise HTTPException(403, "This account uses SSO authentication. Please sign in via SSO.")
    if not user.password_hash:
        # Local account with no password — shouldn't happen for new accounts (password
        # is mandatory at creation when SSO is disabled) but legacy data can have it.
        # Don't leak any detail beyond the standard 401 response.
        raise HTTPException(401, "Invalid credentials")

    # ── M5: Account lockout check ──
    if user.locked_until and user.locked_until > datetime.now(timezone.utc):
        raise HTTPException(423, "Account temporarily locked. Try again later.")

    if not verify_password(body.password, user.password_hash):
        user.failed_login_attempts = (user.failed_login_attempts or 0) + 1
        if user.failed_login_attempts >= 5:
            user.locked_until = datetime.now(timezone.utc) + timedelta(minutes=15)
            logger.warning("Account locked due to repeated failed logins: %s", user.email)
        await db.commit()
        raise HTTPException(401, "Invalid credentials")

    if not user.is_active:
        raise HTTPException(403, "Account disabled")

    # Reset failed attempts on successful login
    user.failed_login_attempts = 0
    user.locked_until = None
    first_login = user.last_login is None
    user.last_login = datetime.now(timezone.utc)
    # First login = invitation consumed. Drop any matching SsoInvitation so
    # the row disappears from the Pending Invitations admin list (#539).
    # Idempotent for subsequent logins — deletes nothing.
    if first_login:
        await db.execute(delete(SsoInvitation).where(SsoInvitation.email == user.email))
    await db.commit()

    token = create_access_token(user.id, user.role)
    _set_auth_cookie(response, token, secure=_is_secure_request(request))
    return TokenResponse(access_token=token)


@router.get("/me", response_model=UserResponse)
async def me(
    request: Request,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    from app.models.user import DEFAULT_UI_PREFERENCES
    from app.services.permission_service import PermissionService

    # Detect an active role-impersonation session from the JWT. We could
    # read the contextvar, but the middleware already set it from the same
    # token we'd decode here — the explicit decode keeps this endpoint
    # self-contained and easy to test.
    impersonated_role_key: str | None = None
    raw_auth = request.headers.get("Authorization", "")
    raw_token = (
        raw_auth[7:] if raw_auth.startswith("Bearer ") else request.cookies.get("access_token", "")
    )
    if raw_token:
        from app.core.security import decode_access_token

        payload = decode_access_token(raw_token)
        if payload:
            impersonated_role_key = payload.get("impersonated_role")

    # Effective role drives label / color / permissions so the entire
    # frontend behaves as that role after the impersonator hits "View as".
    effective_role_key = impersonated_role_key or user.role
    role_data = await PermissionService.load_role(db, effective_role_key)
    impersonated_role_label: str | None = None
    if impersonated_role_key:
        impersonated_role_label = role_data["label"] if role_data else impersonated_role_key

    return UserResponse(
        id=str(user.id),
        email=user.email,
        display_name=user.display_name,
        role=effective_role_key,
        role_label=role_data["label"] if role_data else effective_role_key,
        role_color=role_data["color"] if role_data else "#757575",
        is_active=user.is_active,
        locale=user.locale or "en",
        permissions=role_data["permissions"] if role_data else {},
        ui_preferences=user.ui_preferences or DEFAULT_UI_PREFERENCES,
        impersonated_role=impersonated_role_key,
        impersonated_role_label=impersonated_role_label,
    )


@router.post("/impersonate", response_model=TokenResponse)
async def impersonate_role(
    body: ImpersonateRequest,
    request: Request,
    response: Response,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Start a role-impersonation session.

    Requires ``admin.impersonate``. Issues a fresh JWT carrying an
    ``impersonated_role`` claim — the rest of the request lifecycle
    (PermissionService, audit fan-out) honours it. The real ``user.role``
    column is never modified; impersonation lives entirely in the token.
    """
    from app.models.role import Role
    from app.services.permission_service import PermissionService

    await PermissionService.require_permission(db, user, "admin.impersonate")

    target = body.role.strip()
    if not target:
        raise HTTPException(400, "role is required")
    if target == "admin":
        # No value to "impersonate admin" — an admin already has the
        # wildcard. Hard-reject so any future custom role keyed "admin"
        # doesn't accidentally become an impersonation target either.
        raise HTTPException(400, "Cannot impersonate the admin role")
    if target == user.role:
        raise HTTPException(400, "Already acting as this role")

    role_result = await db.execute(select(Role).where(Role.key == target))
    role = role_result.scalar_one_or_none()
    if role is None:
        raise HTTPException(404, "Role not found")
    if role.is_archived:
        raise HTTPException(400, "Role is archived")

    token = create_access_token(user.id, user.role, impersonated_role=target)
    _set_auth_cookie(response, token, secure=_is_secure_request(request))
    return TokenResponse(access_token=token)


@router.post("/stop-impersonating", response_model=TokenResponse)
async def stop_impersonating(
    request: Request,
    response: Response,
    user: User = Depends(get_current_user),
):
    """End a role-impersonation session.

    Reads the current JWT; if there's no active impersonation, returns
    400 to flag the misuse (caller has stale UI state). Issues a fresh
    JWT without the claim so all subsequent checks revert to the user's
    real role.
    """
    from app.core.security import decode_access_token

    raw_auth = request.headers.get("Authorization", "")
    raw_token = (
        raw_auth[7:] if raw_auth.startswith("Bearer ") else request.cookies.get("access_token", "")
    )
    payload = decode_access_token(raw_token) if raw_token else None
    if not payload or not payload.get("impersonated_role"):
        raise HTTPException(400, "No active impersonation session")
    token = create_access_token(user.id, user.role)
    _set_auth_cookie(response, token, secure=_is_secure_request(request))
    return TokenResponse(access_token=token)


# ── H3: Token refresh endpoint ──
@router.post("/refresh", response_model=TokenResponse)
async def refresh_token(
    request: Request,
    response: Response,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Issue a new short-lived access token. Re-reads role and active status from DB."""
    if not user.is_active:
        raise HTTPException(403, "Account disabled")
    token = create_access_token(user.id, user.role)
    _set_auth_cookie(response, token, secure=_is_secure_request(request))
    return TokenResponse(access_token=token)


# ---------------------------------------------------------------------------
# SSO / Entra ID endpoints
# ---------------------------------------------------------------------------


@router.get("/sso/config")
async def sso_config_endpoint(db: AsyncSession = Depends(get_db)):
    """Public endpoint — returns SSO configuration needed by the frontend to
    build the authorization URL. No secrets are exposed.
    Also includes registration_enabled so the login page knows whether to
    show the Register tab."""
    general = await _get_general_settings(db)
    registration_enabled = general.get("registrationEnabled", True)

    sso = general.get("sso", {})
    if not sso.get("enabled"):
        return {"enabled": False, "registration_enabled": registration_enabled}

    provider = sso.get("provider", "microsoft")
    client_id = sso.get("client_id", "")

    try:
        provider_cfg = _get_provider_config(sso)
    except ValueError as exc:
        logger.error("SSO provider config error: %s", exc)
        return {"enabled": False, "registration_enabled": registration_enabled}

    auth_endpoint = provider_cfg["authorization_endpoint"]

    # For Generic OIDC, fetch discovery document to get the authorization endpoint
    if provider_cfg.get("discovery_required"):
        issuer_url = sso.get("issuer_url", "")
        discovery_url = f"{issuer_url.rstrip('/')}/.well-known/openid-configuration"
        try:
            discovery = await _discover_oidc(issuer_url)
            auth_endpoint = discovery["authorization_endpoint"]
        except Exception:
            logger.exception(
                "Failed to fetch OIDC discovery document from %s. "
                "Ensure the backend container can reach this URL, or configure "
                "manual endpoints (authorization_endpoint, token_endpoint, jwks_uri) "
                "in SSO settings.",
                discovery_url,
            )
            return {"enabled": False, "registration_enabled": registration_enabled}

    # Detect whether any *active* local (non-SSO) account exists. When every
    # usable account is SSO-based the login page hides the email/password form
    # entirely — no one could use it (password login is rejected for SSO users,
    # and disabled accounts can't log in at all). A single active local/invited
    # account keeps the form so they can sign in or set their password.
    local_count = await db.execute(
        select(func.count(User.id)).where(
            User.auth_provider != "sso",
            User.is_active.is_(True),
        )
    )
    local_login_available = (local_count.scalar() or 0) > 0

    result = {
        "enabled": True,
        "provider": provider,
        "provider_name": PROVIDER_LABELS.get(provider, provider),
        "client_id": client_id,
        "authorization_endpoint": auth_endpoint,
        "scopes": provider_cfg["scopes"],
        "registration_enabled": registration_enabled,
        "local_login_available": local_login_available,
    }

    # Include extra auth params (e.g. Google hd parameter)
    if provider_cfg.get("extra_auth_params"):
        result["extra_auth_params"] = provider_cfg["extra_auth_params"]

    return result


class SsoCallbackRequest(BaseModel):
    code: str
    redirect_uri: str


@router.post("/sso/callback", response_model=TokenResponse)
@limiter.limit("20/minute")
async def sso_callback(
    request: Request,
    response: Response,
    body: SsoCallbackRequest,
    db: AsyncSession = Depends(get_db),
):
    """Exchange an authorization code from an SSO provider for a Turbo EA JWT."""
    claims, sso, provider = await sso_service.exchange_code_for_claims(
        db, body.code, body.redirect_uri
    )

    # Microsoft carries the stable object id in "oid"; every other provider
    # uses "sub" (mirrors provider_cfg["subject_claim"]).
    subject_claim = "oid" if provider == "microsoft" else "sub"

    # Extract user info from claims (provider-aware)
    sso_subject_id = claims.get(subject_claim) or claims.get("sub")
    email = claims.get("email") or claims.get("preferred_username", "")
    display_name = claims.get("name", "")

    # Google: validate hosted domain if configured
    if provider == "google" and sso.get("domain"):
        token_hd = claims.get("hd", "")
        if token_hd != sso["domain"]:
            raise HTTPException(
                403,
                f"Sign-in restricted to {sso['domain']} accounts.",
            )

    if not email:
        raise HTTPException(401, "No email claim in SSO token. Ensure email scope is granted.")
    if not sso_subject_id:
        raise HTTPException(401, "No subject identifier found in SSO token.")

    email = email.lower().strip()

    # Check if a user with this SSO subject ID already exists
    result = await db.execute(select(User).where(User.sso_subject_id == sso_subject_id))
    user = result.scalar_one_or_none()

    if user:
        # Existing SSO user — just return a token
        if not user.is_active:
            raise HTTPException(403, "Account disabled")
        tk = create_access_token(user.id, user.role)
        _set_auth_cookie(response, tk, secure=_is_secure_request(request))
        return TokenResponse(access_token=tk)

    # ── M11: Don't auto-merge local accounts with SSO ──
    result = await db.execute(select(User).where(User.email == email))
    user = result.scalar_one_or_none()

    if user:
        if user.auth_provider == "local":
            raise HTTPException(
                409,
                "A local account with this email already exists. "
                "Contact an administrator to link your SSO account.",
            )
        # Already an SSO user with a different subject ID — link
        user.sso_subject_id = sso_subject_id
        if display_name and not user.display_name:
            user.display_name = display_name
        user.password_setup_token = None
        user.last_login = datetime.now(timezone.utc)
        # The user has now accepted the invite via SSO; clear any pending
        # SsoInvitation row for this email (#539).
        await db.execute(delete(SsoInvitation).where(SsoInvitation.email == email))
        await db.commit()
        if not user.is_active:
            raise HTTPException(403, "Account disabled")
        tk = create_access_token(user.id, user.role)
        _set_auth_cookie(response, tk, secure=_is_secure_request(request))
        return TokenResponse(access_token=tk)

    # New user — check for an invitation to determine the role
    role = await _default_role_key(db)  # admin-configured default for new SSO users
    inv_result = await db.execute(select(SsoInvitation).where(SsoInvitation.email == email))
    invitation = inv_result.scalar_one_or_none()
    if invitation:
        role = invitation.role
        # Remove the invitation after use
        await db.delete(invitation)

    # Create new user
    user = User(
        email=email,
        display_name=display_name or email.split("@")[0],
        password_hash=None,
        role=role,
        auth_provider="sso",
        sso_subject_id=sso_subject_id,
        last_login=datetime.now(timezone.utc),
    )
    db.add(user)
    await db.commit()
    await db.refresh(user)

    tk = create_access_token(user.id, user.role)
    _set_auth_cookie(response, tk, secure=_is_secure_request(request))
    return TokenResponse(access_token=tk)


# ---------------------------------------------------------------------------
# Password setup endpoints (for invited users without a password)
# ---------------------------------------------------------------------------


class SetPasswordRequest(BaseModel):
    token: str
    password: str


@router.get("/validate-setup-token")
async def validate_setup_token(token: str, db: AsyncSession = Depends(get_db)):
    """Check if a password-setup token is valid. Returns the user's email."""
    result = await db.execute(select(User).where(User.password_setup_token == token))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(404, "Invalid or expired setup token")
    return {"email": user.email, "display_name": user.display_name}


@router.post("/set-password", response_model=TokenResponse)
async def set_password(
    request: Request,
    response: Response,
    body: SetPasswordRequest,
    db: AsyncSession = Depends(get_db),
):
    """Set a password for an invited user using a one-time setup token."""
    from app.schemas.auth import _validate_password_strength

    try:
        _validate_password_strength(body.password)
    except ValueError:
        raise HTTPException(
            400,
            "Password does not meet strength requirements: "
            "minimum 10 characters, at least one uppercase letter, "
            "and at least one digit.",
        )

    result = await db.execute(select(User).where(User.password_setup_token == body.token))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(404, "Invalid or expired setup token")

    user.password_hash = hash_password(body.password)
    user.password_setup_token = None
    if user.auth_provider != "sso":
        user.auth_provider = "local"
    # The user has now accepted the invite (set-password effectively logs them
    # in by returning a token). Mark last_login so they no longer count as
    # «pending» in the admin invitations list, and drop the SsoInvitation
    # row for tidiness (#539).
    user.last_login = datetime.now(timezone.utc)
    await db.execute(delete(SsoInvitation).where(SsoInvitation.email == user.email))
    await db.commit()

    token = create_access_token(user.id, user.role)
    _set_auth_cookie(response, token, secure=_is_secure_request(request))
    return TokenResponse(access_token=token)


@router.post("/logout")
async def logout(request: Request, response: Response):
    """Clear the auth cookie."""
    _clear_auth_cookie(response, secure=_is_secure_request(request))
    return {"ok": True}


def generate_setup_token() -> str:
    """Generate a cryptographically secure setup token."""
    return secrets.token_urlsafe(48)


# ---------------------------------------------------------------------------
# Password reset (forgot password) endpoints — local accounts only
# ---------------------------------------------------------------------------


class ForgotPasswordRequest(BaseModel):
    email: str


class ResetPasswordRequest(BaseModel):
    token: str
    password: str


PASSWORD_RESET_TTL = timedelta(hours=1)


def _build_reset_email_body(display_name: str, app_title: str, reset_url: str) -> tuple[str, str]:
    """Return (html, plain_text) email body for the reset link.

    Mirrors the visual style of `send_notification_email` but with a fixed
    template — we keep it inline so the reset flow doesn't depend on the
    notification helper (which carries a generic "view in app" CTA).
    """
    import html as _html

    safe_name = _html.escape(display_name or "")
    safe_app = _html.escape(app_title)
    safe_link = _html.escape(reset_url)

    intro = f"Hi {safe_name}," if safe_name else "Hi,"
    wrapper = "font-family: sans-serif; max-width: 600px; margin: 0 auto"
    header_s = "background: #1a1a2e; padding: 16px 24px"
    body_s = "padding: 24px; border: 1px solid #e0e0e0"
    btn = (
        f"<a href='{safe_link}' style='display: inline-block; margin-top: 12px; "
        "padding: 10px 18px; background: #1976d2; color: white; "
        "text-decoration: none; border-radius: 4px;'>Reset password</a>"
    )
    body_html = (
        f'<div style="{wrapper}">'
        f'<div style="{header_s}">'
        f'<h2 style="color:#64b5f6;margin:0">{safe_app}</h2></div>'
        f'<div style="{body_s}">'
        f'<p style="color:#333">{intro}</p>'
        '<p style="color:#555">We received a request to reset the password for your '
        f"{safe_app} account. Click the button below to choose a new password. "
        "This link is valid for one hour.</p>"
        f"{btn}"
        '<p style="color:#777;font-size:12px;margin-top:24px">'
        "If you didn't request a password reset, you can safely ignore this email — "
        "your password will not change.</p>"
        "</div></div>"
    )
    body_text = (
        f"{intro}\n\n"
        f"We received a request to reset the password for your {app_title} account.\n"
        f"Open the link below to choose a new password (valid for one hour):\n\n"
        f"{reset_url}\n\n"
        "If you didn't request a password reset, you can safely ignore this email."
    )
    return body_html, body_text


def _build_setup_email_body(display_name: str, app_title: str, setup_url: str) -> tuple[str, str]:
    """Return (html, plain_text) email body for a password-setup link.

    Used when «Forgot password» is triggered for a local account that was
    created without a password (it has a setup token but no hash). Mirrors
    the reset email's styling but frames the action as first-time setup and
    omits the one-hour-expiry wording — setup tokens don't expire.
    """
    import html as _html

    safe_name = _html.escape(display_name or "")
    safe_app = _html.escape(app_title)
    safe_link = _html.escape(setup_url)

    intro = f"Hi {safe_name}," if safe_name else "Hi,"
    wrapper = "font-family: sans-serif; max-width: 600px; margin: 0 auto"
    header_s = "background: #1a1a2e; padding: 16px 24px"
    body_s = "padding: 24px; border: 1px solid #e0e0e0"
    btn = (
        f"<a href='{safe_link}' style='display: inline-block; margin-top: 12px; "
        "padding: 10px 18px; background: #1976d2; color: white; "
        "text-decoration: none; border-radius: 4px;'>Set password</a>"
    )
    body_html = (
        f'<div style="{wrapper}">'
        f'<div style="{header_s}">'
        f'<h2 style="color:#64b5f6;margin:0">{safe_app}</h2></div>'
        f'<div style="{body_s}">'
        f'<p style="color:#333">{intro}</p>'
        f'<p style="color:#555">Your {safe_app} account is ready. '
        "Click the button below to set your password and sign in.</p>"
        f"{btn}"
        '<p style="color:#777;font-size:12px;margin-top:24px">'
        "If you didn't expect this email, you can safely ignore it.</p>"
        "</div></div>"
    )
    body_text = (
        f"{intro}\n\n"
        f"Your {app_title} account is ready.\n"
        f"Open the link below to set your password and sign in:\n\n"
        f"{setup_url}\n\n"
        "If you didn't expect this email, you can safely ignore it."
    )
    return body_html, body_text


def _resolve_app_base_url(request: Request) -> str:
    """Resolve the public base URL for emailed links.

    Priority:
    1. Admin-configured `app_base_url` (general / email settings push it onto
       `app_config._app_base_url`).
    2. The current request's base URL (works for direct deployments).
    """
    explicit = getattr(settings, "_app_base_url", "") or ""
    if explicit:
        return explicit.rstrip("/")
    return str(request.base_url).rstrip("/")


@router.post("/forgot-password")
@limiter.limit("5/minute")
async def forgot_password(
    request: Request,
    body: ForgotPasswordRequest,
    db: AsyncSession = Depends(get_db),
):
    """Initiate a password reset — or first-time password setup — for a local account.

    Anti-enumeration: always returns `{"ok": True}` regardless of whether the
    email matches a user. An email is only sent for an active local account when
    SMTP is configured, and its shape depends on the account's state:

    - The account already has a password → a one-hour **reset** link.
    - The account has no password but a setup token (created without a
      password, e.g. via a stakeholder invite left un-emailed) → a **set-password**
      link so the user can self-serve on first login. A missing setup token is
      minted here so the account is never permanently locked out.

    SSO-only accounts (no password, marked `auth_provider="sso"`) get nothing.
    """
    raw_email = (body.email or "").strip().lower()
    if not raw_email:
        # Treat missing email same as unknown — anti-enumeration.
        return {"ok": True}

    result = await db.execute(select(User).where(User.email == raw_email))
    user = result.scalar_one_or_none()

    if user is None or not user.is_active or not email_service._is_configured():
        return {"ok": True}

    base_url = _resolve_app_base_url(request)
    app_title = email_service._get_app_title()

    if user.password_hash is not None:
        # Existing local password → reset flow.
        token = secrets.token_urlsafe(32)
        user.password_reset_token = token
        user.password_reset_expires_at = datetime.now(timezone.utc) + PASSWORD_RESET_TTL
        await db.commit()

        reset_url = f"{base_url}/auth/reset-password?token={token}"
        body_html, body_text = _build_reset_email_body(user.display_name, app_title, reset_url)
        subject = f"[{app_title}] Reset your password"
    elif user.auth_provider != "sso":
        # Password-less local account → deliver a set-password link. Mint a
        # setup token if the row somehow lacks one so the user is never stuck.
        if not user.password_setup_token:
            user.password_setup_token = generate_setup_token()
            await db.commit()

        setup_url = f"{base_url}/auth/set-password?token={user.password_setup_token}"
        body_html, body_text = _build_setup_email_body(user.display_name, app_title, setup_url)
        subject = f"[{app_title}] Set your password"
    else:
        # SSO-only account — nothing to reset. Stay silent (anti-enumeration).
        return {"ok": True}

    try:
        await email_service.send_email(user.email, subject, body_html, body_text)
    except Exception:
        # Email delivery failure must not leak via response status —
        # the user still receives the generic success screen.
        logger.exception("Failed to send password email to %s", user.email)

    return {"ok": True}


@router.get("/validate-reset-token")
async def validate_reset_token(token: str, db: AsyncSession = Depends(get_db)):
    """Check whether a password-reset token is valid and unexpired."""
    if not token:
        raise HTTPException(404, "Invalid or expired reset token")
    result = await db.execute(select(User).where(User.password_reset_token == token))
    user = result.scalar_one_or_none()
    if not user or not user.password_reset_expires_at:
        raise HTTPException(404, "Invalid or expired reset token")
    if user.password_reset_expires_at < datetime.now(timezone.utc):
        raise HTTPException(404, "Invalid or expired reset token")
    return {"email": user.email}


@router.post("/reset-password")
@limiter.limit("5/minute")
async def reset_password(
    request: Request,
    body: ResetPasswordRequest,
    db: AsyncSession = Depends(get_db),
):
    """Consume a reset token and set a new password. Does NOT auto-log-in."""
    from app.schemas.auth import _validate_password_strength

    try:
        _validate_password_strength(body.password)
    except ValueError:
        raise HTTPException(
            400,
            "Password does not meet strength requirements: "
            "minimum 10 characters, at least one uppercase letter, "
            "and at least one digit.",
        )

    if not body.token:
        raise HTTPException(404, "Invalid or expired reset token")

    result = await db.execute(select(User).where(User.password_reset_token == body.token))
    user = result.scalar_one_or_none()
    if not user or not user.password_reset_expires_at:
        raise HTTPException(404, "Invalid or expired reset token")
    if user.password_reset_expires_at < datetime.now(timezone.utc):
        raise HTTPException(404, "Invalid or expired reset token")

    user.password_hash = hash_password(body.password)
    user.password_reset_token = None
    user.password_reset_expires_at = None
    # A successful reset clears any account lockout — the user proved
    # control of their inbox.
    user.failed_login_attempts = 0
    user.locked_until = None
    await db.commit()

    return {"ok": True}
