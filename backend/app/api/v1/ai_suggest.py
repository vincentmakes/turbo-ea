"""AI-powered metadata suggestion endpoint."""

from __future__ import annotations

import logging

import httpx
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.config import settings as app_config
from app.database import get_db
from app.models.app_settings import AppSettings
from app.models.card_type import CardType
from app.models.user import User
from app.schemas.ai_suggest import AiSuggestRequest, AiSuggestResponse
from app.services.ai_service import fetch_running_models, suggest_metadata
from app.services.permission_service import PermissionService

logger = logging.getLogger("turboea.ai")

router = APIRouter(prefix="/ai", tags=["AI Suggestions"])


def _get_ai_config(general: dict) -> dict:
    """Resolve AI configuration from DB settings with env-var fallback."""
    ai = general.get("ai", {})
    return {
        "enabled": ai.get("enabled", False),
        "provider_url": ai.get("providerUrl") or app_config.AI_PROVIDER_URL,
        "model": ai.get("model") or app_config.AI_MODEL,
        "search_provider": (
            ai.get("searchProvider") or app_config.AI_SEARCH_PROVIDER or "duckduckgo"
        ),
        "search_url": ai.get("searchUrl") or app_config.AI_SEARCH_URL,
        "enabled_types": ai.get("enabledTypes", []),
    }


@router.post("/suggest", response_model=AiSuggestResponse)
async def suggest(
    body: AiSuggestRequest,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Generate AI-powered metadata suggestions for a card.

    Uses a two-step pipeline: web search → local LLM extraction.
    """
    await PermissionService.require_permission(db, user, "ai.suggest")

    # Load AI configuration
    result = await db.execute(select(AppSettings).where(AppSettings.id == "default"))
    row = result.scalar_one_or_none()
    general = (row.general_settings if row else None) or {}
    ai_cfg = _get_ai_config(general)

    if not ai_cfg["enabled"]:
        raise HTTPException(
            status_code=400,
            detail="AI suggestions are not enabled. An admin must configure this in Settings.",
        )

    if not ai_cfg["provider_url"] or not ai_cfg["model"]:
        raise HTTPException(
            status_code=400,
            detail="AI provider URL and model must be configured in Settings.",
        )

    # Validate that the card type is enabled for AI suggestions
    if ai_cfg["enabled_types"] and body.type_key not in ai_cfg["enabled_types"]:
        raise HTTPException(
            status_code=400,
            detail=f"AI suggestions are not enabled for card type '{body.type_key}'.",
        )

    # Fetch the card type definition
    ct_result = await db.execute(select(CardType).where(CardType.key == body.type_key))
    card_type = ct_result.scalar_one_or_none()
    if not card_type:
        raise HTTPException(status_code=404, detail=f"Card type '{body.type_key}' not found")

    try:
        result_data = await suggest_metadata(
            name=body.name,
            type_key=body.type_key,
            type_label=card_type.label,
            subtype=body.subtype,
            fields_schema=card_type.fields_schema or [],
            provider_url=ai_cfg["provider_url"],
            model=ai_cfg["model"],
            search_provider=ai_cfg["search_provider"],
            search_url=ai_cfg["search_url"],
            context=body.context,
        )
    except httpx.HTTPError as exc:
        logger.warning("AI suggestion failed for '%s': %s", body.name, exc)
        raise HTTPException(
            status_code=502,
            detail="Could not reach the AI provider. Check that it is running and accessible.",
        ) from exc
    except Exception as exc:
        logger.exception("AI suggestion failed for '%s'", body.name)
        raise HTTPException(
            status_code=502,
            detail="AI suggestion failed. Check server logs for details.",
        ) from exc

    return AiSuggestResponse(**result_data)


@router.get("/status")
async def ai_status(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Check whether AI suggestions are enabled and configured.

    Returns the status without exposing secrets.
    """
    result = await db.execute(select(AppSettings).where(AppSettings.id == "default"))
    row = result.scalar_one_or_none()
    general = (row.general_settings if row else None) or {}
    ai_cfg = _get_ai_config(general)

    # Check if user has the permission
    has_perm = await PermissionService.check_permission(db, user, "ai.suggest")

    enabled = ai_cfg["enabled"] and has_perm
    configured = bool(ai_cfg["provider_url"] and ai_cfg["model"])

    # Try to fetch the currently loaded model from Ollama
    running_models: list[str] = []
    if enabled and configured and ai_cfg["provider_url"]:
        models = await fetch_running_models(ai_cfg["provider_url"])
        running_models = [m["name"] for m in models]

    return {
        "enabled": enabled,
        "configured": configured,
        "enabled_types": ai_cfg["enabled_types"] if ai_cfg["enabled"] else [],
        "running_models": running_models,
        "model": ai_cfg["model"] if enabled else None,
    }
