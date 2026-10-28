"""``_fill_builtin_attribute_translations``: the restart backfill of a built-in
relation type's attribute translations (#1327). Pure — no database."""

from __future__ import annotations

import copy

from app.services.seed import _fill_builtin_attribute_translations

SEED = [
    {
        "key": "usageType",
        "label": "Usage",
        "type": "single_select",
        "translations": {"de": "Nutzung", "fr": "Utilisation"},
        "options": [
            {"key": "creates", "label": "Creates", "translations": {"de": "Erstellt"}},
            {"key": "reads", "label": "Reads", "translations": {"de": "Liest"}},
        ],
    },
    {"key": "note", "label": "Note", "type": "text", "translations": {"de": "Notiz"}},
]


def _stored() -> list:
    """The same schema as an install seeded before translations shipped stores it."""
    return [
        {
            "key": "usageType",
            "label": "Usage",
            "type": "single_select",
            "built_in": True,
            "options": [
                {"key": "creates", "label": "Creates", "built_in": True},
                {"key": "reads", "label": "Reads", "built_in": True, "hidden": True},
                {"key": "approves", "label": "Approves", "color": "#123456", "built_in": False},
            ],
        },
        {"key": "note", "label": "Note", "type": "text", "built_in": True},
    ]


def test_fills_built_in_fields_and_values():
    stored = _stored()
    before = copy.deepcopy(stored)

    out = _fill_builtin_attribute_translations(stored, SEED)

    assert out is not None
    assert out[0]["translations"] == {"de": "Nutzung", "fr": "Utilisation"}
    assert out[0]["options"][0]["translations"] == {"de": "Erstellt"}
    assert out[0]["options"][1] == {
        "key": "reads",
        "label": "Reads",
        "built_in": True,
        "hidden": True,
        "translations": {"de": "Liest"},
    }
    assert out[1]["translations"] == {"de": "Notiz"}
    # The stored schema is not mutated in place.
    assert stored == before


def test_leaves_custom_values_and_everything_else_alone():
    out = _fill_builtin_attribute_translations(_stored(), SEED)

    assert out[0]["options"][2] == {
        "key": "approves",
        "label": "Approves",
        "color": "#123456",
        "built_in": False,
    }
    assert [o["key"] for o in out[0]["options"]] == ["creates", "reads", "approves"]
    assert {k: v for k, v in out[0].items() if k not in ("translations", "options")} == {
        "key": "usageType",
        "label": "Usage",
        "type": "single_select",
        "built_in": True,
    }


def test_never_overwrites_a_stored_translation():
    stored = _stored()
    stored[0]["translations"] = {"de": "Eigene Nutzung"}
    stored[0]["options"][0]["translations"] = {"de": "Eigenes Erstellt"}

    out = _fill_builtin_attribute_translations(stored, SEED)

    assert out[0]["translations"] == {"de": "Eigene Nutzung", "fr": "Utilisation"}
    assert out[0]["options"][0]["translations"] == {"de": "Eigenes Erstellt"}


def test_returns_none_when_nothing_is_missing():
    filled = _fill_builtin_attribute_translations(_stored(), SEED)
    assert _fill_builtin_attribute_translations(filled, SEED) is None


def test_skips_custom_fields_unmatched_keys_and_untranslated_seed_entries():
    stored = [
        {"key": "usageType", "label": "Usage", "built_in": False, "options": []},
        {"key": "gone", "label": "Gone", "built_in": True},
        {"key": "note", "label": "Note", "built_in": True},
        "not a field",
    ]
    seed = [
        {"key": "usageType", "translations": {"de": "Nutzung"}},
        {"key": "note", "translations": {}},
    ]
    assert _fill_builtin_attribute_translations(stored, seed) is None


def test_options_of_a_custom_field_are_never_filled():
    stored = [
        {
            "key": "usageType",
            "built_in": False,
            "options": [{"key": "creates", "label": "Creates", "built_in": True}],
        }
    ]
    assert _fill_builtin_attribute_translations(stored, SEED) is None


def test_tolerates_malformed_input():
    assert _fill_builtin_attribute_translations(None, SEED) is None
    assert _fill_builtin_attribute_translations({"key": "x"}, SEED) is None
    stored = [{"key": "usageType", "built_in": True, "options": ["junk", {"label": "no key"}]}]
    out = _fill_builtin_attribute_translations(stored, [*SEED, "junk", {"label": "no key"}])
    assert out[0]["translations"] == {"de": "Nutzung", "fr": "Utilisation"}
    assert out[0]["options"] == ["junk", {"label": "no key"}]
    assert _fill_builtin_attribute_translations([], None) is None
