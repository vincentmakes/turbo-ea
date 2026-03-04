"""AI-powered metadata suggestion endpoint."""

from __future__ import annotations

import logging

import httpx
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.config import settings as app_config
from app.core.encryption import decrypt_value
from app.database import get_db
from app.models.app_settings import AppSettings
from app.models.card_type import CardType
from app.models.ea_principle import EAPrinciple
from app.models.user import User
from app.schemas.ai_suggest import (
    AiSuggestRequest,
    AiSuggestResponse,
    PortfolioInsightsRequest,
    PortfolioInsightsResponse,
)
from app.services.ai_service import (
    fetch_running_models,
    generate_portfolio_insights,
    suggest_metadata,
)
from app.services.permission_service import PermissionService

logger = logging.getLogger("turboea.ai")

router = APIRouter(prefix="/ai", tags=["AI Suggestions"])


def _get_ai_config(general: dict) -> dict:
    """Resolve AI configuration from DB settings with env-var fallback."""
    ai = general.get("ai", {})
    encrypted_key = ai.get("apiKey", "")
    return {
        "enabled": ai.get("enabled", False),
        "provider_type": ai.get("providerType", "ollama"),
        "provider_url": ai.get("providerUrl") or app_config.AI_PROVIDER_URL,
        "api_key": decrypt_value(encrypted_key) if encrypted_key else "",
        "model": ai.get("model") or app_config.AI_MODEL,
        "search_provider": "duckduckgo",
        "search_url": "",
        "enabled_types": ai.get("enabledTypes", []),
        "portfolio_insights_enabled": ai.get("portfolioInsightsEnabled", False),
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

    # Commercial providers require an API key
    if ai_cfg["provider_type"] in ("openai", "anthropic") and not ai_cfg["api_key"]:
        raise HTTPException(
            status_code=400,
            detail="API key is required for commercial LLM providers.",
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
            provider_url=ai_cfg["provider_url"],
            model=ai_cfg["model"],
            context=body.context,
            provider_type=ai_cfg["provider_type"],
            api_key=ai_cfg["api_key"],
            fields_schema=card_type.fields_schema or [],
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


@router.post("/portfolio-insights", response_model=PortfolioInsightsResponse)
async def portfolio_insights(
    body: PortfolioInsightsRequest,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Generate AI-driven insights for the application portfolio report."""
    await PermissionService.require_permission(db, user, "ai.portfolio_insights")

    # Load AI configuration
    result = await db.execute(select(AppSettings).where(AppSettings.id == "default"))
    row = result.scalar_one_or_none()
    general = (row.general_settings if row else None) or {}
    ai_cfg = _get_ai_config(general)

    if not ai_cfg["portfolio_insights_enabled"]:
        raise HTTPException(
            status_code=400,
            detail="AI portfolio insights are not enabled. An admin must enable this in Settings.",
        )

    if not ai_cfg["provider_url"] or not ai_cfg["model"]:
        raise HTTPException(
            status_code=400,
            detail="AI provider URL and model must be configured in Settings.",
        )

    if ai_cfg["provider_type"] in ("openai", "anthropic") and not ai_cfg["api_key"]:
        raise HTTPException(
            status_code=400,
            detail="API key is required for commercial LLM providers.",
        )

    # Load active EA principles
    principles_result = await db.execute(
        select(EAPrinciple)
        .where(EAPrinciple.is_active == True)  # noqa: E712
        .order_by(EAPrinciple.sort_order)
    )
    principles = [
        {
            "title": p.title,
            "description": p.description or "",
            "rationale": p.rationale or "",
            "implications": p.implications or "",
        }
        for p in principles_result.scalars().all()
    ]

    try:
        result_data = await generate_portfolio_insights(
            summary=body.model_dump(),
            provider_url=ai_cfg["provider_url"],
            model=ai_cfg["model"],
            provider_type=ai_cfg["provider_type"],
            api_key=ai_cfg["api_key"],
            principles=principles,
        )
    except httpx.HTTPError as exc:
        logger.warning("AI portfolio insights failed: %s", exc)
        raise HTTPException(
            status_code=502,
            detail="Could not reach the AI provider. Check that it is running and accessible.",
        ) from exc
    except Exception as exc:
        logger.exception("AI portfolio insights failed")
        raise HTTPException(
            status_code=502,
            detail="AI portfolio insights failed. Check server logs for details.",
        ) from exc

    return PortfolioInsightsResponse(**result_data)


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
    has_suggest_perm = await PermissionService.check_permission(db, user, "ai.suggest")
    has_portfolio_perm = await PermissionService.check_permission(db, user, "ai.portfolio_insights")

    configured = bool(ai_cfg["provider_url"] and ai_cfg["model"])
    provider_type = ai_cfg["provider_type"]

    suggest_enabled = ai_cfg["enabled"] and has_suggest_perm
    portfolio_insights_enabled = (
        ai_cfg["portfolio_insights_enabled"] and has_portfolio_perm and configured
    )

    # Only fetch running models for Ollama (commercial providers have no such endpoint)
    running_models: list[str] = []
    if suggest_enabled and configured and provider_type == "ollama" and ai_cfg["provider_url"]:
        models = await fetch_running_models(ai_cfg["provider_url"])
        running_models = [m["name"] for m in models]

    return {
        "enabled": suggest_enabled,
        "configured": configured,
        "provider_type": provider_type,
        "enabled_types": ai_cfg["enabled_types"] if ai_cfg["enabled"] else [],
        "running_models": running_models,
        "model": ai_cfg["model"] if suggest_enabled else None,
        "portfolio_insights_enabled": portfolio_insights_enabled,
    }
