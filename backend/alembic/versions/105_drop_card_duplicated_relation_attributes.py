"""Drop card-duplicated relation attributes from built-in relation types.

Three relation attributes were duplicates of card-level fields and bled into the
relation "type" pickers: ``functionalSuitability`` (relAppToBC),
``technicalSuitability`` (relAppToITC), and ``resourceClassification``
(relITCToTechCat). Each of these is also defined as a card field
(Application.functionalSuitability, ITComponent.technicalSuitability,
ITComponent.resourceClassification), which is where the data belongs. We remove
them from the relation metamodel; they stay as card fields.

Fresh installs already exclude them (seed.py was updated). This migration repairs
existing installs: it drops any ``attributes_schema`` field whose key is one of
the three from every ``built_in`` relation type. Guarded + idempotent — only
UPDATEs rows that actually change. Non-destructive to relation *instance*
``attributes``: any previously-set values stay in the DB but are simply no longer
rendered/editable (the UI iterates the schema), matching the agreed behaviour.

Revision ID: 105
Revises: 104
Create Date: 2026-06-18
"""

import json
from typing import Union

import sqlalchemy as sa

from alembic import op

revision: str = "105"
down_revision: Union[str, None] = "104"
branch_labels: Union[str, None] = None
depends_on: Union[str, None] = None

DROP_KEYS = {"functionalSuitability", "technicalSuitability", "resourceClassification"}


def plan_drop(schema: object) -> list | None:
    """Return the schema with the dropped keys removed, or ``None`` when nothing
    needs changing (so we skip the UPDATE)."""
    if not isinstance(schema, list) or not schema:
        return None
    kept = [f for f in schema if not (isinstance(f, dict) and f.get("key") in DROP_KEYS)]
    return kept if len(kept) != len(schema) else None


def upgrade() -> None:
    conn = op.get_bind()
    rows = conn.execute(
        sa.text(
            "SELECT key, attributes_schema FROM relation_types "
            "WHERE built_in = true AND attributes_schema IS NOT NULL"
        )
    ).fetchall()
    for key, schema in rows:
        new_schema = plan_drop(schema)
        if new_schema is None:
            continue
        conn.execute(
            sa.text(
                "UPDATE relation_types SET attributes_schema = CAST(:s AS jsonb) WHERE key = :k"
            ),
            {"s": json.dumps(new_schema), "k": key},
        )


def downgrade() -> None:
    # Non-destructive forward-only cleanup; the fields are re-seedable from
    # seed.py history if ever needed, so we do not re-add them on downgrade.
    pass
