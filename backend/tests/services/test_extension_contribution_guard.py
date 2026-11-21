"""The pure write guard on an extension's card-type contributions.

`contribution_guard` is shared by the metamodel save and the workspace import;
the route- and import-level behaviour is covered in
`tests/api/test_metamodel_ext_contributions.py` and
`tests/services/test_workspace_applier_exact.py`. These pin the exact output of
each helper, malformed entries included.
"""

from __future__ import annotations

import copy

import pytest

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
            mode="save",
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
            mode="save",
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
            mode="save",
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
            mode="save",
        )
        assert "section_config" not in row

    def test_none_stays_none_when_nothing_comes_back(self):
        row = {"fields_schema": None, "subtypes": None, "section_config": None}
        g.guard_card_type_row(
            row,
            stored_schema=[],
            stored_subtypes=[],
            stored_config=None,
            active_keys=ACTIVE,
            mode="save",
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
            mode="save",
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


class TestModes:
    def test_only_save_and_import_are_accepted(self):
        for bad in ("SAVE", "imports", None, ""):
            with pytest.raises(ValueError, match="unknown contribution guard mode"):
                g.guard_card_type_row(
                    {},
                    stored_schema=[],
                    stored_subtypes=[],
                    stored_config={},
                    active_keys=ACTIVE,
                    mode=bad,  # type: ignore[arg-type]
                )
            with pytest.raises(ValueError):
                g.preserve_ext_schema([], [], ACTIVE, mode=bad)  # type: ignore[arg-type]
            with pytest.raises(ValueError):
                g.preserve_ext_subtypes([], [], ACTIVE, mode=bad)  # type: ignore[arg-type]

    def test_the_defaults_are_a_save(self):
        body = [sec("New", [fd("n", "x-ext")], "x-ext")]
        assert shape(g.preserve_ext_schema(body, [], ACTIVE).schema) == [
            ("New", None, [("n", None)])
        ]
        assert g.preserve_ext_subtypes([{"key": "n", "ext": "x-ext"}], [], ACTIVE) == [{"key": "n"}]
        for mode in ("save", "import"):
            row: dict = {}
            g.guard_card_type_row(
                row,
                stored_schema=[],
                stored_subtypes=[],
                stored_config={},
                active_keys=ACTIVE,
                mode=mode,
            )
            assert row == {}


class TestSmallHelpers:
    def test_stamp_of_and_key_of_take_only_non_empty_strings(self):
        for value, expected in (("k", "k"), ("", None), (5, None), (None, None)):
            assert g.stamp_of({"ext": value}) == expected
            assert g._key_of({"key": value}) == expected
        assert g.stamp_of("junk") is None
        assert g._key_of(["key"]) is None

    def test_stored_stamps_skips_keyless_entries_and_a_stamp_wins(self):
        entries = [{"label": "no key"}, fd("a", K), fd("a"), fd("b"), fd("b", "k2"), "junk"]
        assert g._stored_stamps(entries) == {"a": K, "b": "k2"}

    def test_custom_index_takes_one_non_negative_integer(self):
        cases = {
            "custom:0": 0,
            "custom:12": 12,
            "custom:1:2": None,
            "custom:-1": None,
            "custom:x": None,
        }
        for key, expected in cases.items():
            assert g._custom_index(key) == expected, key

    def test_identity_index_map_counts_every_custom_slot_once(self):
        schema = [sec("A", []), {"section": "__description"}, "junk", sec("B", [])]
        assert g.identity_index_map(schema) == {0: 0, 1: 1, 2: 2}
        assert g.identity_index_map(None) == {}
        assert g.identity_index_map([]) == {}


class TestContributedByManifest:
    def test_every_contribution_to_the_type_is_unioned(self):
        manifest = {
            "metamodel": {
                "field_sections": [
                    {"card_type": "App", "section": "S1", "fields": [fd("a")]},
                    {"card_type": "App", "section": "S2", "fields": [fd("b")]},
                    {"card_type": "App", "fields": [fd("c")]},  # no section name
                    {"card_type": "App", "section": 5, "fields": [fd("d")]},
                    {"card_type": "App", "section": "", "fields": []},
                ],
                "subtypes": [
                    {"card_type": "App", "subtypes": [{"key": "s1"}]},
                    {"card_type": "App", "subtypes": [{"key": "s2"}]},
                ],
            }
        }
        assert g.contributed_by_manifest(manifest, "App") == g.Contributed(
            fields=frozenset({"a", "b", "c", "d"}),
            sections=frozenset({"S1", "S2"}),
            subtypes=frozenset({"s1", "s2"}),
        )

    def test_a_manifest_that_is_not_an_object_contributes_nothing(self):
        for manifest in ("junk", ["x"], 5, None):
            assert g.contributed_by_manifest(manifest, "App") == g.Contributed()


class TestPairing:
    def test_one_body_section_stands_for_one_stored_section(self):
        stored = [sec("X", [fd("a")]), sec("X", [fd("b")])]
        out = g.preserve_ext_schema([sec("X", [fd("a"), fd("b")])], stored, ACTIVE)
        assert out.stored_to_final == {0: 0}
        assert out.inserted is False

    def test_a_stamped_stored_section_pairs_with_the_stamped_body_one_first(self):
        stored = [sec("X", [fd("x", K)], K), sec("X", [fd("a")])]
        body = [sec("X", [fd("a")]), sec("X", [fd("x")], K)]
        out = g.preserve_ext_schema(body, stored, ACTIVE)
        assert out.stored_to_final == {0: 1, 1: 0}
        assert shape(out.schema) == [("X", None, [("a", None)]), ("X", K, [("x", K)])]

    def test_a_same_named_body_section_with_another_stamp_is_passed_over(self):
        # The first "X" the body sends is unstamped: the stamped stored "X"
        # sections look past it to the stamped one, and the second stored
        # section, which has no stamped partner left, takes it by name.
        stored = [sec("X", [fd("x", K)], K), sec("X", [fd("y", K)], K)]
        body = [sec("X", [fd("y")]), sec("X", [fd("x")], K)]
        out = g.preserve_ext_schema(body, stored, ACTIVE)
        assert out.stored_to_final == {0: 1, 1: 0}
        assert shape(out.schema) == [("X", K, [("y", K)]), ("X", K, [("x", K)])]

    def test_a_section_named_like_a_paired_stored_one_is_not_taken_by_fields(self):
        stored = [sec("A", [fd("a")]), sec("E", [fd("x", K)], K)]
        body = [sec("A", [fd("a")]), sec("A", [fd("x")])]
        out = g.preserve_ext_schema(body, stored, ACTIVE)
        assert shape(out.schema) == [
            ("A", None, [("a", None)]),
            ("E", K, []),
            ("A", None, [("x", K)]),
        ]
        assert out.restored == [(1, 1)]

    def test_a_section_paired_by_name_is_not_re_paired_by_its_fields(self):
        stored = [sec("E", [fd("x", K), fd("y")], K)]
        body = [sec("E", [fd("y")]), sec("New", [fd("x")])]
        out = g.preserve_ext_schema(body, stored, ACTIVE)
        assert shape(out.schema) == [("E", K, [("y", None)]), ("New", None, [("x", K)])]
        assert out.stored_to_final == {0: 0}

    def test_a_stored_section_without_stamped_fields_does_not_stop_the_search(self):
        stored = [sec("A", [fd("a")]), sec("E", [fd("x", K)], K)]
        out = g.preserve_ext_schema([sec("Sust", [fd("x")])], stored, ACTIVE)
        assert shape(out.schema) == [("Sust", K, [("x", K)])]
        assert (out.stored_to_final, out.inserted) == ({1: 0}, False)

    def test_one_renamed_section_stands_for_one_stored_section(self):
        stored = [sec("E1", [fd("x", K)], K), sec("E2", [fd("y", K)], K)]
        out = g.preserve_ext_schema([sec("Merged", [fd("x"), fd("y")])], stored, ACTIVE)
        assert shape(out.schema) == [("Merged", K, [("x", K), ("y", K)]), ("E2", K, [])]
        assert (out.stored_to_final, out.restored) == ({0: 0, 1: 1}, [(1, 1)])

    def test_a_stored_section_paired_with_a_description_section_has_no_slot(self):
        stored = [sec("E", [fd("x", K)], K)]
        out = g.preserve_ext_schema([sec("__description", [fd("x")])], stored, ACTIVE)
        assert shape(out.schema) == [("__description", K, [("x", K)])]
        assert (out.stored_to_final, out.restored, out.inserted) == ({}, [], False)


class TestPlacementOfWhatComesBack:
    def test_a_restored_section_follows_its_nearest_earlier_neighbour(self):
        stored = [sec("A", [fd("a")]), sec("E", [fd("x", K)], K), sec("B", [fd("b")])]
        body = [sec("A", [fd("a")]), sec("New", []), sec("B", [fd("b")])]
        out = g.preserve_ext_schema(body, stored, ACTIVE)
        assert [s["section"] for s in out.schema] == ["A", "E", "New", "B"]

    def test_the_nearest_surviving_earlier_neighbour_is_found_past_a_deleted_one(self):
        stored = [
            sec("A", [fd("a")]),
            sec("Gone", [fd("g")]),
            sec("E", [fd("x", K)], K),
            sec("B", [fd("b")]),
        ]
        body = [sec("A", [fd("a")]), sec("New", []), sec("B", [fd("b")])]
        out = g.preserve_ext_schema(body, stored, ACTIVE)
        assert [s["section"] for s in out.schema] == ["A", "E", "New", "B"]

    def test_a_field_returns_after_its_earlier_sibling_not_before_its_later_one(self):
        stored = [sec("E", [fd("a", K), fd("m"), fd("b", K), fd("c", K)], K)]
        out = g.preserve_ext_schema([sec("E", [fd("m"), fd("z"), fd("c")])], stored, ACTIVE)
        assert [f["key"] for f in out.schema[0]["fields"]] == ["a", "m", "b", "z", "c"]

    def test_a_key_stored_twice_comes_back_once(self):
        stored = [sec("A", [fd("x", K)]), sec("B", [fd("x", K)])]
        out = g.preserve_ext_schema([], stored, ACTIVE)
        assert shape(out.schema) == [("A", K, [("x", K)])]
        subtypes = [{"key": "c", "ext": K}, {"key": "c", "ext": K, "label": "dup"}]
        assert g.preserve_ext_subtypes([], subtypes, ACTIVE) == [{"key": "c", "ext": K}]


class TestSectionStamps:
    def test_every_unpaired_section_after_a_paired_one_is_unstamped_on_save(self):
        body = [sec("A", [fd("a")]), sec("New", [fd("n", "x-ext")], "x-ext")]
        out = g.preserve_ext_schema(body, [sec("A", [fd("a")])], ACTIVE)
        assert shape(out.schema) == [("A", None, [("a", None)]), ("New", None, [("n", None)])]

    def test_an_import_keeps_a_section_stamp_only_beside_a_new_field_with_it(self):
        stored = [sec("Old", [fd("s", "x-ext")])]
        body = [
            sec("Old", []),
            sec("Unstamped field", [fd("n")], "x-ext"),
            sec("Known field", [fd("s", "x-ext")], "x-ext"),
            sec("New field", [fd("m", "x-ext")], "x-ext"),
        ]
        out = g.preserve_ext_schema(body, stored, ACTIVE, mode="import")
        assert shape(out.schema) == [
            ("Old", None, []),
            ("Unstamped field", None, [("n", None)]),
            ("Known field", None, [("s", "x-ext")]),
            ("New field", "x-ext", [("m", "x-ext")]),
        ]


class TestNoAliasing:
    def test_restored_entries_share_nothing_with_the_stored_ones(self):
        nested = fd("x", K, options=[{"key": "o"}])
        stored = [sec("E", [nested], K), sec("A", [fd("a"), fd("y", K, options=[1])])]
        out = g.preserve_ext_schema([sec("A", [fd("a")])], stored, ACTIVE)
        out.schema[0]["fields"][0]["options"].append("mutated")
        out.schema[1]["fields"][1]["options"].append("mutated")
        assert stored[0]["fields"][0]["options"] == [{"key": "o"}]
        assert stored[1]["fields"][1]["options"] == [1]

        subtypes = [{"key": "c", "ext": K, "hidden_fields": ["x"]}]
        restored = g.preserve_ext_subtypes([], subtypes, ACTIVE)
        restored[0]["hidden_fields"].append("y")
        assert subtypes[0]["hidden_fields"] == ["x"]

    def test_section_config_values_share_nothing_with_the_inputs(self):
        config = {"__order": ["custom:0"], "tags": {"n": [1]}, "custom:0": {"n": [1]}}
        stored = {"custom:1": {"n": [1]}}
        out = g.preserve_ext_section_config(
            config,
            final_schema=[sec("A", []), sec("E", [], K)],
            active_keys=ACTIVE,
            stored_config=stored,
            index_map={0: 0},
            stored_to_final={0: 0, 1: 1},
            restored=[(1, 1)],
        )
        assert out == {
            "__order": ["custom:0", "custom:1"],
            "tags": {"n": [1]},
            "custom:0": {"n": [1]},
            "custom:1": {"n": [1]},
        }
        for key in ("tags", "custom:0", "custom:1"):
            out[key]["n"].append(2)
        assert config == {"__order": ["custom:0"], "tags": {"n": [1]}, "custom:0": {"n": [1]}}
        assert stored == {"custom:1": {"n": [1]}}

    def test_an_unchanged_schema_keeps_its_order_list_unshared(self):
        config = {"__order": ["relations", ["nested"]]}
        out = g.preserve_ext_section_config(
            config,
            final_schema=[],
            active_keys=ACTIVE,
            stored_config=None,
            index_map=None,
            stored_to_final={},
        )
        assert out == {"__order": ["relations", ["nested"]]}
        out["__order"][1].append("x")
        assert config == {"__order": ["relations", ["nested"]]}


class TestPlaceMissing:
    """A restored section re-enters a sent ``__order`` beside the neighbours it
    had in the STORED order, translated to their final indices."""

    STORED = [sec("A", [fd("a")]), sec("E", [fd("x", K)], K), sec("B", [fd("b")])]

    def guard(self, body, config, stored_config, stored=None):
        row = {"fields_schema": body, "section_config": config}
        g.guard_card_type_row(
            row,
            stored_schema=self.STORED if stored is None else stored,
            stored_subtypes=[],
            stored_config=stored_config,
            active_keys=ACTIVE,
            mode="save",
        )
        return row

    def test_a_stored_neighbour_is_translated_to_its_final_index(self):
        row = self.guard(
            [sec("B", [fd("b")]), sec("A", [fd("a")])],
            {"__order": ["custom:0", "custom:1", "relations"]},
            {"__order": ["custom:0", "custom:1", "custom:2", "relations"]},
        )
        assert [s["section"] for s in row["fields_schema"]] == ["B", "A", "E"]
        assert row["section_config"] == {
            "__order": ["custom:0", "custom:1", "custom:2", "relations"]
        }

    def test_a_deleted_stored_neighbour_is_passed_over(self):
        row = self.guard(
            [sec("B", [fd("b")])],
            {"__order": ["custom:0", "relations"]},
            {"__order": ["custom:0", "custom:1", "custom:2", "relations"]},
        )
        assert [s["section"] for s in row["fields_schema"]] == ["E", "B"]
        assert row["section_config"] == {"__order": ["custom:0", "custom:1", "relations"]}

    def test_an_earlier_neighbour_missing_from_the_sent_order_is_passed_over(self):
        row = self.guard(
            [sec("A", [fd("a")]), sec("B", [fd("b")])],
            {"__order": ["description", "lifecycle", "relations", "custom:0", "custom:1"]},
            {"__order": ["lifecycle", "tags", "custom:1", "relations", "custom:0", "custom:2"]},
        )
        assert row["section_config"] == {
            "__order": [
                "description",
                "lifecycle",
                "custom:1",
                "relations",
                "custom:0",
                "custom:2",
            ]
        }

    def test_with_no_earlier_neighbour_it_goes_before_the_next_one(self):
        row = self.guard(
            [sec("A", [fd("a")]), sec("B", [fd("b")])],
            {"__order": ["description", "lifecycle", "relations", "custom:0", "custom:1"]},
            {"__order": ["custom:1", "tags", "lifecycle", "relations", "custom:0", "custom:2"]},
        )
        assert row["section_config"] == {
            "__order": [
                "description",
                "custom:1",
                "lifecycle",
                "relations",
                "custom:0",
                "custom:2",
            ]
        }

    def test_a_stored_config_that_is_not_an_object_reads_as_empty(self):
        out = g.preserve_ext_section_config(
            {"__order": ["relations"]},
            final_schema=[sec("A", [])],
            active_keys=ACTIVE,
            stored_config=None,
            index_map=None,
            stored_to_final={},
        )
        assert out == {"__order": ["relations"]}


class TestGuardRowEdges:
    STORED = [sec("A", [fd("a")]), sec("E", [fd("x", K)], K), sec("B", [fd("b")])]

    def test_a_malformed_schema_or_subtypes_column_is_replaced(self):
        row = {"fields_schema": "junk", "subtypes": "junk"}
        g.guard_card_type_row(
            row,
            stored_schema=[],
            stored_subtypes=[],
            stored_config=None,
            active_keys=ACTIVE,
            mode="save",
        )
        assert row == {"fields_schema": [], "subtypes": []}

    def test_a_sent_non_object_config_is_left_as_sent(self):
        row = {"fields_schema": [sec("B", [fd("b")])], "section_config": None}
        g.guard_card_type_row(
            row,
            stored_schema=self.STORED,
            stored_subtypes=None,
            stored_config={"__order": ["custom:1"]},
            active_keys=ACTIVE,
            mode="save",
        )
        assert row["section_config"] is None
        assert [s["section"] for s in row["fields_schema"]] == ["E", "B"]

    def test_a_config_only_write_places_by_the_stored_order(self):
        row = {"section_config": {"__order": ["custom:2", "relations", "custom:0"]}}
        g.guard_card_type_row(
            row,
            stored_schema=self.STORED,
            stored_subtypes=None,
            stored_config={"__order": ["relations", "custom:0", "custom:1", "custom:2"]},
            active_keys=ACTIVE,
            mode="save",
        )
        assert row == {
            "section_config": {"__order": ["custom:2", "relations", "custom:0", "custom:1"]}
        }

    def test_a_config_only_write_with_no_stored_schema_keeps_its_order(self):
        row = {"section_config": {"__order": ["relations"]}}
        g.guard_card_type_row(
            row,
            stored_schema=None,
            stored_subtypes=None,
            stored_config=None,
            active_keys=ACTIVE,
            mode="save",
        )
        assert row == {"section_config": {"__order": ["relations"]}}
