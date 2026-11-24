from __future__ import annotations

import uuid
from datetime import date
from decimal import Decimal
from typing import Any

from sqlalchemy import CheckConstraint, Date, ForeignKey, ForeignKeyConstraint, Index, Numeric, Text
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin, UUIDMixin


class PpmInvoice(Base, UUIDMixin, TimestampMixin):
    __tablename__ = "ppm_invoices"
    __table_args__ = (
        ForeignKeyConstraint(
            ["initiative_id", "cost_item_id"],
            ["ppm_cost_lines.initiative_id", "ppm_cost_lines.id"],
            name="fk_ppm_invoice_cost",
            deferrable=True,
            initially="DEFERRED",
        ),
        CheckConstraint(
            "amount >= 0 AND amount < 'Infinity'::numeric", name="ck_ppm_invoice_amount_nonnegative"
        ),
        Index("ix_ppm_invoice_initiative_cost", "initiative_id", "cost_item_id"),
    )

    initiative_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("cards.id", ondelete="CASCADE"), nullable=False
    )
    cost_item_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)
    invoice_date: Mapped[date] = mapped_column(Date, nullable=False)
    invoice_id: Mapped[str] = mapped_column(Text, nullable=False)
    amount: Mapped[Decimal] = mapped_column(Numeric, nullable=False)
    field_values: Mapped[dict[str, Any]] = mapped_column(
        JSONB, nullable=False, default=dict, server_default="{}"
    )
