"""Add external reference columns to todos.

Gives extension-driven task-tracker sync (Jira, MS Planner, GitHub
Projects — `discussion #921
<https://github.com/vincentmakes/turbo-ea/discussions/921>`_) a place to
store the external item's identity on the todo itself:

* ``external_ref`` — the tracker-side id, e.g. ``PROJ-123``.
* ``external_url`` — deep link to the external item, rendered as a chip
  in the Todos UI. Deliberately **not** writable through the REST API:
  ``link`` stays restricted to relative in-app paths, and only
  vendor-signed extensions holding the ``core.todos.write`` grant can set
  these columns through the SDK todos bridge.
* ``external_source`` — the extension key that owns the mirror. Doubles
  as the write-scope discriminator: an extension may only touch rows
  whose ``external_source`` is NULL or its own key.

The index is non-unique on purpose: the bridge upserts by
``(external_source, external_ref)`` lookup, and a unique constraint would
turn any historical duplicate into a migration landmine instead of a
mergeable state.

All three columns are nullable with no server default, so existing rows
are untouched and ``create_all``-built databases match the migration path.

Revision ID: 136
Revises: 135
"""

from collections.abc import Sequence
from typing import Union

import sqlalchemy as sa

from alembic import op

revision: str = "136"
down_revision: Union[str, None] = "135"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("todos", sa.Column("external_ref", sa.String(255), nullable=True))
    op.add_column("todos", sa.Column("external_url", sa.String(1000), nullable=True))
    op.add_column("todos", sa.Column("external_source", sa.String(64), nullable=True))
    op.create_index(
        "ix_todos_external_source_ref",
        "todos",
        ["external_source", "external_ref"],
    )


def downgrade() -> None:
    op.drop_index("ix_todos_external_source_ref", table_name="todos")
    op.drop_column("todos", "external_source")
    op.drop_column("todos", "external_url")
    op.drop_column("todos", "external_ref")
