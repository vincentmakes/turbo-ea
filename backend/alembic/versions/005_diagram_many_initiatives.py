"""diagram many-to-many initiatives

Revision ID: 005
Revises: 004
Create Date: 2026-02-12
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = "005"
down_revision: Union[str, None] = "004"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    from sqlalchemy import inspect as sa_inspect, text

    conn = op.get_bind()
    inspector = sa_inspect(conn)

    # 1. Create association table (skip if create_all already made it)
    if not inspector.has_table("diagram_initiatives"):
        op.create_table(
            "diagram_initiatives",
            sa.Column(
                "diagram_id",
                sa.UUID(as_uuid=True),
                sa.ForeignKey("diagrams.id", ondelete="CASCADE"),
                primary_key=True,
            ),
            sa.Column(
                "initiative_id",
                sa.UUID(as_uuid=True),
                sa.ForeignKey("fact_sheets.id", ondelete="CASCADE"),
                primary_key=True,
            ),
        )

    # 2. Migrate existing initiative_id data into the association table
    existing_columns = [c["name"] for c in inspector.get_columns("diagrams")]
    if "initiative_id" in existing_columns:
        conn.execute(
            text(
                "INSERT INTO diagram_initiatives (diagram_id, initiative_id) "
                "SELECT id, initiative_id FROM diagrams "
                "WHERE initiative_id IS NOT NULL "
                "ON CONFLICT DO NOTHING"
            )
        )
        # 3. Drop the old FK column
        op.drop_column("diagrams", "initiative_id")


def downgrade() -> None:
    # Re-add the single FK column
    op.add_column(
        "diagrams",
        sa.Column(
            "initiative_id",
            sa.UUID(as_uuid=True),
            sa.ForeignKey("fact_sheets.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )
    # Migrate back: take first initiative_id per diagram
    from sqlalchemy import text

    op.get_bind().execute(
        text(
            "UPDATE diagrams d SET initiative_id = ("
            "  SELECT initiative_id FROM diagram_initiatives di "
            "  WHERE di.diagram_id = d.id LIMIT 1"
            ")"
        )
    )
    op.drop_table("diagram_initiatives")
