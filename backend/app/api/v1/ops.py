"""Control-plane ops API — mutually authenticated management surface for managed
(Turbo EA Cloud) deployments.

Every route is guarded by ``verify_ops_request`` (Ed25519 signature + timestamp +
single-use nonce — see ``app/core/ops_auth.py``). On self-hosted installs the env
var ``OPS_PUBLIC_KEY`` is unset and every route answers 404.

Transparency by design: every rescue-access action emits an event AND notifies all
active admins of this instance (in-app + email), so operator access can never
happen invisibly. There is deliberately no billing or licensing logic here.
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone

from fastapi import APIRouter, Depends
from fastapi.responses import Response
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.v1.auth import generate_setup_token
from app.config import APP_VERSION
from app.core.ops_auth import verify_ops_request
from app.database import get_db
from app.models.card import Card
from app.models.user import User
from app.services import notification_service
from app.services.event_bus import event_bus

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/ops", tags=["ops"], dependencies=[Depends(verify_ops_request)])

RESCUE_EMAIL_DOMAIN = "rescue.turboea.invalid"


class RescueAccessRequest(BaseModel):
    request_id: str = Field(min_length=8, max_length=64)
    operator_email: str = Field(max_length=320)
    operator_name: str = Field(max_length=200)
    reason: str = Field(max_length=2000)
    expires_at: datetime
    break_glass: bool = False


class RescueAccessRevoke(BaseModel):
    request_id: str = Field(min_length=8, max_length=64)


def rescue_email_for(request_id: str) -> str:
    return f"rescue-{request_id[:13].lower()}@{RESCUE_EMAIL_DOMAIN}"


async def _notify_admins(
    db: AsyncSession, *, title: str, message: str, data: dict | None = None
) -> None:
    """In-app + forced email to every active admin — rescue access must be visible."""
    admins = (
        (
            await db.execute(
                select(User).where(
                    User.role == "admin",
                    User.is_active == True,  # noqa: E712
                    User.access_expires_at.is_(None),  # never notify rescue accounts
                )
            )
        )
        .scalars()
        .all()
    )
    for admin in admins:
        await notification_service.create_notification(
            db,
            user_id=admin.id,
            notif_type="ops_rescue_access",
            title=title,
            message=message,
            data=data or {},
        )
        # Security notifications bypass email opt-out
        from app.services.email_service import send_notification_email

        try:
            await send_notification_email(to=admin.email, title=title, message=message, link=None)
        except Exception:
            logger.exception("Failed to email admin %s about ops access", admin.id)


@router.get("/info")
async def ops_info(db: AsyncSession = Depends(get_db)):
    user_count = (await db.execute(select(func.count(User.id)))).scalar_one()
    card_count = (await db.execute(select(func.count(Card.id)))).scalar_one()
    return {
        "status": "ok",
        "version": APP_VERSION,
        "user_count": user_count,
        "card_count": card_count,
        "db_ok": True,
    }


@router.post("/rescue-access")
async def create_rescue_access(body: RescueAccessRequest, db: AsyncSession = Depends(get_db)):
    """Create (or refresh) a time-boxed admin account for a control-plane operator.

    The account is dedicated to this request (deterministic email derived from the
    request id), carries ``access_expires_at``, and is handed back as a single-use
    password-setup link. Expiry is enforced instance-side by ``get_current_user``
    and the hourly deactivation loop — a control-plane outage cannot extend access.
    """
    email = rescue_email_for(body.request_id)
    existing = (await db.execute(select(User).where(User.email == email))).scalar_one_or_none()

    token = generate_setup_token()
    if existing:
        user = existing
        user.is_active = True
        user.role = "admin"
        user.password_hash = None
        user.password_setup_token = token
        user.access_expires_at = body.expires_at
    else:
        user = User(
            email=email,
            display_name=f"Rescue operator: {body.operator_name}",
            role="admin",
            is_active=True,
            auth_provider="local",
            password_setup_token=token,
            access_expires_at=body.expires_at,
        )
        db.add(user)
    await db.flush()

    kind = "EMERGENCY break-glass" if body.break_glass else "customer-approved"
    expires_text = body.expires_at.strftime("%Y-%m-%d %H:%M UTC")
    await event_bus.publish(
        event_type="ops.rescue_access_granted",
        data={
            "request_id": body.request_id,
            "operator_email": body.operator_email,
            "operator_name": body.operator_name,
            "reason": body.reason,
            "break_glass": body.break_glass,
            "expires_at": body.expires_at.isoformat(),
            "rescue_user_id": str(user.id),
        },
        db=db,
        user_id=user.id,
    )
    await _notify_admins(
        db,
        title=f"Operator admin access granted ({kind})",
        message=(
            f"Operator {body.operator_name} ({body.operator_email}) was granted temporary "
            f"admin access to this instance until {expires_text}.\n\nReason: {body.reason}"
        ),
        data={"request_id": body.request_id, "break_glass": body.break_glass},
    )
    await db.commit()

    return {
        "user_id": str(user.id),
        "admin_email": email,
        "setup_path": f"/auth/set-password?token={token}",
        "expires_at": body.expires_at.isoformat(),
    }


@router.delete("/rescue-access")
async def revoke_rescue_access(body: RescueAccessRevoke, db: AsyncSession = Depends(get_db)):
    """Immediately deactivate the rescue account created for a request."""
    email = rescue_email_for(body.request_id)
    user = (await db.execute(select(User).where(User.email == email))).scalar_one_or_none()
    if user:
        user.is_active = False
        user.password_setup_token = None
        await event_bus.publish(
            event_type="ops.rescue_access_revoked",
            data={"request_id": body.request_id, "rescue_user_id": str(user.id)},
            db=db,
            user_id=user.id,
        )
        await _notify_admins(
            db,
            title="Operator admin access revoked",
            message="The temporary operator admin access to this instance was revoked.",
            data={"request_id": body.request_id},
        )
        await db.commit()
    return {"ok": True, "revoked": bool(user)}


@router.get("/export")
async def ops_export(db: AsyncSession = Depends(get_db)):
    """Stream the full secret-stripped workspace bundle (same content as
    Admin → Workspace export) for control-plane backups and GDPR data exports."""
    from app.services.workspace_io import build_bundle

    payload = await build_bundle(db)
    await event_bus.publish(
        event_type="ops.workspace_exported",
        data={"size_bytes": len(payload)},
        db=db,
    )
    await db.commit()
    timestamp = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
    return Response(
        content=payload,
        media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="workspace_export_{timestamp}.zip"'},
    )
