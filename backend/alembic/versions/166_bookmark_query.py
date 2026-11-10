"""Saved inventory views: a server-evaluated card query and provenance.

``bookmarks.query`` holds a multi-hop card query (``app/services/card_query.py``)
— keys only (card type, relation type, field and option keys), never a card
id, so a view survives a workspace transfer verbatim. The inventory sends it to
``GET /cards?query=`` on every open and the OData feed applies it, so the view
stays dynamic. It is authored through the MCP server; the web UI never writes
it.

``created_via`` / ``updated_via`` (the ``157`` provenance pair) tell a view an
AI agent saved through MCP from one saved in the web UI.

No backfill: NULL means "a plain view" for ``query`` and "saved before this
migration" for the provenance pair.

Revision ID: 166
Revises: 165
"""

from collections.abc import Sequence
from typing import Union

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "166"
down_revision: Union[str, None] = "165"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

PROVENANCE_COLUMNS = ("created_via", "updated_via")


def upgrade() -> None:
    op.add_column("bookmarks", sa.Column("query", postgresql.JSONB(), nullable=True))
    for column in PROVENANCE_COLUMNS:
        op.add_column("bookmarks", sa.Column(column, sa.String(20), nullable=True))


def downgrade() -> None:
    for column in reversed(PROVENANCE_COLUMNS):
        op.drop_column("bookmarks", column)
    op.drop_column("bookmarks", "query")
