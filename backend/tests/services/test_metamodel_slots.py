"""``metamodel_strings``: the slot builders, the readers and the writers on
plain records — every slot kind's exact key, English and path, the
``translations["en"]`` override at every level, and the entries the review
lists. No database.
"""

from __future__ import annotations

from types import SimpleNamespace

from app.services import metamodel_strings as mm

EN = {"en": "EN", "de": "DE"}


def full_card_type() -> dict:
    """A card type with every translatable thing, each carrying an English
    override that differs from its label, and junk entries before each good
    one (a skipped entry never stops the ones after it)."""
    return {
        "key": "W.1",
        "label": "Widget",
        "description": "Desc",
        "translations": {"label": {"en": "Widget EN"}, "description": {"en": "Desc EN"}},
        "subtypes": [
            "junk",
            {"label": "no key"},
            {"key": "s", "label": "Small", "translations": {"en": "Small EN"}},
        ],
        "hierarchy_labels": [
            "junk",
            {"label": "no key"},
            {"key": "h", "label": "Part", "translations": {"en": "Part EN"}},
        ],
        "fields_schema": [
            "junk",
            {"section": "  ", "fields": []},
            {
                "section": "Sec",
                "translations": {"en": "Sec EN"},
                "groupTranslations": {"Declared": {"de": "x"}, " ": {}},
                "fields": [
                    "junk",
                    {"label": "no key"},
                    {
                        "key": "f",
                        "label": "Field",
                        "translations": {"en": "Field EN"},
                        "help": "Help",
                        "helpTranslations": {"en": "Help EN"},
                        "badge": "Badge",
                        "badgeTranslations": {"en": "Badge EN"},
                        "group": "Used",
                        "options": [
                            "junk",
                            {"label": "no key"},
                            {"key": "o", "label": "Opt", "translations": {"en": "Opt EN"}},
                        ],
                    },
                ],
            },
            {"section": "Plain", "fields": [{"key": "g", "label": "G"}]},
        ],
    }


def full_relation() -> dict:
    return {
        "key": "r",
        "label": "uses",
        "reverse_label": "is used by",
        "translations": {"label": {"en": "uses EN"}, "reverse_label": {"en": "used EN"}},
        "attributes_schema": [
            "junk",
            {"label": "no key"},
            {
                "key": "a",
                "label": "Attr",
                "translations": {"en": "Attr EN"},
                "options": [{"key": "x", "label": "X", "translations": {"en": "X EN"}}],
            },
        ],
    }


def triples(slots):
    return [(s.key, s.english, s.column, s.path) for s in slots]


class TestCardTypeSlots:
    def test_every_slot_kind(self):
        assert triples(mm.card_type_slots(full_card_type())) == [
            ("type.W%2E1.label", "Widget EN", "translations", ("label",)),
            ("type.W%2E1.description", "Desc EN", "translations", ("description",)),
            ("type.W%2E1.subtype.s", "Small EN", "subtypes", (2, "translations")),
            ("type.W%2E1.hierarchy.h", "Part EN", "hierarchy_labels", (2, "translations")),
            ("type.W%2E1.section.Sec", "Sec EN", "fields_schema", (2, "translations")),
            (
                "type.W%2E1.section.Sec.group.Used",
                "Used",
                "fields_schema",
                (2, "groupTranslations", "Used"),
            ),
            (
                "type.W%2E1.section.Sec.group.Declared",
                "Declared",
                "fields_schema",
                (2, "groupTranslations", "Declared"),
            ),
            (
                "type.W%2E1.field.f",
                "Field EN",
                "fields_schema",
                (2, "fields", 2, "translations"),
            ),
            (
                "type.W%2E1.field.f.help",
                "Help EN",
                "fields_schema",
                (2, "fields", 2, "helpTranslations"),
            ),
            (
                "type.W%2E1.field.f.badge",
                "Badge EN",
                "fields_schema",
                (2, "fields", 2, "badgeTranslations"),
            ),
            (
                "type.W%2E1.field.f.option.o",
                "Opt EN",
                "fields_schema",
                (2, "fields", 2, "options", 2, "translations"),
            ),
            ("type.W%2E1.section.Plain", "Plain", "fields_schema", (3, "translations")),
            ("type.W%2E1.field.g", "G", "fields_schema", (3, "fields", 0, "translations")),
        ]

    def test_without_english_overrides_the_labels_are_english(self):
        rec = {
            "key": "T",
            "label": "Type",
            "description": "About",
            "translations": {"label": {"de": "Typ"}, "description": {"de": "Über"}},
            "fields_schema": [{"section": "S", "translations": {"de": "Abschnitt"}, "fields": []}],
        }
        assert [s.english for s in mm.card_type_slots(rec)] == ["Type", "About", "S"]


class TestRelationSlots:
    def test_every_slot_kind(self):
        assert triples(mm.relation_slots(full_relation())) == [
            ("relation.r.label", "uses EN", "translations", ("label",)),
            ("relation.r.reverse_label", "used EN", "translations", ("reverse_label",)),
            ("relation.r.attr.a", "Attr EN", "attributes_schema", (2, "translations")),
            (
                "relation.r.attr.a.option.x",
                "X EN",
                "attributes_schema",
                (2, "options", 0, "translations"),
            ),
        ]

    def test_without_translations(self):
        rec = {"key": "r", "label": "uses", "reverse_label": "is used by", "translations": None}
        assert [s.english for s in mm.relation_slots(rec)] == ["uses", "is used by"]


class TestFlatSlots:
    def test_a_blank_label_makes_no_slot(self):
        assert mm.flat_slot("category.x", "  ") == []
        assert mm.flat_slot("category.x", None) == []

    def test_the_label_is_the_english(self):
        assert triples(mm.flat_slot("category.x", " Layer ")) == [
            ("category.x", "Layer", "translations", ())
        ]


class TestUnescape:
    def test_a_lower_case_escape_reads_as_a_dot(self):
        assert mm.split_key("type.a%2eb.label") == ["type", "a.b", "label"]
        assert mm.unescape_segment("a%2Eb%25c") == "a.b%c"


def record(**columns):
    return SimpleNamespace(**columns)


class TestLocaleMap:
    def slot(self, column, path):
        return mm.Slot("k", "E", column, path)

    def test_reads_through_lists_and_dicts(self):
        obj = record(subtypes=[{"translations": {"nl": "x"}}])
        assert mm.locale_map(obj, self.slot("subtypes", (0, "translations"))) == {"nl": "x"}

    def test_an_index_past_the_end_is_none(self):
        obj = record(subtypes=[{"translations": {}}])
        assert mm.locale_map(obj, self.slot("subtypes", (1, "translations"))) is None

    def test_an_index_into_a_dict_is_none(self):
        obj = record(subtypes={"0": {"translations": {}}})
        assert mm.locale_map(obj, self.slot("subtypes", (0, "translations"))) is None

    def test_a_key_into_a_list_is_none(self):
        obj = record(translations=[{"label": {}}])
        assert mm.locale_map(obj, self.slot("translations", ("label",))) is None

    def test_a_map_that_is_not_a_dict_is_none(self):
        obj = record(translations={"label": "just text"})
        assert mm.locale_map(obj, self.slot("translations", ("label",))) is None


class TestWriteSlotEdges:
    def test_a_missing_column_starts_a_map(self):
        obj = record(translations=None)
        slot = mm.Slot("type.T.label", "T", "translations", ("label",))
        assert mm._write_slot(obj, slot, "nl", "Ding") is True
        assert obj.translations == {"label": {"nl": "Ding"}}

    def test_clearing_the_last_group_drops_the_group_map(self):
        obj = record(fields_schema=[{"section": "S", "groupTranslations": {"G": {"nl": "x"}}}])
        slot = mm.Slot("k", "G", "fields_schema", (0, "groupTranslations", "G"))
        assert mm._write_slot(obj, slot, "nl", None) is True
        assert obj.fields_schema == [{"section": "S"}]

    def test_clearing_keeps_a_map_another_locale_still_uses(self):
        obj = record(translations={"label": {"nl": "x", "de": "y"}})
        slot = mm.Slot("k", "E", "translations", ("label",))
        mm._write_slot(obj, slot, "nl", None)
        assert obj.translations == {"label": {"de": "y"}}


class TestEntries:
    def snapshot(self, *records_, lifecycle=None):
        snap = mm.Snapshot()
        for obj, slots in records_:
            snap.records.append((obj, slots))
        snap.lifecycle = lifecycle or {}
        return snap

    def test_the_first_slot_of_a_key_wins_and_later_keys_still_count(self):
        first = record(translations={"nl": "Eerste"})
        second = record(translations={"nl": "Tweede"})
        other = record(translations={"nl": "Ander"})
        snap = self.snapshot(
            (first, [mm.Slot("k", "K", "translations", ())]),
            (second, [mm.Slot("k", "K", "translations", ())]),
            (other, [mm.Slot("other", "O", "translations", ())]),
        )
        assert [(e.key, e.value) for e in mm.entries(snap, "nl")] == [
            ("k", "Eerste"),
            ("other", "Ander"),
        ]

    def test_empty_or_non_text_values_are_no_translation(self):
        snap = self.snapshot(
            (record(translations={"nl": ""}), [mm.Slot("a", "A", "translations", ())]),
            (record(translations={"nl": 5}), [mm.Slot("b", "B", "translations", ())]),
            lifecycle={"lifecycle.plan": "Plan", "lifecycle.active": "Active"},
        )
        found = {
            e.key: e.value
            for e in mm.entries(snap, "nl", {"lifecycle.plan": "", "lifecycle.active": 5})
        }
        assert found == {"a": None, "b": None, "lifecycle.plan": None, "lifecycle.active": None}

    def test_lifecycle_values_come_from_the_pack(self):
        snap = self.snapshot(lifecycle={"lifecycle.plan": "Plan"})
        (entry,) = mm.entries(snap, "nl", {"lifecycle.plan": "Gepland"})
        assert (entry.key, entry.english, entry.value) == ("lifecycle.plan", "Plan", "Gepland")


class TestOverlay:
    def test_a_phase_without_english_does_not_stop_the_next(self):
        out = mm.overlay_phase_help(
            {"plan": {"de": "nur de"}, "active": {"en": "Active"}},
            {"nl": {"lifecycle.plan": "Gepland", "lifecycle.active": "Actief"}},
        )
        assert out == {"plan": {"de": "nur de"}, "active": {"en": "Active", "nl": "Actief"}}
