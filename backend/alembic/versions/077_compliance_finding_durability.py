"""Compliance finding durability: persist decisions across re-scans.

Adds reviewer + decision + watermark columns to ``turbolens_compliance_findings``
so that human decisions and risk-promotion back-links survive a re-scan. The
existing ``run_compliance_scan`` previously wiped all rows and re-inserted; with
these columns plus a stable ``finding_key`` upsert key, decisions persist and
findings that vanish from a new scan are flagged ``auto_resolved`` instead of
deleted (preserving any linked Risk's audit trail).

Backfill semantics:
- ``finding_key`` is computed for every existing row using the same recipe as
  the application code (``services/turbolens_security.py::compute_finding_key``).
- ``last_seen_run_id`` is set to the row's original ``run_id``.
- ``decision`` defaults to ``"risk_tracked"`` when ``risk_id IS NOT NULL``, else
  ``"open"``.
- ``auto_resolved`` defaults to ``false`` for existing rows.

Revision ID: 077
Revises: 076
"""

from typing import Union

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "077"
down_revision: Union[str, None] = "076"
branch_labels: Union[str, None] = None
depends_on: Union[str, None] = None


def upgrade() -> None:
    op.add_column(
        "turbolens_compliance_findings",
        sa.Column("finding_key", sa.String(length=64), nullable=True),
    )
    op.add_column(
        "turbolens_compliance_findings",
        sa.Column(
            "decision",
            sa.String(length=24),
            nullable=False,
            server_default="open",
        ),
    )
    op.add_column(
        "turbolens_compliance_findings",
        sa.Column(
            "reviewed_by",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )
    op.add_column(
        "turbolens_compliance_findings",
        sa.Column(
            "reviewed_at",
            sa.DateTime(timezone=True),
            nullable=True,
        ),
    )
    op.add_column(
        "turbolens_compliance_findings",
        sa.Column("review_note", sa.Text(), nullable=True),
    )
    op.add_column(
        "turbolens_compliance_findings",
        sa.Column(
            "last_seen_run_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("turbolens_analysis_runs.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )
    op.add_column(
        "turbolens_compliance_findings",
        sa.Column(
            "auto_resolved",
            sa.Boolean(),
            nullable=False,
            server_default=sa.false(),
        ),
    )

    bind = op.get_bind()

    # Backfill finding_key — md5 of pipe-joined identity tuple. Mirrors
    # compute_finding_key() in services/turbolens_security.py so the next
    # scan upserts cleanly onto existing rows.
    bind.execute(
        sa.text(
            """
            UPDATE turbolens_compliance_findings
            SET finding_key = md5(
                COALESCE(scope_type, '') || '|'
                || COALESCE(card_id::text, '') || '|'
                || COALESCE(regulation, '') || '|'
                || COALESCE(regulation_article, '') || '|'
                || substring(COALESCE(requirement, '') from 1 for 200)
            )
            """
        )
    )

    # Backfill last_seen_run_id to the row's original run_id.
    bind.execute(
        sa.text(
            """
            UPDATE turbolens_compliance_findings
            SET last_seen_run_id = run_id
            """
        )
    )

    # Mark rows that were already promoted to a risk.
    bind.execute(
        sa.text(
            """
            UPDATE turbolens_compliance_findings
            SET decision = 'risk_tracked'
            WHERE risk_id IS NOT NULL
            """
        )
    )

    # Now enforce non-null on finding_key.
    op.alter_column(
        "turbolens_compliance_findings",
        "finding_key",
        existing_type=sa.String(length=64),
        nullable=False,
    )

    # Drop the server defaults — application code owns these going forward.
    op.alter_column(
        "turbolens_compliance_findings",
        "decision",
        server_default=None,
    )
    op.alter_column(
        "turbolens_compliance_findings",
        "auto_resolved",
        server_default=None,
    )

    op.create_index(
        "ix_turbolens_compliance_findings_finding_key",
        "turbolens_compliance_findings",
        ["finding_key"],
    )
    op.create_index(
        "ix_turbolens_compliance_findings_decision",
        "turbolens_compliance_findings",
        ["decision"],
    )


def downgrade() -> None:
    op.drop_index(
        "ix_turbolens_compliance_findings_decision",
        table_name="turbolens_compliance_findings",
    )
    op.drop_index(
        "ix_turbolens_compliance_findings_finding_key",
        table_name="turbolens_compliance_findings",
    )
    op.drop_column("turbolens_compliance_findings", "auto_resolved")
    op.drop_column("turbolens_compliance_findings", "last_seen_run_id")
    op.drop_column("turbolens_compliance_findings", "review_note")
    op.drop_column("turbolens_compliance_findings", "reviewed_at")
    op.drop_column("turbolens_compliance_findings", "reviewed_by")
    op.drop_column("turbolens_compliance_findings", "decision")
    op.drop_column("turbolens_compliance_findings", "finding_key")
