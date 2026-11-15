"""Pictures in decision and SoAW text: the ``document_images`` table.

One immutable row per uploaded picture (PNG, JPEG, GIF or WebP, at most
5 MB): its document ``kind`` (``adr`` / ``soaw``, checked), the MIME type the
leading bytes proved, size, SHA-256, the bytes, the uploader (``SET NULL``),
``created_at`` and ``used_at`` — stamped the first time a save stores the
picture; rows never used are purged after a grace period by an hourly loop
(index on ``used_at, created_at``). The rich text references a row as
``<img src="/api/v1/document-images/{kind}/{id}">``.

Names (constraint, index) are exactly the model's own, so a schema built by
``create_all`` downgrades cleanly. Downgrade drops the table.

Revision ID: 173
Revises: 172
"""

from __future__ import annotations

from collections.abc import Sequence
from typing import Union

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "173"
down_revision: Union[str, None] = "172"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

TABLE = "document_images"


def upgrade() -> None:
    op.create_table(
        TABLE,
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("kind", sa.String(8), nullable=False),
        sa.Column("mime_type", sa.String(32), nullable=False),
        sa.Column("size", sa.Integer(), nullable=False),
        sa.Column("sha256", sa.String(64), nullable=False),
        sa.Column("data", sa.LargeBinary(), nullable=False),
        sa.Column(
            "created_by",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column("used_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint("kind IN ('adr', 'soaw')", name="ck_document_images_kind"),
    )
    op.create_index("ix_document_images_used_at_created_at", TABLE, ["used_at", "created_at"])


def downgrade() -> None:
    op.drop_index("ix_document_images_used_at_created_at", table_name=TABLE)
    op.drop_table(TABLE)
