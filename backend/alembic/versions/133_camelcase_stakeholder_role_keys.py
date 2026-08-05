"""Rename the four built-in snake_case stakeholder role keys to camelCase.

Stakeholder role keys were the only metamodel key with a server-side shape
constraint, and it required ``snake_case`` while the shared ``KeyInput``
component the admin UI uses strips underscores and produces ``camelCase``. A
key the UI accepted was rejected by the API with a raw regex in the error
message, and the underscore form the API wanted could not be typed at all
(discussion #907).

The API now accepts the same ``camelCase`` grammar as every other metamodel
key. ``seed.py`` only inserts rows that are missing, so editing the shipped
defaults there has no effect on an existing install — hence this migration.

Exactly four keys change; ``responsible`` and ``observer`` are already
camel-safe and are untouched::

    process_owner               -> processOwner
    technical_application_owner -> technicalApplicationOwner
    business_application_owner  -> businessApplicationOwner
    it_project_manager          -> itProjectManager

Four stores carry a role key and are rewritten in one transaction so the
definition and the assignments pointing at it can never disagree:

- ``stakeholder_role_definitions.key`` — the authoritative definition
- ``stakeholders.role`` — per-card assignments (a bare string, no FK)
- ``surveys.target_roles`` — JSONB array of role keys
- ``card_types.stakeholder_roles`` — legacy JSONB mirror ``[{key, label}]``

Guarded, per the "built-in metamodel default changes need a migration too"
convention: only rows still carrying the exact pre-rename value are rewritten,
so an admin who already renamed a role keeps their choice. A rename is skipped
for a card type that somehow already has the camelCase key, which would
otherwise violate ``uq_srd_type_key``.

The JSONB columns are rewritten Python-side with a ``CAST(:s AS jsonb)`` write
rather than a single SQL ``UPDATE ... jsonb_set(...)``: PostgreSQL's ``?`` JSONB
operator collides with SQLAlchemy's ``text()`` named-parameter scanner and
silently rolls the migration back (see 099 for the incident this convention
comes from).

Revision ID: 133
Revises: 132
Create Date: 2026-08-05
"""

import json
from typing import Sequence, Union

from sqlalchemy.sql import text

from alembic import op

revision: str = "133"
down_revision: Union[str, None] = "132"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

RENAMES: dict[str, str] = {
    "process_owner": "processOwner",
    "technical_application_owner": "technicalApplicationOwner",
    "business_application_owner": "businessApplicationOwner",
    "it_project_manager": "itProjectManager",
}


def _rename_definitions(conn, mapping: dict[str, str]) -> set[tuple[str, str]]:
    """Rewrite ``stakeholder_role_definitions.key``.

    Returns the ``(card_type_key, old_key)`` pairs actually renamed, so the
    dependent tables only follow where the definition moved.
    """
    renamed: set[tuple[str, str]] = set()
    for old, new in mapping.items():
        rows = conn.execute(
            text("SELECT card_type_key FROM stakeholder_role_definitions WHERE key = :old"),
            {"old": old},
        ).fetchall()
        for row in rows:
            clash = conn.execute(
                text(
                    "SELECT 1 FROM stakeholder_role_definitions "
                    "WHERE card_type_key = :ct AND key = :new"
                ),
                {"ct": row.card_type_key, "new": new},
            ).first()
            if clash:
                # The camelCase key already exists for this type — renaming
                # would break the (card_type_key, key) uniqueness constraint.
                continue
            conn.execute(
                text(
                    "UPDATE stakeholder_role_definitions SET key = :new "
                    "WHERE card_type_key = :ct AND key = :old"
                ),
                {"ct": row.card_type_key, "old": old, "new": new},
            )
            renamed.add((row.card_type_key, old))
    return renamed


def _rename_assignments(conn, mapping: dict[str, str], renamed: set[tuple[str, str]]) -> None:
    """Rewrite ``stakeholders.role`` for cards of the types that were renamed."""
    for card_type_key, old in renamed:
        conn.execute(
            text(
                "UPDATE stakeholders SET role = :new "
                "WHERE role = :old AND card_id IN "
                "(SELECT id FROM cards WHERE type = :ct)"
            ),
            {"ct": card_type_key, "old": old, "new": mapping[old]},
        )


def plan_survey_roles(roles, mapping: dict[str, str]) -> list | None:
    """Rewrite a ``surveys.target_roles`` array, or ``None`` when unchanged.

    Pure so it can be unit-tested without a database.
    """
    if not isinstance(roles, list):
        return None
    updated = [mapping.get(r, r) if isinstance(r, str) else r for r in roles]
    return None if updated == roles else updated


def plan_type_mirror(entries, mapping: dict[str, str]) -> list | None:
    """Rewrite a ``card_types.stakeholder_roles`` array, or ``None`` when unchanged.

    Entries carry ``{key, label}``; only the key moves, and any extra keys an
    admin or an older version stored are preserved verbatim.
    """
    if not isinstance(entries, list):
        return None
    updated = [
        {**e, "key": mapping[e["key"]]} if isinstance(e, dict) and e.get("key") in mapping else e
        for e in entries
    ]
    return None if updated == entries else updated


def _rename_survey_targets(conn, mapping: dict[str, str]) -> None:
    """Rewrite the JSONB array ``surveys.target_roles``."""
    rows = conn.execute(text("SELECT id, target_roles FROM surveys")).fetchall()
    for row in rows:
        updated = plan_survey_roles(row.target_roles, mapping)
        if updated is None:
            continue
        conn.execute(
            text("UPDATE surveys SET target_roles = CAST(:s AS jsonb) WHERE id = :id"),
            {"s": json.dumps(updated), "id": row.id},
        )


def _rename_type_mirror(conn, mapping: dict[str, str]) -> None:
    """Rewrite the legacy ``card_types.stakeholder_roles`` JSONB mirror."""
    rows = conn.execute(text("SELECT key, stakeholder_roles FROM card_types")).fetchall()
    for row in rows:
        updated = plan_type_mirror(row.stakeholder_roles, mapping)
        if updated is None:
            continue
        conn.execute(
            text("UPDATE card_types SET stakeholder_roles = CAST(:s AS jsonb) WHERE key = :key"),
            {"s": json.dumps(updated), "key": row.key},
        )


def _apply(mapping: dict[str, str]) -> None:
    conn = op.get_bind()
    renamed = _rename_definitions(conn, mapping)
    _rename_assignments(conn, mapping, renamed)
    _rename_survey_targets(conn, mapping)
    _rename_type_mirror(conn, mapping)


def upgrade() -> None:
    _apply(RENAMES)


def downgrade() -> None:
    _apply({new: old for old, new in RENAMES.items()})
