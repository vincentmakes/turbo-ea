"""Repair the Danish labels of built-in card types, sections, fields and relations.

When Danish was added (#623) a bulk pass injected a ``"da"`` value into every
translation dict of the seed metamodel, and on entries that *contain* other
translated entries it landed the Danish text of one of the children. So a
Danish install shows Application as «Produktnavn» (its Product Name field),
Organization as «Lokation», the Organization Information section as «Kunde»
(a subtype), the Initiative's Business Value field as «Lav» (an option), and
the Application → Data Object relation verb as «Slet» ("delete", one of its
CRUD attributes). Every other locale was translated by hand and is correct;
leaves — options, subtypes, reverse verbs, stakeholder roles, descriptions —
were right in Danish too.

Forty-two values were wrong: twelve card-type labels, fifteen section names,
eight select-field labels and seven relation labels. ``seed.py`` now carries
the right words, but its boot-time merge fills gaps and never overwrites a
stored translation (an admin's own wording must survive a restart), so an
existing install needs this migration.

**Value guard, per entry.** A Danish value is rewritten only when it is
byte-identical to the wrong value we shipped, so an admin who already fixed a
label by hand — or changed it to something else — keeps exactly what they set.
Sections are matched by their ``section`` name and fields by ``key``, the same
identity the seed merge uses. Nothing but ``da`` is touched.

Idempotent: re-running finds nothing left to change. Downgrade is a no-op —
reverting would deliberately reinstate words that name the wrong thing.

Revision ID: 152
Revises: 151
Create Date: 2026-09-24
"""

import copy
import json
from typing import Sequence, Union

from sqlalchemy.sql import text

from alembic import op

revision: str = "152"
down_revision: Union[str, None] = "151"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

LOCALE = "da"

# Every fix is (Danish value we shipped, corrected Danish value).
TYPE_LABEL_FIXES: dict[str, tuple[str, str]] = {
    "Objective": ("Fremskridt (%)", "Mål"),
    "Platform": ("Teknisk", "Platform"),
    "Initiative": ("Observatør", "Initiativ"),
    "Organization": ("Lokation", "Organisation"),
    "BusinessCapability": ("Kompetencemodenhed", "Forretningskompetence"),
    "BusinessContext": ("Optimeret", "Forretningskontekst"),
    "BusinessProcess": ("Observatør", "Forretningsproces"),
    "Application": ("Produktnavn", "Applikation"),
    "Interface": ("Protokol", "Grænseflade"),
    "DataObject": ("Indeholder personoplysninger", "Dataobjekt"),
    "ITComponent": ("Licenstype", "IT-komponent"),
    "Provider": ("Kontraktslutdato", "Udbyder"),
}

# (card type key, section name) -> fix
SECTION_FIXES: dict[tuple[str, str], tuple[str, str]] = {
    ("Objective", "Objective Information"): ("Mål", "Målinformation"),
    ("Platform", "Platform Information"): ("Teknisk", "Platformsinformation"),
    ("Initiative", "Initiative Information"): ("Epic", "Initiativinformation"),
    ("Initiative", "Cost & Timeline"): ("Lav", "Omkostninger & tidsplan"),
    ("Organization", "Organization Information"): ("Kunde", "Organisationsinformation"),
    ("BusinessCapability", "Capability Information"): (
        "Forretningskompetence",
        "Kompetenceinformation",
    ),
    ("BusinessCapability", "BPM Assessment"): ("Kernekompetence", "BPM-vurdering"),
    ("BusinessContext", "Business Context Information"): (
        "ESG-kompetence",
        "Forretningskontekstinformation",
    ),
    ("BusinessProcess", "Process Classification"): ("Procesvariant", "Procesklassifikation"),
    ("BusinessProcess", "Operational Details"): ("Risikoniveau", "Driftsdetaljer"),
    ("Interface", "Interface Information"): ("MCP-server", "Grænsefladeinformation"),
    ("DataObject", "Data Information"): ("Dataobjekt", "Datainformation"),
    ("ITComponent", "Component Information"): ("AI-model", "Komponentinformation"),
    ("ITComponent", "Cost"): ("Har AI-funktioner", "Omkostninger"),
    ("Provider", "Provider Information"): ("Udbyder", "Udbyderinformation"),
}

# (card type key, field key) -> fix
FIELD_FIXES: dict[tuple[str, str], tuple[str, str]] = {
    ("Objective", "objectiveType"): ("Operationel", "Måltype"),
    ("Platform", "platformType"): ("Teknisk", "Platformstype"),
    ("Initiative", "businessValue"): ("Lav", "Forretningsværdi"),
    ("Initiative", "effort"): ("Lav", "Indsats"),
    ("BusinessCapability", "capabilityLevel"): ("Niveau 5", "Kompetenceniveau"),
    ("BusinessCapability", "strategicImportance"): ("Kritisk", "Strategisk betydning"),
    ("BusinessContext", "maturity"): ("Optimeret", "Modenhed"),
    ("Provider", "providerType"): ("Intern udbyder", "Udbydertype"),
}

RELATION_LABEL_FIXES: dict[str, tuple[str, str]] = {
    "relOrgToApp": ("Brugstype", "bruger"),
    "relAppToBC": ("Supporttype", "understøtter"),
    "relAppToDataObj": ("Slet", "CRUD"),
    "relAppToITC": ("Årlig omkostning", "bruger"),
    "relITCToTechCat": ("Ressourceklassifikation", "tilhører"),
    "relProcessToBC": ("Supporttype", "understøtter"),
    "relProcessToDataObj": ("Slet", "bruger"),
}


def _fix_flat(translations, fix: tuple[str, str] | None) -> dict | None:
    """Return a copy of a flat ``{locale: text}`` map with ``da`` repaired, or ``None``."""
    if fix is None or not isinstance(translations, dict):
        return None
    old, new = fix
    if translations.get(LOCALE) != old:
        return None
    return {**translations, LOCALE: new}


def _fix_nested_label(translations, fix: tuple[str, str] | None) -> dict | None:
    """Same for a two-level ``{"label": {locale: text}, ...}`` map."""
    if not isinstance(translations, dict):
        return None
    label = _fix_flat(translations.get("label"), fix)
    if label is None:
        return None
    return {**translations, "label": label}


def plan_type_fix(key: str, translations, fields_schema) -> tuple[dict | None, list | None] | None:
    """What to rewrite on one ``card_types`` row, or ``None`` when nothing drifted.

    Returns ``(new_translations | None, new_fields_schema | None)``. Pure, so it is
    unit-tested without a database (``tests/services/test_alembic_152_*``).
    """
    new_translations = _fix_nested_label(translations, TYPE_LABEL_FIXES.get(key))

    new_schema: list | None = None
    if isinstance(fields_schema, list):
        candidate = copy.deepcopy(fields_schema)
        changed = False
        for section in candidate:
            if not isinstance(section, dict):
                continue
            fixed = _fix_flat(
                section.get("translations"),
                SECTION_FIXES.get((key, section.get("section"))),
            )
            if fixed is not None:
                section["translations"] = fixed
                changed = True
            for field in section.get("fields") or []:
                if not isinstance(field, dict):
                    continue
                fixed = _fix_flat(
                    field.get("translations"), FIELD_FIXES.get((key, field.get("key")))
                )
                if fixed is not None:
                    field["translations"] = fixed
                    changed = True
        if changed:
            new_schema = candidate

    if new_translations is None and new_schema is None:
        return None
    return new_translations, new_schema


def plan_relation_fix(key: str, translations) -> dict | None:
    """The repaired ``relation_types.translations``, or ``None`` when nothing drifted."""
    return _fix_nested_label(translations, RELATION_LABEL_FIXES.get(key))


def upgrade() -> None:
    conn = op.get_bind()

    type_rows = conn.execute(
        text("SELECT key, translations, fields_schema FROM card_types WHERE key = ANY(:keys)"),
        {"keys": sorted({k for k in TYPE_LABEL_FIXES} | {k for k, _ in SECTION_FIXES})},
    ).fetchall()
    for row in type_rows:
        plan = plan_type_fix(row.key, row.translations, row.fields_schema)
        if plan is None:
            continue
        new_translations, new_schema = plan
        assignments = []
        params: dict = {"key": row.key}
        if new_translations is not None:
            assignments.append("translations = CAST(:trans AS jsonb)")
            params["trans"] = json.dumps(new_translations, ensure_ascii=False)
        if new_schema is not None:
            assignments.append("fields_schema = CAST(:schema AS jsonb)")
            params["schema"] = json.dumps(new_schema, ensure_ascii=False)
        conn.execute(
            text(f"UPDATE card_types SET {', '.join(assignments)} WHERE key = :key"),
            params,
        )

    rel_rows = conn.execute(
        text("SELECT key, translations FROM relation_types WHERE key = ANY(:keys)"),
        {"keys": sorted(RELATION_LABEL_FIXES)},
    ).fetchall()
    for row in rel_rows:
        new_translations = plan_relation_fix(row.key, row.translations)
        if new_translations is None:
            continue
        conn.execute(
            text("UPDATE relation_types SET translations = CAST(:trans AS jsonb) WHERE key = :key"),
            {"key": row.key, "trans": json.dumps(new_translations, ensure_ascii=False)},
        )


def downgrade() -> None:
    """No-op — restoring the old values would reinstate labels that name the wrong thing."""
