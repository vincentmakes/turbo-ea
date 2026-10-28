"""Add ``created_via`` / ``updated_via`` — the channel behind a record.

``created_by`` / ``updated_by`` name the person; every MCP write forwards the
user's own token, so nothing on a record told an AI-agent write from a web-UI
one. These two nullable ``String(20)`` columns carry the channel
(``web | mcp | api | ext | system``) on every table MCP can create rows in:
cards, diagrams, risks, ADRs, SoAWs, comments and BPM flow versions. The
values are stamped Python-side by ``ProvenanceMixin`` (``app/models/
provenance.py``) from the request context.

No backfill: NULL means "created before this migration" and renders as
nothing. A workspace-transfer bundle exported before 157 carries no
``created_via`` column, so its cards (and the generic module rows) import
with ``created_via`` stamped by the importing request.

Revision ID: 157
Revises: 156
"""

from collections.abc import Sequence
from typing import Union

import sqlalchemy as sa

from alembic import op

revision: str = "157"
down_revision: Union[str, None] = "156"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

TABLES = (
    "cards",
    "diagrams",
    "risks",
    "architecture_decisions",
    "statement_of_architecture_works",
    "comments",
    "process_flow_versions",
)
COLUMNS = ("created_via", "updated_via")


def upgrade() -> None:
    for table in TABLES:
        for column in COLUMNS:
            op.add_column(table, sa.Column(column, sa.String(20), nullable=True))


def downgrade() -> None:
    for table in TABLES:
        for column in reversed(COLUMNS):
            op.drop_column(table, column)
