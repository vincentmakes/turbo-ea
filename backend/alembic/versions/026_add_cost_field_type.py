"""Migrate cost-related fields from type 'number' to type 'cost'.

Introduces a dedicated 'cost' field type so cost fields are distinguished
from plain numeric fields (e.g. "Number of Users").  Updates built-in
card types (Application, ITComponent, Initiative) and the relAppToITC
relation type.

Revision ID: 026
Revises: 025
Create Date: 2026-02-17
"""
import json
from typing import Sequence, Union

import sqlalchemy as sa

from alembic import op

revision: str = "026"
down_revision: Union[str, None] = "025"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# Field keys that should be migrated from "number" to "cost"
COST_FIELD_KEYS = {"costTotalAnnual", "costBudget", "costActual"}


def _migrate_card_type_fields(conn, type_key: str, to_type: str, from_type: str) -> None:
    result = conn.execute(
        sa.text("SELECT fields_schema FROM card_types WHERE key = :key"),
        {"key": type_key},
    ).fetchone()

    if not result or not result[0]:
        return

    schema = result[0] if isinstance(result[0], list) else json.loads(result[0])
    changed = False

    for section in schema:
        for field in section.get("fields", []):
            if field.get("key") in COST_FIELD_KEYS and field.get("type") == from_type:
                field["type"] = to_type
                changed = True

    if changed:
        conn.execute(
            sa.text("UPDATE card_types SET fields_schema = :schema WHERE key = :key"),
            {"schema": json.dumps(schema), "key": type_key},
        )


def _migrate_relation_type_attrs(conn, type_key: str, to_type: str, from_type: str) -> None:
    result = conn.execute(
        sa.text("SELECT attributes_schema FROM relation_types WHERE key = :key"),
        {"key": type_key},
    ).fetchone()

    if not result or not result[0]:
        return

    schema = result[0] if isinstance(result[0], list) else json.loads(result[0])
    changed = False

    for field in schema:
        if field.get("key") in COST_FIELD_KEYS and field.get("type") == from_type:
            field["type"] = to_type
            changed = True

    if changed:
        conn.execute(
            sa.text("UPDATE relation_types SET attributes_schema = :schema WHERE key = :key"),
            {"schema": json.dumps(schema), "key": type_key},
        )


def upgrade() -> None:
    conn = op.get_bind()

    for type_key in ("Application", "ITComponent", "Initiative"):
        _migrate_card_type_fields(conn, type_key, to_type="cost", from_type="number")

    _migrate_relation_type_attrs(conn, "relAppToITC", to_type="cost", from_type="number")


def downgrade() -> None:
    conn = op.get_bind()

    for type_key in ("Application", "ITComponent", "Initiative"):
        _migrate_card_type_fields(conn, type_key, to_type="number", from_type="cost")

    _migrate_relation_type_attrs(conn, "relAppToITC", to_type="number", from_type="cost")
