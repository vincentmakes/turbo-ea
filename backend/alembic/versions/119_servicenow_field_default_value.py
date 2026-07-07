"""Add ``default_value`` to servicenow_field_mappings.

Field mappings can now carry a default / constant value written to the target
card field on inbound (pull) sync. A row with no ``snow_field`` acts as a
hardcoded constant (e.g. ``subtype: hardware``); a row with a ``snow_field``
uses the default only as a fallback when the source value is empty/missing
(discussion #768). Stored as JSONB so list-typed defaults (``multiple_select``)
survive intact.

Revision ID: 119
Revises: 118
Create Date: 2026-07-07
"""

from typing import Union

import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

from alembic import op

revision: str = "119"
down_revision: Union[str, None] = "118"
branch_labels: Union[str, None] = None
depends_on: Union[str, None] = None


def upgrade() -> None:
    op.add_column(
        "servicenow_field_mappings",
        sa.Column("default_value", JSONB, nullable=True),
    )


def downgrade() -> None:
    op.drop_column("servicenow_field_mappings", "default_value")
