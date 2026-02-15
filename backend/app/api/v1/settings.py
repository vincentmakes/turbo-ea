"""Admin-only application settings — email / SMTP configuration + logo management."""
from __future__ import annotations

from pathlib import Path

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from fastapi.responses import Response
from pydantic import BaseModel
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.config import settings as app_config
from app.database import get_db
from app.models.app_settings import AppSettings
from app.models.fact_sheet_type import FactSheetType
from app.models.relation_type import RelationType
from app.models.user import User

router = APIRouter(prefix="/settings", tags=["settings"])

_DEFAULT_LOGO_PATH = Path(__file__).resolve().parent.parent.parent / "default_logo.png"
_DEFAULT_FAVICON_PATH = Path(__file__).resolve().parent.parent.parent / "default_favicon.png"
_DEFAULT_LOGO_BYTES: bytes | None = None
_DEFAULT_FAVICON_BYTES: bytes | None = None

ALLOWED_LOGO_MIMES = {"image/png", "image/jpeg", "image/svg+xml", "image/webp", "image/gif"}
MAX_LOGO_SIZE = 2 * 1024 * 1024  # 2 MB


def _get_default_logo() -> bytes:
    global _DEFAULT_LOGO_BYTES
    if _DEFAULT_LOGO_BYTES is None:
        _DEFAULT_LOGO_BYTES = _DEFAULT_LOGO_PATH.read_bytes()
    return _DEFAULT_LOGO_BYTES


def _get_default_favicon() -> bytes:
    global _DEFAULT_FAVICON_BYTES
    if _DEFAULT_FAVICON_BYTES is None:
        _DEFAULT_FAVICON_BYTES = _DEFAULT_FAVICON_PATH.read_bytes()
    return _DEFAULT_FAVICON_BYTES


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


class CurrencyPayload(BaseModel):
    currency: str = "USD"


class SsoSettingsPayload(BaseModel):
    enabled: bool = False
    client_id: str = ""
    client_secret: str = ""
    tenant_id: str = "organizations"  # "organizations" for multi-tenant, or a specific tenant ID


DEFAULT_CURRENCY = "USD"


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


# ---------------------------------------------------------------------------
# Currency endpoint
# ---------------------------------------------------------------------------

@router.get("/currency")
async def get_currency(db: AsyncSession = Depends(get_db)):
    """Public endpoint — returns the configured display currency."""
    result = await db.execute(
        select(AppSettings).where(AppSettings.id == "default")
    )
    row = result.scalar_one_or_none()
    general = (row.general_settings if row else None) or {}
    return {"currency": general.get("currency", DEFAULT_CURRENCY)}


@router.patch("/currency")
async def update_currency(
    body: CurrencyPayload,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Admin endpoint — set the display currency for all cost fields."""
    _require_admin(user)

    row = await _get_or_create_row(db)
    general = dict(row.general_settings or {})
    general["currency"] = body.currency
    row.general_settings = general
    await db.commit()

    return {"ok": True}


# ---------------------------------------------------------------------------
# BPM row-order endpoint
# ---------------------------------------------------------------------------

class BpmRowOrderPayload(BaseModel):
    row_order: list[str]


class BpmEnabledPayload(BaseModel):
    enabled: bool


@router.get("/bpm-enabled")
async def get_bpm_enabled(db: AsyncSession = Depends(get_db)):
    """Public endpoint — returns whether the BPM module is enabled."""
    result = await db.execute(
        select(AppSettings).where(AppSettings.id == "default")
    )
    row = result.scalar_one_or_none()
    general = (row.general_settings if row else None) or {}
    return {"enabled": general.get("bpmEnabled", True)}


@router.patch("/bpm-enabled")
async def update_bpm_enabled(
    body: BpmEnabledPayload,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Admin endpoint — enable or disable the BPM module.

    Also toggles is_hidden on the BusinessProcess fact sheet type and all
    relation types that touch BusinessProcess, so that fact sheets, relations,
    and reports are properly hidden/shown across the entire platform.
    """
    _require_admin(user)

    row = await _get_or_create_row(db)
    general = dict(row.general_settings or {})
    general["bpmEnabled"] = body.enabled
    row.general_settings = general

    # Toggle is_hidden on the BusinessProcess fact sheet type
    hide = not body.enabled
    fst_result = await db.execute(
        select(FactSheetType).where(FactSheetType.key == "BusinessProcess")
    )
    fst = fst_result.scalar_one_or_none()
    if fst:
        fst.is_hidden = hide

    # Toggle is_hidden on all relation types connected to BusinessProcess
    rt_result = await db.execute(
        select(RelationType).where(
            or_(
                RelationType.source_type_key == "BusinessProcess",
                RelationType.target_type_key == "BusinessProcess",
            )
        )
    )
    for rt in rt_result.scalars().all():
        rt.is_hidden = hide

    await db.commit()

    return {"ok": True}


@router.get("/bpm-row-order")
async def get_bpm_row_order(db: AsyncSession = Depends(get_db)):
    """Public endpoint — returns the configured BPM process type row order."""
    result = await db.execute(
        select(AppSettings).where(AppSettings.id == "default")
    )
    row = result.scalar_one_or_none()
    general = (row.general_settings if row else None) or {}
    return {"row_order": general.get("bpmRowOrder", ["management", "core", "support"])}


@router.patch("/bpm-row-order")
async def update_bpm_row_order(
    body: BpmRowOrderPayload,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Admin endpoint — set BPM process type row display order."""
    _require_admin(user)

    row = await _get_or_create_row(db)
    general = dict(row.general_settings or {})
    general["bpmRowOrder"] = body.row_order
    row.general_settings = general
    await db.commit()

    return {"ok": True}


# ---------------------------------------------------------------------------
# Logo endpoints
# ---------------------------------------------------------------------------

@router.get("/logo")
async def get_logo(db: AsyncSession = Depends(get_db)):
    """Public endpoint — returns the current logo (custom or default)."""
    result = await db.execute(select(AppSettings).where(AppSettings.id == "default"))
    row = result.scalar_one_or_none()

    if row and row.custom_logo:
        return Response(
            content=row.custom_logo,
            media_type=row.custom_logo_mime or "image/png",
            headers={"Cache-Control": "public, max-age=300"},
        )

    return Response(
        content=_get_default_logo(),
        media_type="image/png",
        headers={"Cache-Control": "public, max-age=300"},
    )


@router.get("/favicon")
async def get_favicon(db: AsyncSession = Depends(get_db)):
    """Public endpoint — favicon-friendly version of the logo.

    Returns the custom logo if set, otherwise a dark-blue recolored
    default that is visible on light browser chrome / bookmark bars.
    """
    result = await db.execute(
        select(AppSettings).where(AppSettings.id == "default")
    )
    row = result.scalar_one_or_none()

    if row and row.custom_logo:
        return Response(
            content=row.custom_logo,
            media_type=row.custom_logo_mime or "image/png",
            headers={"Cache-Control": "public, max-age=300"},
        )

    return Response(
        content=_get_default_favicon(),
        media_type="image/png",
        headers={"Cache-Control": "public, max-age=300"},
    )


@router.get("/logo/info")
async def get_logo_info(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Admin endpoint — returns metadata about the current logo."""
    _require_admin(user)
    result = await db.execute(select(AppSettings).where(AppSettings.id == "default"))
    row = result.scalar_one_or_none()

    has_custom = bool(row and row.custom_logo)
    return {
        "has_custom_logo": has_custom,
        "mime_type": (row.custom_logo_mime if has_custom else "image/png"),
    }


@router.post("/logo")
async def upload_logo(
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Admin endpoint — upload a custom logo."""
    _require_admin(user)

    content_type = file.content_type or ""
    if content_type not in ALLOWED_LOGO_MIMES:
        raise HTTPException(
            400,
            f"Unsupported file type: {content_type}. "
            "Allowed: PNG, JPEG, SVG, WebP, GIF.",
        )

    data = await file.read()
    if len(data) > MAX_LOGO_SIZE:
        raise HTTPException(400, f"Logo must be under {MAX_LOGO_SIZE // (1024 * 1024)} MB.")

    row = await _get_or_create_row(db)
    row.custom_logo = data
    row.custom_logo_mime = content_type
    await db.commit()

    return {"ok": True}


@router.delete("/logo")
async def reset_logo(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Admin endpoint — reset to the default logo."""
    _require_admin(user)

    row = await _get_or_create_row(db)
    row.custom_logo = None
    row.custom_logo_mime = None
    await db.commit()

    return {"ok": True}


# ---------------------------------------------------------------------------
# SSO / Entra ID endpoints
# ---------------------------------------------------------------------------

@router.get("/sso")
async def get_sso_settings(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Admin endpoint — get SSO configuration."""
    _require_admin(user)
    row = await _get_or_create_row(db)
    await db.commit()
    general = row.general_settings or {}
    sso = general.get("sso", {})
    return {
        "enabled": sso.get("enabled", False),
        "client_id": sso.get("client_id", ""),
        "client_secret": "••••••••" if sso.get("client_secret") else "",
        "tenant_id": sso.get("tenant_id", "organizations"),
    }


@router.patch("/sso")
async def update_sso_settings(
    body: SsoSettingsPayload,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Admin endpoint — update SSO configuration."""
    _require_admin(user)

    row = await _get_or_create_row(db)
    general = dict(row.general_settings or {})
    sso = dict(general.get("sso", {}))

    payload = body.model_dump()

    # Only overwrite client_secret if the caller sends a real value
    if payload.get("client_secret") in ("", "••••••••"):
        payload.pop("client_secret", None)

    sso.update(payload)
    general["sso"] = sso
    row.general_settings = general
    await db.commit()

    return {"ok": True}


@router.get("/sso/status")
async def get_sso_status(db: AsyncSession = Depends(get_db)):
    """Public endpoint — returns whether SSO is enabled (no secrets exposed)."""
    result = await db.execute(select(AppSettings).where(AppSettings.id == "default"))
    row = result.scalar_one_or_none()
    general = (row.general_settings if row else None) or {}
    sso = general.get("sso", {})
    return {"enabled": sso.get("enabled", False)}
