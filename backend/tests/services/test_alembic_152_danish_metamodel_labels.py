"""Unit tests for migration 152 (repair the Danish metamodel labels).

The Danish pass that added ``"da"`` to the seed metamodel put a child's text on
the parent: Application read «Produktnavn», the Organization Information section
«Kunde», the Application → Data Object verb «Slet». Migration 152 rewrites those
42 values on existing installs, guarded per value so an admin's own Danish
wording survives, and touches no other locale.

These exercise the pure ``plan_type_fix`` / ``plan_relation_fix`` helpers — no DB.
"""

from __future__ import annotations

import copy
import importlib.util
from pathlib import Path

from app.services import seed

_MIG_PATH = (
    Path(__file__).resolve().parents[2]
    / "alembic"
    / "versions"
    / "152_fix_danish_metamodel_labels.py"
)
_spec = importlib.util.spec_from_file_location("mig152", _MIG_PATH)
mig = importlib.util.module_from_spec(_spec)
assert _spec and _spec.loader
_spec.loader.exec_module(mig)


def _application_row() -> tuple[dict, list]:
    """An Application row as an install seeded before the fix stores it."""
    translations = {
        "label": {"en": "Application", "de": "Anwendung", "da": "Produktnavn"},
        "description": {"en": "Software applications", "da": "Softwareapplikationer"},
    }
    fields_schema = [
        {
            "section": "Application Information",
            "translations": {"en": "Application Information", "da": "Applikationsinformation"},
            "fields": [
                {
                    "key": "productName",
                    "label": "Product Name",
                    "translations": {"en": "Product Name", "da": "Produktnavn"},
                },
            ],
        },
    ]
    return translations, fields_schema


def _initiative_schema() -> list:
    return [
        {
            "section": "Initiative Information",
            "translations": {"en": "Initiative Information", "de": "X", "da": "Epic"},
            "fields": [
                {
                    "key": "businessValue",
                    "translations": {"en": "Business Value", "da": "Lav"},
                    "options": [{"key": "low", "translations": {"en": "Low", "da": "Lav"}}],
                },
                {"key": "effort", "translations": {"en": "Effort", "da": "Lav"}},
                {"key": "startDate", "translations": {"en": "Start Date", "da": "Startdato"}},
            ],
        },
        {
            "section": "Cost & Timeline",
            "translations": {"en": "Cost & Timeline", "da": "Lav"},
            "fields": [],
        },
    ]


class TestTypeFix:
    def test_repairs_the_type_label(self):
        translations, schema = _application_row()
        new_translations, new_schema = mig.plan_type_fix("Application", translations, schema)
        assert new_translations["label"]["da"] == "Applikation"
        assert new_schema is None

    def test_other_locales_and_properties_untouched(self):
        translations, schema = _application_row()
        new_translations, _ = mig.plan_type_fix("Application", translations, schema)
        assert new_translations["label"]["en"] == "Application"
        assert new_translations["label"]["de"] == "Anwendung"
        assert new_translations["description"] == translations["description"]

    def test_field_that_legitimately_carries_the_value_is_left_alone(self):
        """«Produktnavn» is right for the Product Name field — only the type was wrong."""
        translations, schema = _application_row()
        mig.plan_type_fix("Application", translations, schema)
        assert schema[0]["fields"][0]["translations"]["da"] == "Produktnavn"

    def test_repairs_sections_and_fields_but_not_options(self):
        schema = _initiative_schema()
        new_translations, new_schema = mig.plan_type_fix("Initiative", None, schema)
        assert new_translations is None
        info, cost = new_schema
        assert info["translations"]["da"] == "Initiativinformation"
        assert info["translations"]["de"] == "X"
        assert info["fields"][0]["translations"]["da"] == "Forretningsværdi"
        assert info["fields"][0]["options"][0]["translations"]["da"] == "Lav"
        assert info["fields"][1]["translations"]["da"] == "Indsats"
        assert info["fields"][2]["translations"]["da"] == "Startdato"
        assert cost["translations"]["da"] == "Omkostninger & tidsplan"

    def test_does_not_mutate_its_input(self):
        schema = _initiative_schema()
        before = copy.deepcopy(schema)
        mig.plan_type_fix("Initiative", None, schema)
        assert schema == before

    def test_idempotent(self):
        translations, schema = _application_row()
        new_translations, _ = mig.plan_type_fix("Application", translations, schema)
        assert mig.plan_type_fix("Application", new_translations, schema) is None
        _, new_schema = mig.plan_type_fix("Initiative", None, _initiative_schema())
        assert mig.plan_type_fix("Initiative", None, new_schema) is None


class TestGuards:
    def test_admin_wording_survives(self):
        translations, schema = _application_row()
        translations["label"]["da"] = "Software"
        assert mig.plan_type_fix("Application", translations, schema) is None

    def test_one_custom_value_does_not_block_the_others(self):
        schema = _initiative_schema()
        schema[0]["fields"][1]["translations"]["da"] = "Arbejdsbyrde"
        _, new_schema = mig.plan_type_fix("Initiative", None, schema)
        assert new_schema[0]["fields"][1]["translations"]["da"] == "Arbejdsbyrde"
        assert new_schema[0]["fields"][0]["translations"]["da"] == "Forretningsværdi"

    def test_fix_is_scoped_to_its_own_type(self):
        """A custom type whose label happens to be «Lokation» is not an Organization."""
        translations = {"label": {"en": "Site", "da": "Lokation"}}
        assert mig.plan_type_fix("Site", translations, []) is None

    def test_section_fix_is_scoped_to_its_own_type(self):
        schema = [{"section": "Cost", "translations": {"da": "Har AI-funktioner"}, "fields": []}]
        assert mig.plan_type_fix("Application", None, schema) is None
        _, new_schema = mig.plan_type_fix("ITComponent", None, schema)
        assert new_schema[0]["translations"]["da"] == "Omkostninger"


class TestRelationFix:
    def test_repairs_the_label(self):
        translations = {
            "label": {"en": "CRUD", "de": "CRUD", "da": "Slet"},
            "reverse_label": {"en": "is used by", "da": "bruges af"},
        }
        fixed = mig.plan_relation_fix("relAppToDataObj", translations)
        assert fixed["label"] == {"en": "CRUD", "de": "CRUD", "da": "CRUD"}
        assert fixed["reverse_label"] == translations["reverse_label"]
        assert mig.plan_relation_fix("relAppToDataObj", fixed) is None

    def test_admin_wording_and_other_relations_untouched(self):
        assert mig.plan_relation_fix("relAppToDataObj", {"label": {"da": "læser/skriver"}}) is None
        assert mig.plan_relation_fix("relObjectiveToBC", {"label": {"da": "Slet"}}) is None


class TestMalformedPayloads:
    def test_none_and_non_maps(self):
        assert mig.plan_type_fix("Application", None, None) is None
        assert mig.plan_type_fix("Application", "not-a-map", "not-a-list") is None
        assert mig.plan_type_fix("Application", {"label": "not-a-map"}, [None, "x"]) is None
        assert mig.plan_relation_fix("relAppToDataObj", None) is None
        assert mig.plan_relation_fix("relAppToDataObj", {"label": None}) is None

    def test_section_without_fields(self):
        schema = [{"section": "Initiative Information", "translations": {"da": "Epic"}}]
        _, new_schema = mig.plan_type_fix("Initiative", None, schema)
        assert new_schema[0]["translations"]["da"] == "Initiativinformation"


class TestSeedAgreement:
    """The migration's corrected words are exactly what ``seed.py`` now ships."""

    def _type(self, key):
        return next(t for t in seed.TYPES if t["key"] == key)

    def test_type_labels(self):
        for key, (_, new) in mig.TYPE_LABEL_FIXES.items():
            assert self._type(key)["translations"]["label"]["da"] == new, key

    def test_sections_and_fields(self):
        for (key, section), (_, new) in mig.SECTION_FIXES.items():
            sec = next(s for s in self._type(key)["fields_schema"] if s["section"] == section)
            assert sec["translations"]["da"] == new, (key, section)
        for (key, field_key), (_, new) in mig.FIELD_FIXES.items():
            field = next(
                f
                for s in self._type(key)["fields_schema"]
                for f in s["fields"]
                if f["key"] == field_key
            )
            assert field["translations"]["da"] == new, (key, field_key)

    def test_relation_labels(self):
        for key, (_, new) in mig.RELATION_LABEL_FIXES.items():
            rel = next(r for r in seed.RELATIONS if r["key"] == key)
            assert rel["translations"]["label"]["da"] == new, key

    def test_no_seed_value_is_still_the_shipped_mistake(self):
        for key, (old, _) in mig.TYPE_LABEL_FIXES.items():
            assert self._type(key)["translations"]["label"]["da"] != old, key
