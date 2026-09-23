"""The published diagram's colour legend: aggregate data only, mirroring the
frontend's `viewSource.ts` rules so the embedded key agrees with the app's."""

from __future__ import annotations

from app.models.card_type import CardType
from app.services.diagram_legend import legend_from_rows, normalise_view

CRITICALITY = {
    "key": "criticality",
    "label": "Criticality",
    "type": "single_select",
    "translations": {"de": "Kritikalität"},
    "weight": 3,
    "options": [
        {"key": "high", "label": "High", "color": "#ff0000", "translations": {"de": "Hoch"}},
        {"key": "low", "label": "Low", "color": "#00ff00"},
    ],
}


def _type(key: str, *, hidden: bool = False, fields=None, sort_order: int = 0) -> CardType:
    return CardType(
        key=key,
        label=key,
        translations={},
        fields_schema=[
            {"section": "Main", "fields": fields if fields is not None else [CRITICALITY]}
        ],
        is_hidden=hidden,
        sort_order=sort_order,
    )


class TestNormaliseView:
    def test_card_type_and_garbage_mean_no_legend(self):
        assert normalise_view(None) is None
        assert normalise_view("card_fields") is None
        assert normalise_view({"kind": "card_type"}) is None
        assert normalise_view({"kind": "card_fields", "fields": {"A": 3, "": "x"}}) is None

    def test_approval_status(self):
        assert normalise_view({"kind": "approval_status"}) == {"kind": "approval_status"}

    def test_legacy_singular_shape(self):
        assert normalise_view(
            {"kind": "card_field", "type_key": "Application", "field_key": "criticality"}
        ) == {"kind": "card_fields", "fields": {"Application": "criticality"}}

    def test_card_fields_drops_invalid_entries(self):
        view = normalise_view(
            {"kind": "card_fields", "fields": {"Application": "criticality", "__proto__": "x"}}
        )
        assert view == {"kind": "card_fields", "fields": {"Application": "criticality"}}


class TestLegendFromRows:
    VIEW = {"kind": "card_fields", "fields": {"Application": "criticality"}}

    def test_counts_matched_values_and_flags_missing_ones(self):
        legend = legend_from_rows(
            self.VIEW,
            [_type("Application")],
            [
                ("Application", "DRAFT", {"criticality": "high"}),
                ("Application", "DRAFT", {}),
                ("Application", "DRAFT", {"criticality": "unknown-option"}),
                ("ITComponent", "DRAFT", {"criticality": "high"}),  # no rule for this type
            ],
        )
        assert legend["kind"] == "card_fields"
        assert legend["coloured"] == 1
        assert legend["rules"] == [
            {"type_key": "Application", "field_key": "criticality", "has_missing": True}
        ]
        (t,) = legend["types"]
        (field,) = t["fields_schema"][0]["fields"]
        # Trimmed to what the legend renders — weights and the like stay home.
        assert set(field) == {"key", "label", "translations", "type", "options"}
        assert field["options"][0] == {
            "key": "high",
            "label": "High",
            "translations": {"de": "Hoch"},
            "color": "#ff0000",
        }

    def test_no_missing_flag_when_every_card_has_a_value(self):
        legend = legend_from_rows(
            self.VIEW, [_type("Application")], [("Application", None, {"criticality": "low"})]
        )
        assert legend["rules"][0]["has_missing"] is False

    def test_hidden_type_or_unknown_field_yields_no_legend(self):
        assert legend_from_rows(self.VIEW, [_type("Application", hidden=True)], []) is None
        assert legend_from_rows(self.VIEW, [_type("Application", fields=[])], []) is None
        assert legend_from_rows(self.VIEW, [], []) is None

    def test_approval_status_counts_cards_with_a_status(self):
        legend = legend_from_rows(
            {"kind": "approval_status"},
            [],
            [("Application", "APPROVED", {}), ("Application", "", {})],
        )
        assert legend == {"kind": "approval_status", "coloured": 1}

    def test_card_type_view_has_no_legend(self):
        assert legend_from_rows(None, [_type("Application")], []) is None
