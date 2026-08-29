"""Compatibility tests: seed demo data vs. seed metamodel.

Pure unit tests (no database) that verify every card, relation, and attribute
in the demo datasets references valid metamodel definitions.  If the metamodel
changes (types renamed, fields removed, subtypes adjusted, select options
modified, relation types dropped), these tests will catch the mismatch before
it ever hits the database.
"""

from __future__ import annotations

from datetime import date

import pytest

from app.services.seed import RELATIONS as META_RELATIONS
from app.services.seed import TYPES as META_TYPES
from app.services.seed_demo import (
    APPLICATIONS,
    BUSINESS_CAPABILITIES,
    BUSINESS_CONTEXTS,
    DATA_OBJECTS,
    DEMO_ADR_EXTRA_CARD_LINKS,
    DEMO_ADRS_EXTRA,
    DEMO_SOAWS,
    INITIATIVES,
    INTERFACES,
    IT_COMPONENTS,
    OBJECTIVES,
    ORGANIZATIONS,
    PLATFORMS,
    PROVIDERS,
    SOAW_INITIATIVE_REFS,
    TAG_GROUPS,
    TECH_CATEGORIES,
    _id,
)
from app.services.seed_demo import (
    RELATIONS as DEMO_RELATIONS,
)
from app.services.seed_demo_bpm import (
    _BPM_RELATION_SPECS,
    PROCESSES,
)
from app.services.seed_demo_extras import (
    BOOKMARK_DEFS,
    COMMENT_DEFS,
    DIAGRAM_DEFS,
    DOCUMENT_DEFS,
    REFERENCED_CARD_NAMES,
    SAVED_REPORT_DEFS,
    STAKEHOLDER_ASSIGNMENTS,
    SURVEY_DEFS,
    SURVEY_RESPONSE_CARDS,
    TODO_DEFS,
    VALID_REPORT_TYPES,
    VALID_STAKEHOLDER_ROLES_BY_TYPE,
)
from app.services.seed_demo_ppm import REFERENCED_INITIATIVE_NAMES

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

# Every demo card, in one list — the same set the seeder inserts.
_ALL_DEMO_CARDS: list[dict] = (
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


# ===========================================================================
# Tests — PPM demo data (seed_demo_ppm.py)
# ===========================================================================

# Build lookup of all Initiative card names from the base demo dataset
_initiative_names = {c["name"] for c in INITIATIVES}


class TestPpmReferencesMatchDemoData:
    """PPM seed data must reference Initiative cards that exist in seed_demo.py."""

    def test_all_referenced_initiatives_exist(self):
        missing = set(REFERENCED_INITIATIVE_NAMES) - _initiative_names
        assert not missing, f"PPM seed references initiatives not in seed_demo.py: {missing}"


# ===========================================================================
# Tests — SoAW + extra ADR demo data (seed_demo.py)
# ===========================================================================

# Build card-ref → id lookup from _id helper
_all_card_ids = {c["id"] for c in ALL_DEMO_CARDS}

# Valid SoAW section IDs per template
_VALID_SOAW_SECTION_IDS = {
    "1.1",
    "1.2",
    "2.1",
    "2.2",
    "2.3",
    "3.1",
    "4.1",
    "4.2",
    "4.3",
    "5.1",
    "5.2",
    "5.3",
    "6.1",
    "6.2",
    "6.3",
    "7.0",
    "7.1",
    "7.2",
}


class TestSoawDemoData:
    """SoAW demo data must reference valid initiatives and use correct section IDs."""

    def test_soaw_initiative_refs_exist(self):
        """All SoAW initiative refs must correspond to cards in the demo data."""
        init_ids = {c["id"] for c in INITIATIVES}
        for soaw in DEMO_SOAWS:
            init_id = soaw.get("initiative_id")
            if init_id is not None:
                assert init_id in init_ids, (
                    f"SoAW '{soaw['name']}': initiative_id not found in demo Initiatives"
                )

    def test_soaw_section_ids_valid(self):
        """All SoAW section keys must match the template section IDs."""
        for soaw in DEMO_SOAWS:
            sections = soaw.get("sections", {})
            unknown = set(sections.keys()) - _VALID_SOAW_SECTION_IDS
            assert not unknown, f"SoAW '{soaw['name']}': unknown section IDs {unknown}"

    def test_soaw_has_all_template_sections(self):
        """Each SoAW should have entries for all template sections."""
        for soaw in DEMO_SOAWS:
            sections = soaw.get("sections", {})
            missing = _VALID_SOAW_SECTION_IDS - set(sections.keys())
            assert not missing, f"SoAW '{soaw['name']}': missing template sections {missing}"

    def test_soaw_initiative_refs_constant(self):
        """SOAW_INITIATIVE_REFS must reference Initiatives in the demo data."""
        for ref in SOAW_INITIATIVE_REFS:
            ref_id = _id(ref)
            init_ids = {c["id"] for c in INITIATIVES}
            assert ref_id in init_ids, (
                f"SOAW_INITIATIVE_REFS: '{ref}' not found in demo Initiatives"
            )


class TestExtraAdrsDemoData:
    """Extra ADR demo data must have valid card link refs."""

    def test_extra_adr_card_links_valid(self):
        """All card refs in DEMO_ADR_EXTRA_CARD_LINKS must exist in the demo data."""
        errors = []
        for link in DEMO_ADR_EXTRA_CARD_LINKS:
            card_id = _id(link["card_ref"])
            if card_id not in _all_card_ids:
                errors.append(
                    f"ADR card link: card_ref '{link['card_ref']}' not found in demo cards"
                )
        assert not errors, "\n".join(errors)

    def test_extra_adr_refs_match_links(self):
        """All extra ADR IDs must be referenced in the card links."""
        extra_adr_ids = {a["id"] for a in DEMO_ADRS_EXTRA}
        linked_adr_ids = {_id(lnk["adr_ref"]) for lnk in DEMO_ADR_EXTRA_CARD_LINKS}
        unlinked = extra_adr_ids - linked_adr_ids
        assert not unlinked, f"Extra ADRs without card links: {unlinked}"

    def test_extra_adr_reference_numbers_sequential(self):
        """Extra ADR reference numbers should continue from ADR-004."""
        expected = {"ADR-004", "ADR-005", "ADR-006", "ADR-007"}
        actual = {a["reference_number"] for a in DEMO_ADRS_EXTRA}
        assert actual == expected, f"Expected {expected}, got {actual}"

    def test_signatory_user_ids_distinct_and_persona_stable(self):
        """Signatory user_ids must be unique within a document (they key the
        UI's signer chips and the signed-by filter facet) and each persona
        (display_name) must reuse the same id across all documents so the
        signed-by facet dedups to one entry per persona."""
        from app.services.seed_demo import DEMO_ADRS

        persona_ids: dict[str, str] = {}
        errors = []
        for doc in DEMO_ADRS + DEMO_ADRS_EXTRA + DEMO_SOAWS:
            ref = doc.get("reference_number") or doc.get("title")
            sigs = doc.get("signatories", [])
            ids = [s["user_id"] for s in sigs]
            if len(ids) != len(set(ids)):
                errors.append(f"{ref}: duplicate signatory user_ids {ids}")
            for s in sigs:
                if s["user_id"] == "demo-placeholder":
                    errors.append(f"{ref}: signatory still uses demo-placeholder")
                known = persona_ids.setdefault(s["display_name"], s["user_id"])
                if known != s["user_id"]:
                    errors.append(
                        f"{ref}: persona '{s['display_name']}' has id "
                        f"{s['user_id']!r}, expected {known!r}"
                    )
        assert not errors, "\n".join(errors)


# ===========================================================================
# Tests — extras demo data (seed_demo_extras.py)
# ===========================================================================

# Build card name set from all demo cards
_all_card_names = {c["name"] for c in ALL_DEMO_CARDS}

# Build card name → type lookup
_card_type_by_name: dict[str, str] = {c["name"]: c["type"] for c in ALL_DEMO_CARDS}


class TestExtrasDemoData:
    """Extras seed data must reference valid cards and use valid metamodel values."""

    def test_all_referenced_card_names_exist(self):
        """All card names referenced by extras must exist in the base demo data."""
        missing = set(REFERENCED_CARD_NAMES) - _all_card_names
        assert not missing, f"Extras reference cards not in seed_demo.py: {missing}"

    def test_comment_card_names_exist(self):
        """All comment target cards must exist in demo data."""
        errors = []
        for card_name, content, _, _ in COMMENT_DEFS:
            if card_name not in _all_card_names:
                errors.append(f"Comment targets unknown card '{card_name}'")
            if not content or len(content) < 5:
                errors.append(f"Comment on '{card_name}' has empty/short content")
        assert not errors, "\n".join(errors)

    def test_comment_reply_indices_valid(self):
        """Reply indices must point to earlier comments in the list."""
        errors = []
        for i, (_, _, _, reply_idx) in enumerate(COMMENT_DEFS):
            if reply_idx is not None:
                if reply_idx >= i:
                    errors.append(f"Comment #{i}: reply_idx {reply_idx} must be < {i}")
                if reply_idx < 0:
                    errors.append(f"Comment #{i}: reply_idx {reply_idx} must be >= 0")
        assert not errors, "\n".join(errors)

    def test_stakeholder_roles_valid_for_card_type(self):
        """Each stakeholder assignment must use a role valid for that card type."""
        errors = []
        for card_name, role in STAKEHOLDER_ASSIGNMENTS:
            card_type = _card_type_by_name.get(card_name)
            if card_type is None:
                errors.append(f"Stakeholder: card '{card_name}' not found")
                continue
            valid_roles = VALID_STAKEHOLDER_ROLES_BY_TYPE.get(
                card_type, {"responsible", "observer"}
            )
            if role not in valid_roles:
                errors.append(
                    f"Stakeholder on '{card_name}' ({card_type}): "
                    f"invalid role '{role}', valid: {valid_roles}"
                )
        assert not errors, "\n".join(errors)

    def test_saved_report_types_valid(self):
        """Saved report types must be in the valid set."""
        errors = []
        for report in SAVED_REPORT_DEFS:
            if report["report_type"] not in VALID_REPORT_TYPES:
                errors.append(f"Report '{report['name']}': invalid type '{report['report_type']}'")
        assert not errors, "\n".join(errors)

    def test_survey_target_types_valid(self):
        """Survey target_type_key must be a valid card type."""
        errors = []
        for survey in SURVEY_DEFS:
            if survey["target_type_key"] not in _type_by_key:
                errors.append(
                    f"Survey '{survey['name']}': invalid target type '{survey['target_type_key']}'"
                )
        assert not errors, "\n".join(errors)

    def test_survey_field_keys_match_target_type(self):
        """Each surveyed field key must exist on the target card type's metamodel."""
        errors = []
        for survey in SURVEY_DEFS:
            type_key = survey["target_type_key"]
            valid_fields = _fields_by_type.get(type_key, {})
            for f in survey.get("fields", []) or []:
                fk = f.get("key")
                if fk and fk not in valid_fields:
                    errors.append(
                        f"Survey '{survey['name']}': field '{fk}' does not exist "
                        f"on card type '{type_key}'"
                    )
        assert not errors, "\n".join(errors)

    def test_survey_response_cards_exist(self):
        """Survey response target cards must exist in demo data."""
        errors = []
        for card_name, status, _ in SURVEY_RESPONSE_CARDS:
            if card_name not in _all_card_names:
                errors.append(f"Survey response: card '{card_name}' not found")
            if status not in ("pending", "completed"):
                errors.append(f"Survey response for '{card_name}': invalid status '{status}'")
        assert not errors, "\n".join(errors)

    def test_todo_card_names_exist(self):
        """Todo target cards must exist in demo data."""
        errors = []
        for card_name, desc, status, _ in TODO_DEFS:
            if card_name and card_name not in _all_card_names:
                errors.append(f"Todo: card '{card_name}' not found")
            if status not in ("open", "done"):
                errors.append(f"Todo '{desc}': invalid status '{status}'")
        assert not errors, "\n".join(errors)

    def test_document_card_names_exist(self):
        """Document target cards must exist in demo data."""
        errors = []
        for card_name, _, url in DOCUMENT_DEFS:
            if card_name not in _all_card_names:
                errors.append(f"Document: card '{card_name}' not found")
            if not url.startswith("http"):
                errors.append(f"Document on '{card_name}': invalid URL '{url}'")
        assert not errors, "\n".join(errors)

    def test_diagram_card_refs_exist(self):
        """Diagram card references must exist in demo data."""
        errors = []
        for diag in DIAGRAM_DEFS:
            for card_name, card_type, _, _, _ in diag["card_refs"]:
                if card_name not in _all_card_names:
                    errors.append(f"Diagram '{diag['name']}': card '{card_name}' not found")
                actual_type = _card_type_by_name.get(card_name)
                if actual_type and actual_type != card_type:
                    errors.append(
                        f"Diagram '{diag['name']}': card '{card_name}' "
                        f"type mismatch: '{card_type}' vs '{actual_type}'"
                    )
        assert not errors, "\n".join(errors)

    def test_bookmark_card_types_valid(self):
        """Bookmark card types must be valid metamodel types."""
        errors = []
        for bm in BOOKMARK_DEFS:
            ct = bm.get("card_type")
            if ct and ct not in _type_by_key:
                errors.append(f"Bookmark '{bm['name']}': invalid card_type '{ct}'")
        assert not errors, "\n".join(errors)

    def test_bookmark_filters_match_frontend_shape(self):
        """Bookmark filters must use the keys the frontend Filters interface
        reads in handleApplyView — otherwise the bookmark loads but doesn't
        actually filter (the original demo-saved-views bug)."""
        required_keys = {
            "types",
            "search",
            "subtypes",
            "lifecyclePhases",
            "dataQualityMin",
            "approvalStatuses",
            "showArchived",
            "attributes",
            "relations",
            "tagIds",
        }
        errors = []
        for bm in BOOKMARK_DEFS:
            f = bm.get("filters") or {}
            missing = required_keys - set(f.keys())
            if missing:
                errors.append(f"Bookmark '{bm['name']}': filters missing keys {sorted(missing)}")
            # If a card_type hint is set, filters.types should mention it so
            # the inventory grid actually filters down to that type.
            ct = bm.get("card_type")
            if ct and ct not in (f.get("types") or []):
                errors.append(
                    f"Bookmark '{bm['name']}': card_type '{ct}' not present in "
                    f"filters.types {f.get('types')}"
                )
        assert not errors, "\n".join(errors)

    def test_bookmark_columns_use_proper_prefixes(self):
        """Bookmark column keys must use the conventional prefixes the
        inventory grid recognises: `core_`, `attr_`, `rel_`, `meta_`. Bare
        keys (e.g. `name`, `businessCriticality`) silently match nothing,
        which is what made the demo bookmarks open with the wrong columns."""
        valid_prefixes = ("core_", "attr_", "rel_", "meta_")
        errors = []
        for bm in BOOKMARK_DEFS:
            for col in bm.get("columns") or []:
                if not col.startswith(valid_prefixes):
                    errors.append(
                        f"Bookmark '{bm['name']}': column key '{col}' must "
                        f"start with one of {valid_prefixes}"
                    )
        assert not errors, "\n".join(errors)

    def test_bookmark_attribute_columns_exist_on_target_type(self):
        """`attr_<key>` columns referenced by a bookmark must exist as fields
        on the bookmark's `card_type` (otherwise the column shows up as a
        ghost in the column selector and the grid never resolves a value)."""
        errors = []
        for bm in BOOKMARK_DEFS:
            type_key = bm.get("card_type")
            if not type_key:
                continue
            valid_fields = _fields_by_type.get(type_key, {})
            for col in bm.get("columns") or []:
                if col.startswith("attr_"):
                    fk = col[len("attr_") :]
                    if fk not in valid_fields:
                        errors.append(
                            f"Bookmark '{bm['name']}': attribute '{fk}' does "
                            f"not exist on card type '{type_key}'"
                        )
        assert not errors, "\n".join(errors)

    def test_saved_report_configs_use_valid_keys(self):
        """Each saved report's `config` must only use keys the corresponding
        report component reads in its `consumeConfig` effect. Anything else
        loads as a no-op, which made the demo saved reports look broken
        because they opened with default state instead of the preset."""
        # Mirrors the consumeConfig branches in each report component. If a
        # report adds a new readable key the test will fail closed and the
        # demo seed can be updated to take advantage of it.
        valid_keys_by_report_type = {
            "portfolio": {
                "view",
                "groupByRaw",
                "colorBy",
                "search",
                "attrFilters",
                "relationFilters",
                "tagFilterIds",
                "tagFilters",
                "filterOrgs",
                "sortK",
                "sortD",
                "timelineDate",
            },
            "lifecycle": {
                "cardTypeKey",
                "view",
                "sortK",
                "sortD",
                "useCustomDates",
                "useInitiativeDates",
                "customColorBy",
                "initiativeColorBy",
            },
            "capability-map": {
                "metric",
                "displayLevel",
                "showApps",
                "colorBy",
                "attrFilters",
                "relationFilters",
                "tagFilterIds",
                "tagFilters",
                "filterOrgs",
                "timelineDate",
            },
            "dependencies": {
                "cardTypeKey",
                "center",
                "view",
                "chartMode",
            },
            "cost": {
                "cardTypeKey",
                "costField",
                "costSources",
                "costSource",  # legacy single-string shape
                "groupBy",
                "view",
                "sortK",
                "sortD",
                "drillStack",
            },
        }
        errors = []
        for report in SAVED_REPORT_DEFS:
            rt = report["report_type"]
            cfg = report.get("config") or {}
            valid = valid_keys_by_report_type.get(rt)
            if valid is None:
                # New report type — push a fixture before it can ship.
                errors.append(
                    f"Report '{report['name']}': test missing valid-keys set for report_type '{rt}'"
                )
                continue
            extra = set(cfg.keys()) - valid
            if extra:
                errors.append(
                    f"Report '{report['name']}': config has keys "
                    f"{sorted(extra)} that the {rt} component doesn't read"
                )
        assert not errors, "\n".join(errors)


class TestSalesGrowthStory:
    """The demo's time-travel story stays a story.

    The Dependencies report's time travel only demonstrates anything if the
    landscape around a card actually changes as the slider moves. The sales
    growth objective is the dataset's showcase for that, so pin the property
    the demo depends on — cards leaving *behind* today and arriving *ahead* of
    it — rather than the individual cards, which are free to be rewritten.
    """

    @staticmethod
    def _neighbourhood() -> set[str]:
        """Refs one hop from the objective, plus a second hop through them."""
        target = _id("obj_sales_growth")
        by_id = {c["id"]: c for c in _ALL_DEMO_CARDS}
        first = set()
        for r in DEMO_RELATIONS:
            if r["source_id"] == target:
                first.add(r["target_id"])
            elif r["target_id"] == target:
                first.add(r["source_id"])
        second = set(first)
        for r in DEMO_RELATIONS:
            if r["source_id"] in first:
                second.add(r["target_id"])
            elif r["target_id"] in first:
                second.add(r["source_id"])
        return {i for i in second if i in by_id}

    def test_objective_exists(self):
        names = {o["name"] for o in OBJECTIVES}
        assert "Increase Sales by 25%" in names

    def test_objective_pulls_in_initiatives_and_capabilities(self):
        by_id = {c["id"]: c for c in _ALL_DEMO_CARDS}
        types = {by_id[i]["type"] for i in self._neighbourhood()}
        # Every layer the story claims to span must actually be reachable.
        for expected in ("Initiative", "BusinessCapability", "Application", "Organization"):
            assert expected in types, f"{expected} missing from the sales objective's neighbourhood"

    def test_landscape_changes_in_both_directions(self):
        today = date.today().isoformat()
        by_id = {c["id"]: c for c in _ALL_DEMO_CARDS}
        retired_before_today = []
        live_after_today = []
        for ref_id in self._neighbourhood():
            lc = by_id[ref_id].get("lifecycle") or {}
            eol = lc.get("endOfLife")
            active = lc.get("active")
            if eol and eol < today:
                retired_before_today.append(by_id[ref_id]["name"])
            if active and active > today:
                live_after_today.append(by_id[ref_id]["name"])
        assert retired_before_today, (
            "No card around the sales objective retires in the past — "
            "travelling backwards shows nothing"
        )
        assert live_after_today, (
            "No card around the sales objective goes live in the future — "
            "travelling forwards shows nothing"
        )


class TestMacroCapabilities:
    """The Macro tier sits above L1 and is what the depth relaxation is for.

    `_check_hierarchy_depth` allows six levels instead of five for a
    macro-rooted chain and `_sync_capability_level` pins a Macro rather than
    recomputing it — but both detect a macro by walking to the ROOT of the
    chain and reading `capabilityLevel` there. Every assertion below protects
    one of the assumptions that walk makes.
    """

    @staticmethod
    def _caps() -> list[dict]:
        return [c for c in _ALL_DEMO_CARDS if c["type"] == "BusinessCapability"]

    @staticmethod
    def _level(card: dict) -> str | None:
        return (card.get("attributes") or {}).get("capabilityLevel")

    def test_macros_exist_and_are_roots(self):
        macros = [c for c in self._caps() if self._level(c) == "Macro"]
        assert macros, "no Macro capabilities — the tier cannot be seen in the demo"
        parented = [c["name"] for c in macros if c.get("parent_id")]
        assert not parented, (
            f"a Macro must be the root of its chain, or the macro-aware depth and "
            f"level maths never see it: {parented}"
        )

    def test_every_l1_hangs_off_a_macro(self):
        by_id = {c["id"]: c for c in self._caps()}
        orphans, wrong = [], []
        for cap in self._caps():
            if self._level(cap) != "L1":
                continue
            parent_id = cap.get("parent_id")
            if not parent_id:
                orphans.append(cap["name"])
            elif self._level(by_id.get(parent_id, {})) != "Macro":
                wrong.append(cap["name"])
        assert not orphans, f"L1 capabilities with no macro above them: {orphans}"
        assert not wrong, f"L1 capabilities whose parent is not a Macro: {wrong}"

    def test_no_chain_exceeds_the_macro_depth_limit(self):
        """Six levels, matching `_check_hierarchy_depth`'s macro allowance."""
        by_id = {c["id"]: c for c in self._caps()}

        def depth(card: dict) -> int:
            seen, d = {card["id"]}, 1
            while card.get("parent_id") in by_id:
                card = by_id[card["parent_id"]]
                assert card["id"] not in seen, "capability hierarchy has a cycle"
                seen.add(card["id"])
                d += 1
            return d

        deepest = max((depth(c), c["name"]) for c in self._caps())
        assert deepest[0] <= 6, f"'{deepest[1]}' sits at depth {deepest[0]}, over the limit of 6"

    def test_macros_carry_no_catalogue_id(self):
        """`catalogueId` marks a capability imported FROM the bundled catalogue.

        These are NexaTech's own, and the key is not declared on the
        BusinessCapability schema — so setting it would also fail
        `test_all_attribute_keys_valid`.
        """
        tagged = [
            c["name"]
            for c in self._caps()
            if self._level(c) == "Macro" and (c.get("attributes") or {}).get("catalogueId")
        ]
        assert not tagged, f"hand-authored macros must not claim catalogue provenance: {tagged}"


class TestCapabilityHinge:
    """The capability layer is what makes a Dependencies centre worth opening.

    A capability is the only card type that reaches strategy in one direction
    and applications in the other — the metamodel has no Objective→Application
    relation — so it is the card a user centres on to see a transformation whole.
    That only works if the wiring is there; it once was not (11 of 78
    capabilities reached both an objective and an application), which made most
    of the demo a dead end.
    """

    @staticmethod
    def _neighbour_types() -> dict:
        by_id = {c["id"]: c for c in _ALL_DEMO_CARDS}
        adj: dict = {}
        for r in DEMO_RELATIONS:
            adj.setdefault(r["source_id"], set()).add(r["target_id"])
            adj.setdefault(r["target_id"], set()).add(r["source_id"])
        return {
            c["id"]: {by_id[n]["type"] for n in adj.get(c["id"], ()) if n in by_id}
            for c in _ALL_DEMO_CARDS
        }

    def test_capabilities_bridge_objectives_and_applications(self):
        types_by_id = self._neighbour_types()
        caps = [c for c in _ALL_DEMO_CARDS if c["type"] == "BusinessCapability"]
        hinges = [c for c in caps if {"Objective", "Application"} <= types_by_id[c["id"]]]
        assert len(hinges) >= 30, (
            f"only {len(hinges)} of {len(caps)} capabilities reach both an objective "
            "and an application — centring on one shows a dead end"
        )

    def test_no_capability_arrives_after_the_application_leading_it(self):
        """The canvas shows a capability and the app that implements it side by
        side, so the capability arriving second reads as a data error. Nothing
        catches the emptier version of this — a capability with no application
        at all, which is how "Customer Relationship Management" ended up going
        live in 2029 at a company that has run a CRM since 2017 — so the CRM
        applications now lead it and this pins the ordering.
        """
        by_id = {c["id"]: c for c in _ALL_DEMO_CARDS}
        today = date.today().isoformat()
        late = []
        for r in DEMO_RELATIONS:
            if r["type"] != "relAppToBC":
                continue
            if (r.get("attributes") or {}).get("supportType") != "leading":
                continue
            app, cap = by_id.get(r["source_id"]), by_id.get(r["target_id"])
            if not app or not cap:
                continue
            app_live = (app.get("lifecycle") or {}).get("active")
            cap_live = (cap.get("lifecycle") or {}).get("active")
            # Only against an app that is ALREADY live: a capability may well
            # predate a future application built to lead it.
            if app_live and cap_live and app_live <= today and cap_live > app_live:
                late.append(f"{cap['name']} ({cap_live}) after {app['name']} ({app_live})")
        assert not late, f"capabilities arriving after the app leading them: {late}"

    def test_every_application_supports_a_capability(self):
        cap_ids = {c["id"] for c in _ALL_DEMO_CARDS if c["type"] == "BusinessCapability"}
        supported = {r["source_id"] for r in DEMO_RELATIONS if r["target_id"] in cap_ids}
        orphans = [a["name"] for a in APPLICATIONS if a["id"] not in supported]
        assert not orphans, f"applications supporting no capability: {orphans}"


class TestDemoLifecycles:
    """Lifecycle dates are what the Dependencies timeline actually reads."""

    def test_no_card_dies_before_it_lives(self):
        """A card retired at or before its own start draws a mark on a day
        nothing happened — the invariant `cardsChangingBetween` encodes on the
        client. Several lifecycles here are derived, so pin it on the data too.
        """
        broken = [
            (c["name"], c["lifecycle"])
            for c in _ALL_DEMO_CARDS
            if (c.get("lifecycle") or {}).get("endOfLife")
            and (c.get("lifecycle") or {}).get("active")
            and c["lifecycle"]["endOfLife"] <= c["lifecycle"]["active"]
        ]
        assert not broken, f"cards retiring at or before their start: {broken}"

    def test_nothing_ends_without_having_been_active(self):
        """A card with an end and no start retires on the timeline having never
        gone live: the retirement mark has no arrival mark to answer it, and the
        card's own lifecycle bar starts nowhere. Four initiatives carried only a
        plan date and were stamped with an endOfLife derived from their end
        date, which is exactly this.
        """
        broken = [
            (c["type"], c["name"], c["lifecycle"])
            for c in _ALL_DEMO_CARDS
            for lc in [c.get("lifecycle") or {}]
            if (lc.get("endOfLife") or lc.get("phaseOut")) and not lc.get("active")
        ]
        assert not broken, f"cards that end without ever being active: {broken}"

    def test_lifecycle_phases_run_forwards(self):
        """plan -> phaseIn -> active -> phaseOut -> endOfLife, non-decreasing.

        Catches the class of bug where a lifecycle mixes the two date helpers:
        `_in_months(6)` overtakes `_in_years(1)` every second half of the year,
        so the data was correct in spring and backwards in autumn depending
        only on the day the demo happened to be seeded.
        """
        phases = ["plan", "phaseIn", "active", "phaseOut", "endOfLife"]
        broken = []
        for c in _ALL_DEMO_CARDS:
            lc = {k: v for k, v in (c.get("lifecycle") or {}).items() if v}
            dated = [(p, lc[p]) for p in phases if p in lc]
            for (p1, v1), (p2, v2) in zip(dated, dated[1:]):
                if v2 < v1:
                    broken.append(f"{c['name']}: {p1}={v1} after {p2}={v2}")
        assert not broken, f"lifecycles running backwards: {broken}"

    def test_it_components_do_not_all_retire_on_one_day(self):
        """They used to share a single hard-coded end date, which drew one
        enormous mark on the timeline — and a literal that would go stale."""
        ends = [
            (c.get("lifecycle") or {}).get("endOfLife")
            for c in IT_COMPONENTS
            if (c.get("lifecycle") or {}).get("endOfLife")
        ]
        assert len(set(ends)) >= 5, f"IT component end dates cluster on {set(ends)}"

    def test_it_components_do_not_all_go_live_on_one_day(self):
        """The mirror of the retirement spread. 28 components shared a single
        hard-coded go-live date, which the timeline draws as ONE mark — and a
        mark standing for 28 cards swallows any arrival merged into it, so a
        date set by hand on a nearby card looks as though it were never marked.
        """
        actives = [
            (c.get("lifecycle") or {}).get("active")
            for c in IT_COMPONENTS
            if (c.get("lifecycle") or {}).get("active")
        ]
        assert len(set(actives)) >= 5, f"IT component go-live dates cluster on {set(actives)}"

    def test_enough_of_the_landscape_can_retire(self):
        """Time travel needs something to remove. Two thirds of the demo used
        to carry no lifecycle at all."""
        retiring = [c for c in _ALL_DEMO_CARDS if (c.get("lifecycle") or {}).get("endOfLife")]
        dated = [c for c in _ALL_DEMO_CARDS if any((c.get("lifecycle") or {}).values())]
        assert len(retiring) >= 50, f"only {len(retiring)} cards ever retire"
        assert len(dated) >= 140, f"only {len(dated)} cards carry any lifecycle date"

    def test_every_relation_points_at_a_real_card(self):
        """A mistyped ref mints a fresh UUID silently and only FK-fails at
        insert time, long after the tests have passed."""
        known = {c["id"] for c in _ALL_DEMO_CARDS}
        dangling = [
            r["type"]
            for r in DEMO_RELATIONS
            if r["source_id"] not in known or r["target_id"] not in known
        ]
        assert not dangling, f"relations pointing at no card: {sorted(set(dangling))}"
