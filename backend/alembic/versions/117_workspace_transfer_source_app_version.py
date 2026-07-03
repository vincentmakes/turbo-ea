"""Add ``source_app_version`` to workspace_transfers.

The workspace-export bundle's ``manifest.json`` has always carried the source
instance's ``app_version``, but the importer never surfaced it. The preview
job now records it here so the UI can show an advisory warning when a bundle
was exported from a different Turbo EA version than the one importing it
(discussion #667).

Revision ID: 117
Revises: 116
Create Date: 2026-07-03
"""

from typing import Union

import sqlalchemy as sa

from alembic import op

revision: str = "117"
down_revision: Union[str, None] = "116"
branch_labels: Union[str, None] = None
depends_on: Union[str, None] = None


def upgrade() -> None:
    op.add_column(
        "workspace_transfers", sa.Column("source_app_version", sa.String(32), nullable=True)
    )


def downgrade() -> None:
    op.drop_column("workspace_transfers", "source_app_version")
