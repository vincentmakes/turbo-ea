"""``language_pack``: the edges of each rule, one assertion per decision.

These pin what the broader tests in ``test_language_pack.py`` pass over: the
counting in a merge, the order of the skips in the reference list, the shape of
an export of odd stored values, the fingerprint's insensitivity to key order,
and every exit path of the offline validator. No database.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from app.services import language_pack as lp

EN_DIR = Path(__file__).resolve().parents[3] / "frontend" / "src" / "i18n" / "locales" / "en"
PLURAL = {"items_one": "{{count}} item", "items_other": "{{count}} items"}


def tiny(tree: dict) -> lp.Namespace:
    return lp.Namespace.from_tree("t", tree)


class TestCatalogue:
    def test_each_namespace_keeps_its_name(self):
        cat = lp.catalog_from_trees({"b": {"x": "1"}, "a": {"y": "2"}})
        assert cat.names == ["a", "b"]
        assert cat.namespace("a").name == "a" and cat.namespace("b").name == "b"

    def test_the_fingerprint_ignores_key_order(self):
        one = lp.catalog_from_trees({"a": {"x": "Ünï", "y": "2"}})
        other = lp.catalog_from_trees({"a": {"y": "2", "x": "Ünï"}})
        assert one.fingerprint == other.fingerprint

    def test_the_fingerprint_names_the_namespace(self):
        assert (
            lp.catalog_from_trees({"a": {"x": "1"}}).fingerprint
            != lp.catalog_from_trees({"b": {"x": "1"}}).fingerprint
        )

    def test_files_are_read_as_utf8(self, tmp_path):
        (tmp_path / "t.json").write_bytes(json.dumps({"k": "שָׁלוֹם"}, ensure_ascii=False).encode())
        assert lp.read_catalog(tmp_path).namespace("t").strings == {"k": "שָׁלוֹם"}

    def test_source_hash_is_of_the_utf8_text(self):
        assert lp.source_hash("שלום") == lp.source_hash("שלום")
        assert lp.source_hash("שלום") != lp.source_hash("שלוםx")


class TestValidatorEdges:
    def test_whitespace_inside_a_nested_reference_is_ignored(self):
        english = 'See $t(common:a, {"n": 1})'
        assert lp.validate_value(english, 'Siehe $t(common:a,{"n":1})') is None
        assert lp.validate_value(english, 'Siehe $t(common:b,{"n":1})') == lp.NESTING_MISMATCH

    def test_a_url_ending_in_a_bracket_matches_its_full_width_twin(self):
        english = "(see https://a.example)"
        assert lp.validate_value(english, "（siehe https://a.example）") is None

    def test_url_case_is_ignored(self):
        assert lp.validate_value("See https://a.example", "HTTPS://A.EXAMPLE") is None

    def test_a_stray_open_brace_english_has_is_kept_but_a_new_one_is_not(self):
        english = "Type {{ then {{name}}"
        assert lp.validate_value(english, "Tippe {{ dann {{name}}") is None
        assert lp.validate_value(english, "Tippe {{ {{ dann {{name}}") == (lp.PLACEHOLDER_MISMATCH)

    def test_removing_a_source_tag_leaves_plain_text_beside_it(self):
        english = "Delete <strong>{{name}}</strong>?"
        assert lp.validate_value(english, "Löschen <<strong> {{name}}</strong>?") is None
        assert lp.validate_value(english, "Löschen <<strong>x {{name}}</strong>?") == (
            lp.MARKUP_NOT_IN_SOURCE
        )

    def test_structural_refuses_a_lone_open_brace(self):
        assert lp.validate_structural("x {{ y") == lp.PLACEHOLDER_MISMATCH


class TestListingEdges:
    def test_a_stored_non_string_is_listed_as_no_value(self):
        ns = tiny({"a": "Apple"})
        (row,) = lp.list_entries(ns, {"a": 3}, {})
        assert (row["value"], row["status"]) == (None, lp.STATUS_MISSING)

    def test_search_never_matches_an_absent_value(self):
        ns = tiny({"a": "Apple"})
        assert lp.list_entries(ns, {}, {}, search="xxxx") == []
        assert [r["key"] for r in lp.list_entries(ns, {}, {}, search="APP")] == ["a"]

    def test_extra_plural_keys_list_their_other_source(self):
        ns = tiny(PLURAL)
        rows = lp.list_entries(ns, {"items_few": "{{count}} kusy"}, {})
        assert rows[-1]["key"] == "items_few"
        assert rows[-1]["source"] == "{{count}} items"
        assert rows[-1]["source_hash"] == ns.hashes["items_other"]
        assert lp.keys_with_source(ns, {"items_few": "x", "nope": "y"}) == [
            ("items_one", "items_one"),
            ("items_other", "items_other"),
            ("items_few", "items_other"),
        ]


class TestMergeCounting:
    def setup_method(self):
        self.ns = tiny({"a": "A", "b": "B", "c": "C", "d": "D"})

    def test_every_counter_adds_up(self):
        h = self.ns.hashes
        strings = {"a": "x", "b": "y", "c": "z"}
        meta = {k: {"h": h[k], "o": "manual"} for k in strings}
        result = lp.merge_strings(
            self.ns,
            strings,
            meta,
            {"a": None, "b": None, "d": None, "zz": None, "c": "z"},
            origin="import",
        )
        assert (result.cleared, result.unchanged) == (2, 3)

    def test_two_keys_changed_since_reading_are_both_unchanged(self):
        result = lp.merge_strings(
            self.ns,
            {"a": "x", "b": "y"},
            {},
            {"a": "new", "b": "new"},
            origin="ai",
            expected={"a": None, "b": None},
        )
        assert result.unchanged == 2 and result.applied == 0

    def test_an_expected_value_that_still_holds_is_written(self):
        result = lp.merge_strings(
            self.ns,
            {"a": "old"},
            {},
            {"a": "new"},
            origin="ai",
            expected={"a": "old"},
        )
        assert result.applied == 1 and result.strings["a"] == "new"


class TestPluralFillEdges:
    def test_an_untranslated_or_non_string_other_fills_nothing(self):
        ns = tiny(PLURAL)
        assert lp.plural_fill(ns, {"items_other": 5}, "nl") == {}
        assert lp.plural_fill(ns, {"items_other": ""}, "nl") == {}

    def test_every_base_is_considered(self):
        ns = tiny({**PLURAL, "rows_other": "{{count}} rows"})
        fill = lp.plural_fill(ns, {"rows_other": "{{count}} rijen"}, "nl")
        assert fill["rows_one"] == "{{count}} rijen"
        assert "items_one" not in fill

    def test_an_empty_or_non_string_sibling_is_filled(self):
        ns = tiny(PLURAL)
        fill = lp.plural_fill(ns, {"items_other": "x {{count}}", "items_one": ""}, "nl")
        assert fill["items_one"] == "x {{count}}"
        fill = lp.plural_fill(ns, {"items_other": "x {{count}}", "items_two": 5}, "nl")
        assert fill["items_two"] == "x {{count}}"
        assert "items_other" not in fill

    def test_the_bundle_passes_the_language_on(self):
        ns = tiny(PLURAL)
        assert lp.build_namespace_bundle(ns, {"items_other": "x {{count}}"}, "ar")[
            "items_zero"
        ] == ("x {{count}}")


class TestExportEdges:
    def test_current_skips_non_strings_and_reads_odd_meta(self):
        ns = tiny({"a": "A", "b": "B", "c": "C"})
        strings, hashes = lp.export_namespace(
            ns, {"a": 5, "b": "Bee", "c": "See"}, {"b": "junk", "c": {}}, "current"
        )
        assert strings == {"b": "Bee", "c": "See"}
        assert hashes == {"b": ns.hashes["b"], "c": ns.hashes["c"]}

    def test_a_pack_keeps_a_namespace_only_when_it_has_strings(self):
        pack = lp.build_pack(
            locale={"code": "he", "name": "עברית", "english_name": "Hebrew", "rtl": True},
            mode="current",
            app_version="1",
            namespaces={"a": ({}, {"x": "h"}), "b": ({"y": "z"}, {})},
        )
        assert list(pack["strings"]) == ["b"]
        assert pack["locale"]["rtl"] is True


class TestHashEdges:
    def test_bundle_hash_defaults_to_no_app_version(self):
        rows = [("a", "1")]
        assert lp.bundle_hash("f", "nl", "N", False, rows) == lp.bundle_hash(
            "f", "nl", "N", False, rows, ""
        )

    def test_bundle_hash_names_the_namespace(self):
        assert lp.bundle_hash("f", "nl", "N", False, [("a", "1")]) != lp.bundle_hash(
            "f", "nl", "N", False, [("b", "1")]
        )


class TestChunkAndReferences:
    def test_the_character_count_restarts_at_zero(self):
        assert [len(c) for c in lp.chunk([5, 5, 5, 5], lambda n: n, max_chars=10)] == [2, 2]

    def test_each_kind_of_skip_moves_on_to_the_next_key(self):
        ns = tiny(
            {
                "skip": "Skip",
                "long": "z" * 121,
                "stale": "Stale",
                "chatty": "Chatty",
                "edge": "e" * 120,
                "good": "Good",
            }
        )
        strings = {
            "skip": "s",
            "long": "l",
            "stale": "st",
            "chatty": "c" * 121,
            "edge": "f" * 120,
            "good": "Goed",
        }
        meta = {k: {"h": ns.hashes[k]} for k in strings}
        meta["stale"] = {"h": "old"}
        assert lp.reference_pairs(ns, strings, meta, exclude=["skip"]) == [
            ("e" * 120, "f" * 120),
            ("Good", "Goed"),
        ]

    def test_messages_keep_the_target_script_unescaped(self):
        content = lp.translation_messages("Hebrew", {"1": "Save"}, [("Card", "כרטיס")])[1][
            "content"
        ]
        assert "כרטיס" in content


# ---------------------------------------------------------------------------
# The offline validator: every refusal and exit path
# ---------------------------------------------------------------------------

HEADER = {
    "format": lp.PACK_FORMAT,
    "format_version": 1,
    "locale": {"code": "nl", "name": "Nederlands", "english_name": "Dutch", "rtl": False},
}


@pytest.fixture(scope="module")
def cat() -> lp.Catalog:
    return lp.read_catalog(EN_DIR)


class TestValidatePackEdges:
    def test_not_a_pack_is_one_exact_problem(self, cat):
        assert lp.validate_pack({"format": "other"}, cat) == [
            {"namespace": "", "key": "", "reason": "not_a_language_pack"}
        ]

    def test_a_bad_namespace_does_not_stop_the_ones_after_it(self, cat):
        problems = lp.validate_pack(
            {
                **HEADER,
                "strings": {
                    "bogus": {"a": "b"},
                    "common": [],
                    "nav": {"nope.nope": "x"},
                },
            },
            cat,
        )
        assert problems == [
            {"namespace": "bogus", "key": "", "reason": "unknown_namespace"},
            {"namespace": "common", "key": "", "reason": "not_an_object"},
            {"namespace": "nav", "key": "nope.nope", "reason": "unknown_key"},
        ]

    @pytest.mark.parametrize("key", ["", "a\ud800", "a‮b", "a\x00"])
    def test_bad_keys(self, cat, key):
        problems = lp.validate_pack({**HEADER, "strings": {"common": {key: "x"}}}, cat)
        assert problems == [{"namespace": "common", "key": key, "reason": "bad_key"}]


class TestMain:
    def _write(self, tmp_path, strings):
        path = tmp_path / "pack.json"
        path.write_text(json.dumps({**HEADER, "strings": strings}), encoding="utf-8")
        return path

    def test_no_command_is_a_usage_error(self):
        with pytest.raises(SystemExit) as raised:
            lp.main([])
        assert raised.value.code == 2

    def test_english_is_required(self, tmp_path):
        path = self._write(tmp_path, {})
        with pytest.raises(SystemExit) as raised:
            lp.main(["validate", str(path)])
        assert raised.value.code == 2

    def test_a_utf8_pack_is_read_as_utf8(self, tmp_path, capsys):
        path = tmp_path / "pack.json"
        path.write_bytes(
            json.dumps(
                {**HEADER, "strings": {"common": {"actions.save": "שמור"}}}, ensure_ascii=False
            ).encode()
        )
        assert lp.main(["validate", str(path), "--english", str(EN_DIR)]) == 0
        assert "1 strings checked, 0 problem(s)" in capsys.readouterr().out

    def test_a_forging_key_is_printed_escaped(self, tmp_path, capsys):
        path = self._write(tmp_path, {"common": {"a‮b": "x", "שלום": "x"}})
        assert lp.main(["validate", str(path), "--english", str(EN_DIR)]) == 1
        out = capsys.readouterr().out
        assert '"a\\u202eb"' in out
        assert "‮" not in out
        assert '"\\u05e9\\u05dc\\u05d5\\u05dd"' in out

    def test_a_file_that_is_not_an_object_counts_no_strings(self, tmp_path, capsys):
        path = tmp_path / "list.json"
        path.write_text("[1, 2]", encoding="utf-8")
        assert lp.main(["validate", str(path), "--english", str(EN_DIR)]) == 1
        assert "0 strings checked, 1 problem(s)" in capsys.readouterr().out

    def test_strings_that_are_not_an_object_count_none(self, tmp_path, capsys):
        path = tmp_path / "odd.json"
        path.write_text(json.dumps({**HEADER, "strings": []}), encoding="utf-8")
        assert lp.main(["validate", str(path), "--english", str(EN_DIR)]) == 1
        assert "0 strings checked" in capsys.readouterr().out
