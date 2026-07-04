"""Add card_embeddings sidecar table for semantic (vector) card search.

Stores one pgvector embedding per card, populated asynchronously by the
reconciliation worker in ``app.main``. Decoupled from the ``cards`` row so
re-embedding never contends with card writes; the CASCADE FK cleans up on
card delete. See ``app.services.embedding_service`` and the
``/cards/semantic-search`` endpoint.

Revision ID: 118
Revises: 117
Create Date: 2026-07-04
"""

from typing import Union

import sqlalchemy as sa
from pgvector.sqlalchemy import Vector

from alembic import op

revision: str = "118"
down_revision: Union[str, None] = "117"
branch_labels: Union[str, None] = None
depends_on: Union[str, None] = None

# Kept in sync with EMBEDDING_DIM in app.models.card_embedding.
EMBEDDING_DIM = 768


def upgrade() -> None:
    # The app lifespan also ensures this on every startup path (including the
    # fresh-DB create_all path that skips migration bodies); creating it here
    # too keeps the migration self-contained for standalone `alembic upgrade`.
    op.execute(sa.text("CREATE EXTENSION IF NOT EXISTS vector"))

    op.create_table(
        "card_embeddings",
        sa.Column(
            "card_id",
            sa.dialects.postgresql.UUID(as_uuid=True),
            sa.ForeignKey("cards.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column("embedding", Vector(EMBEDDING_DIM), nullable=False),
        sa.Column("model", sa.String(200), nullable=False),
        sa.Column("dim", sa.Integer(), nullable=False),
        sa.Column("content_hash", sa.Text(), nullable=False),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
    )

    # HNSW index for fast approximate nearest-neighbour on cosine distance.
    op.execute(
        sa.text(
            "CREATE INDEX ix_card_embeddings_embedding_hnsw "
            "ON card_embeddings USING hnsw (embedding vector_cosine_ops)"
        )
    )


def downgrade() -> None:
    op.drop_index("ix_card_embeddings_embedding_hnsw", table_name="card_embeddings")
    op.drop_table("card_embeddings")
