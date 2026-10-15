"""The card-type audit diff in ``api/v1/metamodel`` — pure helpers, no database.

Pins two naming rules a reviewer reads off a ``admin.metamodel.type.updated``
row: ``custom:N`` resolves to the N-th *custom* section (``__description`` is
not one), and a subtype's ``hidden_fields`` are named by field label.
"""

from __future__ import annotations

from app.api.v1.metamodel import _section_names, _type_audit_changes

SCHEMA = [
    {"section": "__description", "fields": [{"key": "alias", "label": "Alias"}]},
    {"section": "Finance", "fields": [{"key": "costTotalAnnual", "label": "Annual cost"}]},
    {"section": "Ops", "fields": [{"key": "sla", "label": "SLA"}]},
]


def _snapshot(**overrides):
    base = {
        "label": "Gizmo",
        "description": None,
        "icon": None,
        "color": None,
        "category": None,
        "has_hierarchy": False,
        "has_successors": False,
        "allow_card_logo": False,
        "sort_order": 0,
        "is_hidden": False,
        "reference_config": {},
        "subtypes": [],
        "hierarchy_labels": [],
        "fields_schema": SCHEMA,
        "stakeholder_roles": [],
        "section_config": {},
        "translations": {},
        "role_permissions": {},
    }
    return {**base, **overrides}


def test_section_names_skip_the_description_pseudo_section():
    assert _section_names(SCHEMA) == ["Finance", "Ops"]
    assert _section_names(None) == []


def test_custom_sections_resolve_to_their_own_names():
    before = _snapshot(section_config={"__order": ["description", "custom:0", "custom:1"]})
    after = _snapshot(
        section_config={
            "__order": ["description", "custom:1", "custom:0"],
            "custom:1": {"hidden": True},
        }
    )
    assert _type_audit_changes(before, after) == (
        {},
        [
            {
                "kind": "layout.reordered",
                "old": ["description", "Finance", "Ops"],
                "new": ["description", "Ops", "Finance"],
            },
            {
                "kind": "section.changed",
                "section": "Ops",
                "property": "hidden",
                "old": False,
                "new": True,
            },
        ],
    )


def test_subtype_hidden_fields_are_named_by_label():
    before = _snapshot(subtypes=[{"key": "saas", "label": "SaaS"}])
    after = _snapshot(
        subtypes=[{"key": "saas", "label": "SaaS", "hidden_fields": ["costTotalAnnual"]}]
    )
    assert _type_audit_changes(before, after) == (
        {},
        [
            {
                "kind": "subtype.changed",
                "label": "SaaS",
                "property": "hidden_fields",
                "old": [],
                "new": ["Annual cost"],
            }
        ],
    )


def test_subtype_hidden_fields_fall_back_to_the_before_side_then_the_key():
    # A field removed in the same save is named from the before-side schema;
    # a key no schema knows reads as itself.
    before = _snapshot(subtypes=[{"key": "saas", "label": "SaaS", "hidden_fields": ["sla"]}])
    after = _snapshot(
        fields_schema=[{"section": "Finance", "fields": [{"key": "sla", "label": "Uptime"}]}],
        subtypes=[{"key": "saas", "label": "SaaS", "hidden_fields": ["alias", "ghost"]}],
    )
    _, items = _type_audit_changes(before, after)
    assert [i for i in items if i["kind"] == "subtype.changed"] == [
        {
            "kind": "subtype.changed",
            "label": "SaaS",
            "property": "hidden_fields",
            "old": ["Uptime"],
            "new": ["Alias", "ghost"],
        }
    ]


def test_subtype_hidden_fields_absent_and_empty_are_the_same():
    before = _snapshot(subtypes=[{"key": "saas", "label": "SaaS"}])
    after = _snapshot(subtypes=[{"key": "saas", "label": "SaaS", "hidden_fields": []}])
    assert _type_audit_changes(before, after) == ({}, [])
