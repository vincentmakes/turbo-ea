"""Pure helpers of ``scripts/i18n/check_locales.py``, the ``/translate`` skill's tool.

The script is imported by path (it lives outside the backend package) and its
pure functions are exercised on in-memory data; one test reads the real locale
files off disk, hence the ``source_scan`` marker.
"""

from __future__ import annotations

import importlib.util
import json
from pathlib import Path

import pytest

pytestmark = pytest.mark.source_scan

_SCRIPT = Path(__file__).resolve().parents[3] / "scripts" / "i18n" / "check_locales.py"
_spec = importlib.util.spec_from_file_location("check_locales", _SCRIPT)
cl = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(cl)


class TestFlatten:
    def test_nested_leaves_become_paths(self):
        assert cl.flatten({"a": {"b": "x", "c": {"d": "y"}}, "e.f": "z"}) == {
            ("a", "b"): "x",
            ("a", "c", "d"): "y",
            ("e.f",): "z",
        }

    def test_dotted_joins_segments(self):
        assert cl.dotted(("a", "b.c")) == "a.b.c"


class TestPlaceholders:
    def test_names_extracted(self):
        assert cl.placeholders("{{count}} of {{ total }}") == {"count", "total"}

    def test_format_suffix_ignored(self):
        assert cl.placeholders("{{date, short}}") == {"date"}

    def test_non_string_has_none(self):
        assert cl.placeholders(3) == set()


class TestPluralBase:
    def test_suffixes(self):
        assert cl.plural_base("items_other") == ("items", "other")
        assert cl.plural_base("items_few") == ("items", "few")

    def test_plain_key(self):
        assert cl.plural_base("title") == ("title", None)


class TestDiffLocale:
    EN = {"a": "A {{n}}", "n_one": "{{count}} x", "n_other": "{{count}} xs", "g": {"h": "H"}}

    def test_complete_locale_is_clean(self):
        loc = {"a": "Ä {{n}}", "n_one": "{{count}} y", "n_other": "{{count}} ys", "g": {"h": "Ĥ"}}
        result = cl.diff_locale(self.EN, loc, "de")
        assert result == {"missing": [], "placeholder": [], "extra": [], "empty": []}

    def test_missing_nested_key(self):
        loc = {"a": "Ä {{n}}", "n_one": "1", "n_other": "2", "g": {}}
        assert ("g", "h") in cl.diff_locale(self.EN, loc, "de")["missing"]

    def test_placeholder_mismatch(self):
        loc = {"a": "Ä {{m}}", "n_one": "{{count}}", "n_other": "{{count}}", "g": {"h": "x"}}
        assert cl.diff_locale(self.EN, loc, "de")["placeholder"] == [("a",)]

    def test_empty_value(self):
        loc = {"a": " ", "n_one": "{{count}}", "n_other": "{{count}}", "g": {"h": "x"}}
        assert cl.diff_locale(self.EN, loc, "de")["empty"] == [("a",)]

    def test_russian_extra_plurals_allowed(self):
        loc = {
            "a": "А {{n}}",
            "n_one": "{{count}}",
            "n_few": "{{count}}",
            "n_many": "{{count}}",
            "n_other": "{{count}}",
            "g": {"h": "x"},
        }
        assert cl.diff_locale(self.EN, loc, "ru")["extra"] == []

    def test_extra_plural_not_allowed_for_german(self):
        loc = {"a": "Ä {{n}}", "n_one": "1", "n_few": "f", "n_other": "2", "g": {"h": "x"}}
        assert cl.diff_locale(self.EN, loc, "de")["extra"] == [("n_few",)]


class TestFrCarte:
    @pytest.mark.parametrize(
        "text", ["Créer une carte", "Cartes archivées", "La carte et la carte des capacités"]
    )
    def test_card_meaning_flagged(self, text):
        assert cl.fr_carte_violation(text)

    @pytest.mark.parametrize(
        "text", ["Ouvrir la carte des capacités", "Carte thermique", "Créer une fiche"]
    )
    def test_maps_and_fiche_pass(self, text):
        assert not cl.fr_carte_violation(text)


class TestValidateValue:
    def test_good_value(self):
        assert cl.validate_value("de", "Hi {{n}}", "Hallo {{n}}") is None

    @pytest.mark.parametrize("value", ["", "   ", None])
    def test_empty_refused(self, value):
        assert cl.validate_value("de", "Hi", value) == "empty value"

    def test_placeholder_refused(self):
        assert "placeholders" in cl.validate_value("de", "Hi {{n}}", "Hallo {{m}}")

    def test_ascii_quote_refused(self):
        assert "ASCII" in cl.validate_value("de", "Say hi", 'Sag "hallo"')

    def test_carte_refused_in_french_only(self):
        assert "fiche" in cl.validate_value("fr", "A card", "Une carte")
        assert cl.validate_value("es", "A card", "Una carte") is None


class TestInsertInOrder:
    EN = {"a": "A", "b": "B", "c": "C", "n_one": "1", "n_other": "2", "z": "Z"}

    def test_inserted_after_english_predecessor(self):
        out = cl.insert_in_order({"a": "a", "c": "c"}, self.EN, ("b",), "b")
        assert list(out) == ["a", "b", "c"]

    def test_first_key_goes_first(self):
        out = cl.insert_in_order({"b": "b"}, self.EN, ("a",), "a")
        assert list(out) == ["a", "b"]

    def test_existing_key_replaced_in_place(self):
        out = cl.insert_in_order({"a": "a", "b": "old"}, self.EN, ("b",), "new")
        assert out == {"a": "a", "b": "new"}

    def test_skips_locale_only_plural_forms(self):
        loc = {"n_one": "1", "n_few": "f", "n_many": "m", "n_other": "2"}
        out = cl.insert_in_order(loc, self.EN, ("z",), "z")
        assert list(out) == ["n_one", "n_few", "n_many", "n_other", "z"]

    def test_nested(self):
        en = {"g": {"x": "X", "y": "Y"}, "h": "H"}
        out = cl.insert_in_order({"h": "h"}, en, ("g", "y"), "y")
        assert out == {"g": {"y": "y"}, "h": "h"}
        assert list(out) == ["g", "h"]


class TestResolveKey:
    def test_unique_match(self):
        flat = cl.flatten({"a": {"b": "x"}})
        assert cl.resolve_key(flat, "a.b") == ("a", "b")

    def test_unknown_key(self):
        with pytest.raises(KeyError):
            cl.resolve_key({}, "nope")


class TestLayoutPreservingEdit:
    TEXT = '{\n  "a": "A",\n\n  "c": "caf\\u00e9"\n}\n'

    def test_insert_keeps_blank_lines_and_escapes(self):
        out = cl.insert_flat_text(self.TEXT, "b", "Bé", "a")
        assert out == '{\n  "a": "A",\n  "b": "Bé",\n\n  "c": "caf\\u00e9"\n}\n'

    def test_insert_after_last_key_adds_comma(self):
        out = cl.insert_flat_text(self.TEXT, "d", "D", "c")
        assert json.loads(out) == {"a": "A", "c": "café", "d": "D"}
        assert '"c": "caf\\u00e9",\n  "d": "D"\n' in out

    def test_insert_first(self):
        out = cl.insert_flat_text(self.TEXT, "_", "U", None)
        assert list(json.loads(out)) == ["_", "a", "c"]

    def test_replace_value(self):
        out = cl.replace_flat_value(self.TEXT, "a", "Ä")
        assert json.loads(out)["a"] == "Ä"
        assert "\\u00e9" in out


def test_repository_locales_have_no_fatal_gaps():
    for ns in cl.namespaces():
        en = cl.load("en", ns)
        for locale in cl.TARGET_LOCALES:
            result = cl.diff_locale(en, cl.load(locale, ns), locale)
            assert not result["missing"], (locale, ns, result["missing"][:5])
