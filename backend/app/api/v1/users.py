from __future__ import annotations

import uuid
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, EmailStr
from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.api.v1.auth import _get_sso_config
from app.core.security import hash_password
from app.database import get_db
from app.models.role import Role
from app.models.sso_invitation import SsoInvitation
from app.models.user import DEFAULT_NOTIFICATION_PREFERENCES, DEFAULT_UI_PREFERENCES, User
from app.services.permission_service import PermissionService

router = APIRouter(prefix="/users", tags=["users"])

SUPPORTED_LOCALES = {"en", "de", "fr", "es", "it", "pt", "zh", "ru"}


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
    locale: str | None = None
    auth_provider: str | None = None  # admin only: "local" or "sso"


class NotificationPreferencesUpdate(BaseModel):
    in_app: dict[str, bool] | None = None
    email: dict[str, bool] | None = None


class UiPreferencesUpdate(BaseModel):
    dashboard_default_tab: Literal["overview", "workspace"] | None = None


class InvitationCreate(BaseModel):
    email: EmailStr
    role: str = "viewer"
    send_email: bool = False


def _user_response(u: User) -> dict:
    return {
        "id": str(u.id),
        "email": u.email,
        "display_name": u.display_name,
        "role": u.role,
        "is_active": u.is_active,
        "locale": u.locale or "en",
        "auth_provider": u.auth_provider or "local",
        "has_password": bool(u.password_hash),
        "pending_setup": bool(u.password_setup_token),
        "ui_preferences": u.ui_preferences or DEFAULT_UI_PREFERENCES,
        "created_at": u.created_at.isoformat() if u.created_at else None,
        "last_login": u.last_login.isoformat() if u.last_login else None,
    }


def _invitation_response(inv: SsoInvitation) -> dict:
    return {
        "id": str(inv.id),
        "email": inv.email,
        "role": inv.role,
        "invited_by": str(inv.invited_by) if inv.invited_by else None,
        "created_at": inv.created_at.isoformat() if inv.created_at else None,
    }


# ---------------------------------------------------------------------------
# Fixed-path routes MUST be declared before /{user_id} to avoid shadowing
# ---------------------------------------------------------------------------


@router.get("")
async def list_users(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
    include_inactive: bool = Query(
        False,
        description=(
            "Include disabled (is_active=False) users in the result. "
            "Default False so owner / assignee / stakeholder pickers don't "
            "list disabled accounts. The Users admin page passes True."
        ),
    ),
):
    stmt = select(User).order_by(User.display_name)
    if not include_inactive:
        stmt = stmt.where(User.is_active.is_(True))
    result = await db.execute(stmt)
    return [_user_response(u) for u in result.scalars().all()]


@router.get("/invitations")
async def list_invitations(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Admin only — list pending invitations.

    «Pending» means the invited user has not yet actually used the system. The
    criterion is `users.last_login IS NULL` — an admin who has set a password
    on behalf of the user (PATCH /users/{id}) hasn't *accepted* anything, so
    the invitation stays on the list until the user signs in for the first
    time. This is what powers the «resend invite» UX (#539).
    """
    await PermissionService.require_permission(db, current_user, "admin.users")
    has_logged_in = (
        select(User.id)
        .where(
            User.email == SsoInvitation.email,
            User.last_login.is_not(None),
        )
        .exists()
    )
    stmt = select(SsoInvitation).where(~has_logged_in).order_by(SsoInvitation.email)
    result = await db.execute(stmt)
    return [_invitation_response(inv) for inv in result.scalars().all()]


@router.post("/invitations/{invitation_id}/resend")
async def resend_invitation_by_invitation(
    invitation_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Re-send the invitation email for a row in the Pending Invitations list.

    Looks up the matching user by email and reuses the same email shape
    as ``POST /users/{id}/resend-invitation``. Falls back to a generic
    invite when no user row exists yet (shouldn't normally happen, but
    keeps the action safe for SSO-only deployments).
    """
    await PermissionService.require_permission(db, current_user, "admin.users")

    inv_result = await db.execute(
        select(SsoInvitation).where(SsoInvitation.id == uuid.UUID(invitation_id))
    )
    inv = inv_result.scalar_one_or_none()
    if not inv:
        raise HTTPException(404, "Invitation not found")

    from app.services.email_service import _get_app_title, send_notification_email

    user_result = await db.execute(select(User).where(User.email == inv.email))
    matching_user = user_result.scalar_one_or_none()

    sso_cfg = await _get_sso_config(db)
    sso_enabled = sso_cfg.get("enabled", False)
    title, message, link = _build_invite_email(
        app_title=_get_app_title(),
        setup_token=matching_user.password_setup_token if matching_user else None,
        sso_enabled=sso_enabled,
    )

    try:
        sent = await send_notification_email(to=inv.email, title=title, message=message, link=link)
    except Exception as exc:
        import logging

        logging.getLogger(__name__).exception("Failed to resend invitation email to %s", inv.email)
        raise HTTPException(502, f"Failed to send invitation email: {exc}") from exc

    if not sent:
        raise HTTPException(
            400,
            "SMTP is not configured. Configure SMTP in admin settings before resending.",
        )

    return {"email_sent": True, "sent_to": inv.email}


@router.delete("/invitations/{invitation_id}", status_code=204)
async def delete_invitation(
    invitation_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Admin only — delete/revoke a pending SSO invitation."""
    await PermissionService.require_permission(db, current_user, "admin.users")

    result = await db.execute(
        select(SsoInvitation).where(SsoInvitation.id == uuid.UUID(invitation_id))
    )
    inv = result.scalar_one_or_none()
    if not inv:
        raise HTTPException(404, "Invitation not found")

    await db.delete(inv)
    await db.commit()


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


@router.get("/me/ui-preferences")
async def get_ui_preferences(
    current_user: User = Depends(get_current_user),
):
    return current_user.ui_preferences or DEFAULT_UI_PREFERENCES


@router.patch("/me/ui-preferences")
async def update_ui_preferences(
    body: UiPreferencesUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    prefs = dict(current_user.ui_preferences or DEFAULT_UI_PREFERENCES)
    data = body.model_dump(exclude_unset=True)

    if "dashboard_default_tab" in data:
        value = data["dashboard_default_tab"]
        if value is None:
            prefs.pop("dashboard_default_tab", None)
        else:
            prefs["dashboard_default_tab"] = value

    current_user.ui_preferences = prefs
    await db.commit()
    return prefs


# ---------------------------------------------------------------------------
# Parameterized routes — /{user_id} catch-all comes after fixed paths
# ---------------------------------------------------------------------------


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


INVITE_ALLOWED_ROLES: set[str] = {"member", "viewer"}


@router.post("", status_code=201)
async def create_user(
    body: UserCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    # admin.users grants full create-any-role power; users.invite is the
    # delegated variant for stakeholder/owner pickers and is gated to
    # non-privileged roles below.
    is_admin = await PermissionService.check_permission(db, current_user, "admin.users")
    can_invite = is_admin or await PermissionService.check_permission(
        db, current_user, "users.invite"
    )
    if not can_invite:
        raise HTTPException(403, "Insufficient permissions")

    # Validate role key exists in roles table
    role_result = await db.execute(select(Role).where(Role.key == body.role))
    if not role_result.scalar_one_or_none():
        raise HTTPException(400, f"Unknown role '{body.role}'")

    # Privilege-escalation guard: a users.invite holder without admin.users
    # may only create users with non-privileged roles.
    if not is_admin and body.role not in INVITE_ALLOWED_ROLES:
        raise HTTPException(
            403,
            f"Inviting users with role '{body.role}' requires admin.users. "
            f"Allowed delegated roles: {sorted(INVITE_ALLOWED_ROLES)}",
        )

    email = body.email.lower().strip()

    existing = await db.execute(select(User).where(User.email == email))
    if existing.scalar_one_or_none():
        raise HTTPException(409, "A user with this email already exists")

    # Also check if an SSO invitation already exists for this email
    existing_inv = await db.execute(select(SsoInvitation).where(SsoInvitation.email == email))
    if existing_inv.scalar_one_or_none():
        raise HTTPException(409, "An invitation for this email already exists")

    # Password is required when SSO is not enabled — local accounts cannot exist
    # in a pending-setup state (the email-link flow was a footgun: the User row
    # showed «Pending Setup» and the paired SsoInvitation lingered in the admin
    # list with no way for the user to actually complete setup). SSO-enabled
    # mode still allows creating users without a password since they'll
    # authenticate via SSO.
    sso_cfg = await _get_sso_config(db)
    sso_enabled = sso_cfg.get("enabled", False)
    if not body.password and not sso_enabled:
        raise HTTPException(
            400,
            "A password is required when creating a local account. "
            "Enable SSO or set a password for the new user.",
        )

    pw_hash = hash_password(body.password) if body.password else None
    # When SSO is enabled and the admin invites without a password, the user
    # will sign in via SSO. Mark the User as auth_provider="sso" up front so
    # the SSO callback's "link existing user" branch can attach the
    # `sso_subject_id` on first sign-in — otherwise the callback would hit
    # the auth_provider=="local" guard and refuse with 409.
    auth_provider = "sso" if not body.password else "local"

    u = User(
        email=email,
        display_name=body.display_name,
        password_hash=pw_hash,
        role=body.role,
        auth_provider=auth_provider,
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

    # Send invitation email if requested. The user has already been
    # committed above, so we don't roll back on email failure — instead
    # we surface the SMTP error in the response so the admin can see it
    # and re-send (e.g. via the test-email endpoint after fixing creds).
    response = _user_response(u)
    if body.send_email:
        from app.services.email_service import _get_app_title, send_notification_email

        app_title = _get_app_title()
        invite_title = f"You've been invited to {app_title}"

        if sso_enabled:
            invite_message = (
                f"You have been invited to join {app_title}. Click the button below to sign in."
            )
        else:
            invite_message = (
                f"You have been invited to join {app_title}. "
                "A password has been set for your account. "
                "Click the button below to sign in."
            )
        invite_link = "/"

        try:
            sent = await send_notification_email(
                to=email,
                title=invite_title,
                message=invite_message,
                link=invite_link,
            )
            response["email_sent"] = bool(sent)
            if not sent:
                response["email_error"] = (
                    "SMTP is not configured, so the invitation email could not "
                    "be sent. The account was created — configure SMTP in admin "
                    "settings and re-send manually if needed."
                )
        except Exception as exc:
            import logging

            logging.getLogger(__name__).exception("Failed to send invitation email to %s", email)
            response["email_sent"] = False
            response["email_error"] = (
                f"The account was created, but the invitation email could not be sent: {exc}"
            )

    return response


def _build_invite_email(
    *, app_title: str, setup_token: str | None, sso_enabled: bool
) -> tuple[str, str, str]:
    """Return (title, message, link) for an invitation email."""
    invite_title = f"You've been invited to {app_title}"
    if setup_token and not sso_enabled:
        invite_message = (
            f"You have been invited to join {app_title}. "
            "Click the button below to set your password and get started."
        )
        invite_link = f"/auth/set-password?token={setup_token}"
    elif sso_enabled:
        invite_message = (
            f"You have been invited to join {app_title}. Click the button below to sign in."
        )
        invite_link = "/"
    else:
        invite_message = (
            f"You have been invited to join {app_title}. "
            "A password has been set for your account. "
            "Click the button below to sign in."
        )
        invite_link = "/"
    return invite_title, invite_message, invite_link


@router.patch("/{user_id}")
async def update_user(
    user_id: str,
    body: UserUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    is_admin = await PermissionService.has_app_permission(db, current_user, "admin.users")
    is_self = str(current_user.id) == user_id
    if not is_admin and not is_self:
        raise HTTPException(403, "Admin only or own profile")

    result = await db.execute(select(User).where(User.id == uuid.UUID(user_id)))
    u = result.scalar_one_or_none()
    if not u:
        raise HTTPException(404, "User not found")

    data = body.model_dump(exclude_unset=True)

    # Non-admin can only update own display_name, password, and locale
    if not is_admin:
        allowed = {"display_name", "password", "locale"}
        if not set(data.keys()).issubset(allowed):
            raise HTTPException(403, "Non-admin can only update display_name, password, and locale")

    if "role" in data:
        role_result = await db.execute(select(Role).where(Role.key == data["role"]))
        if not role_result.scalar_one_or_none():
            raise HTTPException(400, f"Unknown role '{data['role']}'")
        # Prevent last admin from losing admin role
        if u.role == "admin" and data["role"] != "admin":
            admin_count = await db.execute(
                select(func.count(User.id)).where(User.role == "admin", User.is_active == True)  # noqa: E712
            )
            if (admin_count.scalar() or 0) <= 1:
                raise HTTPException(400, "Cannot remove the last admin role")

    if "email" in data:
        existing = await db.execute(
            select(User).where(User.email == data["email"], User.id != u.id)
        )
        if existing.scalar_one_or_none():
            raise HTTPException(409, "A user with this email already exists")

    if "locale" in data:
        if data["locale"] not in SUPPORTED_LOCALES:
            raise HTTPException(400, f"Unsupported locale '{data['locale']}'")

    if "auth_provider" in data:
        new_provider = data.pop("auth_provider")
        if new_provider not in ("local", "sso"):
            raise HTTPException(400, "auth_provider must be 'local' or 'sso'")
        if new_provider != u.auth_provider:
            u.auth_provider = new_provider
            if new_provider == "sso":
                # Clear sso_subject_id so it gets linked on next SSO login
                u.sso_subject_id = None
            elif new_provider == "local":
                u.sso_subject_id = None

    if "password" in data:
        # Block password changes for SSO users
        if u.auth_provider == "sso":
            raise HTTPException(400, "Cannot set password for SSO users")
        u.password_hash = hash_password(data.pop("password"))
        # Setting a password from the admin side invalidates the one-time
        # setup link (so the legacy email link can no longer overwrite the
        # admin-chosen password). The matching SsoInvitation row is NOT
        # deleted here: the *user* hasn't accepted yet — admin merely set
        # their credentials on their behalf. The invitation stays on the
        # Pending list so admin can still resend it, and disappears once
        # the user signs in for the first time (#539).
        u.password_setup_token = None

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
    await PermissionService.require_permission(db, current_user, "admin.users")

    if str(current_user.id) == user_id:
        raise HTTPException(400, "Cannot delete your own account")

    result = await db.execute(select(User).where(User.id == uuid.UUID(user_id)))
    u = result.scalar_one_or_none()
    if not u:
        raise HTTPException(404, "User not found")

    # Prevent removing the last active admin so the instance stays manageable.
    if u.role == "admin":
        admin_count = await db.execute(
            select(func.count(User.id)).where(
                User.role == "admin",
                User.is_active == True,  # noqa: E712
            )
        )
        if (admin_count.scalar() or 0) <= 1:
            raise HTTPException(400, "Cannot delete the last active admin")

    # Hard delete. Migration 070 added ON DELETE SET NULL on author / owner /
    # assignee FKs and ON DELETE CASCADE was already in place for the
    # user-scoped tables (stakeholders, comments, bookmarks, favorites, saved
    # reports, notifications, survey responses), so PostgreSQL handles the
    # fan-out. Also remove any pending SSO invitation for the same email so
    # the row doesn't survive and re-grant the role on next SSO login.
    await db.execute(delete(SsoInvitation).where(SsoInvitation.email == u.email))
    await db.delete(u)
    await db.commit()
