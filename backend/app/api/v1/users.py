from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, EmailStr
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.core.security import hash_password
from app.database import get_db
from app.models.user import DEFAULT_NOTIFICATION_PREFERENCES, User

router = APIRouter(prefix="/users", tags=["users"])


class UserCreate(BaseModel):
    email: EmailStr
    display_name: str
    password: str
    role: str = "member"


class UserUpdate(BaseModel):
    display_name: str | None = None
    email: EmailStr | None = None
    role: str | None = None
    is_active: bool | None = None
    password: str | None = None


def _user_response(u: User) -> dict:
    return {
        "id": str(u.id),
        "email": u.email,
        "display_name": u.display_name,
        "role": u.role,
        "is_active": u.is_active,
        "created_at": u.created_at.isoformat() if u.created_at else None,
    }


@router.get("")
async def list_users(db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    result = await db.execute(select(User).order_by(User.display_name))
    return [_user_response(u) for u in result.scalars().all()]


@router.get("/{user_id}")
async def get_user(
    user_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    result = await db.execute(select(User).where(User.id == uuid.UUID(user_id)))
    u = result.scalar_one_or_none()
    if not u:
        raise HTTPException(404, "User not found")
    return _user_response(u)


@router.post("", status_code=201)
async def create_user(
    body: UserCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if current_user.role != "admin":
        raise HTTPException(403, "Admin only")

    if body.role not in ("admin", "member", "viewer"):
        raise HTTPException(400, "Role must be admin, member, or viewer")

    existing = await db.execute(select(User).where(User.email == body.email))
    if existing.scalar_one_or_none():
        raise HTTPException(409, "A user with this email already exists")

    u = User(
        email=body.email,
        display_name=body.display_name,
        password_hash=hash_password(body.password),
        role=body.role,
    )
    db.add(u)
    await db.commit()
    await db.refresh(u)
    return _user_response(u)


@router.patch("/{user_id}")
async def update_user(
    user_id: str,
    body: UserUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if current_user.role != "admin" and str(current_user.id) != user_id:
        raise HTTPException(403, "Admin only or own profile")

    result = await db.execute(select(User).where(User.id == uuid.UUID(user_id)))
    u = result.scalar_one_or_none()
    if not u:
        raise HTTPException(404, "User not found")

    data = body.model_dump(exclude_unset=True)

    # Non-admin can only update own display_name and password
    if current_user.role != "admin":
        allowed = {"display_name", "password"}
        if not set(data.keys()).issubset(allowed):
            raise HTTPException(403, "Non-admin can only update display_name and password")

    if "role" in data and data["role"] not in ("admin", "member", "viewer"):
        raise HTTPException(400, "Role must be admin, member, or viewer")

    if "email" in data:
        existing = await db.execute(
            select(User).where(User.email == data["email"], User.id != u.id)
        )
        if existing.scalar_one_or_none():
            raise HTTPException(409, "A user with this email already exists")

    if "password" in data:
        u.password_hash = hash_password(data.pop("password"))

    for field, value in data.items():
        setattr(u, field, value)

    await db.commit()
    return _user_response(u)


@router.delete("/{user_id}", status_code=204)
async def delete_user(
    user_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if current_user.role != "admin":
        raise HTTPException(403, "Admin only")

    if str(current_user.id) == user_id:
        raise HTTPException(400, "Cannot delete your own account")

    result = await db.execute(select(User).where(User.id == uuid.UUID(user_id)))
    u = result.scalar_one_or_none()
    if not u:
        raise HTTPException(404, "User not found")

    # Soft-delete: deactivate rather than hard-delete to preserve audit trail
    u.is_active = False
    await db.commit()


# ---------------------------------------------------------------------------
# Notification preferences
# ---------------------------------------------------------------------------

class NotificationPreferencesUpdate(BaseModel):
    in_app: dict[str, bool] | None = None
    email: dict[str, bool] | None = None


@router.get("/me/notification-preferences")
async def get_notification_preferences(
    current_user: User = Depends(get_current_user),
):
    return current_user.notification_preferences or DEFAULT_NOTIFICATION_PREFERENCES


@router.patch("/me/notification-preferences")
async def update_notification_preferences(
    body: NotificationPreferencesUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    prefs = dict(current_user.notification_preferences or DEFAULT_NOTIFICATION_PREFERENCES)

    if body.in_app is not None:
        prefs["in_app"] = {**prefs.get("in_app", {}), **body.in_app}
    if body.email is not None:
        prefs["email"] = {**prefs.get("email", {}), **body.email}

    current_user.notification_preferences = prefs
    await db.commit()
    return prefs
