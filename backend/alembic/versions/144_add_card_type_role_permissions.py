"""Add per-card-type role permission overrides.

``card_types.role_permissions`` holds a ``{role_key: {app_permission: bool}}``
map that overrides the four type-scoped inventory permissions
(``inventory.create`` / ``edit`` / ``archive`` / ``delete``) for one card type.
Only explicitly overridden cells are stored; an absent key inherits the role's
global grant, which is why the column defaults to an empty object and every
existing install keeps behaving exactly as before this migration.

Revision ID: 144
Revises: 143
"""

from typing import Union

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "144"
down_revision: Union[str, None] = "143"
branch_labels: Union[str, None] = None
depends_on: Union[str, None] = None


def upgrade() -> None:
    from sqlalchemy import inspect as sa_inspect

    conn = op.get_bind()
    inspector = sa_inspect(conn)

    columns = [c["name"] for c in inspector.get_columns("card_types")]
    if "role_permissions" not in columns:
        op.add_column(
            "card_types",
            sa.Column(
                "role_permissions",
                postgresql.JSONB(),
                nullable=False,
                server_default=sa.text("'{}'::jsonb"),
            ),
        )


def downgrade() -> None:
    op.drop_column("card_types", "role_permissions")
