"""Lifecycle phase help: the pure read / normalise / audit helpers."""

from __future__ import annotations

import pytest

from app.services.lifecycle_phase_help import (
    MAX_LEN,
    SETTING_KEY,
    audit_view,
    normalize_phase_help,
    read_phase_help,
)

LOCALES = ["en", "de", "fr"]


class TestReadPhaseHelp:
    def test_unset_is_empty(self):
        assert read_phase_help({}) == {}
        assert read_phase_help(None) == {}

    def test_setting_key_is_camel_case(self):
        assert SETTING_KEY == "lifecyclePhaseHelp"

    def test_reads_known_phases(self):
        general = {SETTING_KEY: {"active": {"en": "In use", "de": "In Betrieb"}}}
        assert read_phase_help(general) == {"active": {"en": "In use", "de": "In Betrieb"}}

    def test_stray_keys_are_ignored(self):
        general = {
            SETTING_KEY: {
                "retired": {"en": "not a phase"},
                "plan": "not a map",
                "phaseOut": {"en": "Leaving", "de": "", "fr": 3},
                "endOfLife": {"en": ""},
            }
        }
        assert read_phase_help(general) == {"phaseOut": {"en": "Leaving"}}

    def test_non_mapping_setting_is_empty(self):
        assert read_phase_help({SETTING_KEY: ["plan"]}) == {}
        assert read_phase_help({SETTING_KEY: "text"}) == {}


class TestNormalizePhaseHelp:
    def test_unknown_phase_raises(self):
        with pytest.raises(ValueError, match="retired"):
            normalize_phase_help({"retired": {"en": "x"}, "plan": {"en": "y"}}, LOCALES)

    def test_unknown_locale_is_dropped(self):
        out = normalize_phase_help({"plan": {"en": "Idea", "xx": "?"}}, LOCALES)
        assert out == {"plan": {"en": "Idea"}}

    def test_texts_are_trimmed_and_empty_dropped(self):
        out = normalize_phase_help(
            {"plan": {"en": "  Idea \n", "de": "   "}, "active": {"en": ""}}, LOCALES
        )
        assert out == {"plan": {"en": "Idea"}}

    def test_length_is_capped(self):
        out = normalize_phase_help({"active": {"en": "a" * (MAX_LEN + 50)}}, LOCALES)
        assert out["active"]["en"] == "a" * MAX_LEN
        assert MAX_LEN == 2000

    def test_text_at_the_cap_is_kept_whole(self):
        text = "b" * MAX_LEN
        assert normalize_phase_help({"active": {"en": text}}, LOCALES) == {"active": {"en": text}}

    def test_non_string_values_are_dropped(self):
        out = normalize_phase_help({"plan": {"en": 5, "de": "Plan"}}, LOCALES)
        assert out == {"plan": {"de": "Plan"}}

    def test_none_phase_map_is_empty(self):
        assert normalize_phase_help({"plan": None}, LOCALES) == {}

    def test_output_follows_chronological_order(self):
        out = normalize_phase_help(
            {"endOfLife": {"en": "e"}, "plan": {"en": "p"}, "phaseIn": {"en": "i"}}, LOCALES
        )
        assert list(out) == ["plan", "phaseIn", "endOfLife"]


class TestAuditView:
    def test_flattens_to_scalars(self):
        view = audit_view({"phaseOut": {"en": "Leaving", "de": "Auslaufend"}})
        assert view == {"phaseOut_en": "Leaving", "phaseOut_de": "Auslaufend"}

    def test_empty(self):
        assert audit_view({}) == {}
