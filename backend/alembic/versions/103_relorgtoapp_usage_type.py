"""Backfill the ``usageType`` attribute on the Organization→Application relation.

The built-in ``relOrgToApp`` relation type ("uses") declares a ``usageType``
single-select attribute (Owner / User / Stakeholder) in ``seed.py``. ``seed.py``
only inserts a relation type when its row is missing, so any install created
before the attribute was added to the seed kept an empty ``attributes_schema``
and therefore showed no Usage-Type picker.

This migration repairs those installs. It only touches ``relOrgToApp`` and only
when no ``usageType`` field is already present, so admin-customised attribute
schemas (and installs that already have the field) are left untouched. The
option payload is kept in sync with ``USAGE_TYPE_OPTIONS`` in
``backend/app/services/seed.py``.

Revision ID: 103
Revises: 102
Create Date: 2026-06-18
"""

import json
from typing import Union

import sqlalchemy as sa

from alembic import op

revision: str = "103"
down_revision: Union[str, None] = "102"
branch_labels: Union[str, None] = None
depends_on: Union[str, None] = None


USAGE_TYPE_FIELD = {
    "key": "usageType",
    "label": "Usage Type",
    "type": "single_select",
    "options": [
        {
            "key": "owner",
            "label": "Owner",
            "color": "#1976d2",
            "translations": {
                "de": "Eigentümer",
                "fr": "Propriétaire",
                "es": "Propietario",
                "it": "Proprietario",
                "pt": "Proprietário",
                "zh": "所有者",
                "ru": "Владелец",
                "da": "Ejer",
            },
        },
        {
            "key": "user",
            "label": "User",
            "color": "#66bb6a",
            "translations": {
                "de": "Benutzer",
                "fr": "Utilisateur",
                "es": "Usuario",
                "it": "Utente",
                "pt": "Utilizador",
                "zh": "用户",
                "ru": "Пользователь",
                "da": "Bruger",
            },
        },
        {
            "key": "stakeholder",
            "label": "Stakeholder",
            "color": "#ff9800",
            "translations": {
                "de": "Stakeholder",
                "fr": "Partie prenante",
                "es": "Parte interesada",
                "it": "Stakeholder",
                "pt": "Parte interessada",
                "zh": "利益相关者",
                "ru": "Заинтересованная сторона",
                "da": "Interessent",
            },
        },
    ],
}


def plan_backfill(schema: object) -> list | None:
    """Return the repaired ``attributes_schema`` for ``relOrgToApp``, or ``None``
    when no change is needed.

    Guarded + idempotent: leaves the schema untouched if a ``usageType`` field is
    already present (so admin customisations survive), and only ever *appends* the
    field so any other admin-added attributes are preserved.
    """
    if not isinstance(schema, list):
        schema = []
    if any(isinstance(f, dict) and f.get("key") == "usageType" for f in schema):
        return None
    return [*schema, USAGE_TYPE_FIELD]


def upgrade() -> None:
    conn = op.get_bind()
    row = conn.execute(
        sa.text("SELECT attributes_schema FROM relation_types WHERE key = 'relOrgToApp'")
    ).first()
    if row is None:
        # No relOrgToApp row (e.g. it was deleted/customised away) — nothing to do.
        return

    new_schema = plan_backfill(row[0])
    if new_schema is None:
        return

    conn.execute(
        sa.text(
            "UPDATE relation_types SET attributes_schema = CAST(:s AS jsonb) "
            "WHERE key = 'relOrgToApp'"
        ),
        {"s": json.dumps(new_schema)},
    )


def downgrade() -> None:
    # Non-destructive: we never strip the attribute back out, since doing so
    # could discard per-relation usageType values that depend on the schema.
    pass
