"""Custom EOL products: end-of-life data for products endoflife.date lacks.

Two tables:

* ``eol_custom_products`` — a product defined once by the organisation, keyed
  by an immutable slug. Cards link to it through the same two attributes an
  endoflife.date link uses, with the product stored as ``custom:<key>``.
* ``eol_custom_cycles`` — its release cycles, shaped after an endoflife.date
  cycle (``eol`` / ``support`` are a date string, ``true`` or ``false``), keyed
  to the product by its slug so a workspace transfer upserts both by natural
  key.

Revision ID: 164
Revises: 163
Create Date: 2026-11-04
"""

from typing import Sequence, Union

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "164"
down_revision: Union[str, None] = "163"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _timestamps() -> list[sa.Column]:
    # The ORM leaves both stamps out of the INSERT and relies on these
    # defaults (TimestampMixin), so they must exist on an upgraded install.
    return [
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
    ]


def upgrade() -> None:
    op.create_table(
        "eol_custom_products",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("key", sa.String(length=100), nullable=False, unique=True),
        sa.Column("title", sa.String(length=200), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("link", sa.String(length=500), nullable=True),
        sa.Column(
            "created_by",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        *_timestamps(),
    )
    op.create_table(
        "eol_custom_cycles",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "product_key",
            sa.String(length=100),
            sa.ForeignKey("eol_custom_products.key", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("cycle", sa.String(length=100), nullable=False),
        sa.Column("release_date", sa.String(length=10), nullable=True),
        sa.Column("support", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("eol", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("latest", sa.String(length=100), nullable=True),
        sa.Column("latest_release_date", sa.String(length=10), nullable=True),
        sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"),
        *_timestamps(),
        sa.UniqueConstraint("product_key", "cycle", name="uq_eol_custom_cycles_product_cycle"),
    )
    op.create_index("ix_eol_custom_cycles_product_key", "eol_custom_cycles", ["product_key"])


def downgrade() -> None:
    op.drop_index("ix_eol_custom_cycles_product_key", table_name="eol_custom_cycles")
    op.drop_table("eol_custom_cycles")
    op.drop_table("eol_custom_products")
