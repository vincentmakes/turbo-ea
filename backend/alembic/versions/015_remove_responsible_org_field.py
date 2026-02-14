"""Remove responsibleOrg text field from BusinessProcess fields_schema.

The Responsible Organization is already modeled as a proper relation
(relProcessToOrg) so the free-text attribute is redundant.

Revision ID: 015
Revises: 014
Create Date: 2026-02-14
"""
from typing import Sequence, Union

import json
import sqlalchemy as sa

from alembic import op

revision: str = "015"
down_revision: Union[str, None] = "014"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    conn = op.get_bind()

    # Fetch current fields_schema for BusinessProcess
    result = conn.execute(
        sa.text("SELECT fields_schema FROM fact_sheet_types WHERE key = 'BusinessProcess'")
    ).fetchone()

    if not result or not result[0]:
        return

    schema = result[0] if isinstance(result[0], list) else json.loads(result[0])
    changed = False

    for section in schema:
        original_len = len(section.get("fields", []))
        section["fields"] = [
            f for f in section.get("fields", [])
            if f.get("key") != "responsibleOrg"
        ]
        if len(section["fields"]) != original_len:
            changed = True

    if changed:
        conn.execute(
            sa.text(
                "UPDATE fact_sheet_types SET fields_schema = :schema WHERE key = 'BusinessProcess'"
            ),
            {"schema": json.dumps(schema)},
        )


def downgrade() -> None:
    conn = op.get_bind()

    result = conn.execute(
        sa.text("SELECT fields_schema FROM fact_sheet_types WHERE key = 'BusinessProcess'")
    ).fetchone()

    if not result or not result[0]:
        return

    schema = result[0] if isinstance(result[0], list) else json.loads(result[0])

    # Re-add the field to the "Operational Details" section
    for section in schema:
        if section.get("section") == "Operational Details":
            # Insert at position 1 (after frequency, before documentationUrl)
            section["fields"].insert(1, {
                "key": "responsibleOrg",
                "label": "Responsible Organization",
                "type": "text",
                "weight": 0,
            })
            break

    conn.execute(
        sa.text(
            "UPDATE fact_sheet_types SET fields_schema = :schema WHERE key = 'BusinessProcess'"
        ),
        {"schema": json.dumps(schema)},
    )
