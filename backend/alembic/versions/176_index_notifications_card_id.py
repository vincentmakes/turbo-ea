"""Index ``notifications.card_id``.

Deleting a card comment removes the in-app ``comment_added`` notifications
that quoted it, looked up by the comment's card. ``card_id`` had no index, so
that lookup read the whole table. Index only: no column changes.

The name is the one ``index=True`` on the model gives, so a schema built by
``create_all`` (a fresh install, then stamped) already has it; ``if_not_exists``
makes the upgrade a no-op there, and ``if_exists`` keeps the downgrade safe.

Revision ID: 176
Revises: 175
"""

from __future__ import annotations

from collections.abc import Sequence
from typing import Union

from alembic import op

revision: str = "176"
down_revision: Union[str, None] = "175"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

INDEX = "ix_notifications_card_id"


def upgrade() -> None:
    op.create_index(INDEX, "notifications", ["card_id"], if_not_exists=True)


def downgrade() -> None:
    op.drop_index(INDEX, table_name="notifications", if_exists=True)
