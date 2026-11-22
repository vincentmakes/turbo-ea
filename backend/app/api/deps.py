from __future__ import annotations

import uuid
from urllib.parse import urlsplit

from fastapi import Depends, HTTPException, Request
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.core.security import decode_access_token
from app.database import get_db
from app.models.user import User


def parse_uuid(value: str, *, detail: str = "Not found") -> uuid.UUID:
    """Parse a path-parameter id, mapping a malformed one to 404.

    Routes declare their id path params as ``str`` and parse them in the body,
    so an id that is not a valid UUID made ``uuid.UUID()`` raise an unhandled
    ``ValueError`` that surfaced as a 500. A syntactically invalid id names no
    resource, so 404 keeps every ``/{id}`` route's response uniform (and never
    confirms existence), matching ``require_card_readable``'s posture.
    """
    try:
        return uuid.UUID(value)
    except (ValueError, AttributeError, TypeError):
        raise HTTPException(status_code=404, detail=detail) from None


_SAFE_METHODS = {"GET", "HEAD", "OPTIONS"}


def _reject_foreign_origin(request: Request) -> None:
    """Refuse a cookie-authenticated write whose ``Origin`` is not this deployment's.

    SameSite=lax keeps the cookie off cross-site POSTs, but not off a write from
    a sibling site or subdomain. No ``Origin`` (a script or curl) passes; one
    that is in ``ALLOWED_ORIGINS`` or has this request's host passes. The host
    is compared without port: the edge nginx forwards ``$host``, which has none.
    """
    origin = request.headers.get("Origin")
    if request.method in _SAFE_METHODS or not origin:
        return
    if origin in settings.ALLOWED_ORIGINS:
        return
    host = urlsplit("//" + request.headers.get("Host", "")).hostname
    if host and urlsplit(origin).hostname == host:
        return
    raise HTTPException(status_code=403, detail="Cross-origin request refused")


async def get_current_user(request: Request, db: AsyncSession = Depends(get_db)) -> User:
    auth = request.headers.get("Authorization", "")
    if auth.startswith("Bearer "):
        token = auth[7:]
    else:
        # Fall back to httpOnly cookie set by /auth/login
        token = request.cookies.get("access_token", "")
        if token:
            _reject_foreign_origin(request)
    if not token:
        raise HTTPException(status_code=401, detail="Not authenticated")
    payload = decode_access_token(token)
    if payload is None:
        raise HTTPException(status_code=401, detail="Invalid or expired token")
    user_id = payload.get("sub")
    result = await db.execute(select(User).where(User.id == uuid.UUID(user_id)))
    user = result.scalar_one_or_none()
    if user is None or not user.is_active:
        raise HTTPException(status_code=401, detail="User not found or inactive")
    if user.access_expires_at is not None:
        from datetime import datetime, timezone

        if user.access_expires_at < datetime.now(timezone.utc):
            raise HTTPException(status_code=401, detail="Account access has expired")
    from app.services.event_bus import request_actor_id

    request_actor_id.set(user.id)
    return user


async def get_optional_user(request: Request, db: AsyncSession = Depends(get_db)) -> User | None:
    auth = request.headers.get("Authorization", "")
    if not auth.startswith("Bearer ") and not request.cookies.get("access_token"):
        return None
    try:
        return await get_current_user(request, db)
    except HTTPException:
        return None


def require_permission(app_perm: str, *, card_type_key: str | None = None):
    """Dependency factory that checks a single app-level permission via PermissionService.

    ``card_type_key`` narrows the check to one card type, so a route that only
    ever creates cards of a fixed type (the reference-catalogue importers) is
    subject to that type's per-role overrides — same rule as ``POST /cards``.
    """

    async def _check(
        user: User = Depends(get_current_user),
        db: AsyncSession = Depends(get_db),
    ) -> User:
        from app.services.permission_service import PermissionService

        await PermissionService.require_permission(db, user, app_perm, card_type_key=card_type_key)
        return user

    return _check


async def get_card_read_scope(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """The caller's card read scope (``app.services.card_read_scope``).

    Resolved once per request; FastAPI caches dependencies, so a route that
    also takes ``get_current_user`` / ``get_db`` shares the same session.
    """
    from app.services.card_read_scope import CardReadScope

    return await CardReadScope.load(db, user)
