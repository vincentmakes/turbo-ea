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


# ---------------------------------------------------------------------------
# Visitor filters (#1425)
# ---------------------------------------------------------------------------

OPTS = [{"key": "a"}]

#: Every field type a visitor filter can and cannot read.
FILTER_SCHEMA = [
    {
        "section": "Main",
        "fields": [
            {"key": "single", "type": "single_select", "options": OPTS},
            {"key": "multi", "type": "multiple_select", "options": OPTS},
            {"key": "noOptions", "type": "single_select"},
            {"key": "emptyOptions", "type": "single_select", "options": []},
            {"key": "flag", "type": "boolean"},
            {"key": "code", "type": "text"},
            {"key": "notes", "type": "multiline_text"},
            {"key": "site", "type": "url"},
            {"key": "count", "type": "number"},
            {"key": "share", "type": "percentage"},
            {"key": "since", "type": "date"},
            {"key": "spend", "type": "cost"},
            {"key": "rating", "type": "ext.plus.rating"},
        ],
    },
    {
        "section": "Quiet",
        "hideInFilters": True,
        "fields": [
            {"key": "quietSelect", "type": "single_select", "options": OPTS},
            {"key": "quietText", "type": "text"},
            # Declared twice: the first section wins.
            {"key": "single", "type": "text"},
        ],
    },
    "junk",
    {
        "section": "Loud",
        "hideInFilters": "yes",
        "fields": [
            {"key": "loud", "type": "single_select", "options": OPTS},
            "junk",
            {"type": "text"},
        ],
    },
]

ALL_FIELDS = frozenset(
    f["key"]
    for s in FILTER_SCHEMA
    if isinstance(s, dict)
    for f in s["fields"]
    if isinstance(f, dict) and "key" in f
)


def _shape(**overrides):
    kwargs = {
        "exposed_fields": ALL_FIELDS,
        "has_subtypes": True,
        "shows_tags": True,
        "relation_types": frozenset({"r2", "r1"}),
    }
    kwargs.update(overrides)
    return kwargs


class TestFilterKind:
    @pytest.mark.parametrize(
        ("field_def", "kind"),
        [
            ({"type": "single_select", "options": OPTS}, "facet"),
            ({"type": "multiple_select", "options": OPTS}, "facet"),
            ({"type": "single_select"}, None),
            ({"type": "single_select", "options": []}, None),
            ({"type": "single_select", "options": "a"}, None),
            ({"type": "boolean"}, "facet"),
            ({"type": "text"}, "text"),
            ({"type": "multiline_text"}, "text"),
            ({"type": "url"}, "text"),
            ({"type": "number"}, "number"),
            ({"type": "percentage"}, "number"),
            ({"type": "date"}, "date"),
            ({"type": "cost"}, None),
            ({"type": "ext.plus.rating"}, None),
            ({}, None),
            ("text", None),
        ],
    )
    def test_kinds(self, field_def, kind):
        assert pv.filter_kind(field_def) == kind


class TestPublishableFilters:
    def test_every_filterable_published_field_subtype_tags_and_relations(self):
        assert pv.publishable_filters(FILTER_SCHEMA, **_shape()) == [
            "subtype",
            "tags",
            "field:single",
            "field:multi",
            "field:flag",
            "field:code",
            "field:notes",
            "field:site",
            "field:count",
            "field:share",
            "field:since",
            "field:quietSelect",
            "field:quietText",
            "field:loud",
            "rel:r1",
            "rel:r2",
        ]

    def test_an_unpublished_field_is_not(self):
        exposed = ALL_FIELDS - {"code", "single"}
        out = pv.publishable_filters(FILTER_SCHEMA, **_shape(exposed_fields=exposed))
        assert "field:code" not in out
        assert "field:single" not in out
        assert "field:multi" in out

    def test_a_cost_field_never_is_even_when_exposed(self):
        assert "field:spend" not in pv.publishable_filters(FILTER_SCHEMA, **_shape())

    def test_a_cost_field_is_neither_published_nor_a_default(self):
        """Called directly — ``load_portal_visibility`` strips cost fields
        first — a cost field in the schema and in ``exposed_fields`` is still
        never offered, in either list."""
        schema = [{"fields": [{"key": "spend", "type": "cost"}]}]
        shape = _shape(exposed_fields=frozenset({"spend"}), relation_types=frozenset())
        assert pv.publishable_filters(schema, **shape) == ["subtype", "tags"]
        assert pv.default_shown_filters(schema, **shape) == ["subtype", "tags"]

    def test_no_subtypes_no_tags_no_relations(self):
        out = pv.publishable_filters(
            FILTER_SCHEMA,
            **_shape(has_subtypes=False, shows_tags=False, relation_types=frozenset()),
        )
        assert "subtype" not in out
        assert "tags" not in out
        assert not [k for k in out if k.startswith("rel:")]
        assert out[0] == "field:single"

    def test_no_schema(self):
        assert pv.publishable_filters(None, **_shape(relation_types=frozenset())) == [
            "subtype",
            "tags",
        ]


class TestDefaultShownFilters:
    def test_the_legacy_bar_minus_hidden_sections(self):
        # Selects with options only: no boolean, no text / number / date field;
        # and none of a section hidden from filters ("yes" is not true).
        assert pv.default_shown_filters(FILTER_SCHEMA, **_shape()) == [
            "subtype",
            "tags",
            "field:single",
            "field:multi",
            "field:loud",
            "rel:r1",
            "rel:r2",
        ]

    def test_a_hidden_field_is_not_shown(self):
        out = pv.default_shown_filters(
            FILTER_SCHEMA, **_shape(exposed_fields=ALL_FIELDS - {"multi"})
        )
        assert "field:multi" not in out
        assert "field:single" in out

    def test_tags_only_when_shown(self):
        assert "tags" not in pv.default_shown_filters(FILTER_SCHEMA, **_shape(shows_tags=False))

    def test_subtype_only_with_subtypes(self):
        out = pv.default_shown_filters(FILTER_SCHEMA, **_shape(has_subtypes=False))
        assert out[0] == "tags"


class TestVisitorFilterLists:
    PUBLISHABLE = ["subtype", "tags", "field:a", "field:b", "rel:r"]
    DEFAULT = ["subtype", "field:a"]

    def _lists(self, card_config):
        return pv.visitor_filter_lists(
            card_config, publishable=self.PUBLISHABLE, default=self.DEFAULT
        )

    @pytest.mark.parametrize(
        "card_config",
        [None, {}, "junk", {"visitor_filters": None}, {"visitor_filters": "field:b"}],
    )
    def test_no_list_is_the_default(self, card_config):
        lists = self._lists(card_config)
        assert lists.shown == ("subtype", "field:a")
        assert lists.allowed == tuple(self.PUBLISHABLE)
        assert lists.can_add is True

    def test_the_list_within_publishable_in_publishable_order(self):
        lists = self._lists({"visitor_filters": ["rel:r", "field:gone", 3, "field:b", "tags"]})
        assert lists.shown == ("tags", "field:b", "rel:r")

    def test_an_empty_list_shows_nothing(self):
        assert self._lists({"visitor_filters": []}).shown == ()

    def test_adding_off_allows_the_shown_only(self):
        lists = self._lists({"visitor_filters": ["field:b"], "visitor_can_add_filters": False})
        assert lists.can_add is False
        assert lists.allowed == ("field:b",)

    @pytest.mark.parametrize("value", [True, None, 0, "false"])
    def test_only_false_switches_adding_off(self, value):
        lists = self._lists({"visitor_can_add_filters": value})
        assert lists.can_add is True
        assert lists.allowed == tuple(self.PUBLISHABLE)

    def test_a_cost_field_never_appears(self):
        """Publishable never holds a cost field, so a listed one drops out."""
        publishable = pv.publishable_filters(FILTER_SCHEMA, **_shape())
        lists = pv.visitor_filter_lists(
            {"visitor_filters": ["field:spend", "field:code"]},
            publishable=publishable,
            default=[],
        )
        assert lists.shown == ("field:code",)
        assert "field:spend" not in lists.allowed

    def test_payload(self):
        lists = pv.VisitorFilterLists(shown=("tags",), allowed=("tags", "subtype"), can_add=True)
        assert lists.as_payload() == {
            "shown": ["tags"],
            "allowed": ["tags", "subtype"],
            "can_add": True,
        }

    def test_the_empty_lists_allow_nothing(self):
        assert pv.VisitorFilterLists().as_payload() == {
            "shown": [],
            "allowed": [],
            "can_add": False,
        }


class TestFilterableRelationTypes:
    def _vis(self, allowed):
        return pv.PortalVisibility(
            exposed_fields=frozenset(),
            built_ins=frozenset(),
            relation_types=frozenset({"a", "b", "c"}),
            relation_other_types={"a": "ITComponent", "b": "ITComponent", "c": "Provider"},
            visitor_filters=pv.VisitorFilterLists(allowed=allowed),
        )

    def test_only_the_allowed_relation_types_reaching_the_type(self):
        vis = self._vis(("rel:b", "rel:c", "field:a"))
        assert pv.filterable_relation_types(vis, "ITComponent") == ["b"]
        assert pv.filterable_relation_types(vis, "Provider") == ["c"]

    def test_nothing_allowed_nothing_listed(self):
        assert pv.filterable_relation_types(self._vis(()), "ITComponent") == []


class TestIsFilterKey:
    @pytest.mark.parametrize("key", ["subtype", "tags", "field:a", "rel:r"])
    def test_vocabulary(self, key):
        assert pv.is_filter_key(key) is True

    @pytest.mark.parametrize("key", ["field:", "rel:", "description", "a", "", 1, None, "x:y"])
    def test_anything_else(self, key):
        assert pv.is_filter_key(key) is False


class TestNormaliseVisitorFilterConfig:
    def test_list_kept_normalised_and_deduplicated(self):
        out = pv.normalise_visitor_filter_config(
            {"toggles": {}, "visitor_filters": ["tags", "bogus", 3, "field:a", "tags"]},
            "cards",
        )
        assert out == {"toggles": {}, "visitor_filters": ["tags", "field:a"]}

    def test_an_empty_list_is_kept(self):
        out = pv.normalise_visitor_filter_config({"visitor_filters": []}, "cards")
        assert out == {"visitor_filters": []}

    def test_adding_kept_only_when_off(self):
        off = pv.normalise_visitor_filter_config({"visitor_can_add_filters": False}, "cards")
        on = pv.normalise_visitor_filter_config({"visitor_can_add_filters": True}, "cards")
        assert off == {"visitor_can_add_filters": False}
        assert on == {}

    def test_a_board_drops_both(self):
        cfg = {"ppm": {}, "visitor_filters": ["tags"], "visitor_can_add_filters": False}
        out = pv.normalise_visitor_filter_config(cfg, "ppm_portfolio")
        assert out == {"ppm": {}}
        # The input is left as it was.
        assert cfg["visitor_filters"] == ["tags"]

    @pytest.mark.parametrize("raw", ["tags", {"tags": True}, 3])
    def test_a_non_list_is_refused(self, raw):
        with pytest.raises(ValueError) as exc:
            pv.normalise_visitor_filter_config({"visitor_filters": raw}, "cards")
        # The route returns this text as the 422 detail, so it is pinned whole.
        assert str(exc.value) == "card_config.visitor_filters must be a list of filter keys"

    @pytest.mark.parametrize("raw", ["false", 0, []])
    def test_a_non_boolean_switch_is_refused(self, raw):
        with pytest.raises(ValueError) as exc:
            pv.normalise_visitor_filter_config({"visitor_can_add_filters": raw}, "cards")
        assert str(exc.value) == "card_config.visitor_can_add_filters must be true or false"

    @pytest.mark.parametrize("card_config", [None, "junk", []])
    def test_not_an_object_is_left_alone(self, card_config):
        assert pv.normalise_visitor_filter_config(card_config, "cards") == card_config

    def test_null_keys_are_dropped(self):
        out = pv.normalise_visitor_filter_config(
            {"visitor_filters": None, "visitor_can_add_filters": None, "show_logo": False},
            "cards",
        )
        assert out == {"show_logo": False}
