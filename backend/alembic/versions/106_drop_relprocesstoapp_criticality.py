"""Drop the ``criticality`` attribute from the BusinessProcess→Application relation.

``criticality`` was a `single_select` relation attribute on ``relProcessToApp``,
but conceptually it is a card-level attribute, not a relation "type". We remove
it from the relation metamodel (the genuine relation type ``usageType`` stays).

Fresh installs already exclude it (seed.py updated). This migration repairs
existing installs: it drops the ``criticality`` field from ``relProcessToApp``'s
``attributes_schema``. Guarded + idempotent — only UPDATEs when the field is
present. Non-destructive to relation *instance* ``attributes`` (any previously
set value stays in the DB but is no longer rendered/editable).

Revision ID: 106
Revises: 105
Create Date: 2026-06-19
"""

import json
from typing import Union

import sqlalchemy as sa

from alembic import op

revision: str = "106"
down_revision: Union[str, None] = "105"
branch_labels: Union[str, None] = None
depends_on: Union[str, None] = None

RELATION_KEY = "relProcessToApp"
DROP_KEY = "criticality"


def plan_drop(schema: object) -> list | None:
    """Return the schema without the ``criticality`` field, or ``None`` when
    nothing needs changing."""
    if not isinstance(schema, list) or not schema:
        return None
    kept = [f for f in schema if not (isinstance(f, dict) and f.get("key") == DROP_KEY)]
    return kept if len(kept) != len(schema) else None


def upgrade() -> None:
    conn = op.get_bind()
    row = conn.execute(
        sa.text("SELECT attributes_schema FROM relation_types WHERE key = :k"),
        {"k": RELATION_KEY},
    ).first()
    if row is None:
        return
    new_schema = plan_drop(row[0])
    if new_schema is None:
        return
    conn.execute(
        sa.text("UPDATE relation_types SET attributes_schema = CAST(:s AS jsonb) WHERE key = :k"),
        {"s": json.dumps(new_schema), "k": RELATION_KEY},
    )


def downgrade() -> None:
    # Forward-only cleanup; re-seedable from seed.py history if ever needed.
    pass
