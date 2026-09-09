"""Repair the lineage (successor) relation types' reverse verb.

The seven built-in lineage relation types — and every one auto-provisioned when
an admin enables "Supports Lineage" — shipped with ``label = "succeeds"`` and
``reverse_label = "is preceded by"``. Both phrases mean *comes after*, so the
two directions of one relation read identically wherever a relation verb is
rendered: the inventory's relation columns and filter sidebar, portals, the
calculation builder, the Excel export, and the Survey Builder's relation list,
where the two indistinguishable rows were reported (#1091).

The direction convention is **source succeeds target** — in a row (A, X), A
comes after X, which is why card detail lists X's *Successors* as the rows where
X is the target. Read from the target's side the verb is therefore "is succeeded
by". ``seed.py`` and ``_ensure_successor_relation_type`` now say so; this
migration repairs installs that already carry the wrong wording, whether it was
written by the seed, by the auto-provisioner, or by migration 115's backfill.

Russian was worse than wrong, it was transposed: ``label`` read
"предшествует" (*precedes*) and ``reverse_label`` "следует за" (*follows*). The
fix swaps them. The two live in different sub-dicts and both are compared
against the ORIGINAL snapshot before either is written, so the swap cannot
alias. French, Spanish, Italian, Portuguese and Arabic said "preceded" like
English; German, Chinese and Danish were already right and are not touched.

Two guards, both load-bearing:

- **shape** — self-referencing and key ending in "Successor", mirroring
  migration 115's own guard and the auto-provisioner's lookup. Without it, an
  unrelated relation type that legitimately reads "precedes / is preceded by"
  would be caught by the value guard alone. Deliberately does not filter
  ``is_hidden`` (a hidden lineage type can be re-enabled) and does not require
  ``built_in`` (115 and the auto-provisioner both write ``built_in = false``).
- **value, per sub-key** — a value is rewritten only when it is byte-identical
  to the wording we shipped, so an admin who reworded the verb, or translated
  one locale by hand, keeps exactly what they set while the remaining locales
  are still repaired.

Idempotent: re-running finds nothing left to change. Downgrade is a no-op —
reverting would deliberately reinstate a verb that means the wrong thing.

Revision ID: 147
Revises: 146
Create Date: 2026-09-09
"""

import json
from typing import Sequence, Union

from sqlalchemy.sql import text

from alembic import op

revision: str = "147"
down_revision: Union[str, None] = "146"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

SUCCESSOR_KEY_SUFFIX = "Successor"

OLD_REVERSE_COLUMN = "is preceded by"
NEW_REVERSE_COLUMN = "is succeeded by"

# locale -> (wording we shipped, corrected wording). Only these locales were
# wrong; de / zh / da already read correctly and get no branch at all.
LABEL_FIXES: dict[str, tuple[str, str]] = {
    "ru": ("предшествует", "следует за"),
}
REVERSE_FIXES: dict[str, tuple[str, str]] = {
    "en": (OLD_REVERSE_COLUMN, NEW_REVERSE_COLUMN),
    "fr": ("est précédé par", "a pour successeur"),
    "es": ("es precedido por", "es sucedido por"),
    "it": ("è preceduto da", "ha come successore"),
    "pt": ("é precedido por", "é sucedido por"),
    "ru": ("следует за", "предшествует"),
    "ar": ("مسبوق بـ", "يُخلَف بواسطة"),
}


def plan_fix(reverse_label, translations) -> tuple[str | None, dict | None] | None:
    """What to rewrite on one row, or ``None`` when it already reads correctly.

    Returns ``(new_reverse_label | None, new_translations | None)`` — either half
    may be ``None`` when only the other drifted, which is what lets a row with a
    custom column still have its per-locale wording repaired, and vice versa.

    Pure, so it can be unit-tested without a database (see
    ``tests/services/test_alembic_147_successor_reverse_labels.py``).
    """
    new_reverse = NEW_REVERSE_COLUMN if reverse_label == OLD_REVERSE_COLUMN else None

    patched: dict | None = None
    if isinstance(translations, dict):
        candidate = dict(translations)
        for prop, fixes in (("label", LABEL_FIXES), ("reverse_label", REVERSE_FIXES)):
            entries = candidate.get(prop)
            if not isinstance(entries, dict):
                continue
            updated = dict(entries)
            for locale, (old, new) in fixes.items():
                # Compared against `entries`, the pre-edit snapshot: `label.ru`
                # and `reverse_label.ru` swap values, and reading either back
                # mid-write would make the second fix depend on the first.
                if entries.get(locale) == old:
                    updated[locale] = new
            if updated != entries:
                candidate[prop] = updated
                patched = candidate

    if new_reverse is None and patched is None:
        return None
    return new_reverse, patched


def upgrade() -> None:
    conn = op.get_bind()
    rows = conn.execute(
        text(
            "SELECT key, reverse_label, translations FROM relation_types "
            "WHERE source_type_key = target_type_key AND key LIKE :pat"
        ),
        {"pat": f"%{SUCCESSOR_KEY_SUFFIX}"},
    ).fetchall()
    for row in rows:
        plan = plan_fix(row.reverse_label, row.translations or {})
        if plan is None:
            continue
        new_reverse, new_translations = plan
        assignments = []
        params: dict = {"key": row.key}
        if new_reverse is not None:
            assignments.append("reverse_label = :rev")
            params["rev"] = new_reverse
        if new_translations is not None:
            assignments.append("translations = CAST(:trans AS jsonb)")
            params["trans"] = json.dumps(new_translations)
        conn.execute(
            text(f"UPDATE relation_types SET {', '.join(assignments)} WHERE key = :key"),
            params,
        )


def downgrade() -> None:
    """No-op — restoring the old verb would reinstate the bug it describes."""
