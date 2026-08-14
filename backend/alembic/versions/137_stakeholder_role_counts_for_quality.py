"""Add ``counts_for_quality`` to stakeholder role definitions.

The data-quality scorer's "stakeholders" bucket used to award one
completeness slot per role defined on the card type, so a type carrying
both ``responsible`` and ``observer`` silently cost two slots and a card
with an owner named but nobody watching was capped at half the bucket —
while the admin panel showed a single slider and drew it as a single
slice. The bucket is now one yes/no slot filled by any assigned role, and
this column decides which roles qualify.

The default is ``true`` so every existing role keeps counting; only the
built-in ``observer`` is flipped off, because watching a card is passive
and should never stand in for ownership. The column is brand new, so this
UPDATE cannot clobber an admin customisation — there is nothing to
preserve yet. Admins who *want* their observers to count can turn the
toggle back on per role in Admin → Metamodel → Stakeholder roles.

Stored scores are not rewritten here: ``data_quality`` needs the JSONB
``fields_schema`` walk, the ``__dataQuality`` weights and the mandatory
relation/tag checks, none of which are expressible in SQL. The one-shot
startup rescore in ``app.main`` handles it — its marker key is bumped to
``dataQualityCanonicalRescoreDoneV3`` in the same release.

Revision ID: 137
Revises: 136
"""

from collections.abc import Sequence
from typing import Union

import sqlalchemy as sa

from alembic import op

revision: str = "137"
down_revision: Union[str, None] = "136"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "stakeholder_role_definitions",
        sa.Column(
            "counts_for_quality",
            sa.Boolean(),
            nullable=False,
            server_default=sa.true(),
        ),
    )
    op.execute(
        "UPDATE stakeholder_role_definitions SET counts_for_quality = false WHERE key = 'observer'"
    )


def downgrade() -> None:
    op.drop_column("stakeholder_role_definitions", "counts_for_quality")
