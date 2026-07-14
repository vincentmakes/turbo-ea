"""Add the built-in ``hierarchyLevel`` attribute to every hierarchical card type.

Discussions #810 / #812. Historically only BusinessCapability exposed a
hierarchy level (its macro-aware ``capabilityLevel``). This migration brings a
generic, raw-depth ``hierarchyLevel`` (1 = root) to *every* card type with
``has_hierarchy = true`` — built-in and admin-created custom types alike — so it
can be filtered/sorted in the inventory and referenced in calculations.

Two guarded steps:

1. Inject the readonly ``hierarchyLevel`` field def into each hierarchical
   type's ``fields_schema``, unless a field with that key already exists
   (never hijack an admin-authored key). Fresh installs already get the field
   from the seed, so this no-ops there.
2. Backfill ``attributes.hierarchyLevel`` for every card of the injected types
   via a recursive CTE (root = ``parent_id IS NULL``, +1 per level). All
   statuses, so archived subtrees stay consistent.

Revision ID: 123
Revises: 122
"""

import json
from typing import Union

import sqlalchemy as sa

from alembic import op

revision: str = "123"
down_revision: Union[str, None] = "122"
branch_labels: Union[str, None] = None
depends_on: Union[str, None] = None

HIERARCHY_LEVEL_KEY = "hierarchyLevel"

# Frozen copy of app.services.hierarchy.hierarchy_level_field_def() — migrations
# never import app code, so any later change to the app-side def does not rewrite
# history here.
_FIELD_DEF = {
    "key": HIERARCHY_LEVEL_KEY,
    "label": "Hierarchy Level",
    "type": "number",
    "readonly": True,
    "weight": 0,
    "translations": {
        "en": "Hierarchy Level",
        "de": "Hierarchieebene",
        "fr": "Niveau hiérarchique",
        "es": "Nivel jerárquico",
        "it": "Livello gerarchico",
        "pt": "Nível hierárquico",
        "zh": "层级级别",
        "ru": "Уровень иерархии",
        "da": "Hierarkiniveau",
        "ar": "مستوى التسلسل الهرمي",
    },
}

_GENERAL_SECTION_TRANSLATIONS = {
    "en": "General",
    "de": "Allgemein",
    "fr": "Général",
    "es": "General",
    "it": "Generale",
    "pt": "Geral",
    "zh": "常规",
    "ru": "Общие",
    "da": "Generelt",
    "ar": "عام",
}


def _has_field(schema: list) -> bool:
    return any(
        isinstance(s, dict) and f.get("key") == HIERARCHY_LEVEL_KEY
        for s in (schema or [])
        for f in s.get("fields", [])
    )


def upgrade() -> None:
    bind = op.get_bind()
    rows = bind.execute(
        sa.text("SELECT key, fields_schema FROM card_types WHERE has_hierarchy = true")
    ).fetchall()

    injected: list[str] = []
    for key, schema in rows:
        schema = schema or []
        if _has_field(schema):
            continue  # admin already owns the key — no inject, no backfill
        if schema:
            schema[0].setdefault("fields", []).append(_FIELD_DEF)
        else:
            schema = [
                {
                    "section": "General",
                    "translations": _GENERAL_SECTION_TRANSLATIONS,
                    "fields": [_FIELD_DEF],
                }
            ]
        bind.execute(
            sa.text("UPDATE card_types SET fields_schema = CAST(:js AS jsonb) WHERE key = :k"),
            {"js": json.dumps(schema), "k": key},
        )
        injected.append(key)

    if injected:
        bind.execute(
            sa.text(
                """
                WITH RECURSIVE tree AS (
                    SELECT id, 1 AS lvl FROM cards
                     WHERE parent_id IS NULL AND type = ANY(:types)
                    UNION ALL
                    SELECT c.id, t.lvl + 1
                      FROM cards c JOIN tree t ON c.parent_id = t.id
                )
                UPDATE cards
                   SET attributes = jsonb_set(
                       COALESCE(attributes, '{}'::jsonb),
                       '{hierarchyLevel}',
                       to_jsonb(tree.lvl)
                   )
                  FROM tree
                 WHERE cards.id = tree.id
                """
            ),
            {"types": injected},
        )


def downgrade() -> None:
    bind = op.get_bind()
    rows = bind.execute(
        sa.text("SELECT key, fields_schema FROM card_types WHERE has_hierarchy = true")
    ).fetchall()

    stripped: list[str] = []
    for key, schema in rows:
        schema = schema or []
        changed = False
        for section in schema:
            if not isinstance(section, dict):
                continue
            new_fields = [
                f
                for f in section.get("fields", [])
                if not (
                    f.get("key") == HIERARCHY_LEVEL_KEY
                    and f.get("readonly")
                    and f.get("type") == "number"
                )
            ]
            if len(new_fields) != len(section.get("fields", [])):
                section["fields"] = new_fields
                changed = True
        if changed:
            bind.execute(
                sa.text("UPDATE card_types SET fields_schema = CAST(:js AS jsonb) WHERE key = :k"),
                {"js": json.dumps(schema), "k": key},
            )
            stripped.append(key)

    if stripped:
        # The ``-`` operator is a no-op when the key is absent, so no
        # existence guard is needed — and we avoid the JSONB ``?`` operator,
        # which clashes with SQLAlchemy's named-parameter scanner in text().
        bind.execute(
            sa.text(
                "UPDATE cards SET attributes = attributes - 'hierarchyLevel' "
                "WHERE type = ANY(:types)"
            ),
            {"types": stripped},
        )
