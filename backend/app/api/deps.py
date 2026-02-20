from __future__ import annotations

import uuid

from fastapi import Depends, HTTPException, Request
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import decode_access_token
from app.database import get_db
from app.models.user import User


async def get_current_user(
    request: Request, db: AsyncSession = Depends(get_db)
) -> User:
    auth = request.headers.get("Authorization", "")
    if not auth.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Not authenticated")
    token = auth[7:]
    payload = decode_access_token(token)
    if payload is None:
        raise HTTPException(status_code=401, detail="Invalid or expired token")
    user_id = payload.get("sub")
    result = await db.execute(select(User).where(User.id == uuid.UUID(user_id)))
    user = result.scalar_one_or_none()
    if user is None or not user.is_active:
        raise HTTPException(status_code=401, detail="User not found or inactive")
    return user


async def get_optional_user(request: Request, db: AsyncSession = Depends(get_db)) -> User | None:
    auth = request.headers.get("Authorization", "")
    if not auth.startswith("Bearer "):
        return None
    try:
        return await get_current_user(request, db)
    except HTTPException:
        return None


def require_admin(user: User) -> None:
    """Raise 403 unless user is a site admin. (Deprecated — use PermissionService.)"""
    if user.role != "admin":
        raise HTTPException(status_code=403, detail="Admin only")


def require_bpm_admin(user: User) -> None:
    """Raise 403 unless user is admin or bpm_admin. (Deprecated — use PermissionService.)"""
    if user.role not in ("admin", "bpm_admin"):
        raise HTTPException(status_code=403, detail="Admin or BPM Admin required")


def require_permission(app_perm: str):
    """Dependency factory that checks a single app-level permission via PermissionService."""
    async def _check(
        user: User = Depends(get_current_user),
        db: AsyncSession = Depends(get_db),
    ) -> User:
        from app.services.permission_service import PermissionService

        await PermissionService.require_permission(db, user, app_perm)
        return user
    return _check
