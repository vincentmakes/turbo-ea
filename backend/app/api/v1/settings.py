"""Admin-only application settings — currently just email / SMTP configuration."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.config import settings as app_config
from app.database import get_db
from app.models.app_settings import AppSettings
from app.models.user import User

router = APIRouter(prefix="/settings", tags=["settings"])


# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------

class EmailSettingsPayload(BaseModel):
    smtp_host: str = ""
    smtp_port: int = 587
    smtp_user: str = ""
    smtp_password: str = ""
    smtp_from: str = "noreply@turboea.local"
    smtp_tls: bool = True
    app_base_url: str = ""


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _require_admin(user: User) -> None:
    if user.role != "admin":
        raise HTTPException(403, "Admin only")


async def _get_or_create_row(db: AsyncSession) -> AppSettings:
    result = await db.execute(select(AppSettings).where(AppSettings.id == "default"))
    row = result.scalar_one_or_none()
    if not row:
        row = AppSettings(id="default", email_settings={})
        db.add(row)
        await db.flush()
    return row


def _apply_to_runtime(email: dict) -> None:
    """Push DB email settings into the runtime config singleton."""
    if email.get("smtp_host"):
        app_config.SMTP_HOST = email["smtp_host"]
    if email.get("smtp_port"):
        app_config.SMTP_PORT = int(email["smtp_port"])
    if email.get("smtp_user"):
        app_config.SMTP_USER = email["smtp_user"]
    if email.get("smtp_password"):
        app_config.SMTP_PASSWORD = email["smtp_password"]
    if email.get("smtp_from"):
        app_config.SMTP_FROM = email["smtp_from"]
    if "smtp_tls" in email:
        app_config.SMTP_TLS = bool(email["smtp_tls"])
    if email.get("app_base_url"):
        app_config._app_base_url = email["app_base_url"]


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@router.get("/email")
async def get_email_settings(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    _require_admin(user)
    row = await _get_or_create_row(db)
    await db.commit()
    stored = row.email_settings or {}
    return {
        "smtp_host": stored.get("smtp_host", app_config.SMTP_HOST),
        "smtp_port": stored.get("smtp_port", app_config.SMTP_PORT),
        "smtp_user": stored.get("smtp_user", app_config.SMTP_USER),
        "smtp_password": (
            "••••••••" if stored.get("smtp_password") or app_config.SMTP_PASSWORD else ""
        ),
        "smtp_from": stored.get("smtp_from", app_config.SMTP_FROM),
        "smtp_tls": stored.get("smtp_tls", app_config.SMTP_TLS),
        "app_base_url": stored.get("app_base_url", ""),
        "configured": bool(stored.get("smtp_host") or app_config.SMTP_HOST),
    }


@router.patch("/email")
async def update_email_settings(
    body: EmailSettingsPayload,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    _require_admin(user)
    row = await _get_or_create_row(db)

    email = dict(row.email_settings or {})
    payload = body.model_dump()

    # Only overwrite password if the caller sends a real value (not the masked placeholder)
    if payload.get("smtp_password") in ("", "••••••••"):
        payload.pop("smtp_password", None)

    email.update(payload)
    row.email_settings = email
    await db.commit()

    _apply_to_runtime(email)

    return {"ok": True}


@router.post("/email/test")
async def test_email_settings(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Send a test email to the admin's own address using current SMTP settings."""
    _require_admin(user)

    from app.services.email_service import send_notification_email

    try:
        await send_notification_email(
            to=user.email,
            title="Test Email from Turbo EA",
            message="If you received this, your email settings are configured correctly.",
            link="/admin/settings",
        )
    except Exception as exc:
        raise HTTPException(502, f"Failed to send test email: {exc}") from exc

    return {"ok": True, "sent_to": user.email}
