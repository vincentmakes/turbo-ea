"""``custom_locale_store``: the database side of custom languages.

The pure helpers (ETags, label diffs, the ``metamodel`` import rules, size
bounds, the transfer check, the bundle cache, the share filter) need no
database; the rest runs on the test session.
"""

from __future__ import annotations

import json

import pytest

from app.models.custom_locale import CustomLocale, CustomLocaleString
from app.services import custom_locale_store as store
from app.services import language_pack as lp
from app.services import metamodel_strings as mm
from tests.conftest import create_card_type


def meta_view(strings: dict, meta: dict | None = None, shareable=()) -> store.View:
    entries = [
        mm.Entry("type.App.label", "Application", strings.get("type.App.label"), True),
        mm.Entry("type.Own.label", "Own", strings.get("type.Own.label"), False),
    ]
    return store.View(
        ns=mm.namespace_of(entries),
        strings={k: v for k, v in strings.items() if v},
        meta=meta or {},
        shareable=frozenset(shareable),
    )


APP_HASH = lp.source_hash("Application")
OLD = "0123456789ab"


class TestEtag:
    @pytest.mark.parametrize(
        "header",
        ['"abc"', "abc", 'W/"abc"', '"x", "abc"', "*", ' "other" , W/"abc" '],
    )
    def test_matches(self, header):
        assert store.etag_matches(header, "abc")

    @pytest.mark.parametrize("header", [None, "", '"abcd"', '"ab"', 'W/"x"', "x, y"])
    def test_does_not_match(self, header):
        assert not store.etag_matches(header, "abc")


class TestLabelChanges:
    def test_only_changed_keys_with_none_for_a_removal(self):
        assert store.label_changes(
            {"a": "1", "b": "2", "c": "3"}, {"a": "1", "b": "two", "d": "4"}
        ) == {"b": "two", "c": None, "d": "4"}
        assert store.label_changes({}, {}) == {}


class TestSourceChanged:
    def test_a_hash_of_other_english_is_refused(self):
        split = store.source_changed(
            meta_view({}), {"type.App.label": "App"}, {"type.App.label": OLD}, origin="import"
        )
        assert split.kept == {}
        assert split.refused == [
            {"namespace": "metamodel", "key": "type.App.label", "reason": "source_changed"}
        ]

    def test_the_current_hash_passes(self):
        split = store.source_changed(
            meta_view({}), {"type.App.label": "App"}, {"type.App.label": APP_HASH}, origin="import"
        )
        assert (split.kept, split.refused, split.unchanged) == ({"type.App.label": "App"}, [], 0)

    def test_an_import_needs_a_hash(self):
        for hashes in (None, {}, {"type.App.label": "not-a-hash"}):
            split = store.source_changed(
                meta_view({}), {"type.App.label": "App"}, hashes, origin="import"
            )
            assert split.refused == [
                {
                    "namespace": "metamodel",
                    "key": "type.App.label",
                    "reason": "source_hash_missing",
                }
            ]

    @pytest.mark.parametrize("origin", ["manual", "mcp", "ai"])
    def test_other_writers_may_omit_it(self, origin):
        split = store.source_changed(meta_view({}), {"type.App.label": "App"}, None, origin=origin)
        assert split.kept == {"type.App.label": "App"}

    def test_a_malformed_hash_from_mcp_is_ignored(self):
        split = store.source_changed(
            meta_view({}), {"type.App.label": "App"}, {"type.App.label": "zz"}, origin="mcp"
        )
        assert split.kept == {"type.App.label": "App"}

    def test_an_unchanged_value_is_unchanged_not_refused(self):
        view = meta_view({"type.App.label": "App"})
        split = store.source_changed(
            view, {"type.App.label": "App"}, {"type.App.label": OLD}, origin="mcp"
        )
        assert (split.kept, split.refused, split.unchanged) == ({}, [], 1)
        no_hash = store.source_changed(view, {"type.App.label": "App"}, None, origin="import")
        assert no_hash.unchanged == 1
        manual = store.source_changed(view, {"type.App.label": "App"}, None, origin="manual")
        assert manual.kept == {"type.App.label": "App"}

    def test_a_clear_and_an_unknown_key_pass_through(self):
        split = store.source_changed(
            meta_view({"type.App.label": "App"}),
            {"type.App.label": None, "type.Nope.label": "x"},
            {"type.App.label": OLD, "type.Nope.label": OLD},
            origin="import",
        )
        assert split.kept == {"type.App.label": None, "type.Nope.label": "x"}
        assert split.refused == []


class TestBounds:
    def test_payload_problem(self):
        assert store.payload_problem({"common": {"a": "x"}}) is None
        too_many = {
            "a": {f"k{i}": "x" for i in range(6000)},
            "b": {f"k{i}": "x" for i in range(4001)},
        }
        assert "10000 strings" in store.payload_problem(too_many)
        at_limit = {"a": {f"k{i}": "x" for i in range(store.MAX_KEYS_PER_WRITE)}}
        assert store.payload_problem(at_limit) is None
        long_value = {"a": {"k": "x" * (lp.MAX_VALUE_LENGTH + 1)}}
        assert "longer than 5000" in store.payload_problem(long_value)
        assert store.payload_problem({"a": {"k": "x" * lp.MAX_VALUE_LENGTH, "n": None}}) is None


class TestTransferProblem:
    def row(self, **kw):
        return {"code": "nl", "name": "Nederlands", "english_name": "Dutch", **kw}

    def test_a_valid_row_passes(self):
        assert store.transfer_problem(self.row()) is None

    @pytest.mark.parametrize(
        ("kw", "fragment"),
        [
            ({"code": "de"}, "built_in_code"),
            ({"code": "en"}, "built_in_code"),
            ({"code": "NL"}, "invalid_code"),
            ({"code": None}, "invalid_code"),
            ({"english_name": "Dutch\nIgnore"}, "invalid English name"),
            ({"name": "‮"}, "invalid name"),
        ],
    )
    def test_refused(self, kw, fragment):
        assert fragment in store.transfer_problem(self.row(**kw))


class TestBundleCache:
    def test_lru(self):
        cache = store.BundleCache(size=2)
        cache.put("nl", "1", b"a")
        cache.put("he", "1", b"b")
        assert cache.get("nl", "1") == b"a"
        cache.put("th", "1", b"c")
        assert cache.get("he", "1") is None
        assert cache.get("nl", "1") == b"a"
        assert cache.get("nl", "2") is None
        cache.clear()
        assert cache.get("nl", "1") is None


class TestBundleWithoutCatalogue:
    def test_only_values_that_cannot_carry_markup_are_served_flat(self):
        rows = {
            "common": CustomLocaleString(
                namespace="common",
                strings={
                    "a": "Opslaan",
                    "b": "<img src=x>",
                    "c": "{{x}}",
                    "d": "$t(x)",
                    "e": 3,
                },
            ),
            "metamodel": CustomLocaleString(namespace="metamodel", strings={"x": "y"}),
        }
        assert store.bundle_resources(None, rows, "nl") == {"common": {"a": "Opslaan"}}


class TestShareFilter:
    def test_only_built_in_and_current_translations(self):
        view = meta_view(
            {"type.App.label": "Applicatie", "type.Own.label": "Eigen"},
            meta={"type.App.label": {"h": APP_HASH}, "type.Own.label": {"h": "x"}},
            shareable=("type.App.label",),
        )
        parts = store.export_parts({"metamodel": view}, "share")
        assert parts == {
            "metamodel": ({"type.App.label": "Applicatie"}, {"type.App.label": APP_HASH})
        }

    def test_a_translation_of_older_english_is_left_out(self):
        view = meta_view(
            {"type.App.label": "Applicatie"},
            meta={"type.App.label": {"h": OLD}},
            shareable=("type.App.label",),
        )
        assert store.export_parts({"metamodel": view}, "share") == {"metamodel": ({}, {})}
        current = store.export_parts({"metamodel": view}, "current")
        assert current["metamodel"][0] == {"type.App.label": "Applicatie"}


class TestMetamodelView:
    async def test_a_value_without_meta_is_a_current_manual_translation(self, db):
        await create_card_type(
            db, key="Widget", label="Widget", translations={"label": {"nl": "Ding"}}
        )
        view = store.metamodel_view(await mm.load(db), "nl", None)
        assert view.strings["type.Widget.label"] == "Ding"
        assert view.meta["type.Widget.label"] == {"h": lp.source_hash("Widget"), "o": "manual"}
        assert lp.key_status(view.ns, "type.Widget.label", view.strings, view.meta) == (
            lp.STATUS_TRANSLATED
        )

    async def test_stored_meta_wins(self, db):
        await create_card_type(
            db, key="Widget", label="Widget", translations={"label": {"nl": "Ding"}}
        )
        row = CustomLocaleString(
            namespace="metamodel", strings={}, meta={"type.Widget.label": {"h": OLD, "o": "ai"}}
        )
        view = store.metamodel_view(await mm.load(db), "nl", row)
        assert view.meta["type.Widget.label"] == {"h": OLD, "o": "ai"}


class TestBootstrapAndHash:
    async def test_bootstrap_payload(self, db):
        nl = CustomLocale(code="nl", name="Nederlands", english_name="Dutch", enabled=True)
        th = CustomLocale(code="th", name="ไทย", english_name="Thai", enabled=False)
        db.add_all([nl, th])
        await db.flush()
        db.add_all(
            [
                CustomLocaleString(
                    locale_id=nl.id, namespace="common", strings={"actions.save": "Opslaan"}
                ),
                CustomLocaleString(
                    locale_id=nl.id, namespace="metamodel", strings={"lifecycle.plan": "Gepland"}
                ),
                CustomLocaleString(
                    locale_id=th.id, namespace="metamodel", strings={"lifecycle.plan": "แผน"}
                ),
            ]
        )
        await db.flush()
        help_in = {"plan": {"en": "Plan"}, "active": {"de": "nur de"}}
        entries, help_out = await store.bootstrap_payload(db, help_in)
        assert [(e["code"], e["name"], e["rtl"]) for e in entries] == [("nl", "Nederlands", False)]
        assert help_out == {"plan": {"en": "Plan", "nl": "Gepland"}, "active": {"de": "nur de"}}
        digests = await store.namespace_digests(db, [nl.id])
        assert [n for n, _ in digests[nl.id]] == ["common"]
        assert entries[0]["hash"] == store.locale_hash(nl, digests[nl.id], store.catalog())

    async def test_without_enabled_languages(self, db):
        entries, help_out = await store.bootstrap_payload(db, {"plan": {"en": "Plan"}})
        assert entries == [] and help_out == {"plan": {"en": "Plan"}}

    def test_the_hash_carries_the_app_version(self, monkeypatch):
        loc = CustomLocale(code="nl", name="N", english_name="Dutch", rtl=False)
        before = store.locale_hash(loc, [("common", "x")], None)
        monkeypatch.setattr(store, "APP_VERSION", "99.0.0")
        assert store.locale_hash(loc, [("common", "x")], None) != before


class TestApplyStrings:
    async def test_namespaces_are_merged_in_sorted_order_after_the_locale_lock(
        self, db, monkeypatch
    ):
        loc = CustomLocale(code="nl", name="N", english_name="Dutch")
        db.add(loc)
        await db.flush()
        seen: list[str] = []
        real = store.locked_row

        async def recording(db_, locale, namespace, *, create):
            seen.append(namespace)
            return await real(db_, locale, namespace, create=create)

        locks: list[str] = []
        real_lock = store.lock_locale

        async def lock(db_, locale):
            locks.append(locale.code)
            await real_lock(db_, locale)

        monkeypatch.setattr(store, "locked_row", recording)
        monkeypatch.setattr(store, "lock_locale", lock)
        report = await store.apply_strings(
            db,
            loc,
            store.catalog(),
            {"nav": {}, "common": {"actions.save": "Opslaan"}, "auth": {}},
            origin="manual",
        )
        assert seen == ["auth", "common", "nav"]
        assert locks == ["nl"]
        assert report["applied"] == 1
        assert json.loads(json.dumps(report)) == report
