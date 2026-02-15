from __future__ import annotations

import json
import secrets
from base64 import urlsafe_b64decode

import httpx
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.core.security import create_access_token, hash_password, verify_password
from app.database import get_db
from app.models.app_settings import AppSettings
from app.models.sso_invitation import SsoInvitation
from app.models.user import User
from app.schemas.auth import LoginRequest, RegisterRequest, TokenResponse, UserResponse

router = APIRouter(prefix="/auth", tags=["auth"])


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

async def _get_sso_config(db: AsyncSession) -> dict:
    """Read SSO configuration from app_settings."""
    result = await db.execute(select(AppSettings).where(AppSettings.id == "default"))
    row = result.scalar_one_or_none()
    general = (row.general_settings if row else None) or {}
    return general.get("sso", {})


def _decode_jwt_payload(token: str) -> dict:
    """Decode the payload from a JWT without signature verification.
    Used for id_tokens received directly from Microsoft's token endpoint over TLS."""
    parts = token.split(".")
    if len(parts) != 3:
        raise ValueError("Invalid JWT structure")
    payload = parts[1]
    # Add padding
    padding = 4 - len(payload) % 4
    payload += "=" * padding
    return json.loads(urlsafe_b64decode(payload))


# ---------------------------------------------------------------------------
# Standard auth endpoints
# ---------------------------------------------------------------------------

@router.post("/register", response_model=TokenResponse)
async def register(body: RegisterRequest, db: AsyncSession = Depends(get_db)):
    # Block registration when SSO is enabled
    sso_config = await _get_sso_config(db)
    if sso_config.get("enabled"):
        raise HTTPException(
            403, "Registration is disabled when SSO is enabled. Sign in with Microsoft."
        )

    existing = await db.execute(select(User).where(User.email == body.email))
    if existing.scalar_one_or_none():
        raise HTTPException(400, "Email already registered")
    user = User(
        email=body.email,
        display_name=body.display_name,
        password_hash=hash_password(body.password),
        role="admin",  # first user gets admin
        auth_provider="local",
    )
    # Check if any users exist — first user is admin
    count = await db.execute(select(User).limit(1))
    if count.scalar_one_or_none() is not None:
        user.role = "member"
    db.add(user)
    await db.commit()
    await db.refresh(user)
    return TokenResponse(access_token=create_access_token(user.id, user.role))


@router.post("/login", response_model=TokenResponse)
async def login(body: LoginRequest, db: AsyncSession = Depends(get_db)):
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
    if not verify_password(body.password, user.password_hash):
        raise HTTPException(401, "Invalid credentials")
    if not user.is_active:
        raise HTTPException(403, "Account disabled")
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


# ---------------------------------------------------------------------------
# SSO / Entra ID endpoints
# ---------------------------------------------------------------------------

@router.get("/sso/config")
async def sso_config(db: AsyncSession = Depends(get_db)):
    """Public endpoint — returns SSO configuration needed by the frontend to
    build the Microsoft authorization URL. No secrets are exposed."""
    sso = await _get_sso_config(db)
    if not sso.get("enabled"):
        return {"enabled": False}

    tenant = sso.get("tenant_id", "organizations")
    client_id = sso.get("client_id", "")

    return {
        "enabled": True,
        "client_id": client_id,
        "tenant_id": tenant,
        "authorization_endpoint": (
            f"https://login.microsoftonline.com/{tenant}/oauth2/v2.0/authorize"
        ),
    }


class SsoCallbackRequest(BaseModel):
    code: str
    redirect_uri: str


@router.post("/sso/callback", response_model=TokenResponse)
async def sso_callback(body: SsoCallbackRequest, db: AsyncSession = Depends(get_db)):
    """Exchange an authorization code from Microsoft Entra ID for a Turbo EA JWT.

    Flow:
    1. Frontend redirects user to Microsoft's authorization endpoint
    2. Microsoft redirects back to the frontend with an authorization code
    3. Frontend sends the code + redirect_uri here
    4. We exchange the code at Microsoft's token endpoint for an id_token
    5. We extract user claims (email, name, oid) from the id_token
    6. We create or find the local user and return our JWT
    """
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
        error_data = token_response.json() if token_response.headers.get(
            "content-type", ""
        ).startswith("application/json") else {}
        error_desc = error_data.get("error_description", "Token exchange failed")
        raise HTTPException(401, f"SSO authentication failed: {error_desc}")

    tokens = token_response.json()
    id_token = tokens.get("id_token")
    if not id_token:
        raise HTTPException(401, "No id_token received from Microsoft")

    # Decode the id_token payload (trusted because received over TLS from Microsoft)
    try:
        claims = _decode_jwt_payload(id_token)
    except Exception:
        raise HTTPException(401, "Failed to decode id_token")

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

    # Check if a local user with the same email exists — merge/link account
    result = await db.execute(select(User).where(User.email == email))
    user = result.scalar_one_or_none()

    if user:
        # Link existing local account to SSO
        user.sso_subject_id = sso_subject_id
        # Keep password if set (user can still login with password)
        if not user.password_hash:
            user.auth_provider = "sso"
        if display_name and not user.display_name:
            user.display_name = display_name
        # Clear setup token if present (SSO login counts as activation)
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
    if len(body.password) < 6:
        raise HTTPException(400, "Password must be at least 6 characters")

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
