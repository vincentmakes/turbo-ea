"""Admin-only application settings — email / SMTP configuration + logo management."""

from __future__ import annotations

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from fastapi.responses import RedirectResponse, Response
from pydantic import BaseModel
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.config import settings as app_config
from app.core.encryption import decrypt_value, encrypt_value
from app.database import get_db
from app.models.app_settings import AppSettings
from app.models.card_type import CardType
from app.models.relation_type import RelationType
from app.models.user import User
from app.services.permission_service import PermissionService

router = APIRouter(prefix="/settings", tags=["settings"])

ALLOWED_LOGO_MIMES = {"image/png", "image/jpeg", "image/webp", "image/gif"}
MAX_LOGO_SIZE = 2 * 1024 * 1024  # 2 MB


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
    provider: str = "microsoft"  # microsoft | google | okta | oidc
    client_id: str = ""
    client_secret: str = ""
    tenant_id: str = "organizations"  # Microsoft: "organizations" or specific tenant ID
    domain: str = ""  # Google: hosted domain filter; Okta: Okta domain (e.g. dev-12345.okta.com)
    issuer_url: str = ""  # Generic OIDC: issuer URL (e.g. https://auth.example.com/realms/myapp)
    # Optional manual OIDC endpoints — override auto-discovery when the backend
    # cannot reach the provider's /.well-known/openid-configuration endpoint
    # (e.g. Docker networking issues, self-signed certificates on local network).
    authorization_endpoint: str = ""
    token_endpoint: str = ""
    jwks_uri: str = ""


DEFAULT_CURRENCY = "USD"


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


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
        app_config.SMTP_PASSWORD = decrypt_value(email["smtp_password"])
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
    await PermissionService.require_permission(db, user, "admin.settings")
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
    await PermissionService.require_permission(db, user, "admin.settings")
    row = await _get_or_create_row(db)

    email = dict(row.email_settings or {})
    payload = body.model_dump()

    # Only overwrite password if the caller sends a real value (not the masked placeholder)
    if payload.get("smtp_password") in ("", "••••••••"):
        payload.pop("smtp_password", None)
    elif payload.get("smtp_password"):
        payload["smtp_password"] = encrypt_value(payload["smtp_password"])

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
    await PermissionService.require_permission(db, user, "admin.settings")

    from app.services.email_service import send_notification_email

    try:
        await send_notification_email(
            to=user.email,
            title="Test Email from Turbo EA",
            message="If you received this, your email settings are configured correctly.",
            link="/admin/settings",
        )
    except Exception:
        import logging

        logging.getLogger(__name__).exception("Failed to send test email")
        raise HTTPException(502, "Failed to send test email. Check SMTP settings and server logs.")

    return {"ok": True, "sent_to": user.email}


# ---------------------------------------------------------------------------
# Currency endpoint
# ---------------------------------------------------------------------------


@router.get("/currency")
async def get_currency(db: AsyncSession = Depends(get_db)):
    """Public endpoint — returns the configured display currency."""
    result = await db.execute(select(AppSettings).where(AppSettings.id == "default"))
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
    await PermissionService.require_permission(db, user, "admin.settings")

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
    result = await db.execute(select(AppSettings).where(AppSettings.id == "default"))
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

    Also toggles is_hidden on the BusinessProcess card type and all
    relation types that touch BusinessProcess, so that cards, relations,
    and reports are properly hidden/shown across the entire platform.
    """
    await PermissionService.require_permission(db, user, "admin.settings")

    row = await _get_or_create_row(db)
    general = dict(row.general_settings or {})
    general["bpmEnabled"] = body.enabled
    row.general_settings = general

    # Toggle is_hidden on the BusinessProcess card type
    hide = not body.enabled
    fst_result = await db.execute(select(CardType).where(CardType.key == "BusinessProcess"))
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
    result = await db.execute(select(AppSettings).where(AppSettings.id == "default"))
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
    await PermissionService.require_permission(db, user, "admin.settings")

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

    # No custom logo — redirect to the static default in frontend/public/
    return RedirectResponse(url="/logo.png", status_code=302)


@router.get("/favicon")
async def get_favicon(db: AsyncSession = Depends(get_db)):
    """Public endpoint — returns the current favicon.

    Priority: custom favicon → default favicon.
    """
    result = await db.execute(select(AppSettings).where(AppSettings.id == "default"))
    row = result.scalar_one_or_none()

    if row and row.custom_favicon:
        return Response(
            content=row.custom_favicon,
            media_type=row.custom_favicon_mime or "image/png",
            headers={"Cache-Control": "public, max-age=300"},
        )

    # No custom favicon — redirect to the static default in frontend/public/
    return RedirectResponse(url="/favicon.png", status_code=302)


@router.get("/logo/info")
async def get_logo_info(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Admin endpoint — returns metadata about the current logo."""
    await PermissionService.require_permission(db, user, "admin.settings")
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
    await PermissionService.require_permission(db, user, "admin.settings")

    content_type = file.content_type or ""
    if content_type not in ALLOWED_LOGO_MIMES:
        raise HTTPException(
            400,
            f"Unsupported file type: {content_type}. Allowed: PNG, JPEG, WebP, GIF.",
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
    await PermissionService.require_permission(db, user, "admin.settings")

    row = await _get_or_create_row(db)
    row.custom_logo = None
    row.custom_logo_mime = None
    await db.commit()

    return {"ok": True}


# ---------------------------------------------------------------------------
# Favicon endpoints
# ---------------------------------------------------------------------------


@router.get("/favicon/info")
async def get_favicon_info(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Admin endpoint — returns metadata about the current favicon."""
    await PermissionService.require_permission(db, user, "admin.settings")
    result = await db.execute(select(AppSettings).where(AppSettings.id == "default"))
    row = result.scalar_one_or_none()

    has_custom = bool(row and row.custom_favicon)
    return {
        "has_custom_favicon": has_custom,
        "mime_type": (row.custom_favicon_mime if has_custom else "image/png"),
    }


@router.post("/favicon")
async def upload_favicon(
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Admin endpoint — upload a custom favicon."""
    await PermissionService.require_permission(db, user, "admin.settings")

    content_type = file.content_type or ""
    if content_type not in ALLOWED_LOGO_MIMES:
        raise HTTPException(
            400,
            f"Unsupported file type: {content_type}. Allowed: PNG, JPEG, WebP, GIF.",
        )

    data = await file.read()
    if len(data) > MAX_LOGO_SIZE:
        raise HTTPException(400, f"Favicon must be under {MAX_LOGO_SIZE // (1024 * 1024)} MB.")

    row = await _get_or_create_row(db)
    row.custom_favicon = data
    row.custom_favicon_mime = content_type
    await db.commit()

    return {"ok": True}


@router.delete("/favicon")
async def reset_favicon(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Admin endpoint — reset to the default favicon."""
    await PermissionService.require_permission(db, user, "admin.settings")

    row = await _get_or_create_row(db)
    row.custom_favicon = None
    row.custom_favicon_mime = None
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
    await PermissionService.require_permission(db, user, "admin.settings")
    row = await _get_or_create_row(db)
    await db.commit()
    general = row.general_settings or {}
    sso = general.get("sso", {})
    return {
        "enabled": sso.get("enabled", False),
        "provider": sso.get("provider", "microsoft"),
        "client_id": sso.get("client_id", ""),
        "client_secret": "••••••••" if sso.get("client_secret") else "",
        "tenant_id": sso.get("tenant_id", "organizations"),
        "domain": sso.get("domain", ""),
        "issuer_url": sso.get("issuer_url", ""),
        "authorization_endpoint": sso.get("authorization_endpoint", ""),
        "token_endpoint": sso.get("token_endpoint", ""),
        "jwks_uri": sso.get("jwks_uri", ""),
    }


@router.patch("/sso")
async def update_sso_settings(
    body: SsoSettingsPayload,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Admin endpoint — update SSO configuration."""
    await PermissionService.require_permission(db, user, "admin.settings")

    row = await _get_or_create_row(db)
    general = dict(row.general_settings or {})
    sso = dict(general.get("sso", {}))

    payload = body.model_dump()

    # Validate provider
    valid_providers = {"microsoft", "google", "okta", "oidc"}
    if payload.get("provider") and payload["provider"] not in valid_providers:
        opts = ", ".join(valid_providers)
        raise HTTPException(400, f"Invalid SSO provider: {opts}")

    # Only overwrite client_secret if the caller sends a real value
    if payload.get("client_secret") in ("", "••••••••"):
        payload.pop("client_secret", None)
    elif payload.get("client_secret"):
        payload["client_secret"] = encrypt_value(payload["client_secret"])

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


# ---------------------------------------------------------------------------
# Self-registration toggle
# ---------------------------------------------------------------------------


class RegistrationPayload(BaseModel):
    enabled: bool


@router.get("/registration")
async def get_registration_settings(db: AsyncSession = Depends(get_db)):
    """Public endpoint — returns whether self-registration is enabled."""
    result = await db.execute(select(AppSettings).where(AppSettings.id == "default"))
    row = result.scalar_one_or_none()
    general = (row.general_settings if row else None) or {}
    return {"enabled": general.get("registrationEnabled", True)}


@router.patch("/registration")
async def update_registration_settings(
    body: RegistrationPayload,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Admin endpoint — enable or disable self-registration."""
    await PermissionService.require_permission(db, user, "admin.settings")

    row = await _get_or_create_row(db)
    general = dict(row.general_settings or {})
    general["registrationEnabled"] = body.enabled
    row.general_settings = general
    await db.commit()

    return {"ok": True}


# ---------------------------------------------------------------------------
# Enabled locales
# ---------------------------------------------------------------------------

# ---------------------------------------------------------------------------
# AI settings
# ---------------------------------------------------------------------------


_AI_KEY_MASK = "\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022"
_VALID_PROVIDER_TYPES = {"ollama", "openai", "anthropic"}


class AiSettingsPayload(BaseModel):
    enabled: bool = False
    provider_type: str = "ollama"
    provider_url: str = ""
    api_key: str = ""
    model: str = ""
    search_provider: str = "duckduckgo"
    search_url: str = ""
    enabled_types: list[str] = []
    portfolio_insights_enabled: bool = False


def _migrate_ai_cfg(ai: dict) -> dict:
    """Ensure legacy AI config has the new split fields."""
    # Old structure stored a single "enabled" that controlled descriptions.
    # New structure keeps "enabled" for descriptions and adds
    # "portfolioInsightsEnabled" for portfolio insights.
    if "portfolioInsightsEnabled" not in ai:
        ai["portfolioInsightsEnabled"] = False
    return ai


@router.get("/ai")
async def get_ai_settings(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Admin endpoint — get AI configuration."""
    await PermissionService.require_permission(db, user, "admin.settings")
    row = await _get_or_create_row(db)
    await db.commit()
    general = row.general_settings or {}
    ai = _migrate_ai_cfg(general.get("ai", {}))
    api_key_stored = ai.get("apiKey", "")
    return {
        "enabled": ai.get("enabled", False),
        "provider_type": ai.get("providerType", "ollama"),
        "provider_url": ai.get("providerUrl", ""),
        "api_key": _AI_KEY_MASK if api_key_stored else "",
        "model": ai.get("model", ""),
        "search_provider": ai.get("searchProvider", "duckduckgo"),
        "search_url": ai.get("searchUrl", ""),
        "enabled_types": ai.get("enabledTypes", []),
        "portfolio_insights_enabled": ai.get("portfolioInsightsEnabled", False),
    }


@router.patch("/ai")
async def update_ai_settings(
    body: AiSettingsPayload,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Admin endpoint — update AI configuration."""
    await PermissionService.require_permission(db, user, "admin.settings")

    provider_type = body.provider_type
    if provider_type not in _VALID_PROVIDER_TYPES:
        raise HTTPException(
            400,
            f"Invalid provider_type '{provider_type}'. "
            f"Must be one of: {', '.join(sorted(_VALID_PROVIDER_TYPES))}",
        )

    row = await _get_or_create_row(db)
    general = dict(row.general_settings or {})
    prev_ai = general.get("ai", {})

    # Encrypt API key (preserve existing if masked or empty)
    new_api_key = body.api_key
    if new_api_key == _AI_KEY_MASK or (not new_api_key and prev_ai.get("apiKey")):
        encrypted_key = prev_ai.get("apiKey", "")
    elif new_api_key:
        encrypted_key = encrypt_value(new_api_key)
    else:
        encrypted_key = ""

    # Default Anthropic URL if not provided
    provider_url = body.provider_url
    if provider_type == "anthropic" and not provider_url:
        provider_url = "https://api.anthropic.com"

    general["ai"] = {
        "enabled": body.enabled,
        "providerType": provider_type,
        "providerUrl": provider_url,
        "apiKey": encrypted_key,
        "model": body.model,
        "searchProvider": "duckduckgo",
        "searchUrl": "",
        "enabledTypes": body.enabled_types,
        "portfolioInsightsEnabled": body.portfolio_insights_enabled,
    }
    row.general_settings = general
    await db.commit()

    return {"ok": True}


@router.post("/ai/test")
async def test_ai_connection(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Admin endpoint — test connectivity to the AI provider."""
    import httpx as _httpx

    from app.services.ai_service import check_provider_connection

    await PermissionService.require_permission(db, user, "admin.settings")

    row = await _get_or_create_row(db)
    await db.commit()
    general = row.general_settings or {}
    ai = general.get("ai", {})
    provider_type = ai.get("providerType", "ollama")
    provider_url = ai.get("providerUrl", "")
    model = ai.get("model", "")
    encrypted_key = ai.get("apiKey", "")

    if not provider_url and provider_type != "anthropic":
        raise HTTPException(400, "AI provider URL is not configured.")

    # Use default Anthropic URL if not set
    if provider_type == "anthropic" and not provider_url:
        provider_url = "https://api.anthropic.com"

    # Decrypt API key for the test
    api_key = decrypt_value(encrypted_key) if encrypted_key else ""

    if provider_type in ("openai", "anthropic") and not api_key:
        raise HTTPException(400, "API key is required for commercial LLM providers.")

    try:
        result = await check_provider_connection(
            provider_url=provider_url,
            provider_type=provider_type,
            api_key=api_key,
            model=model,
        )
    except _httpx.HTTPError as exc:
        raise HTTPException(502, str(exc)) from exc

    return result


SUPPORTED_LOCALES = ["en", "de", "fr", "es", "it", "pt", "zh"]


class EnabledLocalesPayload(BaseModel):
    locales: list[str]


@router.get("/enabled-locales")
async def get_enabled_locales(db: AsyncSession = Depends(get_db)):
    """Public endpoint — returns which locales are enabled (defaults to all)."""
    result = await db.execute(select(AppSettings).where(AppSettings.id == "default"))
    row = result.scalar_one_or_none()
    general = (row.general_settings if row else None) or {}
    locales = general.get("enabledLocales", SUPPORTED_LOCALES)
    return {"locales": locales}


@router.patch("/enabled-locales")
async def update_enabled_locales(
    body: EnabledLocalesPayload,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Admin endpoint — set which locales are available to users."""
    await PermissionService.require_permission(db, user, "admin.settings")

    # Validate — must be a subset of supported locales, at least one
    valid = [loc for loc in body.locales if loc in SUPPORTED_LOCALES]
    if not valid:
        raise HTTPException(status_code=400, detail="At least one valid locale is required.")

    row = await _get_or_create_row(db)
    general = dict(row.general_settings or {})
    general["enabledLocales"] = valid
    row.general_settings = general
    await db.commit()

    return {"locales": valid}


# ---------------------------------------------------------------------------
# MCP integration settings
# ---------------------------------------------------------------------------


class McpSettingsPayload(BaseModel):
    enabled: bool = False


@router.get("/mcp")
async def get_mcp_settings(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Admin endpoint — get MCP integration configuration."""
    await PermissionService.require_permission(db, user, "admin.mcp")
    row = await _get_or_create_row(db)
    await db.commit()
    general = row.general_settings or {}
    mcp = general.get("mcp", {})
    sso = general.get("sso", {})
    return {
        "enabled": mcp.get("enabled", False),
        "sso_configured": bool(sso.get("enabled")),
    }


@router.patch("/mcp")
async def update_mcp_settings(
    body: McpSettingsPayload,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Admin endpoint — enable or disable MCP integration."""
    await PermissionService.require_permission(db, user, "admin.mcp")

    row = await _get_or_create_row(db)
    general = dict(row.general_settings or {})
    mcp = dict(general.get("mcp", {}))
    mcp["enabled"] = body.enabled
    general["mcp"] = mcp
    row.general_settings = general
    await db.commit()

    return {"ok": True}


@router.get("/mcp/status")
async def get_mcp_status(db: AsyncSession = Depends(get_db)):
    """Public endpoint — returns MCP + SSO availability (no secrets exposed).
    Used by the MCP server to check if it should operate."""
    result = await db.execute(select(AppSettings).where(AppSettings.id == "default"))
    row = result.scalar_one_or_none()
    general = (row.general_settings if row else None) or {}
    mcp = general.get("mcp", {})
    sso = general.get("sso", {})
    return {
        "enabled": mcp.get("enabled", False),
        "sso_configured": bool(sso.get("enabled")),
    }
