"""Tests for cost_field_filter helper."""

from __future__ import annotations

from app.services.cost_field_filter import (
    cost_field_keys_from_card_schema,
    cost_field_keys_from_relation_schema,
    keep_stored_cost_values,
    strip_costs_from_attributes,
    strip_costs_from_relation_attributes,
)


def test_card_schema_picks_only_cost_fields():
    schema = [
        {
            "section": "General",
            "fields": [
                {"key": "costTotalAnnual", "type": "cost"},
                {"key": "name", "type": "text"},
                {"key": "rating", "type": "single_select"},
            ],
        },
        {
            "section": "Other",
            "fields": [
                {"key": "costMonthly", "type": "cost"},
                {"key": "isActive", "type": "boolean"},
            ],
        },
    ]
    assert cost_field_keys_from_card_schema(schema) == frozenset({"costTotalAnnual", "costMonthly"})


def test_card_schema_handles_empty_and_invalid():
    assert cost_field_keys_from_card_schema(None) == frozenset()
    assert cost_field_keys_from_card_schema([]) == frozenset()
    assert cost_field_keys_from_card_schema("not a list") == frozenset()
    # Section with no fields key
    assert cost_field_keys_from_card_schema([{"section": "x"}]) == frozenset()


def test_relation_schema_picks_only_cost_fields():
    schema = [
        {"key": "technicalSuitability", "type": "single_select"},
        {"key": "costTotalAnnual", "type": "cost"},
    ]
    assert cost_field_keys_from_relation_schema(schema) == frozenset({"costTotalAnnual"})


def test_strip_costs_from_attributes_removes_only_cost_keys():
    schema = [
        {
            "section": "x",
            "fields": [
                {"key": "costTotalAnnual", "type": "cost"},
                {"key": "name", "type": "text"},
            ],
        }
    ]

    class FakeType:
        fields_schema = schema

    out = strip_costs_from_attributes(
        FakeType(), {"costTotalAnnual": 100, "name": "App", "extra": True}
    )
    assert out == {"name": "App", "extra": True}


def test_strip_costs_from_attributes_returns_copy_does_not_mutate():
    schema = [{"section": "x", "fields": [{"key": "costTotalAnnual", "type": "cost"}]}]

    class FakeType:
        fields_schema = schema

    src = {"costTotalAnnual": 100, "name": "App"}
    out = strip_costs_from_attributes(FakeType(), src)
    assert "costTotalAnnual" in src  # original untouched
    assert "costTotalAnnual" not in out


def test_strip_costs_passes_through_when_no_cost_fields():
    schema = [{"section": "x", "fields": [{"key": "name", "type": "text"}]}]

    class FakeType:
        fields_schema = schema

    attrs = {"name": "App"}
    assert strip_costs_from_attributes(FakeType(), attrs) == attrs


def test_strip_costs_handles_none_and_empty_attributes():
    class FakeType:
        fields_schema = [{"section": "x", "fields": [{"key": "costTotalAnnual", "type": "cost"}]}]

    assert strip_costs_from_attributes(FakeType(), None) == {}
    assert strip_costs_from_attributes(FakeType(), {}) == {}
    assert strip_costs_from_attributes(None, {"costTotalAnnual": 5}) == {"costTotalAnnual": 5}


def test_strip_costs_from_relation_attributes():
    class FakeRT:
        attributes_schema = [
            {"key": "technicalSuitability", "type": "single_select"},
            {"key": "costTotalAnnual", "type": "cost"},
        ]

    out = strip_costs_from_relation_attributes(
        FakeRT(), {"technicalSuitability": "fit", "costTotalAnnual": 42}
    )
    assert out == {"technicalSuitability": "fit"}


def test_redact_event_costs_both_shapes_and_passthrough():
    from app.services.cost_field_filter import redact_event_costs

    keys = frozenset({"costTotalAnnual"})
    data = {
        "id": "x",
        "changes": {
            "costTotalAnnual": {"old": 1, "new": 2},
            "cost_items": {"old": [], "new": ["a"]},
            "name": {"old": "a", "new": "b"},
            "attributes": {"old": {"costTotalAnnual": 1, "n": 1}, "new": {"costTotalAnnual": 2}},
        },
    }
    out = redact_event_costs(data, keys)
    assert out["changes"] == {
        "name": {"old": "a", "new": "b"},
        "attributes": {"old": {"n": 1}, "new": {}},
    }
    assert "costTotalAnnual" in data["changes"]  # input untouched
    assert redact_event_costs({"id": "x"}, keys) == {"id": "x"}
    assert redact_event_costs(None, keys) is None


# ── mutation hardening: redact_event_costs keeps the rest of the payload ──────────────────────


def test_redact_event_costs_keeps_the_other_payload_keys_and_non_dict_sides():
    from app.services.cost_field_filter import redact_event_costs

    data = {
        "source": "card_costs",
        "changes": {
            "costTotalAnnual": {"old": 1, "new": 2},
            "cost_items": {"old": [], "new": ["a"]},
            "name": {"old": "a", "new": "b"},
            "attributes": {"old": None, "new": {"costTotalAnnual": 2, "x": 1}},
        },
    }
    assert redact_event_costs(data, frozenset({"costTotalAnnual"})) == {
        "source": "card_costs",
        "changes": {
            "name": {"old": "a", "new": "b"},
            "attributes": {"old": None, "new": {"x": 1}},
        },
    }
    assert redact_event_costs(None, frozenset()) is None


def test_stored_costs_survive_and_the_rest_is_replaced():
    stored = {"costTotalAnnual": 100, "tier": "gold", "gone": True}
    incoming = {"tier": "silver", "new": 1}
    assert keep_stored_cost_values(stored, incoming, KEYS) == {
        "costTotalAnnual": 100,
        "tier": "silver",
        "new": 1,
    }


def test_an_incoming_cost_never_replaces_the_stored_one():
    assert keep_stored_cost_values(
        {"costTotalAnnual": 100}, {"costTotalAnnual": 1, "costBudget": 2}, KEYS
    ) == {"costTotalAnnual": 100}


def test_an_incoming_cost_is_dropped_even_when_nothing_is_stored_for_it():
    # Not shown the field, the caller cannot set it either.
    assert keep_stored_cost_values({"tier": "gold"}, {"costBudget": 2, "tier": "x"}, KEYS) == {
        "tier": "x"
    }


def test_a_stored_cost_that_is_empty_is_still_the_stored_value():
    assert keep_stored_cost_values({"costTotalAnnual": None, "costBudget": 0}, {}, KEYS) == {
        "costTotalAnnual": None,
        "costBudget": 0,
    }


def test_nothing_stored_at_all():
    assert keep_stored_cost_values(None, {"costBudget": 2, "tier": "x"}, KEYS) == {"tier": "x"}
    assert keep_stored_cost_values({}, {}, KEYS) == {}


def test_without_cost_keys_the_request_is_taken_whole():
    assert keep_stored_cost_values({"a": 1}, {"b": 2}, frozenset()) == {"b": 2}
    assert keep_stored_cost_values({"a": 1}, {"b": 2}, set()) == {"b": 2}


def test_neither_input_is_mutated():
    stored, incoming = {"costTotalAnnual": 100}, {"costTotalAnnual": 1, "tier": "x"}
    merged = keep_stored_cost_values(stored, incoming, KEYS)
    assert stored == {"costTotalAnnual": 100}
    assert incoming == {"costTotalAnnual": 1, "tier": "x"}
    assert merged is not incoming and merged is not stored


KEYS = frozenset({"costTotalAnnual", "costBudget"})
