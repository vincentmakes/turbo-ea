"""Backfill: stamp ``cards.archived_at`` on archived cards that never got one.

The ServiceNow sync's delete path archived a card by setting ``status`` alone,
leaving ``archived_at`` NULL. The retention purge loop (``app/main.py``) selects
on ``status = 'ARCHIVED' AND archived_at IS NOT NULL``, so those cards were
invisible to retention and were kept forever — the 30-day restore window that
the UI promises never started, and never ended.

The code path is fixed, but cards already archived by a sync on an existing
install stay stranded until something touches them, which nothing will.

**The stamp is ``now()``, deliberately, not a reconstructed archive date.**
``updated_at`` is the only proxy available for when the archive actually
happened, and it is a poor one — any later write moved it. Worse, the purge is
a *permanent delete*: backfilling a historical timestamp would hand the next
purge tick a batch of cards already past their retention window and delete them
within the hour, with no warning and no undo. Starting the clock now means an
operator sees these cards in the archive for a full retention period before
anything is removed, and can restore any that should not have been archived.
The cost is that genuinely old archived cards linger one extra window; that is
the right side to err on.

Scoped to rows that are ARCHIVED with no stamp, so it cannot touch an active
card or overwrite a real archive date, and it is a no-op on a re-run.

Revision ID: 139
Revises: 138
"""

from collections.abc import Sequence
from typing import Union

from sqlalchemy.sql import text

from alembic import op

revision: str = "139"
down_revision: Union[str, None] = "138"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.get_bind().execute(
        text(
            """
            UPDATE cards
            SET archived_at = NOW()
            WHERE status = 'ARCHIVED' AND archived_at IS NULL
            """
        )
    )


def downgrade() -> None:
    # Not reversible: the pre-upgrade state is "we do not know when this card
    # was archived", and re-NULLing every stamp would strand cards that were
    # archived correctly after this migration ran.
    pass
