"""Custom languages: where a language came from.

A custom language installed from the community library
(``services/language_catalogue.py``) records it: ``source`` (``"community"``,
``NULL`` for one added by hand), the SHA-256 of the pack that was installed
(``source_sha256``, what tells an installed pack from an update) and the
library commit that pack was taken from (``source_commit``). All three are
nullable with no default, so every existing language reads as added by hand.
No constraint is created. Downgrade drops the three columns.

Revision ID: 178
Revises: 177
"""

from __future__ import annotations

from collections.abc import Sequence
from typing import Union

import sqlalchemy as sa

from alembic import op

revision: str = "178"
down_revision: Union[str, None] = "177"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

LOCALES = "custom_locales"
COLUMNS = (
    ("source", 20),
    ("source_sha256", 64),
    ("source_commit", 40),
)


def upgrade() -> None:
    for name, length in COLUMNS:
        op.add_column(LOCALES, sa.Column(name, sa.String(length=length), nullable=True))


def downgrade() -> None:
    for name, _length in reversed(COLUMNS):
        op.drop_column(LOCALES, name)
