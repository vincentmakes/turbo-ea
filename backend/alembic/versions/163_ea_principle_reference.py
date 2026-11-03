"""Give every EA principle a human-readable reference number (``P-001``).

The reference is what a spreadsheet re-import matches on first, so an admin
can rename a principle in Excel and still update the same row. Existing rows
are numbered in the order the Principles page lists them (``sort_order``,
then ``created_at``, then ``id`` as a stable tie-break).

The column stays nullable in the schema: a workspace bundle written before
this revision carries no reference, and the applier numbers such rows right
after inserting them (``principle_service.ensure_principle_references``).

Revision ID: 163
Revises: 162
Create Date: 2026-11-03
"""

from typing import Sequence, Union

import sqlalchemy as sa

from alembic import op

revision: str = "163"
down_revision: Union[str, None] = "162"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_principles = sa.table(
    "ea_principles",
    sa.column("id", sa.Uuid),
    sa.column("reference_number", sa.String),
    sa.column("sort_order", sa.Integer),
    sa.column("created_at", sa.DateTime(timezone=True)),
)


def upgrade() -> None:
    # ``unique=True`` on the column, as the model declares it, so an upgraded
    # install and a fresh one (``create_all``) end up with the same
    # PostgreSQL-named constraint (``ea_principles_reference_number_key``).
    op.add_column(
        "ea_principles",
        sa.Column("reference_number", sa.String(length=20), nullable=True, unique=True),
    )

    bind = op.get_bind()
    ids = (
        bind.execute(
            sa.select(_principles.c.id).order_by(
                _principles.c.sort_order, _principles.c.created_at, _principles.c.id
            )
        )
        .scalars()
        .all()
    )
    for seq, pid in enumerate(ids, start=1):
        bind.execute(
            sa.update(_principles)
            .where(_principles.c.id == pid)
            .values(reference_number=f"P-{seq:03d}")
        )


def downgrade() -> None:
    # Dropping the column drops its unique constraint with it.
    op.drop_column("ea_principles", "reference_number")
