"""Add TurboLens security & compliance findings tables.

Revision ID: 063
Revises: 062
"""

import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB, UUID

from alembic import op

revision = "063"
down_revision = "062"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "turbolens_cve_findings",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "run_id",
            UUID(as_uuid=True),
            sa.ForeignKey("turbolens_analysis_runs.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "card_id",
            UUID(as_uuid=True),
            sa.ForeignKey("cards.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("card_type", sa.String(64), nullable=False),
        sa.Column("cve_id", sa.String(32), nullable=False),
        sa.Column("vendor", sa.String(255), nullable=False, server_default=""),
        sa.Column("product", sa.String(255), nullable=False, server_default=""),
        sa.Column("version", sa.String(128), nullable=True),
        sa.Column("cvss_score", sa.Float(), nullable=True),
        sa.Column("cvss_vector", sa.String(128), nullable=True),
        sa.Column("severity", sa.String(16), nullable=False, server_default="unknown"),
        sa.Column("attack_vector", sa.String(16), nullable=True),
        sa.Column("exploitability_score", sa.Float(), nullable=True),
        sa.Column("impact_score", sa.Float(), nullable=True),
        sa.Column("patch_available", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("published_date", sa.Date(), nullable=True),
        sa.Column("last_modified_date", sa.Date(), nullable=True),
        sa.Column("description", sa.Text(), nullable=False, server_default=""),
        sa.Column("nvd_references", JSONB, nullable=True),
        sa.Column("priority", sa.String(16), nullable=False, server_default="medium"),
        sa.Column("probability", sa.String(16), nullable=False, server_default="medium"),
        sa.Column("business_impact", sa.Text(), nullable=True),
        sa.Column("remediation", sa.Text(), nullable=True),
        sa.Column("status", sa.String(16), nullable=False, server_default="open"),
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
        "ix_turbolens_cve_findings_card_id_severity",
        "turbolens_cve_findings",
        ["card_id", "severity"],
    )
    op.create_index("ix_turbolens_cve_findings_run_id", "turbolens_cve_findings", ["run_id"])
    op.create_index("ix_turbolens_cve_findings_status", "turbolens_cve_findings", ["status"])
    op.create_index("ix_turbolens_cve_findings_cve_id", "turbolens_cve_findings", ["cve_id"])
    op.create_index("ix_turbolens_cve_findings_severity", "turbolens_cve_findings", ["severity"])
    op.create_index("ix_turbolens_cve_findings_priority", "turbolens_cve_findings", ["priority"])

    op.create_table(
        "turbolens_compliance_findings",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "run_id",
            UUID(as_uuid=True),
            sa.ForeignKey("turbolens_analysis_runs.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("regulation", sa.String(32), nullable=False),
        sa.Column("regulation_article", sa.String(128), nullable=True),
        sa.Column(
            "card_id",
            UUID(as_uuid=True),
            sa.ForeignKey("cards.id", ondelete="CASCADE"),
            nullable=True,
        ),
        sa.Column("scope_type", sa.String(16), nullable=False, server_default="landscape"),
        sa.Column("category", sa.String(64), nullable=False, server_default=""),
        sa.Column("requirement", sa.Text(), nullable=False, server_default=""),
        sa.Column("status", sa.String(24), nullable=False, server_default="review_needed"),
        sa.Column("severity", sa.String(16), nullable=False, server_default="info"),
        sa.Column("gap_description", sa.Text(), nullable=False, server_default=""),
        sa.Column("evidence", sa.Text(), nullable=True),
        sa.Column("remediation", sa.Text(), nullable=True),
        sa.Column("ai_detected", sa.Boolean(), nullable=False, server_default=sa.false()),
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
        "ix_turbolens_compliance_findings_regulation_status",
        "turbolens_compliance_findings",
        ["regulation", "status"],
    )
    op.create_index(
        "ix_turbolens_compliance_findings_card_id",
        "turbolens_compliance_findings",
        ["card_id"],
    )
    op.create_index(
        "ix_turbolens_compliance_findings_run_id",
        "turbolens_compliance_findings",
        ["run_id"],
    )


def downgrade() -> None:
    op.drop_index(
        "ix_turbolens_compliance_findings_run_id",
        table_name="turbolens_compliance_findings",
    )
    op.drop_index(
        "ix_turbolens_compliance_findings_card_id",
        table_name="turbolens_compliance_findings",
    )
    op.drop_index(
        "ix_turbolens_compliance_findings_regulation_status",
        table_name="turbolens_compliance_findings",
    )
    op.drop_table("turbolens_compliance_findings")

    op.drop_index("ix_turbolens_cve_findings_priority", table_name="turbolens_cve_findings")
    op.drop_index("ix_turbolens_cve_findings_severity", table_name="turbolens_cve_findings")
    op.drop_index("ix_turbolens_cve_findings_cve_id", table_name="turbolens_cve_findings")
    op.drop_index("ix_turbolens_cve_findings_status", table_name="turbolens_cve_findings")
    op.drop_index("ix_turbolens_cve_findings_run_id", table_name="turbolens_cve_findings")
    op.drop_index(
        "ix_turbolens_cve_findings_card_id_severity",
        table_name="turbolens_cve_findings",
    )
    op.drop_table("turbolens_cve_findings")
