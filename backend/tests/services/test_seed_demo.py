"""Compatibility tests: seed demo data vs. seed metamodel.

Pure unit tests (no database) that verify every card, relation, and attribute
in the demo datasets references valid metamodel definitions.  If the metamodel
changes (types renamed, fields removed, subtypes adjusted, select options
modified, relation types dropped), these tests will catch the mismatch before
it ever hits the database.
"""

from __future__ import annotations

import pytest

from app.services.seed import RELATIONS as META_RELATIONS
from app.services.seed import TYPES as META_TYPES
from app.services.seed_demo import (
    APPLICATIONS,
    BUSINESS_CAPABILITIES,
    BUSINESS_CONTEXTS,
    DATA_OBJECTS,
    INITIATIVES,
    INTERFACES,
    IT_COMPONENTS,
    OBJECTIVES,
    ORGANIZATIONS,
    PLATFORMS,
    PROVIDERS,
    TAG_GROUPS,
    TECH_CATEGORIES,
)
from app.services.seed_demo import (
    RELATIONS as DEMO_RELATIONS,
)
from app.services.seed_demo_bpm import (
    _BPM_RELATION_SPECS,
    PROCESSES,
)

# ---------------------------------------------------------------------------
# Build lookup structures from the metamodel (runs once at import time)
# ---------------------------------------------------------------------------
_type_by_key: dict[str, dict] = {t["key"]: t for t in META_TYPES}

_subtypes_by_type: dict[str, set[str]] = {
    t["key"]: {s["key"] for s in t.get("subtypes", [])} for t in META_TYPES
}

_fields_by_type: dict[str, dict[str, dict]] = {}
for _t in META_TYPES:
    fields: dict[str, dict] = {}
    for section in _t.get("fields_schema", []):
        for f in section.get("fields", []):
            fields[f["key"]] = f
    _fields_by_type[_t["key"]] = fields

_select_options_by_field: dict[str, set[str]] = {}
for _t in META_TYPES:
    for section in _t.get("fields_schema", []):
        for f in section.get("fields", []):
            if f["type"] in ("single_select", "multiple_select") and f.get("options"):
                compound = f"{_t['key']}.{f['key']}"
                _select_options_by_field[compound] = {o["key"] for o in f["options"]}

_rel_type_by_key: dict[str, dict] = {r["key"]: r for r in META_RELATIONS}

_rel_attr_options: dict[str, dict[str, set[str]]] = {}
for _r in META_RELATIONS:
    for af in _r.get("attributes_schema", []):
        if af["type"] in ("single_select", "multiple_select") and af.get("options"):
            compound = f"{_r['key']}.{af['key']}"
            _rel_attr_options[compound] = {o["key"] for o in af["options"]}

# All demo cards combined
ALL_DEMO_CARDS = (
    ORGANIZATIONS
    + BUSINESS_CAPABILITIES
    + BUSINESS_CONTEXTS
    + APPLICATIONS
    + IT_COMPONENTS
    + INTERFACES
    + DATA_OBJECTS
    + TECH_CATEGORIES
    + PROVIDERS
    + OBJECTIVES
    + INITIATIVES
    + PLATFORMS
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
def _card_label(card: dict) -> str:
    return f"{card['type']}:{card['name']}"


def _collect_errors(cards: list[dict]) -> list[str]:
    """Validate a list of card dicts against the metamodel. Returns error strings."""
    errors: list[str] = []
    for card in cards:
        label = _card_label(card)
        type_key = card["type"]

        # 1. Card type must exist
        if type_key not in _type_by_key:
            errors.append(f"{label}: unknown card type '{type_key}'")
            continue

        # 2. Subtype must be valid (if set)
        subtype = card.get("subtype")
        if subtype and subtype not in _subtypes_by_type[type_key]:
            valid = _subtypes_by_type[type_key] or {"(none)"}
            errors.append(f"{label}: invalid subtype '{subtype}', valid: {valid}")

        # 3. Every attribute key must exist in the type's fields_schema
        allowed_fields = _fields_by_type[type_key]
        for attr_key, attr_val in card.get("attributes", {}).items():
            if attr_key not in allowed_fields:
                errors.append(f"{label}: unknown attribute '{attr_key}'")
                continue

            # 4. Select values must match defined options
            field_def = allowed_fields[attr_key]
            compound = f"{type_key}.{attr_key}"
            if compound in _select_options_by_field:
                valid_opts = _select_options_by_field[compound]
                if field_def["type"] == "single_select" and attr_val is not None:
                    if attr_val not in valid_opts:
                        errors.append(
                            f"{label}: attribute '{attr_key}' has invalid "
                            f"option '{attr_val}', valid: {valid_opts}"
                        )
                elif field_def["type"] == "multiple_select" and attr_val:
                    for v in attr_val:
                        if v not in valid_opts:
                            errors.append(
                                f"{label}: attribute '{attr_key}' has invalid "
                                f"option '{v}', valid: {valid_opts}"
                            )
    return errors


def _collect_relation_errors(relations: list[dict]) -> list[str]:
    """Validate relation dicts against the metamodel. Returns error strings."""
    errors: list[str] = []
    # Build card-id → type lookup
    card_type_by_id = {c["id"]: c["type"] for c in ALL_DEMO_CARDS + PROCESSES}

    for rel in relations:
        rel_type_key = rel["type"]

        # 1. Relation type must exist
        if rel_type_key not in _rel_type_by_key:
            errors.append(f"relation: unknown type '{rel_type_key}'")
            continue

        meta = _rel_type_by_key[rel_type_key]

        # 2. Source / target card types must match the relation type definition
        src_type = card_type_by_id.get(rel["source_id"])
        tgt_type = card_type_by_id.get(rel["target_id"])
        if src_type and src_type != meta["source_type_key"]:
            errors.append(
                f"relation '{rel_type_key}': source card type '{src_type}' "
                f"!= expected '{meta['source_type_key']}'"
            )
        if tgt_type and tgt_type != meta["target_type_key"]:
            errors.append(
                f"relation '{rel_type_key}': target card type '{tgt_type}' "
                f"!= expected '{meta['target_type_key']}'"
            )

        # 3. Relation attribute keys must exist in the relation's attributes_schema
        rel_attr_keys = {a["key"] for a in meta.get("attributes_schema", [])}
        for attr_key, attr_val in rel.get("attributes", {}).items():
            if attr_key not in rel_attr_keys:
                errors.append(f"relation '{rel_type_key}': unknown attribute '{attr_key}'")
                continue

            # 4. Select values on relation attributes must be valid
            compound = f"{rel_type_key}.{attr_key}"
            if compound in _rel_attr_options:
                valid_opts = _rel_attr_options[compound]
                if isinstance(attr_val, str) and attr_val not in valid_opts:
                    errors.append(
                        f"relation '{rel_type_key}': attribute '{attr_key}' "
                        f"has invalid option '{attr_val}', valid: {valid_opts}"
                    )
    return errors


# ===========================================================================
# Tests — base demo data (seed_demo.py)
# ===========================================================================


class TestDemoCardsMatchMetamodel:
    """Every demo card must reference valid types, subtypes, fields, and options."""

    def test_all_card_types_exist(self):
        used_types = {c["type"] for c in ALL_DEMO_CARDS}
        unknown = used_types - set(_type_by_key)
        assert not unknown, f"Demo cards reference unknown types: {unknown}"

    def test_all_subtypes_valid(self):
        errors = []
        for card in ALL_DEMO_CARDS:
            subtype = card.get("subtype")
            if subtype and subtype not in _subtypes_by_type[card["type"]]:
                errors.append(f"{_card_label(card)}: invalid subtype '{subtype}'")
        assert not errors, "\n".join(errors)

    def test_all_attribute_keys_valid(self):
        errors = [e for e in _collect_errors(ALL_DEMO_CARDS) if "unknown attribute" in e]
        assert not errors, "\n".join(errors)

    def test_all_select_values_valid(self):
        errors = [e for e in _collect_errors(ALL_DEMO_CARDS) if "invalid option" in e]
        assert not errors, "\n".join(errors)


class TestDemoRelationsMatchMetamodel:
    """Every demo relation must reference valid relation types and attributes."""

    def test_all_relation_types_exist(self):
        used = {r["type"] for r in DEMO_RELATIONS}
        unknown = used - set(_rel_type_by_key)
        assert not unknown, f"Demo relations reference unknown types: {unknown}"

    def test_source_target_types_match(self):
        errors = [
            e
            for e in _collect_relation_errors(DEMO_RELATIONS)
            if "source card type" in e or "target card type" in e
        ]
        assert not errors, "\n".join(errors)

    def test_relation_attribute_keys_valid(self):
        errors = [e for e in _collect_relation_errors(DEMO_RELATIONS) if "unknown attribute" in e]
        assert not errors, "\n".join(errors)

    def test_relation_attribute_values_valid(self):
        errors = [e for e in _collect_relation_errors(DEMO_RELATIONS) if "invalid option" in e]
        assert not errors, "\n".join(errors)


class TestDemoTagGroupsMatchMetamodel:
    """Tag groups that restrict to types must reference valid type keys."""

    def test_restrict_to_types_valid(self):
        errors = []
        for tg in TAG_GROUPS:
            for type_key in tg.get("restrict_to_types") or []:
                if type_key not in _type_by_key:
                    errors.append(f"tag group '{tg['name']}': unknown type '{type_key}'")
        assert not errors, "\n".join(errors)


# ===========================================================================
# Tests — BPM demo data (seed_demo_bpm.py)
# ===========================================================================


class TestBpmProcessesMatchMetamodel:
    """Every BPM demo process must be a valid BusinessProcess card."""

    def test_card_type_is_business_process(self):
        bad = [p["name"] for p in PROCESSES if p["type"] != "BusinessProcess"]
        assert not bad, f"Non-BusinessProcess cards in PROCESSES: {bad}"

    def test_business_process_type_exists(self):
        assert "BusinessProcess" in _type_by_key

    def test_all_subtypes_valid(self):
        errors = []
        for p in PROCESSES:
            subtype = p.get("subtype")
            if subtype and subtype not in _subtypes_by_type["BusinessProcess"]:
                errors.append(f"{p['name']}: invalid subtype '{subtype}'")
        assert not errors, "\n".join(errors)

    def test_all_attribute_keys_valid(self):
        errors = [e for e in _collect_errors(PROCESSES) if "unknown attribute" in e]
        assert not errors, "\n".join(errors)

    def test_all_select_values_valid(self):
        errors = [e for e in _collect_errors(PROCESSES) if "invalid option" in e]
        assert not errors, "\n".join(errors)


class TestBpmRelationSpecsMatchMetamodel:
    """BPM relation specs must reference valid relation types and attribute values."""

    @pytest.fixture()
    def bpm_rel_types(self) -> set[str]:
        return {spec[0] for spec in _BPM_RELATION_SPECS}

    def test_all_relation_types_exist(self, bpm_rel_types):
        unknown = bpm_rel_types - set(_rel_type_by_key)
        assert not unknown, f"BPM relations reference unknown types: {unknown}"

    def test_source_type_is_business_process(self, bpm_rel_types):
        """All BPM relation specs should have BusinessProcess as source type."""
        errors = []
        for rel_key in bpm_rel_types:
            meta = _rel_type_by_key.get(rel_key)
            if meta and meta["source_type_key"] != "BusinessProcess":
                errors.append(
                    f"{rel_key}: source_type_key is '{meta['source_type_key']}', "
                    f"expected 'BusinessProcess'"
                )
        assert not errors, "\n".join(errors)

    def test_relation_attribute_values_valid(self):
        errors = []
        for spec in _BPM_RELATION_SPECS:
            rel_key = spec[0]
            attrs = spec[3] if len(spec) > 3 else {}
            if not isinstance(attrs, dict):
                continue
            meta = _rel_type_by_key.get(rel_key)
            if not meta:
                continue
            rel_attr_keys = {a["key"] for a in meta.get("attributes_schema", [])}
            for attr_key, attr_val in attrs.items():
                if attr_key not in rel_attr_keys:
                    errors.append(f"BPM relation '{rel_key}': unknown attribute '{attr_key}'")
                    continue
                compound = f"{rel_key}.{attr_key}"
                if compound in _rel_attr_options:
                    valid_opts = _rel_attr_options[compound]
                    if isinstance(attr_val, str) and attr_val not in valid_opts:
                        errors.append(
                            f"BPM relation '{rel_key}': attribute '{attr_key}' "
                            f"has invalid option '{attr_val}', valid: {valid_opts}"
                        )
        assert not errors, "\n".join(errors)
