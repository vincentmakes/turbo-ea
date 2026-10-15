"""``services/audit_changes`` — semantic change items for the Security log.

Pure functions, no database: every test hand-writes a before / after pair and
asserts the exact list of items, so a change to the wording, the order or the
matching rules fails here first.
"""

from __future__ import annotations

import copy

import pytest

from app.services import audit_changes as ac
from app.services.audit_changes import (
    AUDIT_ITEM_KINDS,
    attributes_schema_items,
    cap_items,
    fields_schema_items,
    item,
    keyed_list_items,
    list_items,
    permission_items,
    portal_card_config_items,
    portal_filter_items,
    role_permissions_items,
    section_config_items,
    translations_items,
)


def _field(key, label=None, type_="text", **extra):
    return {"key": key, "label": label or key.title(), "type": type_, **extra}


def _section(name, *fields, **extra):
    return {"section": name, "fields": list(fields), **extra}


# ── vocabulary ────────────────────────────────────────────────────────────


def test_the_kinds_are_the_vocabulary():
    assert AUDIT_ITEM_KINDS == {
        "section.added",
        "section.removed",
        "section.renamed",
        "section.moved",
        "section.changed",
        "field.added",
        "field.removed",
        "field.moved",
        "field.renamed",
        "field.changed",
        "option.added",
        "option.removed",
        "option.renamed",
        "option.changed",
        "attribute.added",
        "attribute.removed",
        "attribute.renamed",
        "attribute.changed",
        "subtype.added",
        "subtype.removed",
        "subtype.renamed",
        "subtype.changed",
        "hierarchy_label.added",
        "hierarchy_label.removed",
        "hierarchy_label.renamed",
        "hierarchy_label.changed",
        "stakeholder_role.added",
        "stakeholder_role.removed",
        "stakeholder_role.renamed",
        "stakeholder_role.changed",
        "layout.reordered",
        "quality_weight.changed",
        "translation.changed",
        "permission.granted",
        "permission.revoked",
        "permission.wildcard",
        "type_permission.changed",
        "portal_filter.changed",
        "portal_toggle.changed",
        "portal_option.changed",
        "locale.enabled",
        "locale.disabled",
        "image.replaced",
        "image.removed",
        "user.changed",
        "user.deleted",
        "more",
    }


def test_item_rejects_an_unknown_kind():
    with pytest.raises(ValueError, match="'field.exploded'"):
        item("field.exploded", field="x")


def test_item_drops_none_except_old_and_new():
    assert item(
        "field.changed", section=None, field="Cost", property="weight", old=None, new=2
    ) == {
        "kind": "field.changed",
        "field": "Cost",
        "property": "weight",
        "old": None,
        "new": 2,
    }
    assert item("more", count=0) == {"kind": "more", "count": 0}
    assert item("permission.wildcard", granted=False) == {
        "kind": "permission.wildcard",
        "granted": False,
    }


# ── keyed lists ───────────────────────────────────────────────────────────


def test_keyed_list_no_change_is_empty():
    subtypes = [{"key": "a", "label": "A", "hidden_fields": ["x"]}]
    assert keyed_list_items(subtypes, copy.deepcopy(subtypes), noun="subtype") == []


def test_keyed_list_malformed_input_reads_as_empty():
    assert keyed_list_items(None, "nope", noun="subtype") == []
    assert keyed_list_items(
        None, [{"key": "a", "label": "A"}, "junk", {"label": "no key"}], noun="subtype"
    ) == [{"kind": "subtype.added", "label": "A"}]


def test_keyed_list_subtypes_with_hidden_fields():
    old = [
        {"key": "app", "label": "Application", "hidden_fields": ["cost"]},
        {"key": "svc", "label": "Service"},
        {"key": "gone", "label": "Gone"},
    ]
    new = [
        {"key": "new", "label": "", "hidden_fields": []},
        {"key": "app", "label": "Business App", "hidden_fields": ["cost", "risk"]},
        {"key": "svc", "label": "Service", "hidden_fields": None},
        {"key": "app", "label": "Duplicate ignored"},
    ]
    assert keyed_list_items(old, new, noun="subtype", props=("hidden_fields",)) == [
        {"kind": "subtype.added", "label": "new"},
        {"kind": "subtype.removed", "label": "Gone"},
        {"kind": "subtype.renamed", "old": "Application", "new": "Business App"},
        {
            "kind": "subtype.changed",
            "label": "Business App",
            "property": "hidden_fields",
            "old": ["cost"],
            "new": ["cost", "risk"],
        },
    ]


def test_keyed_list_prop_not_listed_is_ignored_and_nested_is_compacted():
    old = [{"key": "a", "label": "A", "color": "#111111", "meta": {"b": 1, "a": 2}}]
    new = [{"key": "a", "label": "A", "color": "#222222", "meta": {"a": 3}}]
    assert keyed_list_items(old, new, noun="hierarchy_label") == []
    assert keyed_list_items(old, new, noun="hierarchy_label", props=("color", "meta")) == [
        {
            "kind": "hierarchy_label.changed",
            "label": "A",
            "property": "color",
            "old": "#111111",
            "new": "#222222",
        },
        {
            "kind": "hierarchy_label.changed",
            "label": "A",
            "property": "meta",
            "old": '{"a":2,"b":1}',
            "new": '{"a":3}',
        },
    ]


def test_keyed_list_tuple_value_is_reported_as_a_list():
    old = [{"key": "a", "label": "A", "hidden_fields": ("x",)}]
    new = [{"key": "a", "label": "A", "hidden_fields": ("x", "y")}]
    result = keyed_list_items(old, new, noun="subtype", props=("hidden_fields",))
    assert result[0]["old"] == ["x"] and isinstance(result[0]["old"], list)
    assert result[0]["new"] == ["x", "y"] and isinstance(result[0]["new"], list)


def test_keyed_list_custom_key_and_label_and_translations():
    old = [{"id": 1, "name": "Owner", "translations": {"de": "Besitzer"}}]
    new = [{"id": 1, "name": "Owner", "translations": {"de": "Eigentümer", "fr": "Propriétaire"}}]
    assert keyed_list_items(old, new, noun="stakeholder_role", key="id", label="name") == [
        {
            "kind": "translation.changed",
            "property": "stakeholder_role:Owner",
            "locale": "de",
            "old": "Besitzer",
            "new": "Eigentümer",
        },
        {
            "kind": "translation.changed",
            "property": "stakeholder_role:Owner",
            "locale": "fr",
            "old": None,
            "new": "Propriétaire",
        },
    ]


def test_keyed_list_rejects_an_unknown_noun():
    with pytest.raises(ValueError):
        keyed_list_items([], [{"key": "a"}], noun="widget")


# ── fields_schema ─────────────────────────────────────────────────────────


BASE = [
    _section("__description", _field("alias", "Alias")),
    _section(
        "Finance",
        _field("cost", "Cost", "cost", weight=1),
        _field(
            "tier",
            "Tier",
            "single_select",
            options=[
                {"key": "gold", "label": "Gold", "color": "#ffd700"},
                {"key": "old", "label": "Old"},
            ],
        ),
    ),
    _section("Ops", _field("sla", "SLA"), _field("owner", "Owner")),
]


def test_fields_schema_no_change_is_empty():
    assert fields_schema_items(BASE, copy.deepcopy(BASE)) == []
    assert fields_schema_items(None, None) == []
    assert fields_schema_items({"not": "a list"}, 42) == []


def test_fields_schema_add_field_to_existing_section():
    new = copy.deepcopy(BASE)
    new[1]["fields"].append(_field("capex", "CapEx", "number"))
    assert fields_schema_items(BASE, new) == [
        {"kind": "field.added", "section": "Finance", "field": "CapEx", "type": "number"}
    ]


def test_fields_schema_remove_field_and_description_section():
    new = copy.deepcopy(BASE)
    new[0]["fields"] = []
    assert fields_schema_items(BASE, new) == [
        {"kind": "field.removed", "section": "__description", "field": "Alias"}
    ]


def test_fields_schema_move_field_between_sections():
    new = copy.deepcopy(BASE)
    sla = new[2]["fields"].pop(0)
    new[1]["fields"].append(sla)
    assert fields_schema_items(BASE, new) == [
        {"kind": "field.moved", "field": "SLA", "from_section": "Ops", "to_section": "Finance"}
    ]


def test_fields_schema_rename_field():
    new = copy.deepcopy(BASE)
    new[1]["fields"][0]["label"] = "Annual cost"
    assert fields_schema_items(BASE, new) == [
        {"kind": "field.renamed", "section": "Finance", "old": "Cost", "new": "Annual cost"}
    ]


def test_fields_schema_change_type_required_weight():
    new = copy.deepcopy(BASE)
    cost = new[1]["fields"][0]
    cost["type"] = "number"
    cost["required"] = True
    cost["weight"] = 3
    assert fields_schema_items(BASE, new) == [
        {
            "kind": "field.changed",
            "section": "Finance",
            "field": "Cost",
            "property": "type",
            "old": "cost",
            "new": "number",
        },
        {
            "kind": "field.changed",
            "section": "Finance",
            "field": "Cost",
            "property": "required",
            "old": False,
            "new": True,
        },
        {
            "kind": "field.changed",
            "section": "Finance",
            "field": "Cost",
            "property": "weight",
            "old": 1,
            "new": 3,
        },
    ]


def test_fields_schema_explicit_false_flag_is_not_a_change():
    new = copy.deepcopy(BASE)
    new[1]["fields"][0].update(required=False, readonly=False, hidden=False)
    assert fields_schema_items(BASE, new) == []


def test_fields_schema_every_other_field_property():
    old = [_section("S", _field("f", "F", group="g1", column=0, help="h", badge="b"))]
    new = [
        _section(
            "S",
            _field(
                "f",
                "F",
                group="g2",
                column=1,
                help="h2",
                badge=None,
                readonly=True,
                hidden=True,
                config={"min": 1, "max": 5},
            ),
        )
    ]
    changed = [(i["property"], i["old"], i["new"]) for i in fields_schema_items(old, new)]
    assert changed == [
        ("readonly", False, True),
        ("group", "g1", "g2"),
        ("column", 0, 1),
        ("help", "h", "h2"),
        ("badge", "b", None),
        ("config", None, '{"max":5,"min":1}'),
        ("hidden", False, True),
    ]


def test_fields_schema_config_compared_as_json():
    old = [_section("S", _field("f", config={"a": 1, "b": [1, 2]}))]
    same = [_section("S", _field("f", config={"b": [1, 2], "a": 1}))]
    changed = [_section("S", _field("f", config={"a": 2}))]
    assert fields_schema_items(old, same) == []
    assert fields_schema_items(old, changed) == [
        {
            "kind": "field.changed",
            "section": "S",
            "field": "F",
            "property": "config",
            "old": '{"a":1,"b":[1,2]}',
            "new": '{"a":2}',
        }
    ]


def test_fields_schema_option_add_remove_rename_recolour_hide():
    new = copy.deepcopy(BASE)
    tier = new[1]["fields"][1]
    tier["options"] = [
        {"key": "gold", "label": "Golden", "color": "#ffaa00", "hidden": True},
        {"key": "new", "label": "New"},
    ]
    assert fields_schema_items(BASE, new) == [
        {"kind": "option.added", "field": "Tier", "option": "New"},
        {"kind": "option.removed", "field": "Tier", "option": "Old"},
        {"kind": "option.renamed", "field": "Tier", "old": "Gold", "new": "Golden"},
        {
            "kind": "option.changed",
            "field": "Tier",
            "option": "Golden",
            "property": "color",
            "old": "#ffd700",
            "new": "#ffaa00",
        },
        {
            "kind": "option.changed",
            "field": "Tier",
            "option": "Golden",
            "property": "hidden",
            "old": False,
            "new": True,
        },
    ]


def test_fields_schema_section_add_and_remove():
    new = copy.deepcopy(BASE)
    new.pop(2)
    new.append(_section("Risk", _field("risk", "Risk")))
    items = fields_schema_items(BASE, new)
    assert items == [
        {"kind": "section.added", "section": "Risk"},
        {"kind": "section.removed", "section": "Ops"},
        {"kind": "field.added", "section": "Risk", "field": "Risk", "type": "text"},
        {"kind": "field.removed", "section": "Ops", "field": "SLA"},
        {"kind": "field.removed", "section": "Ops", "field": "Owner"},
    ]


def test_fields_schema_section_rename_at_half_shared_keys():
    # Two of four field keys survive: 50 % of the larger section is a rename.
    old = [_section("Ops", _field("a"), _field("b"))]
    new = [_section("Operations", _field("a"), _field("b"), _field("c"), _field("d"))]
    assert fields_schema_items(old, new) == [
        {"kind": "section.renamed", "old": "Ops", "new": "Operations"},
        {"kind": "field.added", "section": "Operations", "field": "C", "type": "text"},
        {"kind": "field.added", "section": "Operations", "field": "D", "type": "text"},
    ]


def test_fields_schema_section_below_half_shared_keys_is_remove_and_add():
    old = [_section("Ops", _field("a"), _field("b"), _field("c"))]
    new = [_section("Operations", _field("a"), _field("x"), _field("y"))]
    assert fields_schema_items(old, new) == [
        {"kind": "section.added", "section": "Operations"},
        {"kind": "section.removed", "section": "Ops"},
        {"kind": "field.added", "section": "Operations", "field": "X", "type": "text"},
        {"kind": "field.added", "section": "Operations", "field": "Y", "type": "text"},
        {"kind": "field.removed", "section": "Ops", "field": "B"},
        {"kind": "field.removed", "section": "Ops", "field": "C"},
        {"kind": "field.moved", "field": "A", "from_section": "Ops", "to_section": "Operations"},
    ]


def test_fields_schema_rename_picks_the_best_candidate_and_skips_empty_sections():
    old = [_section("Ops", _field("a"), _field("b")), _section("Empty")]
    new = [
        _section("Half", _field("a"), _field("x")),
        _section("Full", _field("a"), _field("b")),
        _section("Blank"),
    ]
    items = fields_schema_items(old, new)
    assert items[:4] == [
        {"kind": "section.added", "section": "Half"},
        {"kind": "section.added", "section": "Blank"},
        {"kind": "section.removed", "section": "Empty"},
        {"kind": "section.renamed", "old": "Ops", "new": "Full"},
    ]


def test_fields_schema_rename_share_is_over_the_larger_section():
    # One shared key: half of the smaller section, a quarter of the larger.
    old = [_section("Ops", _field("a"), _field("b"))]
    new = [_section("Operations", _field("a"), _field("c"), _field("d"), _field("e"))]
    assert fields_schema_items(old, new)[:2] == [
        {"kind": "section.added", "section": "Operations"},
        {"kind": "section.removed", "section": "Ops"},
    ]


def test_fields_schema_rename_tie_goes_to_the_first_candidate():
    old = [_section("Ops", _field("a"), _field("b"))]
    new = [
        _section("First", _field("a"), _field("x")),
        _section("Second", _field("b"), _field("y")),
    ]
    assert fields_schema_items(old, new)[:2] == [
        {"kind": "section.added", "section": "Second"},
        {"kind": "section.renamed", "old": "Ops", "new": "First"},
    ]


def test_fields_schema_rename_never_reuses_a_paired_section():
    old = [_section("A", _field("a")), _section("B", _field("a"))]
    new = [_section("C", _field("a"))]
    items = fields_schema_items(old, new)
    assert items[:2] == [
        {"kind": "section.removed", "section": "B"},
        {"kind": "section.renamed", "old": "A", "new": "C"},
    ]


def test_fields_schema_section_reorder():
    new = [copy.deepcopy(BASE[2]), copy.deepcopy(BASE[0]), copy.deepcopy(BASE[1])]
    assert fields_schema_items(BASE, new) == [
        {"kind": "section.moved", "section": "__description", "from": 1, "to": 2},
        {"kind": "section.moved", "section": "Finance", "from": 2, "to": 3},
        {"kind": "section.moved", "section": "Ops", "from": 3, "to": 1},
    ]


def test_fields_schema_adding_a_section_first_moves_nothing():
    new = [_section("New"), *copy.deepcopy(BASE)]
    assert fields_schema_items(BASE, new) == [{"kind": "section.added", "section": "New"}]


def test_fields_schema_section_properties():
    old = [_section("S", _field("f"), columns=1, groups=["g"], defaultExpanded=True)]
    new = [
        _section("S", _field("f"), columns=2, groups=["g", "h"], defaultExpanded=False, hidden=True)
    ]
    assert fields_schema_items(old, new) == [
        {"kind": "section.changed", "section": "S", "property": p, "old": a, "new": b}
        for p, a, b in (
            ("columns", 1, 2),
            ("groups", ["g"], ["g", "h"]),
            ("defaultExpanded", True, False),
            ("hidden", False, True),
        )
    ]


def test_fields_schema_translations_on_section_field_and_option():
    old = [
        _section(
            "S",
            _field(
                "f",
                "F",
                "single_select",
                translations={"de": "Feld"},
                helpTranslations={"de": "Hilfe"},
                options=[{"key": "o", "label": "O", "translations": {"de": "A"}}],
            ),
            translations={"de": "Abschnitt"},
            groupTranslations={"g": {"de": "Gruppe"}},
        )
    ]
    new = [
        _section(
            "S",
            _field(
                "f",
                "F",
                "single_select",
                translations={"de": "Feld 2"},
                badgeTranslations={"fr": "Badge"},
                options=[{"key": "o", "label": "O", "translations": {}}],
            ),
            translations={"de": "Abschnitt", "fr": "Section"},
            groupTranslations={"h": {"fr": "Groupe"}},
        )
    ]
    assert fields_schema_items(old, new) == [
        {
            "kind": "translation.changed",
            "property": "option:O",
            "locale": "de",
            "old": "A",
            "new": None,
        },
        {
            "kind": "translation.changed",
            "property": "section:S",
            "locale": "fr",
            "old": None,
            "new": "Section",
        },
        {
            "kind": "translation.changed",
            "property": "group:g",
            "locale": "de",
            "old": "Gruppe",
            "new": None,
        },
        {
            "kind": "translation.changed",
            "property": "group:h",
            "locale": "fr",
            "old": None,
            "new": "Groupe",
        },
        {
            "kind": "translation.changed",
            "property": "field:F",
            "locale": "de",
            "old": "Feld",
            "new": "Feld 2",
        },
        {
            "kind": "translation.changed",
            "property": "field_help:F",
            "locale": "de",
            "old": "Hilfe",
            "new": None,
        },
        {
            "kind": "translation.changed",
            "property": "field_badge:F",
            "locale": "fr",
            "old": None,
            "new": "Badge",
        },
    ]


def test_fields_schema_field_in_renamed_section_is_not_moved():
    old = [_section("Ops", _field("a"), _field("b"))]
    new = [_section("Operations", _field("a", "A2"), _field("b"))]
    assert fields_schema_items(old, new) == [
        {"kind": "section.renamed", "old": "Ops", "new": "Operations"},
        {"kind": "field.renamed", "section": "Operations", "old": "A", "new": "A2"},
    ]


def test_fields_schema_a_field_key_in_two_sections_counts_once():
    old = [_section("S", _field("a")), _section("T", _field("a", "Dup"))]
    assert fields_schema_items(old, copy.deepcopy(old)) == []


# ── attributes_schema ─────────────────────────────────────────────────────


def test_attributes_schema_items():
    old = [
        _field(
            "usageType",
            "Usage",
            "single_select",
            options=[{"key": "owner", "label": "Owner"}],
            translations={"de": "Nutzung"},
        ),
        _field("note", "Note"),
    ]
    new = [
        _field("flow", "Flow", "single_select"),
        _field(
            "usageType",
            "Usage type",
            "single_select",
            required=True,
            options=[{"key": "owner", "label": "Owner"}, {"key": "user", "label": "User"}],
            translations={"de": "Nutzungsart"},
        ),
    ]
    assert attributes_schema_items(old, new) == [
        {"kind": "attribute.added", "attribute": "Flow", "type": "single_select"},
        {"kind": "attribute.removed", "attribute": "Note"},
        {"kind": "attribute.renamed", "old": "Usage", "new": "Usage type"},
        {
            "kind": "attribute.changed",
            "attribute": "Usage type",
            "property": "required",
            "old": False,
            "new": True,
        },
        {"kind": "option.added", "field": "Usage type", "option": "User"},
        {
            "kind": "translation.changed",
            "property": "field:Usage type",
            "locale": "de",
            "old": "Nutzung",
            "new": "Nutzungsart",
        },
    ]
    assert attributes_schema_items(old, copy.deepcopy(old)) == []
    assert attributes_schema_items("x", None) == []


# ── section_config ────────────────────────────────────────────────────────


# What ``custom:N`` indexes: the custom sections only — ``__description`` is
# not one of them (it renders inside Description).
NAMES = ["Finance", "Ops"]


def test_section_config_no_change_is_empty():
    cfg = {"__order": ["description", "custom:0"], "custom:0": {"hidden": True}}
    assert section_config_items(cfg, copy.deepcopy(cfg), NAMES) == []
    assert section_config_items(None, "x", None) == []


def test_section_config_order_resolves_custom_sections():
    old = {"__order": ["description", "custom:0", "custom:1", "relations"]}
    new = {
        "__order": ["custom:1", "description", "custom:0", "relations", "custom:2", "custom:x", 7]
    }
    assert section_config_items(old, new, NAMES) == [
        {
            "kind": "layout.reordered",
            "old": ["description", "Finance", "Ops", "relations"],
            "new": ["Ops", "description", "Finance", "relations", "custom:2", "custom:x", 7],
        }
    ]


def test_section_config_order_appearing_for_the_first_time():
    assert section_config_items({}, {"__order": ["custom:0", "lifecycle"]}, NAMES) == [
        {"kind": "layout.reordered", "old": None, "new": ["Finance", "lifecycle"]}
    ]


def test_section_config_section_flags_and_quality_weights():
    old = {
        "custom:1": {"hidden": False, "defaultExpanded": True},
        "lifecycle": {"hidden": True},
        "__dataQuality": {"lifecycle": 1, "description": 1},
    }
    new = {
        "custom:1": {"hidden": True, "defaultExpanded": True},
        "lifecycle": {},
        "tags": {"defaultExpanded": False},
        "__dataQuality": {"lifecycle": 0, "description": 1, "tags": 2},
    }
    assert section_config_items(old, new, NAMES) == [
        {
            "kind": "section.changed",
            "section": "Ops",
            "property": "hidden",
            "old": False,
            "new": True,
        },
        {
            "kind": "section.changed",
            "section": "lifecycle",
            "property": "hidden",
            "old": True,
            "new": False,
        },
        {
            "kind": "section.changed",
            "section": "tags",
            "property": "defaultExpanded",
            "old": True,
            "new": False,
        },
        {"kind": "quality_weight.changed", "component": "lifecycle", "old": 1, "new": 0},
        {"kind": "quality_weight.changed", "component": "tags", "old": None, "new": 2},
    ]


def test_section_config_absent_default_expanded_reads_as_expanded():
    # The first Card Layout save writes defaultExpanded / hidden explicitly for
    # every section; writing the rendered defaults is no change.
    old = {"custom:0": {}, "lifecycle": {}, "relations": {}}
    new = {
        "custom:0": {"defaultExpanded": True, "hidden": False},
        "lifecycle": {"defaultExpanded": True, "hidden": False},
        "relations": {"defaultExpanded": False, "hidden": False},
    }
    assert section_config_items(old, new, NAMES) == []


def test_section_config_absent_default_expanded_to_false_is_one_item():
    assert section_config_items({}, {"custom:0": {"defaultExpanded": False}}, NAMES) == [
        {
            "kind": "section.changed",
            "section": "Finance",
            "property": "defaultExpanded",
            "old": True,
            "new": False,
        }
    ]


def test_section_config_explicit_true_to_false_is_one_item():
    old = {"lifecycle": {"defaultExpanded": True}}
    new = {"lifecycle": {"defaultExpanded": False}}
    assert section_config_items(old, new, NAMES) == [
        {
            "kind": "section.changed",
            "section": "lifecycle",
            "property": "defaultExpanded",
            "old": True,
            "new": False,
        }
    ]


def test_section_config_relations_starts_collapsed():
    # Relations is the one section whose rendered default is collapsed.
    assert section_config_items({}, {"relations": {"defaultExpanded": True}}, NAMES) == [
        {
            "kind": "section.changed",
            "section": "relations",
            "property": "defaultExpanded",
            "old": False,
            "new": True,
        }
    ]


def test_fields_schema_section_defaults_are_no_change():
    old = [_section("S", _field("f"))]
    new = [_section("S", _field("f"), defaultExpanded=True, hidden=False)]
    assert fields_schema_items(old, new) == []
    collapsed = [_section("S", _field("f"), defaultExpanded=False)]
    assert fields_schema_items(old, collapsed) == [
        {
            "kind": "section.changed",
            "section": "S",
            "property": "defaultExpanded",
            "old": True,
            "new": False,
        }
    ]


# ── translations ──────────────────────────────────────────────────────────


def test_translations_items():
    old = {"label": {"de": "Anwendung", "fr": "Application"}, "description": {"de": "x"}}
    new = {"label": {"de": "Applikation", "fr": "Application"}, "reverse_label": {"it": "y"}}
    assert translations_items(old, new) == [
        {
            "kind": "translation.changed",
            "property": "label",
            "locale": "de",
            "old": "Anwendung",
            "new": "Applikation",
        },
        {
            "kind": "translation.changed",
            "property": "description",
            "locale": "de",
            "old": "x",
            "new": None,
        },
        {
            "kind": "translation.changed",
            "property": "reverse_label",
            "locale": "it",
            "old": None,
            "new": "y",
        },
    ]
    assert translations_items(old, copy.deepcopy(old)) == []
    assert translations_items(None, []) == []


# ── permissions ───────────────────────────────────────────────────────────


@pytest.mark.parametrize(
    ("old", "new", "states"),
    [
        ({"inventory.view": True}, {"inventory.view": False}, ("allow", "deny")),
        ({"inventory.view": False}, {"inventory.view": True}, ("deny", "allow")),
        ({"inventory.view": True}, {}, ("allow", "inherit")),
        ({}, {"inventory.view": True}, ("inherit", "allow")),
        ({"inventory.view": False}, {}, ("deny", "inherit")),
        ({}, {"inventory.view": False}, ("inherit", "deny")),
    ],
)
def test_role_permissions_every_transition(old, new, states):
    assert role_permissions_items({"viewer": old}, {"viewer": new}, {"viewer": "Viewer"}) == [
        {
            "kind": "type_permission.changed",
            "role": "Viewer",
            "permission": "inventory.view",
            "old": states[0],
            "new": states[1],
        }
    ]


def test_role_permissions_role_label_falls_back_to_key_and_no_op_is_empty():
    old = {"member": {"inventory.edit": True}}
    new = {"member": {"inventory.edit": True}, "custom": {"inventory.view": False}}
    assert role_permissions_items(old, new, {}) == [
        {
            "kind": "type_permission.changed",
            "role": "custom",
            "permission": "inventory.view",
            "old": "inherit",
            "new": "deny",
        }
    ]
    assert role_permissions_items(old, copy.deepcopy(old)) == []
    assert role_permissions_items(None, {"r": "junk"}, None) == []


def test_permission_items_grant_revoke_wildcard():
    old = {"inventory.view": True, "inventory.edit": True, "reports.view": False}
    new = {"inventory.view": True, "inventory.edit": False, "admin.users": True, "*": True}
    assert permission_items(old, new) == [
        {"kind": "permission.wildcard", "granted": True},
        {"kind": "permission.granted", "permission": "admin.users"},
        {"kind": "permission.revoked", "permission": "inventory.edit"},
    ]
    assert permission_items({"*": True}, {}) == [{"kind": "permission.wildcard", "granted": False}]
    assert permission_items(old, copy.deepcopy(old)) == []
    assert permission_items(None, None) == []


# ── portals ───────────────────────────────────────────────────────────────


def test_portal_filter_items():
    old = {"subtypes": ["app", "svc"], "tag_ids": ["t1"]}
    new = {"subtypes": ["svc", "app"], "tag_ids": ["t1", "t2", None]}
    assert portal_filter_items(
        old, new, subtype_labels={"app": "Application"}, tag_labels={"t1": "Gold", "t2": "Red"}
    ) == [
        {"kind": "portal_filter.changed", "filter": "tags", "old": ["Gold"], "new": ["Gold", "Red"]}
    ]
    assert portal_filter_items(
        None, {"subtypes": ["app", "svc"]}, subtype_labels={"app": "Application"}
    ) == [
        {
            "kind": "portal_filter.changed",
            "filter": "subtypes",
            "old": [],
            "new": ["Application", "svc"],
        }
    ]
    assert portal_filter_items(old, copy.deepcopy(old)) == []


def test_portal_card_config_items():
    old = {
        "toggles": {"description": {"card": True, "detail": True}, "cost": {"card": False}},
        "ppm": {"show_costs": True, "default_group_by": "Organization"},
        "show_logo": False,
    }
    new = {
        "toggles": {
            "description": {"card": False, "detail": True},
            "cost": {"card": False, "detail": True},
            "risk": {"card": True},
        },
        "ppm": {"show_costs": False, "default_group_by": "Organization"},
        "bpm": {"default_level": 3},
    }
    assert portal_card_config_items(old, new, item_labels={"cost": "Annual cost"}) == [
        {
            "kind": "portal_toggle.changed",
            "item": "description",
            "surface": "card",
            "old": True,
            "new": False,
        },
        {
            "kind": "portal_toggle.changed",
            "item": "Annual cost",
            "surface": "detail",
            "old": None,
            "new": True,
        },
        {
            "kind": "portal_toggle.changed",
            "item": "risk",
            "surface": "card",
            "old": None,
            "new": True,
        },
        {"kind": "portal_option.changed", "option": "ppm_show_costs", "old": True, "new": False},
        {"kind": "portal_option.changed", "option": "bpm_default_level", "old": None, "new": 3},
        {"kind": "portal_option.changed", "option": "show_logo", "old": False, "new": True},
    ]


def test_portal_card_config_unset_show_logo_reads_true_and_no_op_is_empty():
    assert portal_card_config_items(None, {"show_logo": True}) == []
    assert portal_card_config_items({"show_logo": True}, None) == []
    assert portal_card_config_items(None, {"show_logo": False}) == [
        {"kind": "portal_option.changed", "option": "show_logo", "old": True, "new": False}
    ]
    cfg = {"ppm": {"x": {"nested": 1}}, "toggles": {"a": {"card": True}}}
    assert portal_card_config_items(cfg, copy.deepcopy(cfg)) == []
    assert portal_card_config_items(
        cfg, {"ppm": {"x": {"nested": 2}}, **{"toggles": cfg["toggles"]}}
    ) == [
        {
            "kind": "portal_option.changed",
            "option": "ppm_x",
            "old": '{"nested":1}',
            "new": '{"nested":2}',
        }
    ]


# ── lists and caps ────────────────────────────────────────────────────────


def test_list_items():
    assert list_items(
        ["en", "de", "fr"],
        ["en", "fr", "da", "ar"],
        kind_added="locale.enabled",
        kind_removed="locale.disabled",
        arg="locale",
    ) == [
        {"kind": "locale.enabled", "locale": "da"},
        {"kind": "locale.enabled", "locale": "ar"},
        {"kind": "locale.disabled", "locale": "de"},
    ]
    assert (
        list_items(
            ["en"],
            ["en"],
            kind_added="locale.enabled",
            kind_removed="locale.disabled",
            arg="locale",
        )
        == []
    )
    assert (
        list_items(
            None, "en", kind_added="locale.enabled", kind_removed="locale.disabled", arg="locale"
        )
        == []
    )


def test_cap_items_at_and_above_the_limit():
    three = [item("locale.enabled", locale=c) for c in ("a", "b", "c")]
    assert cap_items(three, limit=3) == three
    assert cap_items(three, limit=3) is not three
    assert cap_items(three, limit=2) == [*three[:2], {"kind": "more", "count": 1}]
    many = [item("locale.enabled", locale=str(i)) for i in range(201)]
    capped = cap_items(many)
    assert len(capped) == 201
    assert capped[:200] == many[:200]
    assert capped[-1] == {"kind": "more", "count": 1}
    assert cap_items(many[:200]) == many[:200]


def test_every_item_produced_is_a_known_kind_with_flat_values():
    produced = (
        fields_schema_items(BASE, [])
        + fields_schema_items([], BASE)
        + permission_items({}, {"a": True, "*": True})
        + portal_card_config_items({}, {"ppm": {"x": [1, {"y": 2}]}})
    )
    for entry in produced:
        assert entry["kind"] in AUDIT_ITEM_KINDS
        for key, value in entry.items():
            assert ac._is_flat(value), (key, value)
