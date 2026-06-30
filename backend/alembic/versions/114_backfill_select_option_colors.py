"""Backfill: give colorless select options the default color (issue #718).

A select-field option carries an optional ``color`` used to render a colored
dot/chip in the card editor and Inventory grid. The Metamodel field editor's
ColorPicker shows a ``#1976d2`` blue as its fallback swatch when an option has
no color, but — until the accompanying frontend fix — that default was only a
*display* value: an option whose swatch was never explicitly clicked saved with
no ``color`` at all, so its dot never rendered even though the editor looked
like it had a color set.

The frontend now normalizes the displayed default onto every option on save, so
this is fixed going forward and any re-saved field is repaired. This migration
repairs data already sitting in the database without requiring an admin to
re-open each field.

**Mixed-field heuristic (deliberate, conservative).** We only fill colorless
options in a select field where *at least one* option already has a color. That
is exactly the reported scenario (five colored options + one added later with no
color). Fields where *no* option has a color are left untouched: those are
intentional, color-less built-ins (e.g. the ``creates`` / ``reads`` / ``updates``
relation-attribute options seeded by ``seed.py``), and forcing a blue dot onto
them would be a visible, unwanted change.

Applies to both ``card_types.fields_schema`` (a list of sections, each with a
``fields`` list) and ``relation_types.attributes_schema`` (a flat list of field
defs). Idempotent: re-running is a no-op. ``downgrade`` is a no-op — the
pre-fill state (which options were colorless) is not recoverable.

Revision ID: 114
Revises: 113
Create Date: 2026-06-30
"""

import json
from typing import Sequence, Union

from sqlalchemy.sql import text

from alembic import op

revision: str = "114"
down_revision: Union[str, None] = "113"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

DEFAULT_OPTION_COLOR = "#1976d2"
SELECT_TYPES = {"single_select", "multiple_select"}


def _backfill_field(field: dict) -> bool:
    """Fill colorless options of a single select ``field`` in place.

    Returns ``True`` if anything changed. No-op unless the field is a select
    type whose options are *mixed* (some colored, some not).
    """
    if not isinstance(field, dict) or field.get("type") not in SELECT_TYPES:
        return False
    options = field.get("options")
    if not isinstance(options, list) or not options:
        return False

    any_colored = any(
        isinstance(o, dict) and isinstance(o.get("color"), str) and o["color"].strip()
        for o in options
    )
    if not any_colored:
        return False  # fully colorless field — leave intentional built-ins alone

    changed = False
    for o in options:
        if isinstance(o, dict) and not (isinstance(o.get("color"), str) and o["color"].strip()):
            o["color"] = DEFAULT_OPTION_COLOR
            changed = True
    return changed


def _backfill_card_schema(schema: list) -> bool:
    """Walk a card-type ``fields_schema`` (sections -> fields). Mutates in place."""
    changed = False
    if not isinstance(schema, list):
        return False
    for section in schema:
        if not isinstance(section, dict):
            continue
        for field in section.get("fields", []) or []:
            if _backfill_field(field):
                changed = True
    return changed


def _backfill_relation_schema(schema: list) -> bool:
    """Walk a relation-type ``attributes_schema`` (flat field list). Mutates in place."""
    changed = False
    if not isinstance(schema, list):
        return False
    for field in schema:
        if _backfill_field(field):
            changed = True
    return changed


def _apply(table: str, column: str, walker) -> None:
    conn = op.get_bind()
    rows = conn.execute(text(f"SELECT id, {column} FROM {table}")).fetchall()
    for row in rows:
        schema = getattr(row, column)
        if not isinstance(schema, list):
            continue
        if walker(schema):
            conn.execute(
                text(f"UPDATE {table} SET {column} = CAST(:s AS jsonb) WHERE id = :id"),
                {"s": json.dumps(schema), "id": row.id},
            )


def upgrade() -> None:
    _apply("card_types", "fields_schema", _backfill_card_schema)
    _apply("relation_types", "attributes_schema", _backfill_relation_schema)


def downgrade() -> None:
    # Data repair — the set of previously-colorless options is not recoverable.
    pass
