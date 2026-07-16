from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone

import bcrypt
import jwt

from app.config import settings

ALGORITHM = "HS256"

# Portal-session tokens use a DISTINCT issuer/audience from user session tokens
# (``turbo-ea``) so the two token families can never cross-validate: a portal
# token is rejected by ``decode_access_token`` (wrong aud/iss and no user
# ``sub``), and a user session token is rejected by ``decode_portal_token``.
PORTAL_ISS = "turbo-ea-portal"
PORTAL_AUD = "turbo-ea-portal"


def create_access_token(
    user_id: uuid.UUID,
    role: str = "member",
    *,
    impersonated_role: str | None = None,
) -> str:
    now = datetime.now(timezone.utc)
    payload: dict = {
        "sub": str(user_id),
        "role": role,
        "iat": now,
        "exp": now + timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES),
        "iss": "turbo-ea",
        "aud": "turbo-ea",
    }
    if impersonated_role:
        payload["impersonated_role"] = impersonated_role
    return jwt.encode(payload, settings.SECRET_KEY, algorithm=ALGORITHM)


def decode_access_token(token: str) -> dict | None:
    try:
        return jwt.decode(
            token,
            settings.SECRET_KEY,
            algorithms=[ALGORITHM],
            issuer="turbo-ea",
            audience="turbo-ea",
        )
    except jwt.PyJWTError:
        return None


def create_portal_token(portal_id: uuid.UUID, slug: str, email: str | None = None) -> str:
    """Mint a short-lived, portal-scoped session token.

    This is NOT a user account token — it carries no user ``sub`` and a distinct
    issuer/audience, so it can never be resolved to a ``users`` row by
    ``get_current_user``. ``psid`` binds the token to a single portal.
    """
    now = datetime.now(timezone.utc)
    payload: dict = {
        "typ": "portal",
        "psid": str(portal_id),
        "slug": slug,
        "email": email,
        "iat": now,
        "exp": now + timedelta(minutes=settings.PORTAL_TOKEN_EXPIRE_MINUTES),
        "iss": PORTAL_ISS,
        "aud": PORTAL_AUD,
    }
    return jwt.encode(payload, settings.SECRET_KEY, algorithm=ALGORITHM)


def decode_portal_token(token: str) -> dict | None:
    """Verify a portal-session token. Returns None on any failure."""
    try:
        return jwt.decode(
            token,
            settings.SECRET_KEY,
            algorithms=[ALGORITHM],
            issuer=PORTAL_ISS,
            audience=PORTAL_AUD,
        )
    except jwt.PyJWTError:
        return None


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()


def verify_password(password: str, hashed: str) -> bool:
    return bcrypt.checkpw(password.encode(), hashed.encode())
