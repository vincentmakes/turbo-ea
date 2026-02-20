"""Change documentationUrl field type from 'text' to 'url' in card_types.

Revision ID: 034
Revises: 033
"""

import json

from alembic import op
import sqlalchemy as sa

revision = "034"
down_revision = "033"
branch_labels = None
depends_on = None


def _update_field_type(conn, field_key: str, old_type: str, new_type: str) -> None:
    """Update a field's type inside card_types.fields_schema using Python."""
    rows = conn.execute(
        sa.text("SELECT key, fields_schema FROM card_types WHERE fields_schema IS NOT NULL")
    ).fetchall()
    for row in rows:
        schema = row[1]
        if schema is None:
            continue
        changed = False
        for section in schema:
            for field in section.get("fields", []):
                if field.get("key") == field_key and field.get("type") == old_type:
                    field["type"] = new_type
                    changed = True
        if changed:
            conn.execute(
                sa.text("UPDATE card_types SET fields_schema = :schema WHERE key = :key"),
                {"schema": json.dumps(schema), "key": row[0]},
            )


def upgrade() -> None:
    conn = op.get_bind()
    _update_field_type(conn, "documentationUrl", "text", "url")


def downgrade() -> None:
    conn = op.get_bind()
    _update_field_type(conn, "documentationUrl", "url", "text")
