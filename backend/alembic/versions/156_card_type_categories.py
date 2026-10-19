"""Add ``card_type_categories`` — the registry of EA layers a card type sits in.

Until now ``card_types.category`` was free text with no registry: the backend
never validated it, the type editor was a bare text field (so a typo silently
invented a layer) and the frontend carried the four layer names in three
hard-coded copies. This table makes the layers data. ``card_types.category``
keeps its column and its values — it now *names* a row here by ``key``.

The four built-in layers are **not** inserted here: ``seed_metamodel`` inserts
them insert-only on every boot (migrations run first), exactly like the
built-in resource types. What this migration does is **adopt** every distinct
non-blank category already stored on a card type that is not one of the four
defaults, as a custom row (label = key, neutral grey, ordered after the
defaults) — otherwise the type editor, which always sends ``category`` back,
would refuse every unrelated edit of such a type with ``unknown_category``.

Revision ID: 156
Revises: 155
"""

from collections.abc import Iterable, Sequence
from typing import Union

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "156"
down_revision: Union[str, None] = "155"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

ADOPTED_COLOR = "#999999"
ADOPTED_SORT_ORDER_START = 100
MAX_KEY_LENGTH = 100


def plan_adopted_rows(values: Iterable[object], default_keys: Iterable[str]) -> list[dict]:
    """The custom rows to insert for the stored ``values``: one per distinct
    trimmed, non-blank string that is not a default key, in sorted order so a
    re-run on the same data numbers them the same way. Pure — no database."""
    defaults = set(default_keys)
    keys = sorted(
        {
            v.strip()
            for v in values
            if isinstance(v, str)
            and v.strip()
            and len(v.strip()) <= MAX_KEY_LENGTH
            and v.strip() not in defaults
        }
    )
    return [
        {
            "key": key,
            "label": key,
            "color": ADOPTED_COLOR,
            "sort_order": ADOPTED_SORT_ORDER_START + index,
            "built_in": False,
            "translations": {},
        }
        for index, key in enumerate(keys)
    ]


def upgrade() -> None:
    table = op.create_table(
        "card_type_categories",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("key", sa.String(length=100), nullable=False, unique=True),
        sa.Column("label", sa.String(length=100), nullable=False),
        sa.Column("color", sa.String(length=20), nullable=False, server_default=ADOPTED_COLOR),
        sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("built_in", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column(
            "translations",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default="{}",
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
    )

    from app.services.seed import DEFAULT_CATEGORY_KEYS

    card_types = sa.table("card_types", sa.column("category", sa.String))
    conn = op.get_bind()
    stored = conn.execute(
        sa.select(card_types.c.category).where(card_types.c.category.is_not(None)).distinct()
    ).scalars()
    rows = plan_adopted_rows(stored, DEFAULT_CATEGORY_KEYS)
    if not rows:
        return
    import uuid

    op.bulk_insert(table, [{"id": uuid.uuid4(), **row} for row in rows])
    print(f"[migration 155] Adopted {len(rows)} custom card type categor(y/ies)")


def downgrade() -> None:
    op.drop_table("card_type_categories")
