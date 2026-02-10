from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.database import get_db
from app.models.subscription import Subscription
from app.models.user import User
from app.schemas.common import SubscriptionCreate

router = APIRouter(tags=["subscriptions"])


@router.get("/fact-sheets/{fs_id}/subscriptions")
async def list_subscriptions(fs_id: str, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(Subscription).where(Subscription.fact_sheet_id == uuid.UUID(fs_id))
    )
    subs = result.scalars().all()
    return [
        {
            "id": str(s.id),
            "user_id": str(s.user_id),
            "user_display_name": s.user.display_name if s.user else None,
            "user_email": s.user.email if s.user else None,
            "role": s.role,
            "created_at": s.created_at.isoformat() if s.created_at else None,
        }
        for s in subs
    ]


@router.post("/fact-sheets/{fs_id}/subscriptions", status_code=201)
async def create_subscription(
    fs_id: str,
    body: SubscriptionCreate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    sub = Subscription(
        fact_sheet_id=uuid.UUID(fs_id),
        user_id=uuid.UUID(body.user_id),
        role=body.role,
    )
    db.add(sub)
    await db.commit()
    await db.refresh(sub)
    return {"id": str(sub.id), "user_id": str(sub.user_id), "role": sub.role}


@router.delete("/subscriptions/{sub_id}", status_code=204)
async def delete_subscription(
    sub_id: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    result = await db.execute(select(Subscription).where(Subscription.id == uuid.UUID(sub_id)))
    sub = result.scalar_one_or_none()
    if not sub:
        raise HTTPException(404, "Subscription not found")
    await db.delete(sub)
    await db.commit()
