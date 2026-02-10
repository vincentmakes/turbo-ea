from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.database import get_db
from app.models.user import User

router = APIRouter(prefix="/users", tags=["users"])


class UserUpdate(BaseModel):
    display_name: str | None = None
    role: str | None = None
    is_active: bool | None = None


@router.get("")
async def list_users(db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    result = await db.execute(select(User).order_by(User.display_name))
    return [
        {
            "id": str(u.id),
            "email": u.email,
            "display_name": u.display_name,
            "role": u.role,
            "is_active": u.is_active,
        }
        for u in result.scalars().all()
    ]


@router.patch("/{user_id}")
async def update_user(
    user_id: str,
    body: UserUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if current_user.role != "admin":
        raise HTTPException(403, "Admin only")
    result = await db.execute(select(User).where(User.id == uuid.UUID(user_id)))
    u = result.scalar_one_or_none()
    if not u:
        raise HTTPException(404, "User not found")
    for field, value in body.model_dump(exclude_unset=True).items():
        setattr(u, field, value)
    await db.commit()
    return {"id": str(u.id), "role": u.role, "is_active": u.is_active}
