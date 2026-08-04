"""Add publishing columns to diagrams.

Lets a diagram be shared as a read-only link that renders without an app
session, so it can be iframed into Confluence (discussion #905). The access
model mirrors ``web_portals``: ``public`` (anyone with the link) or ``sso``
(visitor authenticates against the org IdP for an ephemeral, account-less
session), with an optional email-domain allowlist.

``public_slug`` is a generated, unguessable token — **not** slugified from the
diagram name. For a ``public`` diagram the URL is the capability, so a slug
derived from the title would make every published diagram enumerable by anyone
who can guess a name. Unique + indexed because it is the lookup key on the
public route.

Existing rows land unpublished with a NULL slug, which is what you want: this
migration must never expose anything that was not explicitly shared.

Revision ID: 132
Revises: 131
"""

from collections.abc import Sequence
from typing import Union

import sqlalchemy as sa

from alembic import op

revision: str = "132"
down_revision: Union[str, None] = "131"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "diagrams",
        sa.Column("is_published", sa.Boolean(), nullable=False, server_default=sa.false()),
    )
    op.add_column("diagrams", sa.Column("public_slug", sa.String(length=64), nullable=True))
    op.add_column(
        "diagrams",
        sa.Column("access_mode", sa.String(length=20), nullable=False, server_default="public"),
    )
    op.add_column(
        "diagrams",
        sa.Column("allowed_email_domains", sa.dialects.postgresql.JSONB(), nullable=True),
    )
    op.create_index("ix_diagrams_public_slug", "diagrams", ["public_slug"], unique=True)


def downgrade() -> None:
    op.drop_index("ix_diagrams_public_slug", table_name="diagrams")
    op.drop_column("diagrams", "allowed_email_domains")
    op.drop_column("diagrams", "access_mode")
    op.drop_column("diagrams", "public_slug")
    op.drop_column("diagrams", "is_published")
