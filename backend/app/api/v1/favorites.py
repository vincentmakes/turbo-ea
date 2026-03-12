from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.database import get_db
from app.models.card import Card
from app.models.user import User
from app.models.user_favorite import UserFavorite

router = APIRouter(prefix="/favorites", tags=["favorites"])


@router.get("")
async def list_favorites(
    type: str | None = Query(None, description="Filter by card type key"),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """List current user's favorite cards."""
    stmt = (
        select(UserFavorite)
        .where(UserFavorite.user_id == user.id)
        .order_by(UserFavorite.created_at.desc())
    )

    if type:
        stmt = stmt.join(Card, UserFavorite.card_id == Card.id).where(Card.type == type)

    result = await db.execute(stmt)
    favorites = result.scalars().all()

    return [
        {
            "id": str(f.id),
            "card_id": str(f.card_id),
            "created_at": f.created_at.isoformat() if f.created_at else None,
        }
        for f in favorites
    ]


@router.post("/{card_id}", status_code=201)
async def add_favorite(
    card_id: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Add a card to favorites. Idempotent — returns 200 if already favorited."""
    cid = uuid.UUID(card_id)

    # Verify card exists
    card_result = await db.execute(select(Card).where(Card.id == cid))
    if not card_result.scalar_one_or_none():
        raise HTTPException(404, "Card not found")

    # Check if already favorited
    existing = await db.execute(
        select(UserFavorite).where(
            UserFavorite.user_id == user.id,
            UserFavorite.card_id == cid,
        )
    )
    if existing.scalar_one_or_none():
        return {"status": "already_favorited"}

    fav = UserFavorite(user_id=user.id, card_id=cid)
    db.add(fav)
    await db.commit()

    return {
        "id": str(fav.id),
        "card_id": str(fav.card_id),
        "created_at": fav.created_at.isoformat() if fav.created_at else None,
    }


@router.delete("/{card_id}", status_code=204)
async def remove_favorite(
    card_id: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Remove a card from favorites."""
    cid = uuid.UUID(card_id)
    result = await db.execute(
        select(UserFavorite).where(
            UserFavorite.user_id == user.id,
            UserFavorite.card_id == cid,
        )
    )
    fav = result.scalar_one_or_none()
    if not fav:
        raise HTTPException(404, "Favorite not found")

    await db.delete(fav)
    await db.commit()
