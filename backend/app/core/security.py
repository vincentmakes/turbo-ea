from __future__ import annotations

import hashlib
import hmac
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

# The MCP server proves it is this instance's own MCP server with a short-lived
# token signed by a key both sides derive from SECRET_KEY. A third issuer and
# audience again, and a derived key rather than SECRET_KEY itself, so nothing
# the MCP server signs can ever verify as a user session, and no user session
# verifies as the service. The context string is mirrored in
# ``mcp-server/turbo_ea_mcp/config.py`` (the two packages share no code); a
# known-answer test on each side keeps them from drifting.
MCP_SERVICE_ISS = "turbo-ea-mcp"
MCP_SERVICE_AUD = "turbo-ea-backend"
MCP_SERVICE_KEY_CONTEXT = b"turbo-ea-mcp/service-auth/v1"


def derive_key(context: bytes, secret: str | None = None) -> bytes:
    """A 32-byte key for one purpose, derived from the instance's SECRET_KEY.

    ``context`` names the purpose, so two purposes never share a key."""
    source = settings.SECRET_KEY if secret is None else secret
    return hmac.new(source.encode(), context, hashlib.sha256).digest()


def _sign(payload: dict) -> str:
    # Fenced rather than a trailing pragma: the reason would push the line past 100 columns.
    # pragma: no mutate start, HS256 is PyJWT's default too, so dropping the algorithm is equivalent
    return jwt.encode(payload, settings.SECRET_KEY, algorithm=ALGORITHM)
    # pragma: no mutate end


def create_access_token(
    user_id: uuid.UUID,
    role: str = "member",
    *,
    impersonated_role: str | None = None,
    expires: timedelta | None = None,
    mcp_session_id: uuid.UUID | None = None,
) -> str:
    """A user session token.

    ``mcp_session_id`` binds the token to one MCP connection (the ``msid``
    claim): ``get_current_user`` then accepts it only while that connection is
    live, so revoking the connection ends the token at once. ``expires``
    shortens the lifetime for such a token; the default is the instance's
    ``ACCESS_TOKEN_EXPIRE_MINUTES``."""
    now = datetime.now(timezone.utc)
    lifetime = expires or timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)
    payload: dict = {
        "sub": str(user_id),
        "role": role,
        "iat": now,
        "exp": now + lifetime,
        "iss": "turbo-ea",
        "aud": "turbo-ea",
    }
    if impersonated_role:
        payload["impersonated_role"] = impersonated_role
    if mcp_session_id is not None:
        payload["msid"] = str(mcp_session_id)
    return _sign(payload)


def verify_mcp_service_token(token: str) -> bool:
    """Whether ``token`` was signed by this instance's MCP server just now.

    The MCP server signs a token that lives a minute; an expired one, one with
    another issuer or audience, and one signed with any other key all fail."""
    if not token:
        return False
    try:
        jwt.decode(
            token,
            derive_key(MCP_SERVICE_KEY_CONTEXT),
            algorithms=[ALGORITHM],
            issuer=MCP_SERVICE_ISS,
            audience=MCP_SERVICE_AUD,
            options={"require": ["exp", "iat"]},
        )
    except jwt.PyJWTError:
        return False
    return True


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


def create_portal_token(
    portal_id: uuid.UUID,
    slug: str,
    email: str | None = None,
    resource: str = "portal",
) -> str:
    """Mint a short-lived session token for one published, account-less resource.

    This is NOT a user account token — it carries no user ``sub`` and a distinct
    issuer/audience, so it can never be resolved to a ``users`` row by
    ``get_current_user``. ``psid`` binds the token to a single resource.

    ``resource`` discriminates what kind of thing ``psid`` refers to (``portal``
    or ``diagram``). Both kinds are signed with the same key and issuer, so
    without it a cookie minted for a published *diagram* would satisfy a
    *portal*'s access check whenever the two ids happened to match — the
    discriminator is what keeps the two grants separate. ``typ`` and ``psid``
    keep their original names so cookies issued before this existed still
    validate (see ``portal_token_matches``).
    """
    now = datetime.now(timezone.utc)
    payload: dict = {
        "typ": "portal",
        "res": resource,
        "psid": str(portal_id),
        "slug": slug,
        "email": email,
        "iat": now,
        "exp": now + timedelta(minutes=settings.PORTAL_TOKEN_EXPIRE_MINUTES),
        "iss": PORTAL_ISS,
        "aud": PORTAL_AUD,
    }
    return _sign(payload)


def decode_portal_token(token: str) -> dict | None:
    """Verify a resource-session token. Returns None on any failure."""
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


def portal_token_matches(claims: dict | None, resource: str, resource_id: uuid.UUID) -> bool:
    """True when ``claims`` grant access to exactly this resource.

    A token minted for one resource kind must never unlock another, so the
    ``res`` claim has to match. Tokens issued before ``res`` existed carry no
    such claim and are treated as ``portal`` — that keeps live portal cookies
    working across the upgrade without ever letting a legacy token satisfy a
    diagram check.
    """
    if not claims or claims.get("typ") != "portal":
        return False
    if (claims.get("res") or "portal") != resource:
        return False
    return claims.get("psid") == str(resource_id)


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()


def verify_password(password: str, hashed: str) -> bool:
    return bcrypt.checkpw(password.encode(), hashed.encode())
