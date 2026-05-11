"""Create ai_governance_classifications cache table.

Backs the GRC AI Inventory dashboard. One row per card detected as
AI-bearing (subtype match or LLM semantic detection). Refreshed by
``POST /grc/ai-inventory/discover``; read by ``GET /grc/ai-inventory``.

Revision ID: 076
Revises: 075
"""

import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

from alembic import op

revision = "076"
down_revision = "075"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "ai_governance_classifications",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "card_id",
            UUID(as_uuid=True),
            sa.ForeignKey("cards.id", ondelete="CASCADE"),
            nullable=False,
            unique=True,
        ),
        sa.Column("detected_role", sa.String(50), nullable=False, server_default="embedded"),
        sa.Column("confidence", sa.Float, nullable=False, server_default="0"),
        sa.Column(
            "subtype_match",
            sa.Boolean,
            nullable=False,
            server_default=sa.text("false"),
        ),
        sa.Column("signal", sa.Text, nullable=False, server_default=""),
        sa.Column(
            "detected_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
    )
    op.create_index(
        "ix_ai_governance_classifications_card_id",
        "ai_governance_classifications",
        ["card_id"],
    )


def downgrade() -> None:
    op.drop_index(
        "ix_ai_governance_classifications_card_id",
        table_name="ai_governance_classifications",
    )
    op.drop_table("ai_governance_classifications")
