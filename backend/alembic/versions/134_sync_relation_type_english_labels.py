"""Repair relation types whose English translation drifted from their label.

Metamodel labels resolve *translations-first*: ``translations[property]["en"]``
shadows the ``label`` / ``reverse_label`` columns everywhere the frontend renders
a relation verb. Every seeded relation type carries an ``en`` entry — injected by
``_inject_english_translations_relation`` (``seed.py``) on fresh installs and by
migration 038 on pre-existing ones.

Until this release the relation editor in Admin → Metamodel wrote the raw columns
only and echoed the old ``translations`` map straight back, so renaming a relation
type changed the database but nothing a user could see: the card's Relations
section, the inventory relation columns, the matrix/portfolio reports and the
portals all kept rendering the stale English translation, while the surfaces that
read the raw column (metamodel graph, Layered Dependency View, dependency report)
showed the new one — the split symptom reported in #912.

The editor is now locale-aware and the API keeps the two in step, but installs
that already renamed a relation type carry the divergence. This migration adopts
the raw column as the truth for English:

- for every ``relation_types`` row that HAS an ``en`` entry differing from its
  column, rewrite the entry to match the column;
- never create an ``en`` entry where none exists, and never touch another locale.

Guarded and idempotent: a fresh install (where seed keeps the two identical) is a
no-op, and re-running changes nothing.

Relation-type translations have never been editable in any UI — ``TranslationDialog``
covers card types, subtypes, sections, fields, options and stakeholder roles, but not
relation types — so a divergent ``en`` entry can only have come from this bug. The one
edge case is an admin who renamed a relation type while the UI was in another language:
the old editor wrote the translated wording into the base column, so that wording is
adopted as English here. It matches what those installs already show on the raw-label
surfaces, and the admin can re-edit the verb in English to correct it.

Downgrade is a no-op — the shadowed value was stale by definition and is not
recoverable.

Revision ID: 134
Revises: 133
Create Date: 2026-08-05
"""

import json
from typing import Sequence, Union

from sqlalchemy.sql import text

from alembic import op

revision: str = "134"
down_revision: Union[str, None] = "133"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def plan_repair(label, reverse_label, translations) -> dict | None:
    """Return a repaired ``translations`` dict, or ``None`` when nothing to do.

    Pure, so it can be unit-tested without a database (see
    ``tests/services/test_alembic_134_relation_label_translations.py``).
    """
    if not isinstance(translations, dict):
        return None
    patched = dict(translations)
    changed = False
    for prop, value in (("label", label), ("reverse_label", reverse_label)):
        entries = patched.get(prop)
        # Only realign an entry that already exists — never invent one. A row with
        # no English translation already resolves through the column fallback.
        if not isinstance(entries, dict) or "en" not in entries:
            continue
        if entries["en"] == value:
            continue
        updated = dict(entries)
        if value:
            updated["en"] = value
        else:
            # Column was cleared: drop the stale translation so resolution falls back.
            updated.pop("en", None)
        patched[prop] = updated
        changed = True
    return patched if changed else None


def upgrade() -> None:
    conn = op.get_bind()
    rows = conn.execute(
        text("SELECT key, label, reverse_label, translations FROM relation_types")
    ).fetchall()
    for row in rows:
        patched = plan_repair(row.label, row.reverse_label, row.translations or {})
        if patched is None:
            continue
        conn.execute(
            text("UPDATE relation_types SET translations = CAST(:s AS jsonb) WHERE key = :key"),
            {"s": json.dumps(patched), "key": row.key},
        )


def downgrade() -> None:
    """No-op — the overwritten English translations were stale by definition."""
