"""Link Organizations at process-flow level (hybrid lane + step model).

Three additive changes, no data backfill:

1. ``process_elements.organization_id`` — explicit per-step Organization
   override, mirroring the existing application/data-object/IT-component FKs.
2. New ``process_lane_links`` table — binds a BPMN lane (free-text name, per
   process) to an Organization card. Steps without an explicit override
   inherit their lane's organization; the effective value is always computed,
   never copied, so the two stores cannot contradict each other.
3. ``process_flow_versions.draft_lane_links`` — draft-stage lane bindings
   (JSONB, keyed by lane name), applied to ``process_lane_links`` on publish.

Revision ID: 126
Revises: 125
"""

from typing import Union

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "126"
down_revision: Union[str, None] = "125"
branch_labels: Union[str, None] = None
depends_on: Union[str, None] = None


def upgrade() -> None:
    op.add_column(
        "process_elements",
        sa.Column(
            "organization_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("cards.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )
    op.create_table(
        "process_lane_links",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "process_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("cards.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        ),
        sa.Column("lane_name", sa.String(length=200), nullable=False),
        sa.Column(
            "organization_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("cards.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.UniqueConstraint("process_id", "lane_name", name="uq_process_lane"),
    )
    op.add_column(
        "process_flow_versions",
        sa.Column(
            "draft_lane_links",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=True,
        ),
    )


def downgrade() -> None:
    op.drop_column("process_flow_versions", "draft_lane_links")
    op.drop_table("process_lane_links")
    op.drop_column("process_elements", "organization_id")
