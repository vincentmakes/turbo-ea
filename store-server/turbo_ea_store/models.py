"""Store data model.

- ``products``      — one row per sellable extension (maps to a Stripe Price)
- ``releases``      — uploaded ``.teax`` artifacts per extension version
- ``customers``     — one row per paying customer (keyed by Stripe customer id);
                      carries the hashed instance account token
- ``subscriptions`` — mirror of Stripe subscription state, the source of
                      entitlements (licenses are regenerated from these rows
                      on demand — nothing to invalidate)
- ``redeem_codes``  — one-time codes linking a purchase to a Turbo EA instance
"""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from turbo_ea_store.db import Base


class Product(Base):
    __tablename__ = "products"

    key: Mapped[str] = mapped_column(String(64), primary_key=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str] = mapped_column(Text, default="")
    stripe_price_id: Mapped[str] = mapped_column(String(255), nullable=False)
    display_price: Mapped[str] = mapped_column(String(64), default="")  # e.g. "€990 / year"
    plan: Mapped[str] = mapped_column(String(64), default="standard")
    active: Mapped[bool] = mapped_column(Boolean, default=True)
    sort_order: Mapped[int] = mapped_column(Integer, default=0)


class Release(Base):
    __tablename__ = "releases"
    __table_args__ = (UniqueConstraint("extension_key", "version"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    extension_key: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    version: Mapped[str] = mapped_column(String(32), nullable=False)
    filename: Mapped[str] = mapped_column(String(255), nullable=False)
    sha256: Mapped[str] = mapped_column(String(64), nullable=False)
    core_min: Mapped[str] = mapped_column(String(32), default="0.0.1")
    core_max_exclusive: Mapped[str | None] = mapped_column(String(32), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)


class Customer(Base):
    __tablename__ = "customers"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    email: Mapped[str] = mapped_column(String(320), nullable=False, index=True)
    stripe_customer_id: Mapped[str] = mapped_column(String(255), unique=True, nullable=False)
    # sha256 hex of the instance account token (the token itself is shown once)
    account_token_hash: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)


class Subscription(Base):
    __tablename__ = "subscriptions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    customer_id: Mapped[int] = mapped_column(
        ForeignKey("customers.id", ondelete="CASCADE"), nullable=False, index=True
    )
    extension_key: Mapped[str] = mapped_column(String(64), nullable=False)
    stripe_subscription_id: Mapped[str] = mapped_column(String(255), unique=True, nullable=False)
    status: Mapped[str] = mapped_column(String(32), default="active")
    current_period_end: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )


class RedeemCode(Base):
    __tablename__ = "redeem_codes"

    code: Mapped[str] = mapped_column(String(32), primary_key=True)
    customer_id: Mapped[int] = mapped_column(
        ForeignKey("customers.id", ondelete="CASCADE"), nullable=False, index=True
    )
    stripe_session_id: Mapped[str | None] = mapped_column(String(255), nullable=True, index=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
