from __future__ import annotations

import logging
import secrets
from datetime import datetime, timedelta, timezone

import httpx
import jwt
from fastapi import APIRouter, Depends, HTTPException, Request
from jwt import PyJWKClient
from pydantic import BaseModel
from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.core.rate_limit import limiter
from app.core.security import create_access_token, hash_password, verify_password
from app.database import get_db
from app.models.app_settings import AppSettings
from app.models.sso_invitation import SsoInvitation
from app.models.user import User
from app.schemas.auth import LoginRequest, RegisterRequest, TokenResponse, UserResponse

router = APIRouter(prefix="/auth", tags=["auth"])
logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

async def _get_general_settings(db: AsyncSession) -> dict:
    """Read general_settings from app_settings."""
    result = await db.execute(select(AppSettings).where(AppSettings.id == "default"))
    row = result.scalar_one_or_none()
    return (row.general_settings if row else None) or {}


async def _get_sso_config(db: AsyncSession) -> dict:
    """Read SSO configuration from app_settings."""
    general = await _get_general_settings(db)
    return general.get("sso", {})


# ── C5: Verify Microsoft id_token signature via JWKS ──

_jwks_client: PyJWKClient | None = None


def _get_jwks_client(tenant: str) -> PyJWKClient:
    global _jwks_client
    jwks_url = f"https://login.microsoftonline.com/{tenant}/discovery/v2.0/keys"
    if _jwks_client is None:
        _jwks_client = PyJWKClient(jwks_url, cache_keys=True)
    return _jwks_client


def _verify_id_token(token: str, client_id: str, tenant: str) -> dict:
    jwks_client = _get_jwks_client(tenant)
    signing_key = jwks_client.get_signing_key_from_jwt(token)
    return jwt.decode(
        token,
        signing_key.key,
        algorithms=["RS256"],
        audience=client_id,
        issuer=f"https://login.microsoftonline.com/{tenant}/v2.0",
    )


# ---------------------------------------------------------------------------
# Standard auth endpoints
# ---------------------------------------------------------------------------

@router.post("/register", response_model=TokenResponse)
@limiter.limit("5/minute")
async def register(request: Request, body: RegisterRequest, db: AsyncSession = Depends(get_db)):
    general = await _get_general_settings(db)

    # ── M1: Use advisory lock to prevent race condition on first-user admin ──
    await db.execute(text("SELECT pg_advisory_xact_lock(1)"))
    count_result = await db.execute(select(func.count(User.id)))
    user_count = count_result.scalar()
    is_first_user = user_count == 0
    role = "admin" if is_first_user else "member"

    # Always allow first-user bootstrap registration
    if not is_first_user:
        # Block registration when SSO is enabled
        sso_config = general.get("sso", {})
        if sso_config.get("enabled"):
            raise HTTPException(
                403, "Registration is disabled when SSO is enabled. Sign in with Microsoft."
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
    return TokenResponse(access_token=create_access_token(user.id, user.role))


@router.post("/login", response_model=TokenResponse)
@limiter.limit("10/minute")
async def login(request: Request, body: LoginRequest, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(User).where(User.email == body.email))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(401, "Invalid credentials")
    # Block password login for SSO-only users
    if user.auth_provider == "sso":
        raise HTTPException(
            403, "This account uses SSO authentication. Please sign in with Microsoft."
        )
    if not user.password_hash:
        if user.password_setup_token:
            raise HTTPException(
                403,
                "Password not set yet. Check your email for the setup link.",
            )
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
    await db.commit()

    return TokenResponse(access_token=create_access_token(user.id, user.role))


@router.get("/me", response_model=UserResponse)
async def me(user: User = Depends(get_current_user)):
    return UserResponse(
        id=str(user.id),
        email=user.email,
        display_name=user.display_name,
        role=user.role,
        is_active=user.is_active,
    )


# ── H3: Token refresh endpoint ──
@router.post("/refresh", response_model=TokenResponse)
async def refresh_token(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Issue a new short-lived access token. Re-reads role and active status from DB."""
    if not user.is_active:
        raise HTTPException(403, "Account disabled")
    return TokenResponse(access_token=create_access_token(user.id, user.role))


# ---------------------------------------------------------------------------
# SSO / Entra ID endpoints
# ---------------------------------------------------------------------------

@router.get("/sso/config")
async def sso_config_endpoint(db: AsyncSession = Depends(get_db)):
    """Public endpoint — returns SSO configuration needed by the frontend to
    build the Microsoft authorization URL. No secrets are exposed.
    Also includes registration_enabled so the login page knows whether to
    show the Register tab."""
    general = await _get_general_settings(db)
    registration_enabled = general.get("registrationEnabled", True)

    sso = general.get("sso", {})
    if not sso.get("enabled"):
        return {"enabled": False, "registration_enabled": registration_enabled}

    tenant = sso.get("tenant_id", "organizations")
    client_id = sso.get("client_id", "")

    return {
        "enabled": True,
        "client_id": client_id,
        "tenant_id": tenant,
        "authorization_endpoint": (
            f"https://login.microsoftonline.com/{tenant}/oauth2/v2.0/authorize"
        ),
        "registration_enabled": registration_enabled,
    }


class SsoCallbackRequest(BaseModel):
    code: str
    redirect_uri: str


@router.post("/sso/callback", response_model=TokenResponse)
@limiter.limit("20/minute")
async def sso_callback(
    request: Request, body: SsoCallbackRequest, db: AsyncSession = Depends(get_db)
):
    """Exchange an authorization code from Microsoft Entra ID for a Turbo EA JWT."""
    sso = await _get_sso_config(db)
    if not sso.get("enabled"):
        raise HTTPException(400, "SSO is not enabled")

    client_id = sso.get("client_id", "")
    client_secret = sso.get("client_secret", "")
    tenant = sso.get("tenant_id", "organizations")

    if not client_id or not client_secret:
        raise HTTPException(500, "SSO is not properly configured")

    token_url = f"https://login.microsoftonline.com/{tenant}/oauth2/v2.0/token"

    # Exchange the authorization code for tokens
    async with httpx.AsyncClient() as client:
        token_response = await client.post(
            token_url,
            data={
                "grant_type": "authorization_code",
                "client_id": client_id,
                "client_secret": client_secret,
                "code": body.code,
                "redirect_uri": body.redirect_uri,
                "scope": "openid email profile",
            },
            headers={"Content-Type": "application/x-www-form-urlencoded"},
        )

    if token_response.status_code != 200:
        # ── H8: Don't leak error details to the client ──
        error_data = token_response.json() if token_response.headers.get(
            "content-type", ""
        ).startswith("application/json") else {}
        error_desc = error_data.get("error_description", "Token exchange failed")
        logger.error("SSO token exchange failed: %s", error_desc)
        raise HTTPException(401, "SSO authentication failed. Please try again.")

    tokens = token_response.json()
    id_token = tokens.get("id_token")
    if not id_token:
        raise HTTPException(401, "No id_token received from Microsoft")

    # ── C5: Verify the id_token signature ──
    try:
        claims = _verify_id_token(id_token, client_id, tenant)
    except Exception:
        logger.exception("Failed to verify SSO id_token")
        raise HTTPException(401, "Failed to verify SSO token")

    # Extract user info from claims
    sso_subject_id = claims.get("oid") or claims.get("sub")
    email = claims.get("email") or claims.get("preferred_username", "")
    display_name = claims.get("name", "")

    if not email:
        raise HTTPException(
            401, "No email claim in SSO token. Ensure email scope is granted."
        )
    if not sso_subject_id:
        raise HTTPException(401, "No subject identifier found in SSO token.")

    email = email.lower().strip()

    # Check if a user with this SSO subject ID already exists
    result = await db.execute(
        select(User).where(User.sso_subject_id == sso_subject_id)
    )
    user = result.scalar_one_or_none()

    if user:
        # Existing SSO user — just return a token
        if not user.is_active:
            raise HTTPException(403, "Account disabled")
        return TokenResponse(access_token=create_access_token(user.id, user.role))

    # ── M11: Don't auto-merge local accounts with SSO ──
    result = await db.execute(select(User).where(User.email == email))
    user = result.scalar_one_or_none()

    if user:
        if user.auth_provider == "local":
            raise HTTPException(
                409,
                "A local account with this email already exists. "
                "Contact an administrator to link your SSO account."
            )
        # Already an SSO user with a different subject ID — link
        user.sso_subject_id = sso_subject_id
        if display_name and not user.display_name:
            user.display_name = display_name
        user.password_setup_token = None
        await db.commit()
        if not user.is_active:
            raise HTTPException(403, "Account disabled")
        return TokenResponse(access_token=create_access_token(user.id, user.role))

    # New user — check for an invitation to determine the role
    role = "viewer"  # Default role for SSO users
    inv_result = await db.execute(
        select(SsoInvitation).where(SsoInvitation.email == email)
    )
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
    )
    db.add(user)
    await db.commit()
    await db.refresh(user)

    return TokenResponse(access_token=create_access_token(user.id, user.role))


# ---------------------------------------------------------------------------
# Password setup endpoints (for invited users without a password)
# ---------------------------------------------------------------------------

class SetPasswordRequest(BaseModel):
    token: str
    password: str


@router.get("/validate-setup-token")
async def validate_setup_token(token: str, db: AsyncSession = Depends(get_db)):
    """Check if a password-setup token is valid. Returns the user's email."""
    result = await db.execute(
        select(User).where(User.password_setup_token == token)
    )
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(404, "Invalid or expired setup token")
    return {"email": user.email, "display_name": user.display_name}


@router.post("/set-password", response_model=TokenResponse)
async def set_password(
    body: SetPasswordRequest, db: AsyncSession = Depends(get_db)
):
    """Set a password for an invited user using a one-time setup token."""
    from app.schemas.auth import _validate_password_strength

    try:
        _validate_password_strength(body.password)
    except ValueError as e:
        raise HTTPException(400, str(e)) from e

    result = await db.execute(
        select(User).where(User.password_setup_token == body.token)
    )
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(404, "Invalid or expired setup token")

    user.password_hash = hash_password(body.password)
    user.password_setup_token = None
    if user.auth_provider != "sso":
        user.auth_provider = "local"
    await db.commit()

    return TokenResponse(access_token=create_access_token(user.id, user.role))


def generate_setup_token() -> str:
    """Generate a cryptographically secure setup token."""
    return secrets.token_urlsafe(48)
