from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.core.security import create_access_token, hash_password, verify_password
from app.database import get_db
from app.models.user import User
from app.schemas.auth import LoginRequest, RegisterRequest, TokenResponse, UserResponse

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/register", response_model=TokenResponse)
async def register(body: RegisterRequest, db: AsyncSession = Depends(get_db)):
    existing = await db.execute(select(User).where(User.email == body.email))
    if existing.scalar_one_or_none():
        raise HTTPException(400, "Email already registered")
    user = User(
        email=body.email,
        display_name=body.display_name,
        password_hash=hash_password(body.password),
        role="admin",  # first user gets admin
    )
    # Check if any users exist — first user is admin
    count = await db.execute(select(User).limit(1))
    if count.scalar_one_or_none() is not None:
        user.role = "member"
    db.add(user)
    await db.commit()
    await db.refresh(user)
    return TokenResponse(access_token=create_access_token(user.id, user.role))


@router.post("/login", response_model=TokenResponse)
async def login(body: LoginRequest, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(User).where(User.email == body.email))
    user = result.scalar_one_or_none()
    if not user or not verify_password(body.password, user.password_hash):
        raise HTTPException(401, "Invalid credentials")
    if not user.is_active:
        raise HTTPException(403, "Account disabled")
    return TokenResponse(access_token=create_access_token(user.id, user.role))


@router.get("/me", response_model=UserResponse)
async def me(user: User = Depends(get_current_user)):
    return UserResponse(
        id=str(user.id),
        email=user.email,
        display_name=user.display_name,
        role=user.role,
        is_active=user.is_active,
    )
