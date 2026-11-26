"""``custom_locale_store``: the database side of custom languages.

The pure helpers (ETags, label diffs, the ``metamodel`` import rules, size
bounds, the transfer check, the bundle cache, the share filter) need no
database; the rest runs on the test session.
"""

from __future__ import annotations

import json

import pytest
from sqlalchemy import select

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
            ({"source": "community"}, "invalid source"),
            ({"source": "elsewhere", "source_sha256": "a" * 64}, "invalid source"),
            ({"source_sha256": "a" * 64}, "invalid source"),
            ({"source_commit": "b" * 40}, "invalid source"),
            ({"source": "community", "source_sha256": "A" * 64}, "invalid source"),
            ({"source": "community", "source_sha256": "a" * 63}, "invalid source"),
            (
                {"source": "community", "source_sha256": "a" * 64, "source_commit": "b" * 39},
                "invalid source",
            ),
        ],
    )
    def test_refused(self, kw, fragment):
        assert fragment in store.transfer_problem(self.row(**kw))

    @pytest.mark.parametrize(
        "kw",
        [
            {"source": None, "source_sha256": None, "source_commit": None},
            {"source": "community", "source_sha256": "a" * 64},
            {"source": "community", "source_sha256": "a" * 64, "source_commit": "b" * 40},
        ],
    )
    def test_provenance_accepted(self, kw):
        assert store.transfer_problem(self.row(**kw)) is None

    def test_shape_helpers(self):
        assert store.is_sha256("0" * 64) and not store.is_sha256("0" * 64 + "\n")
        assert not store.is_sha256(None) and not store.is_commit(1)
        assert store.is_commit("f" * 40) and not store.is_commit("f" * 41)


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


# ── Identical English text ──────────────────────────────────────────────────

TWINS = lp.Namespace.from_tree(
    "common",
    {
        "a": "High",
        "b": "High",
        "c": "High",
        "d": "Low",
        "n_one": "{{count}} item",
        "n_other": "{{count}} items",
        "m_other": "{{count}} items",
        "p": "{{count}} items",
    },
)


def twin_view(strings: dict | None = None) -> store.View:
    return store.View(ns=TWINS, strings=dict(strings or {}), meta={})


def row(key: str) -> dict:
    return {"namespace": "common", "key": key, "source_hash": TWINS.current_hash(key)}


class TestCollapseIdentical:
    def test_each_text_once_with_its_key_count(self):
        out = store.collapse_identical([row(k) for k in ("a", "d", "b", "c")])
        assert [(r["key"], r["same_text"]) for r in out] == [("a", 3), ("d", 1)]

    def test_a_plural_category_is_its_own_text(self):
        """``n_other``, ``m_other`` and plain ``p`` share English; only the
        two ``_other`` forms are one text."""
        out = store.collapse_identical([row(k) for k in ("n_other", "p", "m_other", "n_one")])
        assert [(r["key"], r["same_text"]) for r in out] == [
            ("n_other", 2),
            ("p", 1),
            ("n_one", 1),
        ]

    def test_the_rows_are_copies(self):
        rows = [row("a"), row("b")]
        store.collapse_identical(rows)
        assert "same_text" not in rows[0]


class TestIdenticalTextFills:
    def test_untranslated_twins_get_the_value(self):
        views = {"common": twin_view()}
        fills = store.identical_text_fills(views, {"common": {"a": "Hoog"}}, set())
        assert fills == {"common": {"b": "Hoog", "c": "Hoog"}}

    def test_a_translated_twin_is_never_overwritten(self):
        views = {"common": twin_view({"b": "Hoog (oud)"})}
        fills = store.identical_text_fills(views, {"common": {"a": "Hoog"}}, set())
        assert fills == {"common": {"c": "Hoog"}}

    def test_a_submitted_twin_keeps_its_own_value(self):
        views = {"common": twin_view()}
        sent = {"common": {"b": "Hoog", "a": "Hoog"}}
        assert store.identical_text_fills(views, sent, set()) == {"common": {"c": "Hoog"}}

    def test_two_different_values_for_one_text_fill_nothing(self):
        views = {"common": twin_view()}
        for sent in (
            {"common": {"a": "Hoog", "b": "Hoge"}},
            {"common": {"b": "Hoge", "a": "Hoog"}},
        ):
            assert store.identical_text_fills(views, sent, set()) == {}
        # Across namespaces too, and a third agreeing value does not revive it.
        other = lp.Namespace.from_tree("admin", {"x": "High", "y": "High"})
        views["admin"] = store.View(ns=other, strings={}, meta={})
        sent = {"common": {"a": "Hoog", "b": "Hoog"}, "admin": {"x": "Hoge"}}
        assert store.identical_text_fills(views, sent, set()) == {}

    def test_a_value_from_older_english_fills_nothing(self):
        views = {"common": twin_view()}
        sent = {"common": {"a": "Hoog"}}
        old = {"common": {"a": "0123456789ab"}}
        assert store.identical_text_fills(views, sent, set(), old) == {}
        current = {"common": {"a": TWINS.current_hash("a")}}
        assert store.identical_text_fills(views, sent, set(), current) == {
            "common": {"b": "Hoog", "c": "Hoog"}
        }
        # A hash for another key, or an odd hashes map, changes nothing.
        for odd in ({"common": {"b": "0123456789ab"}}, {"common": "x"}, {"nav": {"a": "x"}}):
            assert store.identical_text_fills(views, sent, set(), odd) == {
                "common": {"b": "Hoog", "c": "Hoog"}
            }

    def test_a_refused_value_is_never_spread(self):
        views = {"common": twin_view()}
        sent = {"common": {"a": "Hoog"}}
        assert store.identical_text_fills(views, sent, {("common", "a")}) == {}

    def test_plural_categories_do_not_mix(self):
        views = {"common": twin_view()}
        fills = store.identical_text_fills(
            views, {"common": {"n_other": "{{count}} dingen"}}, set()
        )
        assert fills == {"common": {"m_other": "{{count}} dingen"}}

    def test_unknown_keys_namespaces_and_odd_values_are_ignored(self):
        views = {"common": twin_view()}
        sent = {"common": {"zz": "High", "a": None}, "nope": {"a": "x"}, "nav": "odd"}
        assert store.identical_text_fills(views, sent, set()) == {}

    def test_across_namespaces(self):
        other = lp.Namespace.from_tree("admin", {"x": "High"})
        views = {
            "common": twin_view(),
            "admin": store.View(ns=other, strings={}, meta={}),
        }
        fills = store.identical_text_fills(views, {"admin": {"x": "Hoog"}}, set())
        assert fills == {"common": {"a": "Hoog", "b": "Hoog", "c": "Hoog"}}


class TestFillIdentical:
    """On the real catalogue: "Description" is ``labels.description``,
    ``dashboard.settings.description`` and ``portal.description``."""

    TWINS = ("dashboard.settings.description", "portal.description")

    @staticmethod
    def namespaces() -> list[str]:
        cat = store.catalog()
        return sorted(
            name
            for name in cat.names()
            if any(
                text == "Description" and (name, key) != ("common", "labels.description")
                for key, text in cat.namespace(name).strings.items()
            )
        )

    @staticmethod
    def others() -> int:
        """Every other key of the catalogue whose English is "Description"."""
        cat = store.catalog()
        return (
            sum(
                text == "Description"
                for name in cat.names()
                for text in cat.namespace(name).strings.values()
            )
            - 1
        )

    async def _locale(self, db):
        loc = CustomLocale(code="nl", name="N", english_name="Dutch")
        db.add(loc)
        await db.flush()
        return loc

    async def _stored(self, db, loc) -> CustomLocaleString | None:
        await db.flush()
        found = await db.execute(
            select(CustomLocaleString).where(
                CustomLocaleString.locale_id == loc.id,
                CustomLocaleString.namespace == "common",
            )
        )
        return found.scalar_one_or_none()

    async def test_fills_the_twins_with_the_writes_origin(self, db):
        loc = await self._locale(db)
        cat = store.catalog()
        sent = {"common": {"labels.description": "Beschrijving"}}
        report = await store.apply_strings(db, loc, cat, sent, origin="mcp")
        out = await store.fill_identical(db, loc, cat, sent, report, origin="mcp", dry_run=False)
        assert out == ({"filled": self.others(), "fill_rejected": 0}, self.namespaces())
        stored = await self._stored(db, loc)
        for key in self.TWINS:
            assert stored.strings[key] == "Beschrijving"
            assert stored.meta[key]["o"] == "mcp"

    async def test_a_dry_run_counts_and_stores_nothing(self, db):
        loc = await self._locale(db)
        cat = store.catalog()
        sent = {"common": {"labels.description": "Beschrijving"}}
        report = await store.apply_strings(db, loc, cat, sent, origin="mcp", dry_run=True)
        out = await store.fill_identical(db, loc, cat, sent, report, origin="mcp", dry_run=True)
        assert out == ({"filled": self.others(), "fill_rejected": 0}, self.namespaces())
        assert await self._stored(db, loc) is None

    async def test_a_rejected_value_fills_nothing(self, db):
        loc = await self._locale(db)
        cat = store.catalog()
        sent = {"common": {"labels.description": "<b>Beschrijving</b>"}}
        report = await store.apply_strings(db, loc, cat, sent, origin="mcp")
        assert report["rejected"]
        out = await store.fill_identical(db, loc, cat, sent, report, origin="mcp", dry_run=False)
        assert out == ({"filled": 0, "fill_rejected": 0}, [])

    async def test_a_value_set_meanwhile_is_kept(self, db, monkeypatch):
        """The views say every twin is empty, but one was written since: the
        conditional write leaves it."""
        loc = await self._locale(db)
        cat = store.catalog()
        empty = await store.load_views(db, loc, cat, None)
        await store.apply_strings(
            db, loc, cat, {"common": {"portal.description": "Eigen"}}, origin="manual"
        )

        async def stale_views(*_args, **_kwargs):
            return empty

        monkeypatch.setattr(store, "load_views", stale_views)
        sent = {"common": {"labels.description": "Beschrijving"}}
        report = await store.apply_strings(db, loc, cat, sent, origin="mcp")
        counts, _ = await store.fill_identical(
            db, loc, cat, sent, report, origin="mcp", dry_run=False
        )
        assert counts["filled"] == self.others() - 1
        stored = await self._stored(db, loc)
        assert stored.strings["portal.description"] == "Eigen"
        assert stored.strings["dashboard.settings.description"] == "Beschrijving"

    async def test_rejected_fills_are_counted(self, db, monkeypatch):
        loc = await self._locale(db)
        cat = store.catalog()
        sent = {"common": {"labels.description": "Beschrijving"}}
        report = await store.apply_strings(db, loc, cat, sent, origin="mcp")
        seen: list = []

        async def refusing(_db, _loc, _cat, fills, **kwargs):
            seen.append((fills, kwargs))
            return {"applied": 1, "rejected": [{"namespace": "common", "key": "x"}] * 2}

        monkeypatch.setattr(store, "apply_strings", refusing)
        counts, _ = await store.fill_identical(
            db, loc, cat, sent, report, origin="import", dry_run=True
        )
        assert counts == {"filled": 1, "fill_rejected": 2}
        ((fills, kwargs),) = seen
        assert kwargs["origin"] == "import" and kwargs["dry_run"] is True
        # Conditional on every filled key still being empty.
        assert kwargs["expected"] == {name: dict.fromkeys(keys) for name, keys in fills.items()}
