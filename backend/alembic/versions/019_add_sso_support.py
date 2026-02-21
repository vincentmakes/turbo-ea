"""add SSO support: user auth_provider/sso_subject_id columns + sso_invitations table

Revision ID: 019
Revises: 018
Create Date: 2026-02-15
"""

from typing import Sequence, Union

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "019"
down_revision: Union[str, None] = "018"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    from sqlalchemy import inspect as sa_inspect

    conn = op.get_bind()
    inspector = sa_inspect(conn)

    # Add auth_provider and sso_subject_id columns to users table
    existing_columns = {col["name"] for col in inspector.get_columns("users")}

    if "auth_provider" not in existing_columns:
        op.add_column(
            "users",
            sa.Column("auth_provider", sa.String(20), server_default="local", nullable=False),
        )

    if "sso_subject_id" not in existing_columns:
        op.add_column(
            "users",
            sa.Column("sso_subject_id", sa.String(256), nullable=True, unique=True),
        )

    if "password_setup_token" not in existing_columns:
        op.add_column(
            "users",
            sa.Column("password_setup_token", sa.String(128), nullable=True, unique=True),
        )

    # Make password_hash nullable (SSO users don't have passwords)
    op.alter_column("users", "password_hash", existing_type=sa.String(200), nullable=True)

    # Create sso_invitations table
    if not inspector.has_table("sso_invitations"):
        op.create_table(
            "sso_invitations",
            sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
            sa.Column("email", sa.String(320), nullable=False, unique=True),
            sa.Column("role", sa.String(20), server_default="viewer", nullable=False),
            sa.Column(
                "invited_by",
                postgresql.UUID(as_uuid=True),
                sa.ForeignKey("users.id", ondelete="SET NULL"),
                nullable=True,
            ),
            sa.Column(
                "created_at",
                sa.DateTime(timezone=True),
                server_default=sa.func.now(),
            ),
            sa.Column(
                "updated_at",
                sa.DateTime(timezone=True),
                server_default=sa.func.now(),
            ),
        )


def downgrade() -> None:
    op.drop_table("sso_invitations")
    op.drop_column("users", "password_setup_token")
    op.drop_column("users", "sso_subject_id")
    op.drop_column("users", "auth_provider")
    op.alter_column("users", "password_hash", existing_type=sa.String(200), nullable=False)
