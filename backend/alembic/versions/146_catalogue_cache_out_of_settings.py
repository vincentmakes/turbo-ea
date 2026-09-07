"""Move the cached reference catalogues out of the settings row.

The three catalogue payloads a PyPI fetch caches (capabilities, processes,
value streams) lived as keys inside ``app_settings.general_settings`` — the
one JSONB blob every setting in the product is read-modify-written through.
Once a catalogue was cached, every settings save anywhere (core's own
PATCHes and every extension's ``set_settings``) read and rewrote megabytes
of nested JSON, while reads never touched it: a switch that "takes 3.5 s to
save" on an instance where the inventory is instant. They get a table of
their own; this moves whatever is cached today and strips it from the blob,
which is what makes an affected instance fast again on upgrade.

Python-side fetch-mutate-update, like 099: the ``?`` JSONB operator does not
survive SQLAlchemy's named-parameter scan inside ``text()``.

Revision ID: 146
Revises: 145
"""

import json
from typing import Union

import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

from alembic import op

revision: str = "146"
down_revision: Union[str, None] = "145"
branch_labels: Union[str, None] = None
depends_on: Union[str, None] = None

# Mirrors catalogue_common.{CAPABILITY,PROCESS,VALUE_STREAM}_CACHE_KEY — pinned
# here rather than imported, so the migration keeps meaning what it meant
# when it ran even if the constants ever move.
CACHE_KEYS = ("capability_catalogue", "process_catalogue", "value_stream_catalogue")


def _load(value):
    return json.loads(value) if isinstance(value, str) else (value or {})


def upgrade() -> None:
    op.create_table(
        "catalogue_cache",
        sa.Column("key", sa.String(64), primary_key=True),
        sa.Column("payload", JSONB, nullable=False),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
    )
    conn = op.get_bind()
    row = conn.execute(
        sa.text("SELECT general_settings FROM app_settings WHERE id = 'default'")
    ).first()
    if row is None:
        return
    general = dict(_load(row[0]))
    moved = {key: general.pop(key) for key in CACHE_KEYS if key in general}
    if not moved:
        return
    for key, payload in moved.items():
        if not isinstance(payload, dict):
            continue
        conn.execute(
            sa.text(
                "INSERT INTO catalogue_cache (key, payload) VALUES (:k, CAST(:p AS jsonb)) "
                "ON CONFLICT (key) DO UPDATE SET payload = EXCLUDED.payload"
            ),
            {"k": key, "p": json.dumps(payload)},
        )
    conn.execute(
        sa.text(
            "UPDATE app_settings SET general_settings = CAST(:s AS jsonb) WHERE id = 'default'"
        ),
        {"s": json.dumps(general)},
    )


def downgrade() -> None:
    conn = op.get_bind()
    rows = conn.execute(sa.text("SELECT key, payload FROM catalogue_cache")).fetchall()
    settings = conn.execute(
        sa.text("SELECT general_settings FROM app_settings WHERE id = 'default'")
    ).first()
    if rows and settings is not None:
        general = dict(_load(settings[0]))
        for key, payload in rows:
            general[key] = _load(payload)
        conn.execute(
            sa.text(
                "UPDATE app_settings SET general_settings = CAST(:s AS jsonb) WHERE id = 'default'"
            ),
            {"s": json.dumps(general)},
        )
    op.drop_table("catalogue_cache")
