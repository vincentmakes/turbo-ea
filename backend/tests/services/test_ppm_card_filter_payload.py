"""The PPM board's filter data is an opt-in projection of the portfolio payload.

Pure functions, no database: ``card_filter_payload`` keeps exactly the keys the
reports' client-side matcher reads and passes their values through unchanged;
``empty_filter_payload`` is what an install without an Initiative type gets.
"""

from __future__ import annotations

from app.services.ppm_portfolio_service import (
    FILTER_ITEM_KEYS,
    card_filter_payload,
    empty_filter_payload,
)

RELATION = {
    "relation_type": "relInitiativeToOrganization",
    "direction": "outgoing",
    "related_id": "org-1",
    "related_name": "Finance",
    "related_type": "Organization",
    "attributes": {"share": 40},
}

ITEM_A = {
    "id": "init-a",
    "name": "Alpha",
    "subtype": "Program",
    "attributes": {"costBudget": 1200, "businessValue": "high"},
    "lifecycle": {"active": "2026-01-01"},
    "relations": [RELATION],
    "org_ids": ["org-1"],
    "tag_ids": ["tag-1", "tag-2"],
}

ITEM_B = {
    "id": "init-b",
    "name": "Beta",
    "subtype": None,
    "attributes": {},
    "lifecycle": {},
    "relations": [],
    "org_ids": [],
    "tag_ids": [],
}

RELATION_TYPES = [{"key": "relInitiativeToOrganization", "other_type_key": "Organization"}]
GROUPABLE = {"Organization": [{"id": "org-1", "name": "Finance", "parent_id": None}]}
TAG_GROUPS = [{"id": "tg-1", "name": "Theme", "mode": "multi", "tags": [{"id": "tag-1"}]}]

PAYLOAD = {
    "items": [ITEM_A, ITEM_B],
    "fields_schema": [{"section": "s", "fields": [{"key": "costBudget"}]}],
    "relation_types": RELATION_TYPES,
    "groupable_types": GROUPABLE,
    "organizations": [{"id": "org-1", "name": "Finance"}],
    "tag_groups": TAG_GROUPS,
}


def test_filter_item_keys_are_what_the_matcher_reads():
    assert FILTER_ITEM_KEYS == ("id", "name", "subtype", "attributes", "relations", "tag_ids")


def test_top_level_keeps_exactly_the_four_collections():
    out = card_filter_payload(PAYLOAD)
    assert set(out) == {"items", "relation_types", "groupable_types", "tag_groups"}
    assert "fields_schema" not in out
    assert "organizations" not in out
    assert out["relation_types"] == RELATION_TYPES
    assert out["groupable_types"] == GROUPABLE
    assert out["tag_groups"] == TAG_GROUPS


def test_items_keep_only_the_filter_keys_with_values_unchanged():
    out = card_filter_payload(PAYLOAD)
    assert out["items"] == [
        {
            "id": "init-a",
            "name": "Alpha",
            "subtype": "Program",
            "attributes": {"costBudget": 1200, "businessValue": "high"},
            "relations": [RELATION],
            "tag_ids": ["tag-1", "tag-2"],
        },
        {
            "id": "init-b",
            "name": "Beta",
            "subtype": None,
            "attributes": {},
            "relations": [],
            "tag_ids": [],
        },
    ]
    for item in out["items"]:
        assert set(item) == set(FILTER_ITEM_KEYS)
        assert "lifecycle" not in item
        assert "org_ids" not in item


def test_the_input_payload_is_left_untouched():
    card_filter_payload(PAYLOAD)
    assert set(PAYLOAD["items"][0]) == set(ITEM_A)
    assert "fields_schema" in PAYLOAD


def test_no_items_projects_to_no_items():
    out = card_filter_payload({**PAYLOAD, "items": []})
    assert out["items"] == []
    assert out["tag_groups"] == TAG_GROUPS


def test_empty_filter_payload_shape():
    assert empty_filter_payload() == {
        "items": [],
        "relation_types": [],
        "groupable_types": {},
        "tag_groups": [],
    }
