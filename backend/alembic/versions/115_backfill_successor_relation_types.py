"""Backfill: create the ``rel{Key}Successor`` relation type for every card type
that has ``has_successors`` enabled but is missing its lineage relation type.

Background (issue #729): "Supports Lineage" on a card type is the boolean
``card_types.has_successors``. The card detail lineage section only renders when a
non-hidden, self-referential relation type whose key ends in "Successor" exists for
that type. The seven built-in lineage types ship such a relation type via
``seed.py``, but enabling the flag through the metamodel admin used to only flip the
boolean — it never created the matching relation type. So any admin-enabled type
(e.g. Business Context, Objective) had the flag on with no UI.

The API now auto-provisions the relation type when the flag is enabled. This
migration backfills existing installs already stuck in the broken state: it walks
every card type with ``has_successors = true`` and, when no qualifying successor
relation type exists, un-hides an existing hidden one or inserts a new one.

The guard keys off the *shape* the frontend matches (self-pair + key ending in
"Successor" + not hidden), so the seeded built-ins are skipped automatically with no
hardcoded list.

Idempotent: re-running is a no-op. Downgrade is intentionally a no-op — auto-created
rows are indistinguishable from admin-created ones, and dropping them could delete a
relation type the admin relies on.

Revision ID: 115
Revises: 114
Create Date: 2026-06-30
"""

import json
import uuid
from typing import Sequence, Union

from sqlalchemy.sql import text

from alembic import op

revision: str = "115"
down_revision: Union[str, None] = "114"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

SUCCESSOR_KEY_SUFFIX = "Successor"

# Mirrors the seeded built-in successors and the API auto-provision helper so
# backfilled relation types carry the same wording + i18n.
_SUCCESSOR_LABEL = "succeeds"
_SUCCESSOR_REVERSE_LABEL = "is preceded by"
_SUCCESSOR_TRANSLATIONS = {
    "label": {
        "en": _SUCCESSOR_LABEL,
        "de": "folgt auf",
        "fr": "succède à",
        "es": "sucede a",
        "it": "succede a",
        "pt": "sucede a",
        "zh": "继承",
        "ru": "предшествует",
        "da": "efterfølger",
        "ar": "يخلف",
    },
    "reverse_label": {
        "en": _SUCCESSOR_REVERSE_LABEL,
        "de": "wird abgelöst durch",
        "fr": "est précédé par",
        "es": "es precedido por",
        "it": "è preceduto da",
        "pt": "é precedido por",
        "zh": "被继承",
        "ru": "следует за",
        "da": "efterfølges af",
        "ar": "مسبوق بـ",
    },
}


def upgrade() -> None:
    conn = op.get_bind()
    type_keys = [
        row.key
        for row in conn.execute(
            text("SELECT key FROM card_types WHERE has_successors = true")
        ).fetchall()
    ]
    for type_key in type_keys:
        # Already has a usable (non-hidden, self-pair, *Successor) relation type? Skip.
        # This auto-skips the seeded built-ins.
        existing = conn.execute(
            text(
                "SELECT 1 FROM relation_types "
                "WHERE source_type_key = :k AND target_type_key = :k "
                "AND key LIKE :pat AND is_hidden = false LIMIT 1"
            ),
            {"k": type_key, "pat": f"%{SUCCESSOR_KEY_SUFFIX}"},
        ).first()
        if existing:
            continue

        key = f"rel{type_key}{SUCCESSOR_KEY_SUFFIX}"
        by_key = conn.execute(
            text("SELECT id, is_hidden FROM relation_types WHERE key = :key"),
            {"key": key},
        ).first()
        if by_key is not None:
            # Exact key exists but is hidden — un-hide rather than insert (UNIQUE key).
            if by_key.is_hidden:
                conn.execute(
                    text("UPDATE relation_types SET is_hidden = false WHERE id = :id"),
                    {"id": by_key.id},
                )
            continue

        next_order = (
            conn.execute(
                text("SELECT COALESCE(MAX(sort_order), 0) + 1 FROM relation_types")
            ).scalar()
            or 1
        )
        conn.execute(
            text(
                "INSERT INTO relation_types "
                "(id, key, label, reverse_label, source_type_key, target_type_key, "
                "cardinality, attributes_schema, built_in, is_hidden, sort_order, translations) "
                "VALUES "
                "(:id, :key, :label, :reverse_label, :src, :tgt, :card, "
                "CAST(:attrs AS jsonb), false, false, :sort_order, CAST(:trans AS jsonb))"
            ),
            {
                "id": str(uuid.uuid4()),
                "key": key,
                "label": _SUCCESSOR_LABEL,
                "reverse_label": _SUCCESSOR_REVERSE_LABEL,
                "src": type_key,
                "tgt": type_key,
                "card": "n:m",
                "attrs": json.dumps([]),
                "sort_order": next_order,
                "trans": json.dumps(_SUCCESSOR_TRANSLATIONS),
            },
        )


def downgrade() -> None:
    # No-op: auto-created successor relation types are indistinguishable from
    # admin-created ones, and removing them could delete data the admin relies on.
    pass
