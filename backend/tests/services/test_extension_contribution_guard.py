"""The pure write guard on an extension's card-type contributions.

`contribution_guard` is shared by the metamodel save and the workspace import;
the route- and import-level behaviour is covered in
`tests/api/test_metamodel_ext_contributions.py` and
`tests/services/test_workspace_applier_exact.py`. These pin the exact output of
each helper, malformed entries included.
"""

from __future__ import annotations

import copy

from app.services.extensions import contribution_guard as g
from app.services.extensions.registry import ExtensionInfo, ExtensionRegistry

K = "sample-ext"
ACTIVE = frozenset({K, "k2"})


def fd(key, ext=None, **extra):
    out = {"key": key, "label": key.upper(), "type": "text", **extra}
    if ext:
        out["ext"] = ext
    return out


def sec(name, fields, ext=None, **extra):
    out = {"section": name, "fields": fields, **extra}
    if ext:
        out["ext"] = ext
    return out


def shape(schema):
    return [
        (s.get("section"), s.get("ext"), [(f.get("key"), f.get("ext")) for f in s["fields"]])
        if isinstance(s, dict) and isinstance(s.get("fields"), list)
        else s
        for s in schema
    ]


class TestActiveExtensionKeys:
    def test_installed_and_enabled_whatever_the_licence(self):
        reg = ExtensionRegistry()
        reg.load_installed(
            [
                ExtensionInfo(key="a", name="a", version="1", status="installed", enabled=True),
                ExtensionInfo(key="b", name="b", version="1", status="failed", enabled=True),
                ExtensionInfo(key="c", name="c", version="1", status="needs_restart", enabled=True),
                ExtensionInfo(key="d", name="d", version="1", status="disabled", enabled=True),
                ExtensionInfo(key="e", name="e", version="1", status="removed", enabled=True),
                ExtensionInfo(key="f", name="f", version="1", status="installed", enabled=False),
            ]
        )
        assert g.active_extension_keys(reg) == frozenset({"a", "b", "c"})


class TestSchemaStamps:
    def test_stamps_follow_the_stored_ones_and_flags_are_stripped(self):
        stored = [sec("A", [fd("a")]), sec("E", [fd("x", K)], K)]
        body = [
            sec("A", [fd("a", K, ext_protected=True)], K, ext_protected=True),
            sec("E", [fd("x", ext_locked=True)]),
        ]
        before = copy.deepcopy(body)
        out = g.preserve_ext_schema(body, stored, ACTIVE)
        assert out.schema == [sec("A", [fd("a")]), sec("E", [fd("x", K)], K)]
        assert body == before  # the input is never mutated
        assert (out.body_to_final, out.stored_to_final, out.restored, out.inserted) == (
            {0: 0, 1: 1},
            {0: 0, 1: 1},
            [],
            False,
        )

    def test_save_strips_a_stamp_on_a_new_key_import_keeps_it(self):
        body = [sec("New", [fd("n", "x-ext"), fd("m")], "x-ext"), sec("Bare", [fd("b")], "x-ext")]
        saved = g.preserve_ext_schema(body, [], ACTIVE).schema
        assert shape(saved) == [
            ("New", None, [("n", None), ("m", None)]),
            ("Bare", None, [("b", None)]),
        ]
        imported = g.preserve_ext_schema(
            body, [sec("Old", [fd("b")])], ACTIVE, mode="import"
        ).schema
        # The new key keeps its stamp and so does its section; a section with
        # nothing but a key this instance holds unstamped does not.
        assert shape(imported) == [
            ("New", "x-ext", [("n", "x-ext"), ("m", None)]),
            ("Bare", None, [("b", None)]),
        ]

    def test_a_renamed_section_is_matched_by_its_stamped_fields(self):
        stored = [sec("A", [fd("a")]), sec("E", [fd("x", K)], K)]
        out = g.preserve_ext_schema([sec("A", [fd("a")]), sec("Sust", [fd("x")])], stored, ACTIVE)
        assert shape(out.schema) == [("A", None, [("a", None)]), ("Sust", K, [("x", K)])]
        assert out.inserted is False

    def test_a_section_named_like_another_stored_one_is_not_taken_for_it(self):
        stored = [sec("A", [fd("a")]), sec("E", [fd("x", K)], K)]
        out = g.preserve_ext_schema([sec("A", [fd("a"), fd("x")])], stored, ACTIVE)
        # A keeps no stamp; E comes back, empty: x lives in A now.
        assert shape(out.schema) == [("A", None, [("a", None), ("x", K)]), ("E", K, [])]
        assert out.restored == [(1, 1)]


class TestRestore:
    def test_a_stamped_section_comes_back_between_its_neighbours(self):
        stored = [
            sec("A", [fd("a")]),
            sec("E", [fd("x", K), fd("mine")], K, columns=2),
            sec("B", [fd("b")]),
        ]
        out = g.preserve_ext_schema([sec("A", [fd("a")]), sec("B", [fd("b")])], stored, ACTIVE)
        assert out.schema == [sec("A", [fd("a")]), stored[1], sec("B", [fd("b")])]
        assert out.schema[1] is not stored[1]
        assert (out.body_to_final, out.stored_to_final, out.restored) == (
            {0: 0, 1: 2},
            {0: 0, 1: 1, 2: 2},
            [(1, 1)],
        )

    def test_a_section_with_no_surviving_earlier_neighbour_goes_before_the_next(self):
        stored = [sec("E", [fd("x", K)], K), sec("B", [fd("b")])]
        out = g.preserve_ext_schema([sec("New", []), sec("B", [fd("b")])], stored, ACTIVE)
        assert [s["section"] for s in out.schema] == ["New", "E", "B"]
        out = g.preserve_ext_schema([], stored, ACTIVE)
        assert [s["section"] for s in out.schema] == ["E"]

    def test_an_inactive_extensions_section_and_field_may_go(self):
        stored = [sec("A", [fd("a"), fd("y", "gone")]), sec("L", [fd("note")], "gone")]
        out = g.preserve_ext_schema([sec("A", [fd("a")])], stored, ACTIVE)
        assert out.schema == [sec("A", [fd("a")])]
        assert out.inserted is False

    def test_a_dropped_field_returns_next_to_its_stored_neighbours(self):
        stored = [sec("E", [fd("a", K), fd("m"), fd("b", K), fd("c", K), "junk"], K)]
        out = g.preserve_ext_schema([sec("E", [fd("m"), fd("c"), fd("z")])], stored, ACTIVE)
        assert [f["key"] for f in out.schema[0]["fields"]] == ["a", "m", "b", "c", "z"]

    def test_an_admin_holder_is_never_restored_whole(self):
        stored = [sec("General", [fd("a"), fd("x", K)]), sec("Other", [fd("b")])]
        # Holder kept: the field returns into it.
        out = g.preserve_ext_schema(
            [sec("General", [fd("a")]), sec("Other", [fd("b")])], stored, ACTIVE
        )
        assert shape(out.schema) == [
            ("General", None, [("a", None), ("x", K)]),
            ("Other", None, [("b", None)]),
        ]
        # Holder deleted: only the field comes back, in a re-created stamped
        # section that takes the holder's place.
        out = g.preserve_ext_schema([sec("Other", [fd("b")])], stored, ACTIVE)
        assert shape(out.schema) == [("General", K, [("x", K)]), ("Other", None, [("b", None)])]
        assert (out.stored_to_final, out.restored, out.inserted) == ({0: 0, 1: 1}, [], True)

    def test_a_field_whose_holder_is_gone_joins_its_extensions_section(self):
        stored = [sec("General", [fd("x", K)]), sec("E", [fd("y", K)], K)]
        out = g.preserve_ext_schema([sec("E", [fd("y")])], stored, ACTIVE)
        assert shape(out.schema) == [("E", K, [("y", K), ("x", K)])]

    def test_two_extensions_fields_from_one_deleted_holder_are_kept_apart(self):
        stored = [sec("General", [fd("x", K), fd("y", "k2")])]
        out = g.preserve_ext_schema([], stored, ACTIVE)
        assert shape(out.schema) == [("General", K, [("x", K)]), ("General", "k2", [("y", "k2")])]

    def test_junk_is_passed_through_and_never_restored(self):
        stored = [None, "x", sec("E", [fd("x", K), None, "s"], K), {"section": "Odd", "fields": 5}]
        body = [None, 5, {"section": "Q", "fields": None}]
        out = g.preserve_ext_schema(body, stored, ACTIVE)
        # No stored neighbour survives, so E goes last; junk never pairs.
        assert out.schema == [
            None,
            5,
            {"section": "Q", "fields": None},
            sec("E", [fd("x", K), None, "s"], K),
        ]
        assert g.preserve_ext_schema(None, None, ACTIVE).schema == []
        assert g.preserve_ext_schema("junk", "junk", ACTIVE).schema == []  # type: ignore[arg-type]


class TestSectionConfig:
    STORED = [sec("A", [fd("a")]), sec("E", [fd("x", K)], K), sec("B", [fd("b")])]

    def guard(self, body, config, stored_config):
        row = {"fields_schema": body, "section_config": config}
        g.guard_card_type_row(
            row,
            stored_schema=self.STORED,
            stored_subtypes=[],
            stored_config=stored_config,
            active_keys=ACTIVE,
        )
        return row["section_config"]

    def test_shorter_order_restored_section_goes_next_to_its_neighbour(self):
        out = self.guard(
            [sec("B", [fd("b")])],
            {"__order": ["description", "lifecycle", "custom:0", "hierarchy", "relations"]},
            {
                "__order": [
                    "description",
                    "custom:1",
                    "lifecycle",
                    "custom:0",
                    "custom:2",
                    "relations",
                ]
            },
        )
        # Final: E custom:0 (restored, stored custom:1), B custom:1.
        assert out == {
            "__order": [
                "description",
                "custom:0",
                "lifecycle",
                "custom:1",
                "hierarchy",
                "relations",
            ]
        }

    def test_no_stored_order_places_it_before_relations(self):
        out = self.guard(
            [sec("A", [fd("a")]), sec("B", [fd("b")]), sec("New", [])],
            {"__order": ["description", "custom:0", "custom:1", "custom:2", "relations"]},
            {},
        )
        assert out == {
            "__order": ["description", "custom:0", "custom:2", "custom:3", "custom:1", "relations"]
        }

    def test_per_section_entries_are_remapped_and_never_inherited(self):
        out = self.guard(
            [sec("A", [fd("a")]), sec("B", [fd("b")])],
            {
                "__order": ["custom:1", "custom:0", "custom:x", 7, "custom:9"],
                "custom:1": {"hidden": True},
                "custom:9": {"hidden": True},
                "custom:bad": {"dropped": 1},  # no section to name
                "tags": {"t": 1},
            },
            {
                "__order": ["custom:2", "custom:1", "custom:0"],
                "custom:1": {"defaultExpanded": True},
            },
        )
        assert out == {
            "__order": ["custom:2", "custom:1", "custom:0", 7],
            "custom:2": {"hidden": True},
            "tags": {"t": 1},
            "custom:1": {"defaultExpanded": True},
        }

    def test_an_empty_order_stays_empty(self):
        assert self.guard([sec("A", [fd("a")])], {"__order": []}, {}) == {"__order": []}

    def test_a_section_config_only_write_places_active_sections(self):
        row = {"section_config": {"__order": ["custom:2", "custom:0"], "custom:7": 1}}
        g.guard_card_type_row(
            row,
            stored_schema=self.STORED,
            stored_subtypes=[],
            stored_config={"__order": ["custom:0", "custom:1", "custom:2"]},
            active_keys=ACTIVE,
        )
        assert row == {
            "section_config": {"__order": ["custom:2", "custom:0", "custom:1"], "custom:7": 1}
        }

    def test_a_fields_only_write_readdresses_the_stored_config_when_it_restores(self):
        row = {"fields_schema": [sec("B", [fd("b")])]}
        g.guard_card_type_row(
            row,
            stored_schema=self.STORED,
            stored_subtypes=None,
            stored_config={"__order": ["custom:2", "custom:1", "custom:0"], "custom:0": 1},
            active_keys=ACTIVE,
        )
        assert shape(row["fields_schema"]) == [("E", K, [("x", K)]), ("B", None, [("b", None)])]
        assert row["section_config"] == {"__order": ["custom:1", "custom:0"]}
        # Nothing restored: the stored config is left alone (not written).
        row = {"fields_schema": copy.deepcopy(self.STORED)}
        g.guard_card_type_row(
            row,
            stored_schema=self.STORED,
            stored_subtypes=None,
            stored_config={},
            active_keys=ACTIVE,
        )
        assert "section_config" not in row

    def test_none_stays_none_when_nothing_comes_back(self):
        row = {"fields_schema": None, "subtypes": None, "section_config": None}
        g.guard_card_type_row(
            row, stored_schema=[], stored_subtypes=[], stored_config=None, active_keys=ACTIVE
        )
        assert row == {"fields_schema": None, "subtypes": None, "section_config": None}


class TestSubtypes:
    STORED = [
        {"key": "own", "label": "Own"},
        {"key": "c", "label": "C", "ext": K, "hidden_fields": ["x"]},
        {"key": "gone", "label": "G", "ext": "gone"},
        "junk",
    ]

    def test_dropped_comes_back_and_inactive_may_go(self):
        out = g.preserve_ext_subtypes([{"key": "own", "label": "Own"}], self.STORED, ACTIVE)
        assert out == [{"key": "own", "label": "Own"}, self.STORED[1]]
        assert out[1] is not self.STORED[1]

    def test_stamps_cannot_be_dropped_or_minted(self):
        body = [
            {"key": "own", "label": "Own", "ext": K},
            {"key": "c", "label": "Relabelled", "ext_protected": True},
            {"key": "new", "label": "N", "ext": "x"},
            "junk",
        ]
        assert g.preserve_ext_subtypes(body, self.STORED, ACTIVE) == [
            {"key": "own", "label": "Own"},
            {"key": "c", "label": "Relabelled", "ext": K},
            {"key": "new", "label": "N"},
            "junk",
        ]
        imported = g.preserve_ext_subtypes(body, self.STORED, ACTIVE, mode="import")
        assert imported[2] == {"key": "new", "label": "N", "ext": "x"}
        assert imported[0] == {"key": "own", "label": "Own"}

    def test_flags(self):
        assert g.flag_protected_subtypes(self.STORED, ACTIVE) == [
            self.STORED[0],
            {**self.STORED[1], "ext_protected": True},
            self.STORED[2],
            "junk",
        ]
        assert g.flag_protected_subtypes(self.STORED, frozenset()) is self.STORED
        assert g.flag_protected_subtypes(None, ACTIVE) == []


def test_protected_fields_and_sections():
    schema = [sec("A", [fd("a"), fd("x", K)]), "junk", sec("E", [fd("y", K), fd("z", "gone")], K)]
    assert g.protected_fields_and_sections(schema, ACTIVE) == ({"x", "y"}, {2})
    assert g.protected_fields_and_sections(None, ACTIVE) == (set(), set())


class TestReReviewFixes:
    def test_same_named_sections_pair_by_stamp_whatever_the_body_order(self):
        stored = [sec("X", [fd("a")]), sec("X", [fd("x", K)], K)]
        # The editor sends both back (stamps as read), in swapped order.
        body = [sec("X", [fd("x")], K), sec("X", [fd("a")])]
        out = g.preserve_ext_schema(body, stored, ACTIVE)
        assert shape(out.schema) == [("X", K, [("x", K)]), ("X", None, [("a", None)])]
        assert out.stored_to_final == {0: 1, 1: 0}
        assert out.inserted is False

    def test_a_recreated_stand_in_takes_no_per_section_setting_of_the_deleted_holder(self):
        stored = [sec("General", [fd("a"), fd("x", K)]), sec("Other", [fd("b")])]
        row = {"fields_schema": [sec("Other", [fd("b")])]}
        g.guard_card_type_row(
            row,
            stored_schema=stored,
            stored_subtypes=None,
            stored_config={
                "__order": ["custom:0", "custom:1", "relations"],
                "custom:0": {"hidden": True},
                "custom:1": {"defaultExpanded": False},
            },
            active_keys=ACTIVE,
        )
        assert shape(row["fields_schema"]) == [
            ("General", K, [("x", K)]),
            ("Other", None, [("b", None)]),
        ]
        # The stand-in keeps the holder's place in the order, not its "hidden".
        assert row["section_config"] == {
            "__order": ["custom:0", "custom:1", "relations"],
            "custom:1": {"defaultExpanded": False},
        }

    def test_a_recreated_stand_in_with_a_sent_config_gets_no_entry_either(self):
        stored = [sec("General", [fd("a"), fd("x", K)]), sec("Other", [fd("b")])]
        guard = g.preserve_ext_schema([sec("Other", [fd("b")])], stored, ACTIVE)
        assert guard.recreated == [0]
        cfg = g.preserve_ext_section_config(
            {"custom:0": {"hidden": True}},
            final_schema=guard.schema,
            active_keys=ACTIVE,
            stored_config={},
            index_map=guard.stored_to_final,
            stored_to_final=guard.stored_to_final,
            recreated=guard.recreated,
        )
        assert cfg == {}


class TestImportStampRule:
    INSTALLED = {
        K: g.Contributed(
            fields=frozenset({"real"}),
            sections=frozenset({"Real"}),
            subtypes=frozenset({"branch"}),
        )
    }

    def test_a_stamp_of_an_installed_extension_is_kept_only_on_what_it_contributes(self):
        body = [
            sec("Real", [fd("real", K), fd("forged", K)], K),
            sec("Fake", [fd("forged2", K)], K),
            sec("Orphan", [fd("o", "unknown-ext")], "unknown-ext"),
        ]
        out = g.preserve_ext_schema(
            body, [], frozenset(), mode="import", installed=self.INSTALLED
        ).schema
        assert shape(out) == [
            ("Real", K, [("real", K), ("forged", None)]),
            ("Fake", None, [("forged2", None)]),
            ("Orphan", "unknown-ext", [("o", "unknown-ext")]),
        ]

    def test_subtypes_follow_the_same_rule(self):
        body = [
            {"key": "branch", "label": "B", "ext": K},
            {"key": "forged", "label": "F", "ext": K},
            {"key": "o", "label": "O", "ext": "unknown-ext"},
        ]
        out = g.preserve_ext_subtypes(
            body, [], frozenset(), mode="import", installed=self.INSTALLED
        )
        assert out == [
            {"key": "branch", "label": "B", "ext": K},
            {"key": "forged", "label": "F"},
            {"key": "o", "label": "O", "ext": "unknown-ext"},
        ]

    def test_a_save_never_consults_it(self):
        body = [sec("Real", [fd("real", K)], K)]
        out = g.preserve_ext_schema(body, [], ACTIVE, installed=self.INSTALLED).schema
        assert shape(out) == [("Real", None, [("real", None)])]

    def test_installed_contributions_reads_every_non_removed_manifest(self):
        manifest = {
            "metamodel": {
                "field_sections": [
                    {"card_type": "App", "section": "S", "fields": [fd("x"), {"label": "no key"}]},
                    {"card_type": "Other", "section": "T", "fields": [fd("y")]},
                    "junk",
                ],
                "subtypes": [
                    {"card_type": "App", "subtypes": [{"key": "st", "label": "St"}]},
                    {"card_type": "Other", "subtypes": [{"key": "no", "label": "No"}]},
                ],
            }
        }
        reg = ExtensionRegistry()
        reg.load_installed(
            [
                ExtensionInfo(
                    key="a",
                    name="a",
                    version="1",
                    status="disabled",
                    enabled=False,
                    manifest=manifest,
                ),
                ExtensionInfo(
                    key="r",
                    name="r",
                    version="1",
                    status="removed",
                    enabled=True,
                    manifest=manifest,
                ),
                ExtensionInfo(key="n", name="n", version="1", status="installed", enabled=True),
            ]
        )
        assert g.installed_contributions("App", reg) == {
            "a": g.Contributed(frozenset({"x"}), frozenset({"S"}), frozenset({"st"})),
            "n": g.Contributed(),
        }
