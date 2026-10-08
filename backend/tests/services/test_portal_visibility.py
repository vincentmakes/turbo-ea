"""The portal-visibility rules mirror the public page's ``isVisible``.

Pure unit tests: no database. The relation-type loader is covered by the API
tests in ``tests/api/test_web_portals_public_shaping.py``.
"""

from __future__ import annotations

import pytest

from app.services import portal_visibility as pv

ON = {"card": True, "detail": True}
OFF = {"card": False, "detail": False}
CARD_ONLY = {"card": True, "detail": False}
DETAIL_ONLY = {"card": False, "detail": True}


class TestJsTruthy:
    @pytest.mark.parametrize("value", [None, False, 0, 0.0, "", float("nan")])
    def test_falsy(self, value):
        assert pv._js_truthy(value) is False

    @pytest.mark.parametrize("value", [True, 1, -1, 0.5, "x", {}, [], {"card": False}])
    def test_truthy(self, value):
        # Unlike Python, JavaScript treats an empty object or array as truthy.
        assert pv._js_truthy(value) is True


class TestPortalToggles:
    def test_reads_the_toggle_map(self):
        assert pv.portal_toggles({"toggles": {"tags": ON}}) == {"tags": ON}

    @pytest.mark.parametrize(
        "card_config",
        [None, [], "toggles", {}, {"toggles": None}, {"toggles": ["tags"]}],
    )
    def test_anything_else_is_no_toggles(self, card_config):
        assert pv.portal_toggles(card_config) == {}


class TestSentByDefault:
    def test_no_entry_is_sent(self):
        assert pv._sent_by_default({}, "tags") is True

    def test_a_falsy_entry_is_ignored(self):
        # The page falls back to its defaults, which always show in the dialog.
        for entry in (None, False, 0, ""):
            assert pv._sent_by_default({"tags": entry}, "tags") is True

    def test_an_entry_showing_it_anywhere_is_sent(self):
        assert pv._sent_by_default({"tags": CARD_ONLY}, "tags") is True
        assert pv._sent_by_default({"tags": DETAIL_ONLY}, "tags") is True

    def test_an_entry_showing_it_nowhere_is_not(self):
        assert pv._sent_by_default({"tags": OFF}, "tags") is False

    def test_an_empty_or_non_object_entry_shows_it_nowhere(self):
        # JavaScript reads {} and true as truthy, then entry.card is undefined.
        assert pv._sent_by_default({"tags": {}}, "tags") is False
        assert pv._sent_by_default({"tags": True}, "tags") is False
        assert pv._sent_by_default({"tags": {"card": 0, "detail": ""}}, "tags") is False


class TestPublicFieldsSchema:
    SCHEMA = [
        {
            "section": "Cost",
            "fields": [{"key": "costTotalAnnual"}, {"key": "name"}],
            "columns": 2,
        },
        "not a section",
        {"section": "Empty"},
    ]

    def test_strips_cost_fields_and_keeps_the_rest_of_each_section(self):
        out = pv.public_fields_schema(self.SCHEMA, frozenset({"costTotalAnnual"}))
        assert out == [
            {"section": "Cost", "fields": [{"key": "name"}], "columns": 2},
            "not a section",
            {"section": "Empty", "fields": []},
        ]

    def test_leaves_the_input_untouched(self):
        pv.public_fields_schema(self.SCHEMA, frozenset({"costTotalAnnual"}))
        assert self.SCHEMA[0]["fields"] == [{"key": "costTotalAnnual"}, {"key": "name"}]

    def test_without_cost_fields_it_is_the_schema(self):
        assert pv.public_fields_schema(self.SCHEMA, frozenset()) == self.SCHEMA

    def test_no_schema_is_empty(self):
        assert pv.public_fields_schema(None, frozenset()) == []
        assert pv.public_fields_schema(None, frozenset({"x"})) == []


class TestPublicFieldKeys:
    def test_collects_every_section(self):
        schema = [
            {"section": "__description", "fields": [{"key": "alias"}]},
            "junk",
            {"section": "Main", "fields": [{"key": "a"}, "junk", {"label": "no key"}, {"key": 1}]},
            {"section": "None"},
            {"section": "More", "fields": [{"key": "b"}]},
        ]
        assert pv.public_field_keys(schema) == frozenset({"alias", "a", "b"})


class TestExposedFieldKeys:
    KEYS = frozenset({"a", "b", "c", "d", "e"})

    def test_untoggled_fields_are_all_exposed(self):
        # Every field shows in the detail dialog unless toggled off there too.
        assert pv.exposed_field_keys({}, self.KEYS) == self.KEYS

    def test_a_field_hidden_in_both_places_is_not(self):
        exposed = pv.exposed_field_keys({"field:b": OFF, "field:e": OFF}, self.KEYS)
        assert exposed == frozenset({"a", "c", "d"})

    def test_shown_in_either_place_is_exposed(self):
        toggles = {"field:a": CARD_ONLY, "field:b": DETAIL_ONLY}
        assert pv.exposed_field_keys(toggles, self.KEYS) == self.KEYS

    def test_reads_the_field_prefix_only(self):
        # A built-in toggle with a field's name does not hide the field.
        assert pv.exposed_field_keys({"a": OFF}, frozenset({"a"})) == frozenset({"a"})


class TestExposedBuiltIns:
    def test_all_by_default(self):
        assert pv.exposed_built_ins({}) == frozenset(pv.BUILT_IN_TOGGLES)

    def test_stakeholders_follow_the_subscribers_toggle(self):
        assert "stakeholders" not in pv.exposed_built_ins({"subscribers": OFF})
        assert "stakeholders" in pv.exposed_built_ins({"subscribers": DETAIL_ONLY})

    def test_each_toggle_hides_its_own_key(self):
        for payload_key, toggle in pv.BUILT_IN_TOGGLES.items():
            exposed = pv.exposed_built_ins({toggle: OFF})
            assert exposed == frozenset(pv.BUILT_IN_TOGGLES) - {payload_key}

    def test_shown_on_the_tile_only_is_exposed(self):
        assert "approval_status" in pv.exposed_built_ins({"approval_status": CARD_ONLY})

    def test_reads_the_toggle_name_not_the_payload_key(self):
        assert "stakeholders" in pv.exposed_built_ins({"stakeholders": OFF})


class TestVisibleRelationTypeKeys:
    def test_no_default(self):
        assert pv.visible_relation_type_keys({}, ["r1"]) == frozenset()

    def test_shown_on_the_tile_or_in_the_dialog(self):
        toggles = {"rel:r1": CARD_ONLY, "rel:r2": DETAIL_ONLY, "rel:r3": OFF, "rel:r4": ON}
        visible = pv.visible_relation_type_keys(toggles, ["r1", "r2", "r3", "r4", "r5"])
        assert visible == frozenset({"r1", "r2", "r4"})

    @pytest.mark.parametrize("entry", [True, {}, {"card": 0}, {"detail": ""}, None])
    def test_malformed_entries_hide(self, entry):
        assert pv.visible_relation_type_keys({"rel:r1": entry}, ["r1"]) == frozenset()

    def test_only_the_offered_keys(self):
        assert pv.visible_relation_type_keys({"rel:other": ON}, ["r1"]) == frozenset()


class TestShapePublicItem:
    ITEM = {
        "id": "1",
        "name": "CRM",
        "description": "d",
        "lifecycle": {"active": "2024-01-01"},
        "attributes": {"a": 1, "b": 2},
        "approval_status": "APPROVED",
        "data_quality": 50.0,
        "tags": [{"id": "t"}],
        "stakeholders": [{"role": "r", "display_name": "n"}],
        "relations": [{"type": "r1"}, {"type": "r2"}],
    }

    def _shape(self, **overrides):
        kwargs = {
            "exposed_fields": frozenset({"a"}),
            "built_ins": frozenset(pv.BUILT_IN_TOGGLES),
            "visible_relation_types": frozenset({"r1"}),
        }
        kwargs.update(overrides)
        return pv.shape_public_item(self.ITEM, **kwargs)

    def test_keeps_exposed_values(self):
        shaped = self._shape()
        assert shaped["attributes"] == {"a": 1}
        assert shaped["relations"] == [{"type": "r1"}]
        for key in pv.BUILT_IN_TOGGLES:
            assert shaped[key] == self.ITEM[key]
        assert shaped["name"] == "CRM"

    def test_blanks_hidden_built_ins_keeping_their_shape(self):
        shaped = self._shape(built_ins=frozenset())
        assert shaped["description"] is None
        assert shaped["lifecycle"] is None
        assert shaped["approval_status"] is None
        assert shaped["data_quality"] is None
        assert shaped["tags"] == []
        assert shaped["stakeholders"] == []

    def test_leaves_the_input_untouched(self):
        self._shape(built_ins=frozenset())
        assert self.ITEM["attributes"] == {"a": 1, "b": 2}
        assert self.ITEM["description"] == "d"

    def test_tolerates_missing_collections(self):
        shaped = pv.shape_public_item(
            {"attributes": None, "relations": None},
            exposed_fields=frozenset({"a"}),
            built_ins=frozenset(pv.BUILT_IN_TOGGLES),
            visible_relation_types=frozenset({"r1"}),
        )
        assert shaped["attributes"] == {}
        assert shaped["relations"] == []


class TestPortalVisibility:
    def test_relation_types_reaching_a_type(self):
        vis = pv.PortalVisibility(
            exposed_fields=frozenset(),
            built_ins=frozenset({"tags"}),
            relation_types=frozenset({"b", "a", "c"}),
            relation_other_types={"b": "ITComponent", "a": "ITComponent", "c": "Provider"},
        )
        assert vis.relation_types_reaching("ITComponent") == ["a", "b"]
        assert vis.relation_types_reaching("Organization") == []
        assert vis.shows_built_in("tags") is True
        assert vis.shows_built_in("description") is False
