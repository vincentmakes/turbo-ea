"""Normalise legacy ``risks.source_type = 'ppm'`` rows back to ``'manual'``.

A short-lived pre-release revision of the Risk Register let PPM project
risks be promoted into the register with ``source_type = 'ppm'``. The
feature was removed before release, and with it the ``'ppm'`` value left
the API's source vocabulary — but any risk promoted while the feature
existed still carries the value. A single such row made the strict
response schema fail validation and the whole ``GET /risks`` list 500,
rendering the register empty even though the rows were intact.

Guarded UPDATE: only rows still carrying the retired value are touched,
so nothing else changes shape. No downgrade — 'ppm' is not a valid value
anywhere anymore.

Revision ID: 127
Revises: 126
"""

from typing import Union

import sqlalchemy as sa

from alembic import op

revision: str = "127"
down_revision: Union[str, None] = "126"
branch_labels: Union[str, None] = None
depends_on: Union[str, None] = None


def upgrade() -> None:
    op.execute(sa.text("UPDATE risks SET source_type = 'manual' WHERE source_type = 'ppm'"))


def downgrade() -> None:
    # The 'ppm' provenance is intentionally not restorable.
    pass
