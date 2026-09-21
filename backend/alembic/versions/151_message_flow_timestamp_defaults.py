"""Give ``process_message_flows`` timestamps the server default the model expects.

Migration 149 created ``process_message_flows.created_at`` / ``updated_at`` as
NOT NULL **without** a server default. ``ProcessMessageFlow`` reads both from
``TimestampMixin`` (``server_default=func.now()``), so the ORM leaves them out
of the INSERT and expects the database to fill them — and on a table created by
149 the database refused with ``null value in column "created_at" ... violates
not-null constraint``. Publishing a process whose diagram has a message flow,
or saving one through the legacy ``PUT /diagram`` route, therefore failed with
a 500 on every *upgraded* install (#1133). A fresh install was never affected:
``create_all`` builds the table from the model, default included, which is
also why the test suite could not see it. 149's own backfill wrote ``now()``
explicitly in raw SQL, so the upgrade itself sailed through and the bug only
surfaced at the next publish.

This sets ``DEFAULT now()`` on both columns wherever it is missing. 149 has
been repaired in place as well, so an install that has not run it yet gets the
right table straight away and this migration no-ops. Existing rows are
untouched — the constraint guarantees none carries a NULL.

Revision ID: 151
Revises: 150
Create Date: 2026-09-21
"""

from collections.abc import Sequence
from typing import Union

import sqlalchemy as sa

from alembic import op

revision: str = "151"
down_revision: Union[str, None] = "150"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

TABLE = "process_message_flows"
TIMESTAMP_COLUMNS = ("created_at", "updated_at")


def columns_missing_default(columns: list[dict]) -> list[str]:
    """The timestamp columns, in ``TIMESTAMP_COLUMNS`` order, whose reflected
    ``default`` is empty — i.e. the ones 149 left without ``now()``.

    Pure so the decision is unit-testable without a database; ``columns`` is
    what ``Inspector.get_columns`` returns.
    """
    by_name = {c["name"]: c for c in columns}
    return [
        name for name in TIMESTAMP_COLUMNS if name in by_name and not by_name[name].get("default")
    ]


def upgrade() -> None:
    from sqlalchemy import inspect as sa_inspect

    inspector = sa_inspect(op.get_bind())
    if not inspector.has_table(TABLE):
        return
    for name in columns_missing_default(inspector.get_columns(TABLE)):
        op.alter_column(
            TABLE,
            name,
            server_default=sa.text("now()"),
            existing_type=sa.DateTime(timezone=True),
            existing_nullable=False,
        )


def downgrade() -> None:
    # Deliberately a no-op: dropping the default would reintroduce the failure,
    # and nothing was written that needs reversing.
    pass
