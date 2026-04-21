"""Add risk register tables and finding→risk back-links.

Revision ID: 064
Revises: 063
"""

import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

from alembic import op

revision = "064"
down_revision = "063"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "risks",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("reference", sa.String(16), nullable=False, unique=True),
        sa.Column("title", sa.String(500), nullable=False),
        sa.Column("description", sa.Text(), nullable=False, server_default=""),
        sa.Column("category", sa.String(32), nullable=False, server_default="operational"),
        sa.Column("source_type", sa.String(32), nullable=False, server_default="manual"),
        sa.Column("source_ref", sa.String(64), nullable=True),
        sa.Column(
            "initial_probability",
            sa.String(16),
            nullable=False,
            server_default="medium",
        ),
        sa.Column("initial_impact", sa.String(16), nullable=False, server_default="medium"),
        sa.Column("initial_level", sa.String(16), nullable=False, server_default="medium"),
        sa.Column("mitigation", sa.Text(), nullable=True),
        sa.Column("residual_probability", sa.String(16), nullable=True),
        sa.Column("residual_impact", sa.String(16), nullable=True),
        sa.Column("residual_level", sa.String(16), nullable=True),
        sa.Column(
            "owner_id",
            UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("target_resolution_date", sa.Date(), nullable=True),
        sa.Column("status", sa.String(24), nullable=False, server_default="identified"),
        sa.Column("acceptance_rationale", sa.Text(), nullable=True),
        sa.Column(
            "accepted_by",
            UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("accepted_at", sa.DateTime(timezone=True), nullable=True),
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
    op.create_index("ix_risks_status", "risks", ["status"])
    op.create_index("ix_risks_category_status", "risks", ["category", "status"])
    op.create_index("ix_risks_initial_level", "risks", ["initial_level"])
    op.create_index("ix_risks_residual_level", "risks", ["residual_level"])
    op.create_index("ix_risks_owner_id", "risks", ["owner_id"])
    op.create_index("ix_risks_source_type", "risks", ["source_type"])

    op.create_table(
        "risk_cards",
        sa.Column(
            "risk_id",
            UUID(as_uuid=True),
            sa.ForeignKey("risks.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "card_id",
            UUID(as_uuid=True),
            sa.ForeignKey("cards.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("role", sa.String(32), nullable=False, server_default="affected"),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("risk_id", "card_id", name="pk_risk_cards"),
    )
    op.create_index("ix_risk_cards_card_id", "risk_cards", ["card_id"])
    op.create_index("ix_risk_cards_risk_id", "risk_cards", ["risk_id"])

    # Back-links from findings → risk (nullable; set only when promoted).
    op.add_column(
        "turbolens_cve_findings",
        sa.Column(
            "risk_id",
            UUID(as_uuid=True),
            sa.ForeignKey("risks.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )
    op.create_index(
        "ix_turbolens_cve_findings_risk_id",
        "turbolens_cve_findings",
        ["risk_id"],
    )

    op.add_column(
        "turbolens_compliance_findings",
        sa.Column(
            "risk_id",
            UUID(as_uuid=True),
            sa.ForeignKey("risks.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )
    op.create_index(
        "ix_turbolens_compliance_findings_risk_id",
        "turbolens_compliance_findings",
        ["risk_id"],
    )


def downgrade() -> None:
    op.drop_index(
        "ix_turbolens_compliance_findings_risk_id",
        table_name="turbolens_compliance_findings",
    )
    op.drop_column("turbolens_compliance_findings", "risk_id")

    op.drop_index(
        "ix_turbolens_cve_findings_risk_id",
        table_name="turbolens_cve_findings",
    )
    op.drop_column("turbolens_cve_findings", "risk_id")

    op.drop_index("ix_risk_cards_risk_id", table_name="risk_cards")
    op.drop_index("ix_risk_cards_card_id", table_name="risk_cards")
    op.drop_table("risk_cards")

    op.drop_index("ix_risks_source_type", table_name="risks")
    op.drop_index("ix_risks_owner_id", table_name="risks")
    op.drop_index("ix_risks_residual_level", table_name="risks")
    op.drop_index("ix_risks_initial_level", table_name="risks")
    op.drop_index("ix_risks_category_status", table_name="risks")
    op.drop_index("ix_risks_status", table_name="risks")
    op.drop_table("risks")
