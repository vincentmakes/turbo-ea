"""Backfill ai_suggest: "never" on decision fields in card_types.fields_schema.

These fields represent internal organisational assessments (business criticality,
suitability scores, maturity levels, costs, risk levels, etc.) that should never
be populated by AI suggestions.  The flag was added to seed.py but existing
databases need the JSONB patched.

Revision ID: 041
Revises: 040
Create Date: 2026-02-26
"""

import json

import sqlalchemy as sa

from alembic import op

revision = "041"
down_revision = "040"
branch_labels = None
depends_on = None

# type_key → set of field keys that must have ai_suggest = "never"
_NEVER_FIELDS: dict[str, set[str]] = {
    "Objective": {"objectiveType", "progress"},
    "Initiative": {"initiativeStatus", "businessValue", "effort", "costBudget", "costActual"},
    "Organization": {"headCount"},
    "BusinessCapability": {
        "capabilityLevel",
        "isCoreCapability",
        "strategicImportance",
        "maturity",
    },
    "BusinessContext": {"maturity"},
    "BusinessProcess": {
        "processType",
        "maturity",
        "automationLevel",
        "riskLevel",
        "frequency",
        "regulatoryRelevance",
    },
    "Application": {
        "businessCriticality",
        "functionalSuitability",
        "technicalSuitability",
        "timeModel",
        "costTotalAnnual",
        "numberOfUsers",
    },
    "Interface": {"frequency"},
    "DataObject": {"dataSensitivity", "isPersonalData"},
    "ITComponent": {"technicalSuitability", "resourceClassification", "costTotalAnnual"},
}


def upgrade() -> None:
    conn = op.get_bind()
    for type_key, field_keys in _NEVER_FIELDS.items():
        row = conn.execute(
            sa.text("SELECT key, fields_schema FROM card_types WHERE key = :k"),
            {"k": type_key},
        ).fetchone()
        if row is None or row.fields_schema is None:
            continue

        schema = list(row.fields_schema)
        changed = False
        for section in schema:
            for field in section.get("fields", []):
                if field.get("key") in field_keys and field.get("ai_suggest") != "never":
                    field["ai_suggest"] = "never"
                    changed = True

        if changed:
            conn.execute(
                sa.text("UPDATE card_types SET fields_schema = :s::jsonb WHERE key = :k"),
                {"s": json.dumps(schema), "k": type_key},
            )


def downgrade() -> None:
    conn = op.get_bind()
    for type_key, field_keys in _NEVER_FIELDS.items():
        row = conn.execute(
            sa.text("SELECT key, fields_schema FROM card_types WHERE key = :k"),
            {"k": type_key},
        ).fetchone()
        if row is None or row.fields_schema is None:
            continue

        schema = list(row.fields_schema)
        changed = False
        for section in schema:
            for field in section.get("fields", []):
                if field.get("key") in field_keys and field.get("ai_suggest") == "never":
                    del field["ai_suggest"]
                    changed = True

        if changed:
            conn.execute(
                sa.text("UPDATE card_types SET fields_schema = :s::jsonb WHERE key = :k"),
                {"s": json.dumps(schema), "k": type_key},
            )
