"""Add a view discriminator to web portals.

One additive column, no data backfill — every existing portal keeps its
historical behaviour because ``view`` defaults to ``cards``:

``web_portals.view`` — ``cards`` (the card-list grid every portal has rendered
until now) or ``ppm_portfolio`` (the read-only PPM portfolio board, published for
executives who have no Turbo EA account).

This is a column rather than a key inside ``card_config`` for the same reason
``access_mode`` is: ``update_portal`` writes unknown fields with a bare
``setattr``, so a typo'd JSONB key would silently no-op forever, while a column
validated in ``_validate_view`` returns a 400. It also keeps ``card_config``
meaning display configuration, and makes "which portals publish the portfolio?"
answerable with a WHERE clause rather than a JSONB path.

Revision ID: 142
Revises: 141
"""

from typing import Union

import sqlalchemy as sa

from alembic import op

revision: str = "142"
down_revision: Union[str, None] = "141"
branch_labels: Union[str, None] = None
depends_on: Union[str, None] = None


def upgrade() -> None:
    op.add_column(
        "web_portals",
        sa.Column(
            "view",
            sa.String(length=32),
            nullable=False,
            server_default="cards",
        ),
    )


def downgrade() -> None:
    op.drop_column("web_portals", "view")
