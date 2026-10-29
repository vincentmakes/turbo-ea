"""Widen users.role and sso_invitations.role to the length of roles.key.

``POST /roles`` accepts a key of up to 50 characters (``roles.key`` is
``VARCHAR(50)``), but the two columns that store an *assigned* role key were
still ``VARCHAR(20)``. A role such as ``regional_application_owner`` was
created fine, and every write of it then failed with "value too long for type
character varying(20)": creating or editing a user, a bulk role change, an SSO
invitation, sign-up with that role as the default, and a workspace import of
such a user (issue #1330).

Widening a ``varchar`` is a catalogue-only change on PostgreSQL (no table
rewrite), and ``fk_users_role_key`` (``users.role`` -> ``roles.key``, migration
022) stays valid: it already referenced a 50-character column.

**Downgrade** narrows both columns back to 20. PostgreSQL refuses it while any
row holds a key longer than 20 characters, and that is intended: truncating the
value would orphan ``fk_users_role_key`` and silently change who holds which
role.

Revision ID: 159
Revises: 158
Create Date: 2026-10-28
"""

from typing import Sequence, Union

import sqlalchemy as sa

from alembic import op

revision: str = "159"
down_revision: Union[str, None] = "158"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# Every (table, column) that stores a roles.key.
ROLE_KEY_COLUMNS: tuple[tuple[str, str], ...] = (
    ("users", "role"),
    ("sso_invitations", "role"),
)
OLD_LENGTH = 20
NEW_LENGTH = 50


def upgrade() -> None:
    for table, column in ROLE_KEY_COLUMNS:
        op.alter_column(
            table,
            column,
            existing_type=sa.String(OLD_LENGTH),
            type_=sa.String(NEW_LENGTH),
            existing_nullable=False,
        )


def downgrade() -> None:
    for table, column in ROLE_KEY_COLUMNS:
        op.alter_column(
            table,
            column,
            existing_type=sa.String(NEW_LENGTH),
            type_=sa.String(OLD_LENGTH),
            existing_nullable=False,
        )
