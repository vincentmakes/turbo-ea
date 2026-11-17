"""Tests for migration 178 (the ``licensing`` extension's data -> core licenses).

The pure helpers in ``app.services.licensing_migration`` (no DB). The DB tests of the
already-applied 178 are gone: its raw ``ON CONFLICT (key)`` insert cannot run on the schema of
migration 192 (see ``test_alembic_192_license_metrics.py``).
"""

from __future__ import annotations

import copy
import importlib.util
from pathlib import Path

from app.services import seed
from app.services.licensing_migration import (
    GENERAL_SECTION,
    LICENSING_MODEL_FIELD,
    LICENSING_SECTION,
    assign_keys,
    build_items,
    citing_calculations,
    citing_model_calculations,
    derive_type_metrics,
    move_model_field,
    slug,
    without_model_field,
)

_MIG_PATH = (
    Path(__file__).resolve().parents[2] / "alembic" / "versions" / "178_licensing_from_extension.py"
)
_spec = importlib.util.spec_from_file_location("mig178", _MIG_PATH)
mig = importlib.util.module_from_spec(_spec)
assert _spec and _spec.loader
_spec.loader.exec_module(mig)

KEYS = assign_keys(["Admin", "Dev"])


def test_slug_and_type_fallback():
    assert slug("End User") == "end_user"
    assert slug("  Prod-1 ") == "prod_1"
    assert slug("123") is None
    assert slug("—") is None
    assert len(slug("a" * 100)) == 64


def test_assign_keys_merges_case_and_falls_back():
    k = assign_keys(["Prod", "prod", "123", "End User"])
    assert k["prod"] == ("prod", "Prod")
    assert k["123"][0] == "type_1"
    assert k["end user"][0] == "end_user"
    assert len(k) == 3


def test_assign_keys_suffixes_slug_collisions():
    assert {v[0] for v in assign_keys(["a b", "a-b"]).values()} == {"a_b", "a_b_2"}


def test_build_items_sums_duplicates_and_reports_bad_values():
    items, problems = build_items(
        {
            "licensedUsers": [
                {"category": "Admin", "value": 2},
                {"category": "admin", "value": 3},
            ],
            "actualUsers": [
                {"category": "Admin", "value": "x"},
                {"category": "Dev", "value": -1},
                {"category": "Admin", "value": 1.6},
            ],
        },
        KEYS,
    )
    assert items == {"users": {"admin": {"licensed": 5, "actual": 2}}}
    assert {p["reason"] for p in problems} == {"not_numeric", "negative", "rounded"}


def test_build_items_accepts_numeric_text_and_skips_blank_category():
    items, problems = build_items(
        {
            "licensedInstallations": [
                {"category": "Dev", "value": " 7 "},
                {"category": "  ", "value": 4},
            ]
        },
        KEYS,
    )
    assert items == {"installations": {"dev": {"licensed": 7, "actual": None}}}
    assert [p["reason"] for p in problems] == ["no_category"]


def test_actual_without_licensed_gets_licensed_zero():
    items, _ = build_items({"actualUsers": [{"category": "Dev", "value": 3}]}, KEYS)
    assert items == {"users": {"dev": {"licensed": 0, "actual": 3}}}


def test_nothing_usable_gives_no_items():
    items, problems = build_items({"licensedUsers": "garbage", "actualUsers": [{"x": 1}]}, KEYS)
    assert items == {} and problems == []


def _ext_field(key, ftype="multiple_select"):
    return {"key": key, "label": key, "type": ftype, "ext": "licensing"}


def test_move_model_field_adds_the_dedicated_section_after_the_extension_was_stripped():
    schema = [{"section": "Application Information", "fields": [{"key": "hostingType"}]}]
    out = move_model_field("Application", schema)
    assert out[0] == schema[0]  # the general section is untouched
    assert out[-1]["section"] == LICENSING_SECTION
    assert out[-1]["fields"] == [LICENSING_MODEL_FIELD]
    assert out[-1]["fields"][0] is not LICENSING_MODEL_FIELD
    assert set(out[-1]["translations"]) == {"de", "fr", "es", "it", "pt", "zh", "ru", "da", "ar"}


def test_move_model_field_adds_on_instance_without_extension():
    schema = [{"section": "Component Information", "fields": [{"key": "x"}]}]
    out = move_model_field("ITComponent", schema)
    assert [f["key"] for f in out[0]["fields"]] == ["x"]
    assert [f["key"] for f in out[-1]["fields"]] == ["licensingModel"]
    assert [f["key"] for f in schema[0]["fields"]] == ["x"]  # input untouched
    assert move_model_field("ITComponent", out) is None  # second pass: no change


def test_move_model_field_pulls_the_field_out_of_a_general_section_keeping_its_definition():
    mine = {**copy.deepcopy(LICENSING_MODEL_FIELD), "label": "Our model"}
    schema = [{"section": "Application Information", "fields": [{"key": "a"}, mine]}]
    out = move_model_field("Application", schema)
    assert [f["key"] for f in out[0]["fields"]] == ["a"]
    assert out[-1]["section"] == LICENSING_SECTION
    assert out[-1]["fields"] == [mine]  # the admin's label survives the move


def test_move_model_field_reuses_an_existing_licensing_section():
    schema = [{"section": LICENSING_SECTION, "fields": [{"key": "other"}]}]
    out = move_model_field("Application", schema)
    assert len(out) == 1
    assert [f["key"] for f in out[0]["fields"]] == ["other", "licensingModel"]


def test_move_model_field_keeps_an_admin_field_with_the_same_key_but_another_type():
    schema = [{"section": "Mine", "fields": [{"key": "licensingModel", "type": "text"}]}]
    assert move_model_field("Application", schema) is None


def test_move_model_field_adds_the_missing_required_options_keeping_the_admin_ones():
    mine = copy.deepcopy(LICENSING_MODEL_FIELD)
    mine["label"] = "Our model"
    mine["options"] = [{"key": "cores", "label": "Cores"}, mine["options"][0]]  # no installations
    schema = [{"section": LICENSING_SECTION, "fields": [mine]}]  # already in place
    out = move_model_field("Application", schema)
    field = out[0]["fields"][0]
    assert field["label"] == "Our model"
    assert [o["key"] for o in field["options"]] == ["cores", "users", "installations"]
    assert move_model_field("Application", out) is None


def test_move_model_field_cleans_a_copy_left_in_an_extension_section():
    schema = [
        {"section": "Ext", "ext": "licensing", "fields": [copy.deepcopy(LICENSING_MODEL_FIELD)]}
    ]
    out = move_model_field("Application", schema)
    assert out[0]["fields"] == []
    assert out[-1]["section"] == LICENSING_SECTION
    keys = [f["key"] for s in out for f in s["fields"]]
    assert keys == ["licensingModel"]


def test_move_model_field_ignores_other_types():
    assert move_model_field("Platform", []) is None


def test_seed_no_longer_carries_the_licensing_model_field():
    for type_key in GENERAL_SECTION:
        type_def = next(t for t in seed.TYPES if t["key"] == type_key)
        assert LICENSING_SECTION not in [s["section"] for s in type_def["fields_schema"]]
        keys = [f["key"] for s in type_def["fields_schema"] for f in s["fields"]]
        assert "licensingModel" not in keys


def test_citing_calculations_lists_formulas_naming_old_keys():
    rows = [
        ("1", "uses", "present = data.licensedUsers + 1"),
        ("2", "other", "present = data.licensedUsersExtra"),
        ("3", "none", "present = data.cost"),
        ("4", "two", "data.actualUsers / data.actualInstallations"),
    ]
    assert citing_calculations(rows) == [
        {"id": "1", "name": "uses", "keys": ["licensedUsers"]},
        {"id": "4", "name": "two", "keys": ["actualUsers", "actualInstallations"]},
    ]


def test_derive_type_metrics_follows_where_the_data_is():
    types = [("admin", False), ("dev", False), ("old", True), ("both", False)]
    used = {"admin": {"users"}, "dev": {"installations"}, "both": {"installations", "users"}}
    assert derive_type_metrics(types, used) == [
        ("admin", "users"),
        ("dev", "installations"),
        ("old", "users"),
        ("old", "installations"),
        ("both", "users"),
        ("both", "installations"),
    ]


def test_derive_type_metrics_of_no_types_is_empty():
    assert derive_type_metrics([], {}) == []


def _field(ftype="multiple_select", **kw):
    return {"key": "licensingModel", "type": ftype, **kw}


def test_without_model_field_drops_the_field_and_its_empty_section():
    schema = [
        {"section": "Application Information", "fields": [{"key": "hostingType"}]},
        {"section": "Licensing", "fields": [_field()]},
    ]
    assert without_model_field("Application", schema) == [schema[0]]
    assert schema[1]["fields"] == [_field()]  # the input is not mutated


def test_without_model_field_keeps_a_licensing_section_an_admin_added_fields_to():
    schema = [{"section": "Licensing", "fields": [_field(), {"key": "vendor"}]}]
    assert without_model_field("ITComponent", schema) == [
        {"section": "Licensing", "fields": [{"key": "vendor"}]}
    ]


def test_without_model_field_pulls_it_out_of_a_general_section_too():
    schema = [{"section": "Application Information", "fields": [_field(), {"key": "x"}]}]
    assert without_model_field("Application", schema) == [
        {"section": "Application Information", "fields": [{"key": "x"}]}
    ]


def test_without_model_field_leaves_an_extension_field_and_a_custom_type_alone():
    ext = [{"section": "Licensing", "ext": "licensing", "fields": [_field(ext="licensing")]}]
    assert without_model_field("Application", ext) == ext
    custom = [{"section": "Licensing", "fields": [_field("text")]}]
    assert without_model_field("MyType", custom) == custom
    # Same key but another type on a licensing card type: not the protected field either.
    assert without_model_field("Application", custom) == [
        {"section": "Licensing", "fields": [_field("text")]}
    ]


def test_citing_model_calculations_matches_the_whole_key():
    rows = [
        ("1", "yes", "x = data.licensingModel"),
        ("2", "longer", "x = data.licensingModelX"),
        ("3", "no", "x = data.cost"),
    ]
    assert citing_model_calculations(rows) == [{"id": "1", "name": "yes"}]
