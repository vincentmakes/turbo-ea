"""PPM redesign: separate cost lines and risks tables, simplify reports, remove task start_date.

Revision ID: 050
Revises: 049
"""

import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB, UUID

from alembic import op

revision = "050"
down_revision = "049"


def upgrade() -> None:
    # --- Create ppm_cost_lines table ---
    op.create_table(
        "ppm_cost_lines",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "initiative_id",
            UUID(as_uuid=True),
            sa.ForeignKey("cards.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        ),
        sa.Column("description", sa.Text, nullable=False),
        sa.Column("category", sa.Text, nullable=False),
        sa.Column("planned", sa.Float, server_default="0"),
        sa.Column("actual", sa.Float, server_default="0"),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
        ),
    )

    # --- Create ppm_risks table ---
    op.create_table(
        "ppm_risks",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "initiative_id",
            UUID(as_uuid=True),
            sa.ForeignKey("cards.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        ),
        sa.Column("title", sa.Text, nullable=False),
        sa.Column("description", sa.Text, nullable=True),
        sa.Column("probability", sa.Integer, nullable=False, server_default="3"),
        sa.Column("impact", sa.Integer, nullable=False, server_default="3"),
        sa.Column("risk_score", sa.Integer, nullable=False, server_default="9"),
        sa.Column("mitigation", sa.Text, nullable=True),
        sa.Column(
            "owner_id",
            UUID(as_uuid=True),
            sa.ForeignKey("users.id"),
            nullable=True,
        ),
        sa.Column("status", sa.Text, nullable=False, server_default="open"),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
        ),
    )

    # --- Migrate data from ppm_status_reports before dropping columns ---
    # Add new columns to ppm_status_reports
    op.add_column(
        "ppm_status_reports",
        sa.Column("accomplishments", sa.Text, nullable=True),
    )
    op.add_column(
        "ppm_status_reports",
        sa.Column("next_steps", sa.Text, nullable=True),
    )

    # Migrate cost_lines JSONB → ppm_cost_lines rows
    conn = op.get_bind()
    reports_with_costs = conn.execute(
        sa.text(
            "SELECT id, initiative_id, cost_lines FROM ppm_status_reports "
            "WHERE cost_lines IS NOT NULL AND cost_lines != '[]'::jsonb"
        )
    ).fetchall()
    for report in reports_with_costs:
        cost_lines = report[2] if isinstance(report[2], list) else []
        for cl in cost_lines:
            conn.execute(
                sa.text(
                    "INSERT INTO ppm_cost_lines (id, initiative_id, description, category, "
                    "planned, actual) VALUES (gen_random_uuid(), :init_id, :desc, :cat, "
                    ":planned, :actual)"
                ),
                {
                    "init_id": report[1],
                    "desc": cl.get("description", ""),
                    "cat": cl.get("category", "capex"),
                    "planned": cl.get("planned", 0),
                    "actual": cl.get("actual", 0),
                },
            )

    # Migrate risks JSONB → ppm_risks rows
    reports_with_risks = conn.execute(
        sa.text(
            "SELECT id, initiative_id, risks FROM ppm_status_reports "
            "WHERE risks IS NOT NULL AND risks != '[]'::jsonb"
        )
    ).fetchall()
    for report in reports_with_risks:
        risks = report[2] if isinstance(report[2], list) else []
        for risk in risks:
            severity = risk.get("severity", "medium")
            prob = {"low": 2, "medium": 3, "high": 5}.get(severity, 3)
            impact = prob
            conn.execute(
                sa.text(
                    "INSERT INTO ppm_risks (id, initiative_id, title, description, "
                    "probability, impact, risk_score, status) "
                    "VALUES (gen_random_uuid(), :init_id, :title, :desc, "
                    ":prob, :impact, :score, 'open')"
                ),
                {
                    "init_id": report[1],
                    "title": risk.get("description", "Untitled risk")[:200],
                    "desc": risk.get("description", ""),
                    "prob": prob,
                    "impact": impact,
                    "score": prob * impact,
                },
            )

    # Drop old columns from ppm_status_reports
    op.drop_column("ppm_status_reports", "percent_complete")
    op.drop_column("ppm_status_reports", "cost_lines")
    op.drop_column("ppm_status_reports", "risks")

    # Drop start_date from ppm_tasks
    op.drop_column("ppm_tasks", "start_date")


def downgrade() -> None:
    # Re-add dropped columns
    op.add_column(
        "ppm_tasks",
        sa.Column("start_date", sa.Date, nullable=True),
    )
    op.add_column(
        "ppm_status_reports",
        sa.Column("risks", JSONB, server_default="[]"),
    )
    op.add_column(
        "ppm_status_reports",
        sa.Column("cost_lines", JSONB, server_default="[]"),
    )
    op.add_column(
        "ppm_status_reports",
        sa.Column("percent_complete", sa.Integer, server_default="0"),
    )
    op.drop_column("ppm_status_reports", "next_steps")
    op.drop_column("ppm_status_reports", "accomplishments")
    op.drop_table("ppm_risks")
    op.drop_table("ppm_cost_lines")
