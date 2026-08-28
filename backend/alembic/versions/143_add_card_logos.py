"""Add per-card custom logos.

Two additive changes plus one guarded backfill:

``card_logos`` — one optional logo image per card (unique on ``card_id``,
cascade-deleted with the card). A side table rather than a column on ``cards``
so that ``GET /cards`` never drags blobs through a page query, and so writing a
logo cannot move ``cards.updated_at``.

``card_types.allow_card_logo`` — the per-type switch that decides whether
editors may upload a logo for cards of that type.

The backfill turns the switch on for the built-in ``Application`` and
``ITComponent`` types, which is where product logos actually earn their keep.
``seed.py`` only creates rows that are missing, so without this UPDATE the new
default would reach fresh installs only and every existing install would see
the feature switched off everywhere.

Revision ID: 143
Revises: 142
"""

from typing import Union

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "143"
down_revision: Union[str, None] = "142"
branch_labels: Union[str, None] = None
depends_on: Union[str, None] = None


def upgrade() -> None:
    from sqlalchemy import inspect as sa_inspect

    conn = op.get_bind()
    inspector = sa_inspect(conn)

    if not inspector.has_table("card_logos"):
        op.create_table(
            "card_logos",
            sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
            sa.Column(
                "card_id",
                postgresql.UUID(as_uuid=True),
                sa.ForeignKey("cards.id", ondelete="CASCADE"),
                nullable=False,
            ),
            sa.Column("mime_type", sa.String(length=100), nullable=False),
            sa.Column("size", sa.Integer(), nullable=False),
            sa.Column("data", sa.LargeBinary(), nullable=False),
            sa.Column(
                "created_by",
                postgresql.UUID(as_uuid=True),
                sa.ForeignKey("users.id", ondelete="SET NULL"),
                nullable=True,
            ),
            sa.Column(
                "updated_at",
                sa.DateTime(timezone=True),
                server_default=sa.func.now(),
                nullable=False,
            ),
        )
        # A single unique index, matching exactly what the ORM's
        # ``unique=True, index=True`` emits on the fresh-install create_all
        # path — the two schemas must not drift.
        op.create_index("ix_card_logos_card_id", "card_logos", ["card_id"], unique=True)

    columns = [c["name"] for c in inspector.get_columns("card_types")]
    if "allow_card_logo" not in columns:
        op.add_column(
            "card_types",
            sa.Column(
                "allow_card_logo",
                sa.Boolean(),
                nullable=False,
                server_default=sa.false(),
            ),
        )
        # Only the built-in types we ship this default for, so an admin who has
        # since customised their metamodel is never overridden.
        op.execute(
            sa.text(
                "UPDATE card_types SET allow_card_logo = TRUE "
                "WHERE key IN ('Application', 'ITComponent') AND built_in = TRUE"
            )
        )


def downgrade() -> None:
    op.drop_column("card_types", "allow_card_logo")
    op.drop_index("ix_card_logos_card_id", table_name="card_logos")
    op.drop_table("card_logos")
