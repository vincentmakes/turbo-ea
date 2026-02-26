"""AI chat assistant — streaming endpoint for conversational EA queries.

Privacy:
  - Conversations are NEVER persisted to the database
  - Context is built from permission-filtered queries only
  - All LLM inference runs locally via Ollama — no data leaves the infrastructure
"""

from __future__ import annotations

import json
import logging

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.config import settings as app_config
from app.database import get_db
from app.models.app_settings import AppSettings
from app.models.user import User
from app.schemas.ai_chat import AiChatRequest
from app.services.ai_chat_service import build_chat_context, stream_chat_response
from app.services.permission_service import PermissionService

logger = logging.getLogger("turboea.ai.chat")

router = APIRouter(prefix="/ai", tags=["AI Chat"])


def _get_ai_config(general: dict) -> dict:
    """Resolve AI configuration from DB settings with env-var fallback."""
    ai = general.get("ai", {})
    return {
        "enabled": ai.get("enabled", False),
        "provider_url": ai.get("providerUrl") or app_config.AI_PROVIDER_URL,
        "model": ai.get("model") or app_config.AI_MODEL,
    }


@router.post("/chat")
async def chat(
    body: AiChatRequest,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Stream an AI chat response about the EA landscape.

    Returns a text/event-stream of Server-Sent Events.
    Each event is ``data: {"token": "..."}`` or ``data: {"done": true}``.
    """
    await PermissionService.require_permission(db, user, "ai.chat")

    # Load AI configuration
    result = await db.execute(select(AppSettings).where(AppSettings.id == "default"))
    row = result.scalar_one_or_none()
    general = (row.general_settings if row else None) or {}
    ai_cfg = _get_ai_config(general)

    if not ai_cfg["enabled"]:
        raise HTTPException(
            status_code=400,
            detail="AI is not enabled. An admin must configure this in Settings.",
        )
    if not ai_cfg["provider_url"] or not ai_cfg["model"]:
        raise HTTPException(
            status_code=400,
            detail="AI provider URL and model must be configured in Settings.",
        )

    # Build context from the landscape (permission-filtered)
    system_prompt = await build_chat_context(db, body.message, card_id=body.card_id)

    # Convert history to plain dicts for the LLM
    history = [{"role": m.role, "content": m.content} for m in body.history]

    async def event_stream():
        try:
            async for token in stream_chat_response(
                provider_url=ai_cfg["provider_url"],
                model=ai_cfg["model"],
                system_prompt=system_prompt,
                messages=history,
                user_message=body.message,
            ):
                yield f"data: {json.dumps({'token': token})}\n\n"
            yield f"data: {json.dumps({'done': True})}\n\n"
        except Exception:
            logger.exception("AI chat stream error")
            yield f"data: {json.dumps({'error': 'Stream interrupted'})}\n\n"

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )


@router.get("/chat/status")
async def chat_status(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Check if AI chat is available for the current user."""
    has_perm = await PermissionService.check_permission(db, user, "ai.chat")

    result = await db.execute(select(AppSettings).where(AppSettings.id == "default"))
    row = result.scalar_one_or_none()
    general = (row.general_settings if row else None) or {}
    ai_cfg = _get_ai_config(general)

    enabled = ai_cfg["enabled"] and has_perm
    configured = bool(ai_cfg["provider_url"] and ai_cfg["model"])

    return {
        "available": enabled and configured,
        "model": ai_cfg["model"] if enabled else None,
    }
