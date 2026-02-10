"""Webhook management endpoints."""

import uuid

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.webhook import Webhook, WebhookStatus

router = APIRouter()


# --- Schemas ---


class WebhookCreate(BaseModel):
    name: str
    url: str
    secret: str | None = None
    event_types: list[str] | None = None


class WebhookUpdate(BaseModel):
    name: str | None = None
    url: str | None = None
    secret: str | None = None
    status: str | None = None
    event_types: list[str] | None = None


class WebhookResponse(BaseModel):
    id: str
    name: str
    url: str
    status: str
    event_types: list[str] | None
    last_delivery_at: str | None
    last_status_code: int | None
    failure_count: int
    created_at: str
    updated_at: str


class WebhookListResponse(BaseModel):
    items: list[WebhookResponse]
    total: int


# --- Helpers ---

def _to_response(w: Webhook) -> WebhookResponse:
    return WebhookResponse(
        id=str(w.id),
        name=w.name,
        url=w.url,
        status=w.status.value,
        event_types=w.event_types,
        last_delivery_at=w.last_delivery_at,
        last_status_code=w.last_status_code,
        failure_count=w.failure_count,
        created_at=w.created_at.isoformat() if w.created_at else "",
        updated_at=w.updated_at.isoformat() if w.updated_at else "",
    )


# --- Endpoints ---


@router.get("", response_model=WebhookListResponse)
async def list_webhooks(
    db: AsyncSession = Depends(get_db),
):
    """List all webhooks."""
    q = select(Webhook).order_by(Webhook.created_at.desc())
    items = list((await db.execute(q)).scalars().all())
    return WebhookListResponse(items=[_to_response(w) for w in items], total=len(items))


@router.post("", response_model=WebhookResponse, status_code=201)
async def create_webhook(
    data: WebhookCreate,
    db: AsyncSession = Depends(get_db),
):
    """Create a new webhook."""
    webhook = Webhook(
        name=data.name,
        url=data.url,
        secret=data.secret,
        event_types=data.event_types,
    )
    db.add(webhook)
    await db.flush()
    await db.refresh(webhook)
    return _to_response(webhook)


@router.get("/{webhook_id}", response_model=WebhookResponse)
async def get_webhook(
    webhook_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
):
    """Get a webhook by ID."""
    webhook = await db.get(Webhook, webhook_id)
    if not webhook:
        raise HTTPException(status_code=404, detail="Webhook not found")
    return _to_response(webhook)


@router.patch("/{webhook_id}", response_model=WebhookResponse)
async def update_webhook(
    webhook_id: uuid.UUID,
    data: WebhookUpdate,
    db: AsyncSession = Depends(get_db),
):
    """Update a webhook."""
    webhook = await db.get(Webhook, webhook_id)
    if not webhook:
        raise HTTPException(status_code=404, detail="Webhook not found")

    if data.name is not None:
        webhook.name = data.name
    if data.url is not None:
        webhook.url = data.url
    if data.secret is not None:
        webhook.secret = data.secret
    if data.status is not None:
        webhook.status = WebhookStatus(data.status)
    if data.event_types is not None:
        webhook.event_types = data.event_types

    await db.flush()
    await db.refresh(webhook)
    return _to_response(webhook)


@router.delete("/{webhook_id}", status_code=204)
async def delete_webhook(
    webhook_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
):
    """Delete a webhook."""
    webhook = await db.get(Webhook, webhook_id)
    if not webhook:
        raise HTTPException(status_code=404, detail="Webhook not found")
    await db.delete(webhook)


@router.post("/{webhook_id}/test", response_model=dict)
async def test_webhook(
    webhook_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
):
    """Send a test event to a webhook."""
    webhook = await db.get(Webhook, webhook_id)
    if not webhook:
        raise HTTPException(status_code=404, detail="Webhook not found")

    # Return info about what would be sent (actual HTTP delivery in production)
    return {
        "message": "Test event queued",
        "webhook_id": str(webhook.id),
        "url": webhook.url,
        "payload": {"event": "test", "timestamp": "now"},
    }
