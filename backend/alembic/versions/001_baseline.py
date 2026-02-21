"""baseline – stamp existing schema

Revision ID: 001
Revises: None
Create Date: 2026-02-11

This is a baseline migration representing the schema already created by
create_all.  When running against an existing database, stamp this revision
without executing:  alembic stamp 001
"""

from typing import Sequence, Union

revision: str = "001"
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Baseline: tables already exist via create_all.
    # This migration is intentionally empty – stamp it on existing DBs.
    pass


def downgrade() -> None:
    pass
