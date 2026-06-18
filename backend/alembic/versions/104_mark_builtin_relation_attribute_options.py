"""Stamp ``built_in=True`` on built-in relation attribute fields and options.

The built-in relation "type" pickers (``usageType`` on ``relOrgToApp``,
``flowDirection`` on ``relAppToInterface``, ``functionalSuitability`` /
``supportType`` on ``relAppToItc``, …) ship from ``seed.py``. The metamodel
admin now lets admins manage these picker values: built-in values are
locked-but-hideable, while admins may add their own custom values. The lock is
keyed off a per-field / per-option ``built_in`` flag.

Fresh installs get the flag stamped at seed time (``_mark_builtin_attributes_schema``
in ``seed.py``). This migration repairs existing installs: it walks every
built-in relation type and stamps ``built_in: true`` on each ``attributes_schema``
field + option that doesn't already carry the flag. Guarded + idempotent — only
entries missing the flag are touched, and only ``built_in`` relation types
(custom relation types and their options stay fully editable).

Revision ID: 104
Revises: 103
Create Date: 2026-06-18
"""

import json
from typing import Union

import sqlalchemy as sa

from alembic import op

revision: str = "104"
down_revision: Union[str, None] = "103"
branch_labels: Union[str, None] = None
depends_on: Union[str, None] = None


def plan_stamp(schema: object) -> list | None:
    """Return the schema with ``built_in=True`` stamped on every field + option,
    or ``None`` when nothing needs changing (so we skip the UPDATE).
    """
    if not isinstance(schema, list) or not schema:
        return None
    changed = False
    out = []
    for field in schema:
        if not isinstance(field, dict):
            out.append(field)
            continue
        f = dict(field)
        if f.get("built_in") is not True:
            f["built_in"] = True
            changed = True
        opts = f.get("options")
        if isinstance(opts, list):
            new_opts = []
            for opt in opts:
                if isinstance(opt, dict) and opt.get("built_in") is not True:
                    o = dict(opt)
                    o["built_in"] = True
                    new_opts.append(o)
                    changed = True
                else:
                    new_opts.append(opt)
            f["options"] = new_opts
        out.append(f)
    return out if changed else None


def upgrade() -> None:
    conn = op.get_bind()
    rows = conn.execute(
        sa.text(
            "SELECT key, attributes_schema FROM relation_types "
            "WHERE built_in = true AND attributes_schema IS NOT NULL"
        )
    ).fetchall()
    for key, schema in rows:
        new_schema = plan_stamp(schema)
        if new_schema is None:
            continue
        conn.execute(
            sa.text(
                "UPDATE relation_types SET attributes_schema = CAST(:s AS jsonb) WHERE key = :k"
            ),
            {"s": json.dumps(new_schema), "k": key},
        )


def downgrade() -> None:
    # Non-destructive: the built_in flag is metadata that only affects edit
    # gating; we never strip it back out.
    pass
