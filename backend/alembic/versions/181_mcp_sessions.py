"""MCP connections: one durable row per AI tool connection.

Until now the MCP server kept the tokens it issued in its own memory, so every
restart ended every connection (#1449), and a connection left unused for a day
could not be renewed. ``mcp_sessions`` is the server-side record a refresh
token is checked against: ``generation`` counts the rotations, the two expiry
columns hold the idle and the absolute end, ``revoked_at`` ends it by hand or
on a replayed token. No token and no hash of one is stored: a refresh token is
an HMAC over ``(id, generation)``.

Nothing is backfilled: connections made before this migration live only in the
old MCP server's memory and need one new sign-in.

Downgrade drops the table, which ends every connection.

Revision ID: 181
Revises: 180
"""

from __future__ import annotations

from collections.abc import Sequence
from typing import Union

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "181"
down_revision: Union[str, None] = "180"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

TABLE = "mcp_sessions"


def upgrade() -> None:
    op.create_table(
        TABLE,
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "user_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("client_name", sa.String(200), nullable=False),
        sa.Column("scope", sa.String(200), nullable=False),
        sa.Column("generation", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("rotated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.Column(
            "last_used_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.Column("idle_expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("revoked_reason", sa.String(40), nullable=True),
    )
    op.create_index("ix_mcp_sessions_user_id", TABLE, ["user_id"])


def downgrade() -> None:
    op.drop_index("ix_mcp_sessions_user_id", table_name=TABLE)
    op.drop_table(TABLE)
