"""Split the Application card's mixed section into facts + Assessment.

Historically the Application card type bundled objective facts (hosting type,
commercial flag, AI features) and subjective ratings (business criticality,
functional/technical suitability, TIME model) into a single "Application
Information" section. Discussion #632 asked to mirror the BusinessCapability
card's facts-vs-assessment split: the four rating fields now live in a dedicated
"Assessment" section, leaving only the factual attributes in "Application
Information" ("Cost & Ownership" is untouched).

``seed.py`` only runs for missing card-type rows on startup, so editing the seed
default has no effect on existing installs. This migration restructures the
``fields_schema`` of the existing Application row, only when all of the
following are true (so admin-customised layouts are left alone):

- the Application row exists
- a single section named "Application Information" exists
- that section contains all four rating field keys
- no "Assessment" section already exists (idempotent)

Revision ID: 101
Revises: 100
Create Date: 2026-06-03
"""

import json
from typing import Union

import sqlalchemy as sa

from alembic import op

revision: str = "101"
down_revision: Union[str, None] = "100"
branch_labels: Union[str, None] = None
depends_on: Union[str, None] = None


ASSESSMENT_FIELD_KEYS = [
    "businessCriticality",
    "functionalSuitability",
    "technicalSuitability",
    "timeModel",
]

ASSESSMENT_SECTION_TRANSLATIONS = {
    "de": "Bewertung",
    "fr": "Évaluation",
    "es": "Evaluación",
    "it": "Valutazione",
    "pt": "Avaliação",
    "zh": "评估",
    "ru": "Оценка",
    "da": "Vurdering",
}

INFO_SECTION = "Application Information"
ASSESSMENT_SECTION = "Assessment"


def upgrade() -> None:
    conn = op.get_bind()
    row = conn.execute(
        sa.text("SELECT fields_schema FROM card_types WHERE key = 'Application'")
    ).fetchone()
    if not row or not row[0]:
        return
    schema = list(row[0])

    # Idempotency / customization guards.
    if any(s.get("section") == ASSESSMENT_SECTION for s in schema):
        return
    info_indices = [i for i, s in enumerate(schema) if s.get("section") == INFO_SECTION]
    if len(info_indices) != 1:
        return
    info_idx = info_indices[0]
    info_section = schema[info_idx]
    info_fields = info_section.get("fields", [])
    info_keys = {f.get("key") for f in info_fields}
    if not all(k in info_keys for k in ASSESSMENT_FIELD_KEYS):
        return

    # Pull the rating fields out (preserving their stored definitions, ordered
    # per ASSESSMENT_FIELD_KEYS) and leave the facts behind.
    by_key = {f.get("key"): f for f in info_fields}
    moved = [by_key[k] for k in ASSESSMENT_FIELD_KEYS]
    info_section["fields"] = [f for f in info_fields if f.get("key") not in ASSESSMENT_FIELD_KEYS]

    assessment_section = {
        "section": ASSESSMENT_SECTION,
        "translations": ASSESSMENT_SECTION_TRANSLATIONS,
        "fields": moved,
    }
    schema.insert(info_idx + 1, assessment_section)

    conn.execute(
        sa.text("UPDATE card_types SET fields_schema = :s WHERE key = 'Application'"),
        {"s": json.dumps(schema)},
    )


def downgrade() -> None:
    conn = op.get_bind()
    row = conn.execute(
        sa.text("SELECT fields_schema FROM card_types WHERE key = 'Application'")
    ).fetchone()
    if not row or not row[0]:
        return
    schema = list(row[0])

    info_indices = [i for i, s in enumerate(schema) if s.get("section") == INFO_SECTION]
    assessment_indices = [i for i, s in enumerate(schema) if s.get("section") == ASSESSMENT_SECTION]
    if len(info_indices) != 1 or len(assessment_indices) != 1:
        return

    info_idx = info_indices[0]
    assessment_idx = assessment_indices[0]
    moved = schema[assessment_idx].get("fields", [])

    # Merge the rating fields back to the front of "Application Information"
    # (their original position), then drop the "Assessment" section.
    schema[info_idx]["fields"] = moved + schema[info_idx].get("fields", [])
    schema.pop(assessment_idx)

    conn.execute(
        sa.text("UPDATE card_types SET fields_schema = :s WHERE key = 'Application'"),
        {"s": json.dumps(schema)},
    )
