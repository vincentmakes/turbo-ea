"""Create standard_cards junction table.

Revision ID: 110
Revises: 109
Create Date: 2026-06-25 20:35:00.000000

"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "110"
down_revision = "109"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "standard_cards",
        sa.Column("standard_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("card_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("compliance_status", sa.String(20), nullable=False, server_default="pending_review"),
        sa.Column("evidence", sa.Text(), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["card_id"], ["cards.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["standard_id"], ["ea_standards.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("standard_id", "card_id"),
    )
    op.create_index(op.f("ix_standard_cards_card_id"), "standard_cards", ["card_id"], unique=False)
    op.create_index(op.f("ix_standard_cards_standard_id"), "standard_cards", ["standard_id"], unique=False)


def downgrade() -> None:
    op.drop_index(op.f("ix_standard_cards_standard_id"), table_name="standard_cards")
    op.drop_index(op.f("ix_standard_cards_card_id"), table_name="standard_cards")
    op.drop_table("standard_cards")
