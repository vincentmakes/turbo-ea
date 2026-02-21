"""migrate existing process_diagrams into process_flow_versions as drafts

Revision ID: 017
Revises: 016
Create Date: 2026-02-15
"""

from typing import Sequence, Union

import sqlalchemy as sa

from alembic import op

revision: str = "017"
down_revision: Union[str, None] = "016"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    from sqlalchemy import inspect as sa_inspect

    conn = op.get_bind()
    inspector = sa_inspect(conn)

    if not inspector.has_table("process_diagrams"):
        return
    if not inspector.has_table("process_flow_versions"):
        return

    # Copy process_diagrams that don't already have a matching
    # process_flow_version (by process_id) so this is idempotent.
    conn.execute(
        sa.text(
            """
            INSERT INTO process_flow_versions
                (id, process_id, status, revision, bpmn_xml,
                 svg_thumbnail, created_by, created_at, updated_at)
            SELECT
                gen_random_uuid(), pd.process_id, 'draft', pd.version, pd.bpmn_xml,
                pd.svg_thumbnail, pd.created_by, pd.created_at, pd.updated_at
            FROM process_diagrams pd
            WHERE NOT EXISTS (
                SELECT 1 FROM process_flow_versions pfv
                WHERE pfv.process_id = pd.process_id
            )
            """
        )
    )


def downgrade() -> None:
    # Data migration only — nothing to structurally undo.
    pass
