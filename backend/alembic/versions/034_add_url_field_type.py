"""Change documentationUrl field type from 'text' to 'url' in card_types.

Revision ID: 034
Revises: 033
"""

from alembic import op
import sqlalchemy as sa

revision = "034"
down_revision = "033"
branch_labels = None
depends_on = None


def _update_field_type(conn, field_key: str, old_type: str, new_type: str) -> None:
    """Update a field's type inside all card_types.fields_schema JSONB arrays."""
    # Use jsonb_set to surgically update the type of a specific field by key.
    # We iterate through sections and fields in SQL to find and update the match.
    conn.execute(sa.text("""
        UPDATE card_types
        SET fields_schema = (
            SELECT jsonb_agg(
                jsonb_set(
                    section,
                    '{fields}',
                    (
                        SELECT jsonb_agg(
                            CASE
                                WHEN field->>'key' = :field_key AND field->>'type' = :old_type
                                THEN jsonb_set(field, '{type}', to_jsonb(:new_type::text))
                                ELSE field
                            END
                        )
                        FROM jsonb_array_elements(section->'fields') AS field
                    )
                )
            )
            FROM jsonb_array_elements(fields_schema) AS section
        )
        WHERE fields_schema::text LIKE :pattern
    """), {
        "field_key": field_key,
        "old_type": old_type,
        "new_type": new_type,
        "pattern": f'%"{field_key}"%',
    })


def upgrade() -> None:
    conn = op.get_bind()
    _update_field_type(conn, "documentationUrl", "text", "url")


def downgrade() -> None:
    conn = op.get_bind()
    _update_field_type(conn, "documentationUrl", "url", "text")
