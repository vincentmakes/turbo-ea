"""Lifecycle phase help: the pure read / normalise / audit helpers."""

from __future__ import annotations

import pytest

from app.services import seed
from app.services.lifecycle import PHASE_CHRONOLOGICAL
from app.services.lifecycle_phase_help import (
    MAX_LEN,
    SETTING_KEY,
    audit_view,
    default_phase_help,
    normalize_phase_help,
    read_phase_help,
)

LOCALES = ["en", "de", "fr"]


class TestReadPhaseHelp:
    def test_absent_key_serves_the_defaults(self):
        help_map = read_phase_help({"currency": "EUR"})
        assert list(help_map) == list(PHASE_CHRONOLOGICAL)
        for phase in PHASE_CHRONOLOGICAL:
            assert isinstance(help_map[phase]["en"], str) and help_map[phase]["en"].strip()
        assert help_map == default_phase_help()

    def test_none_general_serves_the_defaults(self):
        assert read_phase_help(None) == default_phase_help()
        assert read_phase_help({}) == default_phase_help()

    def test_cleared_setting_beats_the_defaults(self):
        assert read_phase_help({SETTING_KEY: {}}) == {}

    def test_null_setting_is_empty_not_defaults(self):
        assert read_phase_help({SETTING_KEY: None}) == {}

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


class TestDefaultPhaseHelp:
    def test_english_comes_from_the_seed_label(self):
        defaults = default_phase_help()
        for entry in seed.LIFECYCLE_PHASE_HELP:
            assert defaults[entry["key"]]["en"] == entry["label"]

    def test_skips_empty_translations_and_carries_filled_ones(self, monkeypatch):
        monkeypatch.setattr(
            seed,
            "LIFECYCLE_PHASE_HELP",
            [
                {"key": "plan", "label": "Planned", "translations": {"de": ""}},
                {"key": "active", "label": "In use", "translations": {"de": "In Betrieb"}},
            ],
        )
        assert default_phase_help() == {
            "plan": {"en": "Planned"},
            "active": {"en": "In use", "de": "In Betrieb"},
        }

    def test_skips_unknown_phases_and_textless_entries(self, monkeypatch):
        monkeypatch.setattr(
            seed,
            "LIFECYCLE_PHASE_HELP",
            [
                {"key": "retired", "label": "Gone", "translations": {}},
                {"key": "phaseIn", "label": "", "translations": {"de": ""}},
                {"key": "endOfLife", "label": "", "translations": {"fr": "Fin"}},
            ],
        )
        assert default_phase_help() == {"endOfLife": {"fr": "Fin"}}


class TestNormalizePhaseHelp:
    def test_unknown_phase_raises(self):
        with pytest.raises(ValueError, match="retired"):
            normalize_phase_help({"retired": {"en": "x"}, "plan": {"en": "y"}}, LOCALES)

    def test_unknown_phases_are_named_sorted_and_comma_separated(self):
        with pytest.raises(ValueError) as excinfo:
            normalize_phase_help({"scrapped": {"en": "x"}, "retired": {"en": "y"}}, LOCALES)
        assert str(excinfo.value) == "Unknown lifecycle phase: retired, scrapped"

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
