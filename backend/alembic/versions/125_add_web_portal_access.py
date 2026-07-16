"""Add native access protection to web portals.

Two additive columns on ``web_portals``, no data backfill (existing portals
keep their historical behaviour — ``access_mode`` defaults to ``public``):

1. ``web_portals.access_mode`` — ``public`` (world-readable when published, the
   historical behaviour) or ``sso`` (visitor must authenticate against the org's
   configured SSO IdP for an ephemeral, account-less portal session).
2. ``web_portals.allowed_email_domains`` — nullable JSONB list of lowercase
   email domains for ``sso`` mode. NULL / ``[]`` means any user the IdP
   authenticates.

Revision ID: 125
Revises: 124
"""

from typing import Union

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "125"
down_revision: Union[str, None] = "124"
branch_labels: Union[str, None] = None
depends_on: Union[str, None] = None


def upgrade() -> None:
    op.add_column(
        "web_portals",
        sa.Column(
            "access_mode",
            sa.String(length=20),
            nullable=False,
            server_default="public",
        ),
    )
    op.add_column(
        "web_portals",
        sa.Column(
            "allowed_email_domains",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=True,
        ),
    )


def downgrade() -> None:
    op.drop_column("web_portals", "allowed_email_domains")
    op.drop_column("web_portals", "access_mode")
