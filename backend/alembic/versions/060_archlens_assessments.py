"""ArchLens assessments table for persisting architecture AI sessions.

Revision ID: 060
Revises: 059
"""

import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB, UUID

from alembic import op

revision = "060"
down_revision = "059"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "archlens_assessments",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("title", sa.String(500), nullable=False),
        sa.Column("requirement", sa.Text, nullable=False),
        sa.Column("status", sa.String(50), nullable=False, server_default="saved"),
        sa.Column("session_data", JSONB, nullable=False),
        sa.Column(
            "initiative_id",
            UUID(as_uuid=True),
            sa.ForeignKey("cards.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column(
            "created_by",
            UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
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
    op.create_index("ix_archlens_assessments_created_by", "archlens_assessments", ["created_by"])
    op.create_index(
        "ix_archlens_assessments_initiative_id", "archlens_assessments", ["initiative_id"]
    )


def downgrade() -> None:
    # Use IF EXISTS because create_all() may have created the table without
    # these migration-only indexes (see CI migration-rollback test pattern).
    op.execute("DROP INDEX IF EXISTS ix_archlens_assessments_initiative_id")
    op.execute("DROP INDEX IF EXISTS ix_archlens_assessments_created_by")
    op.drop_table("archlens_assessments")
