"""Repair four Arabic relation verbs that carry an attribute's name.

When Arabic was added, four built-in relation types received the Arabic text of
their *attribute* instead of their verb, the same slip migration 152 repaired
for Danish: Organization → Application read «نوع الاستخدام» ("usage type"),
Application → Business Capability and Business Process → Business Capability
«نوع الدعم» ("support type"), and Business Process → Application «الاستخدام»
("usage"). ``seed.py`` now carries the verbs, but its boot-time merge fills gaps
and never overwrites a stored translation, so an existing install needs this.

**Value guard.** The ``ar`` label is rewritten only when it is byte-identical to
the wrong value we shipped, so an admin's own wording survives. Nothing but
``translations.label.ar`` is touched. Idempotent; downgrade is a no-op —
reverting would reinstate words that name the wrong thing.

Revision ID: 158
Revises: 157
Create Date: 2026-10-28
"""

import json
from typing import Sequence, Union

from sqlalchemy.sql import text

from alembic import op

revision: str = "158"
down_revision: Union[str, None] = "157"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

LOCALE = "ar"

# relation type key -> (Arabic value we shipped, corrected Arabic verb)
RELATION_LABEL_FIXES: dict[str, tuple[str, str]] = {
    "relOrgToApp": ("نوع الاستخدام", "يستخدم"),
    "relAppToBC": ("نوع الدعم", "يدعم"),
    "relProcessToBC": ("نوع الدعم", "يدعم"),
    "relProcessToApp": ("الاستخدام", "مدعوم بواسطة"),
}


def plan_relation_fix(key: str, translations) -> dict | None:
    """The repaired ``relation_types.translations``, or ``None`` when nothing drifted.

    Pure, so it is unit-tested without a database
    (``tests/services/test_alembic_158_arabic_relation_verbs.py``).
    """
    fix = RELATION_LABEL_FIXES.get(key)
    if fix is None or not isinstance(translations, dict):
        return None
    label = translations.get("label")
    old, new = fix
    if not isinstance(label, dict) or label.get(LOCALE) != old:
        return None
    return {**translations, "label": {**label, LOCALE: new}}


def upgrade() -> None:
    conn = op.get_bind()
    rows = conn.execute(
        text("SELECT key, translations FROM relation_types WHERE key = ANY(:keys)"),
        {"keys": sorted(RELATION_LABEL_FIXES)},
    ).fetchall()
    for row in rows:
        new_translations = plan_relation_fix(row.key, row.translations)
        if new_translations is None:
            continue
        conn.execute(
            text("UPDATE relation_types SET translations = CAST(:trans AS jsonb) WHERE key = :key"),
            {"key": row.key, "trans": json.dumps(new_translations, ensure_ascii=False)},
        )


def downgrade() -> None:
    """No-op — restoring the old values would reinstate labels that name the wrong thing."""
