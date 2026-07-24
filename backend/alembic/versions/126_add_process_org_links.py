"""Link Organizations to process-flow steps.

One additive table, no data backfill: ``process_element_organizations`` — an
M:N junction between BPMN process elements and Organization cards, mirroring
the existing per-step application/data-object/IT-component links but allowing
several Organizations per step. Lane names stay plain free text on
``process_elements.lane_name`` and are not connected to Organization cards.

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
    op.create_table(
        "process_element_organizations",
        sa.Column(
            "element_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("process_elements.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column(
            "organization_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("cards.id", ondelete="CASCADE"),
            primary_key=True,
            index=True,
        ),
    )


def downgrade() -> None:
    op.drop_table("process_element_organizations")
