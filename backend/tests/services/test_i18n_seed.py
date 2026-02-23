"""Unit tests for internationalization of seed metamodel data.

These tests validate that all card types, subtypes, fields, options,
sections, and relations in the seed data have complete translations
for all supported non-English locales. No database is required.
"""

from __future__ import annotations

import pytest

from app.services.seed import RELATIONS, TYPES

SUPPORTED_LOCALES = ["de", "fr", "es", "it", "pt", "zh"]


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _type_ids():
    """Return pytest param IDs for each card type."""
    return [pytest.param(t, id=t["key"]) for t in TYPES]


def _relation_ids():
    """Return pytest param IDs for each relation type."""
    return [pytest.param(r, id=r["key"]) for r in RELATIONS]


# ---------------------------------------------------------------------------
# Type-level translations
# ---------------------------------------------------------------------------


class TestTypeTranslations:
    @pytest.mark.parametrize("card_type", _type_ids())
    def test_all_types_have_translations(self, card_type):
        """Every type in TYPES has a non-empty translations dict."""
        assert "translations" in card_type, (
            f"Type '{card_type['key']}' is missing a 'translations' dict"
        )
        assert isinstance(card_type["translations"], dict), (
            f"Type '{card_type['key']}' translations is not a dict"
        )
        assert len(card_type["translations"]) > 0, (
            f"Type '{card_type['key']}' has an empty translations dict"
        )

    @pytest.mark.parametrize("card_type", _type_ids())
    def test_type_label_translated_to_all_locales(self, card_type):
        """translations['label'] has entries for all 6 non-English locales."""
        translations = card_type.get("translations", {})
        assert "label" in translations, (
            f"Type '{card_type['key']}' translations missing 'label' key"
        )
        label_translations = translations["label"]
        for locale in SUPPORTED_LOCALES:
            assert locale in label_translations, (
                f"Type '{card_type['key']}' missing label translation for locale '{locale}'"
            )
            value = label_translations[locale]
            assert isinstance(value, str) and len(value) > 0, (
                f"Type '{card_type['key']}' label translation for "
                f"locale '{locale}' is empty or not a string"
            )

    @pytest.mark.parametrize("card_type", _type_ids())
    def test_type_description_translated_to_all_locales(self, card_type):
        """For types with a description, translations['description'] covers all locales."""
        if not card_type.get("description"):
            pytest.skip(f"Type '{card_type['key']}' has no description")

        translations = card_type.get("translations", {})
        assert "description" in translations, (
            f"Type '{card_type['key']}' has a description but translations "
            f"missing 'description' key"
        )
        desc_translations = translations["description"]
        for locale in SUPPORTED_LOCALES:
            assert locale in desc_translations, (
                f"Type '{card_type['key']}' missing description translation for locale '{locale}'"
            )
            value = desc_translations[locale]
            assert isinstance(value, str) and len(value) > 0, (
                f"Type '{card_type['key']}' description translation for "
                f"locale '{locale}' is empty or not a string"
            )


# ---------------------------------------------------------------------------
# Subtype translations
# ---------------------------------------------------------------------------


class TestSubtypeTranslations:
    @pytest.mark.parametrize("card_type", _type_ids())
    def test_all_subtypes_have_translations(self, card_type):
        """Every subtype has a translations dict with all 6 locales."""
        subtypes = card_type.get("subtypes", [])
        if not subtypes:
            pytest.skip(f"Type '{card_type['key']}' has no subtypes")

        for subtype in subtypes:
            assert "translations" in subtype, (
                f"Type '{card_type['key']}' subtype '{subtype['key']}' "
                f"is missing a 'translations' dict"
            )
            translations = subtype["translations"]
            for locale in SUPPORTED_LOCALES:
                assert locale in translations, (
                    f"Type '{card_type['key']}' subtype '{subtype['key']}' "
                    f"missing translation for locale '{locale}'"
                )

    @pytest.mark.parametrize("card_type", _type_ids())
    def test_subtype_translations_are_nonempty(self, card_type):
        """No subtype translation value is an empty string."""
        subtypes = card_type.get("subtypes", [])
        if not subtypes:
            pytest.skip(f"Type '{card_type['key']}' has no subtypes")

        for subtype in subtypes:
            translations = subtype.get("translations", {})
            for locale, value in translations.items():
                assert isinstance(value, str) and len(value) > 0, (
                    f"Type '{card_type['key']}' subtype '{subtype['key']}' "
                    f"has empty translation for locale '{locale}'"
                )


# ---------------------------------------------------------------------------
# Section translations
# ---------------------------------------------------------------------------


class TestSectionTranslations:
    @pytest.mark.parametrize("card_type", _type_ids())
    def test_all_sections_have_translations(self, card_type):
        """Every section in fields_schema has translations for all 6 locales."""
        fields_schema = card_type.get("fields_schema", [])
        if not fields_schema:
            pytest.skip(f"Type '{card_type['key']}' has no fields_schema")

        for section in fields_schema:
            section_name = section.get("section", "<unnamed>")
            assert "translations" in section, (
                f"Type '{card_type['key']}' section '{section_name}' "
                f"is missing a 'translations' dict"
            )
            translations = section["translations"]
            for locale in SUPPORTED_LOCALES:
                assert locale in translations, (
                    f"Type '{card_type['key']}' section '{section_name}' "
                    f"missing translation for locale '{locale}'"
                )

    @pytest.mark.parametrize("card_type", _type_ids())
    def test_section_translations_are_nonempty(self, card_type):
        """No section translation value is an empty string."""
        fields_schema = card_type.get("fields_schema", [])
        if not fields_schema:
            pytest.skip(f"Type '{card_type['key']}' has no fields_schema")

        for section in fields_schema:
            section_name = section.get("section", "<unnamed>")
            translations = section.get("translations", {})
            for locale, value in translations.items():
                assert isinstance(value, str) and len(value) > 0, (
                    f"Type '{card_type['key']}' section '{section_name}' "
                    f"has empty translation for locale '{locale}'"
                )


# ---------------------------------------------------------------------------
# Field translations
# ---------------------------------------------------------------------------


class TestFieldTranslations:
    @pytest.mark.parametrize("card_type", _type_ids())
    def test_all_fields_have_translations(self, card_type):
        """Every field in fields_schema has translations for all 6 locales."""
        fields_schema = card_type.get("fields_schema", [])
        if not fields_schema:
            pytest.skip(f"Type '{card_type['key']}' has no fields_schema")

        for section in fields_schema:
            section_name = section.get("section", "<unnamed>")
            for field in section.get("fields", []):
                field_key = field.get("key", "<unnamed>")
                assert "translations" in field, (
                    f"Type '{card_type['key']}' section '{section_name}' "
                    f"field '{field_key}' is missing a 'translations' dict"
                )
                translations = field["translations"]
                for locale in SUPPORTED_LOCALES:
                    assert locale in translations, (
                        f"Type '{card_type['key']}' section '{section_name}' "
                        f"field '{field_key}' missing translation for "
                        f"locale '{locale}'"
                    )

    @pytest.mark.parametrize("card_type", _type_ids())
    def test_field_translations_are_nonempty(self, card_type):
        """No field translation value is an empty string."""
        fields_schema = card_type.get("fields_schema", [])
        if not fields_schema:
            pytest.skip(f"Type '{card_type['key']}' has no fields_schema")

        for section in fields_schema:
            section_name = section.get("section", "<unnamed>")
            for field in section.get("fields", []):
                field_key = field.get("key", "<unnamed>")
                translations = field.get("translations", {})
                for locale, value in translations.items():
                    assert isinstance(value, str) and len(value) > 0, (
                        f"Type '{card_type['key']}' section '{section_name}' "
                        f"field '{field_key}' has empty translation for "
                        f"locale '{locale}'"
                    )


# ---------------------------------------------------------------------------
# Option translations (single_select / multiple_select fields)
# ---------------------------------------------------------------------------


class TestOptionTranslations:
    @pytest.mark.parametrize("card_type", _type_ids())
    def test_all_options_have_translations(self, card_type):
        """Every option on select fields has translations for all 6 locales."""
        fields_schema = card_type.get("fields_schema", [])
        if not fields_schema:
            pytest.skip(f"Type '{card_type['key']}' has no fields_schema")

        found_any = False
        for section in fields_schema:
            section_name = section.get("section", "<unnamed>")
            for field in section.get("fields", []):
                options = field.get("options", [])
                if not options:
                    continue
                found_any = True
                field_key = field.get("key", "<unnamed>")
                for option in options:
                    option_key = option.get("key", "<unnamed>")
                    assert "translations" in option, (
                        f"Type '{card_type['key']}' section '{section_name}' "
                        f"field '{field_key}' option '{option_key}' "
                        f"is missing a 'translations' dict"
                    )
                    translations = option["translations"]
                    for locale in SUPPORTED_LOCALES:
                        assert locale in translations, (
                            f"Type '{card_type['key']}' section "
                            f"'{section_name}' field '{field_key}' "
                            f"option '{option_key}' missing translation "
                            f"for locale '{locale}'"
                        )

        if not found_any:
            pytest.skip(f"Type '{card_type['key']}' has no fields with options")

    @pytest.mark.parametrize("card_type", _type_ids())
    def test_option_translations_are_nonempty(self, card_type):
        """No option translation value is an empty string."""
        fields_schema = card_type.get("fields_schema", [])
        if not fields_schema:
            pytest.skip(f"Type '{card_type['key']}' has no fields_schema")

        found_any = False
        for section in fields_schema:
            section_name = section.get("section", "<unnamed>")
            for field in section.get("fields", []):
                options = field.get("options", [])
                if not options:
                    continue
                found_any = True
                field_key = field.get("key", "<unnamed>")
                for option in options:
                    option_key = option.get("key", "<unnamed>")
                    translations = option.get("translations", {})
                    for locale, value in translations.items():
                        assert isinstance(value, str) and len(value) > 0, (
                            f"Type '{card_type['key']}' section "
                            f"'{section_name}' field '{field_key}' "
                            f"option '{option_key}' has empty translation "
                            f"for locale '{locale}'"
                        )

        if not found_any:
            pytest.skip(f"Type '{card_type['key']}' has no fields with options")


# ---------------------------------------------------------------------------
# Relation translations
# ---------------------------------------------------------------------------


class TestRelationTranslations:
    @pytest.mark.parametrize("relation", _relation_ids())
    def test_all_relations_have_translations(self, relation):
        """Every relation in RELATIONS has a translations dict."""
        assert "translations" in relation, (
            f"Relation '{relation['key']}' is missing a 'translations' dict"
        )
        assert isinstance(relation["translations"], dict), (
            f"Relation '{relation['key']}' translations is not a dict"
        )
        assert len(relation["translations"]) > 0, (
            f"Relation '{relation['key']}' has an empty translations dict"
        )

    @pytest.mark.parametrize("relation", _relation_ids())
    def test_relation_label_translated(self, relation):
        """translations['label'] has all 6 locales for every relation."""
        translations = relation.get("translations", {})
        assert "label" in translations, (
            f"Relation '{relation['key']}' translations missing 'label' key"
        )
        label_translations = translations["label"]
        for locale in SUPPORTED_LOCALES:
            assert locale in label_translations, (
                f"Relation '{relation['key']}' missing label translation for locale '{locale}'"
            )
            value = label_translations[locale]
            assert isinstance(value, str) and len(value) > 0, (
                f"Relation '{relation['key']}' label translation for "
                f"locale '{locale}' is empty or not a string"
            )

    @pytest.mark.parametrize("relation", _relation_ids())
    def test_relation_reverse_label_translated(self, relation):
        """For relations with reverse_label, translations['reverse_label'] covers all locales."""
        if not relation.get("reverse_label"):
            pytest.skip(f"Relation '{relation['key']}' has no reverse_label")

        translations = relation.get("translations", {})
        assert "reverse_label" in translations, (
            f"Relation '{relation['key']}' has a reverse_label but "
            f"translations missing 'reverse_label' key"
        )
        rev_translations = translations["reverse_label"]
        for locale in SUPPORTED_LOCALES:
            assert locale in rev_translations, (
                f"Relation '{relation['key']}' missing reverse_label "
                f"translation for locale '{locale}'"
            )
            value = rev_translations[locale]
            assert isinstance(value, str) and len(value) > 0, (
                f"Relation '{relation['key']}' reverse_label translation "
                f"for locale '{locale}' is empty or not a string"
            )
