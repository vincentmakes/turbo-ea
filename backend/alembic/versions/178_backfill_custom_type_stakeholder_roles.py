"""Give custom card types real definitions of the stakeholder roles they show.

Until this release ``POST /metamodel/types`` stored a new custom type's roles
(Responsible and Observer) only in the legacy ``card_types.stakeholder_roles``
JSONB list, never as ``stakeholder_role_definitions`` rows. The picker showed
them through its fallback, which applies only while a type has **no**
definition row, so:

- such a role granted no card permission at all (permissions are read from the
  definition row), and
- the first role an admin added to the type replaced them both: Responsible
  disappeared, together with every assignment made under it (#1437). The
  ``stakeholders`` rows were kept, which is why defining the role again brought
  them back.

The route now writes the rows itself. This migration does the same for the
custom types an install already has (built-in types get theirs from the seed):

- **a type with no definition row** gets one for each role the picker showed:
  its JSONB list, or Responsible and Observer when the list is empty;
- **a type with some rows** (an admin already added a role, the state the
  reporter was in) gets one only for each role key its cards' stakeholders
  still hold and no row defines, so the hidden assignments come back. A JSONB
  role nobody holds is not revived there: the admin may have removed it.

In both cases a key the cards hold that no list names is defined too.
Responsible and Observer get the permissions the app gives them on a built-in
type; any other key gets none (the same as before, when no row granted
anything), for an admin to tick. Observer does not count toward data quality,
as on a built-in type. A type that gains a counting role gains a data-quality
stakeholders slot, so the one-shot rescore marker in ``app/main.py`` moves to
V4 in the same release and every card is rescored once on the next boot.

Downgrade is a no-op: the rows are ordinary role definitions an admin may have
edited since, and the older code reads them correctly.

Revision ID: 178
Revises: 177
Create Date: 2026-11-26
"""

from __future__ import annotations

import json
import uuid
from collections.abc import Sequence
from typing import Union

from sqlalchemy.sql import text

from alembic import op

revision: str = "178"
down_revision: Union[str, None] = "177"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


# Literals rather than imports from ``app.core.permissions``, so the migration
# keeps describing the database as it was when this revision ran.
RESPONSIBLE_PERMISSIONS: dict[str, bool] = {
    "card.view": True,
    "card.view_costs": True,
    "card.edit": True,
    "card.archive": True,
    "card.delete": False,
    "card.approval_status": True,
    "card.manage_stakeholders": True,
    "card.manage_relations": True,
    "card.manage_documents": True,
    "card.manage_comments": True,
    "card.create_comments": True,
    "card.bpm_edit": True,
    "card.bpm_manage_drafts": True,
    "card.bpm_approve": False,
    "card.bpm_withdraw": False,
    "card.manage_adr_links": True,
    "card.manage_diagram_links": True,
}

OBSERVER_PERMISSIONS: dict[str, bool] = {
    "card.view": True,
    "card.view_costs": False,
    "card.edit": False,
    "card.archive": False,
    "card.delete": False,
    "card.approval_status": False,
    "card.manage_stakeholders": False,
    "card.manage_relations": False,
    "card.manage_documents": False,
    "card.manage_comments": False,
    "card.create_comments": True,
    "card.bpm_edit": False,
    "card.bpm_manage_drafts": False,
    "card.bpm_approve": False,
    "card.bpm_withdraw": False,
    "card.manage_adr_links": False,
    "card.manage_diagram_links": False,
}

PERMISSIONS_BY_ROLE: dict[str, dict[str, bool]] = {
    "responsible": RESPONSIBLE_PERMISSIONS,
    "observer": OBSERVER_PERMISSIONS,
}

DEFAULT_ROLES: tuple[dict, ...] = (
    {"key": "responsible", "label": "Responsible"},
    {"key": "observer", "label": "Observer"},
)

NON_COUNTING_ROLES = frozenset({"observer"})
DEFAULT_COLOR = "#757575"
MAX_KEY_LEN = 50
MAX_LABEL_LEN = 200


def _usable_roles(jsonb_roles) -> list[tuple[str, str]]:
    """``(key, label)`` of each well-formed entry of a legacy JSONB list."""
    out: list[tuple[str, str]] = []
    seen: set[str] = set()
    for role in jsonb_roles if isinstance(jsonb_roles, (list, tuple)) else ():
        if not isinstance(role, dict):
            continue
        key = role.get("key")
        if not isinstance(key, str) or not key or len(key) > MAX_KEY_LEN or key in seen:
            continue
        label = role.get("label")
        seen.add(key)
        out.append((key, label if isinstance(label, str) and label.strip() else key))
    return out


def plan_rows(
    jsonb_roles, existing_keys: set[str], used_keys: Sequence[str], next_sort: int = 0
) -> list[dict]:
    """The definition rows one custom card type needs, in order.

    Pure so it can be unit-tested without a database. ``existing_keys`` are
    the keys the type already defines (archived included), ``used_keys`` the
    role keys its cards' stakeholders hold, ``next_sort`` the first free
    ``sort_order``.
    """
    listed = _usable_roles(jsonb_roles)
    labels = {k: lbl for k, lbl in _usable_roles(DEFAULT_ROLES)}
    labels.update(dict(listed))

    wanted: list[str] = []
    if not existing_keys:
        wanted = [k for k, _ in listed] or [r["key"] for r in DEFAULT_ROLES]
    held = {k for k in used_keys if isinstance(k, str) and k and len(k) <= MAX_KEY_LEN}
    wanted += sorted(held - set(wanted))

    rows: list[dict] = []
    for key in wanted:
        if key in existing_keys:
            continue
        rows.append(
            {
                "key": key,
                "label": labels.get(key, key)[:MAX_LABEL_LEN],
                "permissions": dict(PERMISSIONS_BY_ROLE.get(key, {})),
                "counts_for_quality": key not in NON_COUNTING_ROLES,
                "sort_order": next_sort + len(rows),
            }
        )
    return rows


def upgrade() -> None:
    conn = op.get_bind()
    types = conn.execute(
        text("SELECT key, stakeholder_roles FROM card_types WHERE built_in = false")
    ).fetchall()
    for card_type in types:
        defined = conn.execute(
            text(
                "SELECT key, sort_order FROM stakeholder_role_definitions WHERE card_type_key = :t"
            ),
            {"t": card_type.key},
        ).fetchall()
        used = conn.execute(
            text(
                "SELECT DISTINCT s.role FROM stakeholders s "
                "JOIN cards c ON c.id = s.card_id WHERE c.type = :t"
            ),
            {"t": card_type.key},
        ).scalars()
        next_sort = max((r.sort_order or 0 for r in defined), default=-1) + 1
        for row in plan_rows(
            card_type.stakeholder_roles, {r.key for r in defined}, list(used), next_sort
        ):
            conn.execute(
                text(
                    "INSERT INTO stakeholder_role_definitions "
                    "(id, card_type_key, key, label, color, permissions, is_archived, "
                    "counts_for_quality, sort_order, translations, created_at, updated_at) "
                    "VALUES (:id, :t, :key, :label, :color, CAST(:permissions AS jsonb), "
                    "false, :counts, :sort, CAST('{}' AS jsonb), now(), now())"
                ),
                {
                    "id": uuid.uuid4(),
                    "t": card_type.key,
                    "key": row["key"],
                    "label": row["label"],
                    "color": DEFAULT_COLOR,
                    "permissions": json.dumps(row["permissions"]),
                    "counts": row["counts_for_quality"],
                    "sort": row["sort_order"],
                },
            )


def downgrade() -> None:
    """Nothing to undo: the rows are ordinary role definitions."""
