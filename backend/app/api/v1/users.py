from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, EmailStr
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.api.v1.auth import _get_sso_config, generate_setup_token
from app.core.security import hash_password
from app.database import get_db
from app.models.sso_invitation import SsoInvitation
from app.models.user import DEFAULT_NOTIFICATION_PREFERENCES, User

router = APIRouter(prefix="/users", tags=["users"])


class UserCreate(BaseModel):
    email: EmailStr
    display_name: str
    password: str | None = None
    role: str = "member"
    send_email: bool = False


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
        "auth_provider": u.auth_provider or "local",
        "has_password": bool(u.password_hash),
        "pending_setup": bool(u.password_setup_token),
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

    if body.role not in ("admin", "bpm_admin", "member", "viewer"):
        raise HTTPException(400, "Role must be admin, bpm_admin, member, or viewer")

    email = body.email.lower().strip()

    existing = await db.execute(select(User).where(User.email == email))
    if existing.scalar_one_or_none():
        raise HTTPException(409, "A user with this email already exists")

    # Also check if an SSO invitation already exists for this email
    existing_inv = await db.execute(
        select(SsoInvitation).where(SsoInvitation.email == email)
    )
    if existing_inv.scalar_one_or_none():
        raise HTTPException(409, "An invitation for this email already exists")

    setup_token = None
    pw_hash = None
    if body.password:
        pw_hash = hash_password(body.password)
    else:
        setup_token = generate_setup_token()

    u = User(
        email=email,
        display_name=body.display_name,
        password_hash=pw_hash,
        role=body.role,
        password_setup_token=setup_token,
    )
    db.add(u)

    # Also create an SSO invitation so SSO login gives the right role
    sso_inv = SsoInvitation(
        email=email,
        role=body.role,
        invited_by=current_user.id,
    )
    db.add(sso_inv)

    await db.commit()
    await db.refresh(u)

    # Send invitation email if requested
    if body.send_email:
        try:
            from app.services.email_service import send_notification_email

            sso_cfg = await _get_sso_config(db)
            sso_enabled = sso_cfg.get("enabled", False)

            if setup_token and not sso_enabled:
                # SSO disabled + no password: send password setup link
                await send_notification_email(
                    to=email,
                    title="You've been invited to Turbo EA",
                    message=(
                        "You have been invited to join Turbo EA. "
                        "Click the button below to set your password "
                        "and get started."
                    ),
                    link=f"/auth/set-password?token={setup_token}",
                )
            elif sso_enabled:
                # SSO enabled: tell them to sign in with Microsoft
                await send_notification_email(
                    to=email,
                    title="You've been invited to Turbo EA",
                    message=(
                        "You have been invited to join Turbo EA. "
                        "Click the button below to sign in with your "
                        "Microsoft account."
                    ),
                    link="/",
                )
            else:
                # Password was set: tell them to sign in
                await send_notification_email(
                    to=email,
                    title="You've been invited to Turbo EA",
                    message=(
                        "You have been invited to join Turbo EA. "
                        "A password has been set for your account. "
                        "Click the button below to sign in."
                    ),
                    link="/",
                )
        except Exception:
            pass  # Email sending is best-effort

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
        # Block password changes for SSO users
        if u.auth_provider == "sso":
            raise HTTPException(400, "Cannot set password for SSO users")
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


# ---------------------------------------------------------------------------
# SSO Invitations
# ---------------------------------------------------------------------------

class InvitationCreate(BaseModel):
    email: EmailStr
    role: str = "viewer"
    send_email: bool = False


def _invitation_response(inv: SsoInvitation) -> dict:
    return {
        "id": str(inv.id),
        "email": inv.email,
        "role": inv.role,
        "invited_by": str(inv.invited_by) if inv.invited_by else None,
        "created_at": inv.created_at.isoformat() if inv.created_at else None,
    }


@router.get("/invitations")
async def list_invitations(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Admin only — list all pending invitations."""
    if current_user.role != "admin":
        raise HTTPException(403, "Admin only")
    result = await db.execute(
        select(SsoInvitation).order_by(SsoInvitation.email)
    )
    return [_invitation_response(inv) for inv in result.scalars().all()]


@router.delete("/invitations/{invitation_id}", status_code=204)
async def delete_invitation(
    invitation_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Admin only — delete/revoke a pending SSO invitation."""
    if current_user.role != "admin":
        raise HTTPException(403, "Admin only")

    result = await db.execute(
        select(SsoInvitation).where(SsoInvitation.id == uuid.UUID(invitation_id))
    )
    inv = result.scalar_one_or_none()
    if not inv:
        raise HTTPException(404, "Invitation not found")

    await db.delete(inv)
    await db.commit()
