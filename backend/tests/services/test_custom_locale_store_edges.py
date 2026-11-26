"""``custom_locale_store`` on the database: locking, reads, the bundle, the
metamodel merge and the write path's edges. The pure helpers that need no
database are at the top.
"""

from __future__ import annotations

import json
from datetime import datetime, timezone
from types import SimpleNamespace

import pytest
from sqlalchemy import event as sa_event
from sqlalchemy import select

from app.config import APP_VERSION
from app.config import settings as app_config
from app.models.custom_locale import CustomLocale, CustomLocaleString
from app.models.user import User
from app.services import custom_locale_store as store
from app.services import language_pack as lp
from app.services import metamodel_strings as mm
from tests.conftest import create_card_type, create_user

OLD = "0123456789ab"
T1 = datetime(2026, 1, 1, tzinfo=timezone.utc)
T2 = datetime(2026, 2, 1, tzinfo=timezone.utc)


@pytest.fixture
def sql(db):
    """Every statement the test session sends, in order."""
    statements: list[str] = []
    bind = db.sync_session.get_bind()

    @sa_event.listens_for(bind, "before_cursor_execute")
    def _record(conn, cursor, statement, parameters, context, executemany):
        statements.append(" ".join(statement.split()))

    yield statements
    sa_event.remove(bind, "before_cursor_execute", _record)


async def _locale(db, code="nl", **kw):
    loc = CustomLocale(code=code, name=kw.pop("name", "Nederlands"), english_name="Dutch", **kw)
    db.add(loc)
    await db.flush()
    return loc


# ---------------------------------------------------------------------------
# Pure
# ---------------------------------------------------------------------------


class TestPure:
    def test_last_change_is_the_latest_stamp(self):
        locale = SimpleNamespace(updated_at=T1)
        rows = {"common": SimpleNamespace(updated_at=T2), "nav": SimpleNamespace(updated_at=None)}
        assert store.last_change(locale, rows) == T2
        assert store.last_change(SimpleNamespace(updated_at=None), {}) is None

    def test_serialize_formats_the_stamp(self):
        locale = SimpleNamespace(
            code="nl",
            name="N",
            english_name="Dutch",
            rtl=False,
            enabled=True,
            updated_at=T1,
            translate_job=None,
            source=None,
        )
        out = store.serialize(locale, {}, None)
        assert out["updated_at"] == T1.isoformat()
        assert out["source"] is None
        locale.source = "community"
        assert store.serialize(locale, {}, None)["source"] == "community"
        assert out["stats"] is None and "namespaces" not in out
        locale.updated_at = None
        assert store.serialize(locale, {}, None)["updated_at"] is None

    def test_namespace_stats_reads_the_meta(self):
        ns = lp.Namespace.from_tree("common", {"a": "A", "b": "B"})
        view = store.View(ns=ns, strings={"a": "x", "b": "y"}, meta={"a": {"h": ns.hashes["a"]}})
        assert store.namespace_stats({"common": view}) == [
            {"namespace": "common", "total": 2, "translated": 1, "missing": 0, "stale": 1}
        ]

    def test_list_strings_filters_one_namespace_without_stopping_early(self):
        meta_ns = mm.namespace_of([mm.Entry("type.A.label", "A", None, True)])
        common = lp.Namespace.from_tree("common", {"a": "Apple"})
        views = {
            "metamodel": store.View(ns=meta_ns, strings={}, meta={}),
            "common": store.View(ns=common, strings={}, meta={}),
        }
        rows = store.list_strings(views, namespace="common", status="all", search="")
        assert [r["key"] for r in rows] == ["a"]

    def test_build_views_without_a_snapshot_has_no_metamodel(self):
        cat = lp.catalog_from_trees({"common": {"a": "A"}})
        assert list(store.build_views(cat, None, "nl", {})) == ["common"]

    def test_the_catalogue_follows_the_setting(self, tmp_path, monkeypatch):
        (tmp_path / "only.json").write_text('{"k": "v"}', encoding="utf-8")
        monkeypatch.setattr(app_config, "I18N_EN_DIR", str(tmp_path))
        assert store.catalog().names == ["only"]

    def test_the_hash_is_the_bundle_hash_of_the_locale(self):
        loc = SimpleNamespace(code="he", name="עברית", rtl=True)
        cat = lp.catalog_from_trees({"common": {"a": "A"}})
        rows = [("common", "d")]
        assert store.locale_hash(loc, rows, cat) == lp.bundle_hash(
            cat.fingerprint, "he", "עברית", True, rows, APP_VERSION
        )
        assert store.locale_hash(loc, rows, None) == lp.bundle_hash(
            "no-catalog", "he", "עברית", True, rows, APP_VERSION
        )

    @pytest.mark.parametrize(("header", "match"), [('"x","abc"', True), ("W/abc", True)])
    def test_etag_forms(self, header, match):
        assert store.etag_matches(header, "abc") is match

    def test_etag_keeps_the_tag_characters(self):
        assert store.etag_matches('"XA1"', "XA1")

    def test_the_bundle_cache_holds_sixteen_by_default(self):
        cache = store.BundleCache()
        for i in range(17):
            cache.put("nl", str(i), b"x")
        assert cache.get("nl", "0") is None
        assert cache.get("nl", "1") == b"x" and cache.get("nl", "16") == b"x"

    def test_the_bundle_body(self):
        loc = SimpleNamespace(code="he", name="עברית", rtl=True)
        rows = {"common": CustomLocaleString(namespace="common", strings={"actions.save": "שמור"})}
        cat = lp.catalog_from_trees({"common": {"actions": {"save": "Save"}}})
        body = store.bundle_body(loc, "tag", cat, rows)
        assert "שמור".encode() in body
        assert json.loads(body) == {
            "code": "he",
            "name": "עברית",
            "rtl": True,
            "hash": "tag",
            "resources": {"common": {"actions": {"save": "שמור"}}},
        }
        flat = json.loads(store.bundle_body(loc, "tag", None, rows))
        assert flat["resources"] == {"common": {"actions.save": "שמור"}}

    def test_bundle_resources_reads_each_namespace(self):
        cat = lp.catalog_from_trees({"a": {"x": "X"}, "b": {"y": "Y"}})
        rows = {
            "a": CustomLocaleString(namespace="a", strings={"x": "ix"}),
            "b": CustomLocaleString(namespace="b", strings={}),
        }
        assert store.bundle_resources(cat, rows, "nl") == {"a": {"x": "ix"}}


# ---------------------------------------------------------------------------
# Reads on the database
# ---------------------------------------------------------------------------


class TestReads:
    async def test_get_locale_locks_only_when_asked_and_rereads(self, db, sql):
        loc = await _locale(db)
        sql.clear()
        await store.get_locale(db, "nl")
        assert not any("FOR UPDATE" in s for s in sql)
        await db.execute(
            CustomLocale.__table__.update().where(CustomLocale.id == loc.id).values(name="Vlaams")
        )
        stale = await store.get_locale(db, "nl")
        assert stale.name == "Nederlands"
        fresh = await store.get_locale(db, "nl", lock=True)
        assert fresh.name == "Vlaams"
        assert any("FOR UPDATE" in s for s in sql)

    async def test_list_locales_is_ordered_by_code(self, db):
        await _locale(db, "th")
        await _locale(db, "he")
        assert [loc.code for loc in await store.list_locales(db)] == ["he", "th"]

    async def test_is_enabled_code_checks_the_code(self, db):
        await _locale(db, "nl", enabled=True)
        await _locale(db, "th", enabled=False)
        assert await store.is_enabled_code(db, "nl")
        assert not await store.is_enabled_code(db, "th")
        assert not await store.is_enabled_code(db, "he")

    async def test_the_metamodel_view_carries_the_pack_strings(self, db):
        row = CustomLocaleString(namespace="metamodel", strings={"lifecycle.plan": "Gepland"})
        view = store.metamodel_view(await mm.load(db), "nl", row)
        assert view.strings["lifecycle.plan"] == "Gepland"

    async def test_load_views_reads_no_metamodel_it_does_not_need(self, db, monkeypatch):
        loc = await _locale(db)

        async def refuse(_db):
            raise AssertionError("the metamodel labels were read")

        monkeypatch.setattr(mm, "load", refuse)
        views = await store.load_views(db, loc, lp.catalog_from_trees({"common": {}}), ["common"])
        assert list(views) == ["common"]

    async def test_without_a_catalogue_no_labels_are_read(self, db, monkeypatch):
        loc = await _locale(db)

        async def refuse(_db):
            raise AssertionError("the metamodel labels were read")

        monkeypatch.setattr(store, "catalog", lambda: None)
        monkeypatch.setattr(mm, "load", refuse)
        assert (await store.serialize_all(db, [loc]))[0]["stats"] is None
        assert (await store.serialize_one(db, loc))["stats"] is None

    async def test_progress_counts_the_locales_own_labels(self, db):
        loc = await _locale(db)
        await _locale(db, "he")
        await create_card_type(
            db, key="Widget", label="Widget", translations={"label": {"nl": "D"}}
        )
        by_code = {
            e["code"]: e for e in await store.serialize_all(db, await store.list_locales(db))
        }
        assert by_code["nl"]["stats"]["translated"] == 1
        assert by_code["he"]["stats"]["translated"] == 0
        one = await store.serialize_one(db, loc)
        assert one["namespaces"][0] == {
            "namespace": "metamodel",
            "total": one["namespaces"][0]["total"],
            "translated": 1,
            "missing": one["namespaces"][0]["total"] - 1,
            "stale": 0,
        }

    async def test_digests_are_per_locale(self, db):
        nl = await _locale(db)
        he = await _locale(db, "he")
        db.add_all(
            [
                CustomLocaleString(locale_id=nl.id, namespace="common", strings={"a": "1"}),
                CustomLocaleString(locale_id=he.id, namespace="common", strings={"a": "2"}),
            ]
        )
        await db.flush()
        digests = await store.namespace_digests(db, [nl.id])
        assert list(digests) == [nl.id] and len(digests[nl.id]) == 1

    async def test_the_export_names_the_app_version(self, db):
        loc = await _locale(db)
        assert store.export_pack(loc, {}, mode="all")["app_version"] == APP_VERSION

    async def test_bootstrap_reads_only_the_metamodel_row_for_phase_help(self, db):
        nl = await _locale(db, enabled=True)
        db.add(
            CustomLocaleString(
                locale_id=nl.id, namespace="metamodel", strings={"lifecycle.plan": "Gepland"}
            )
        )
        await db.flush()
        db.add(CustomLocaleString(locale_id=nl.id, namespace="common", strings={"a": "x"}))
        db.add(CustomLocaleString(locale_id=nl.id, namespace="nav", strings={"b": "y"}))
        await db.flush()
        _entries, help_out = await store.bootstrap_payload(db, {"plan": {"en": "Plan"}})
        assert help_out == {"plan": {"en": "Plan", "nl": "Gepland"}}


# ---------------------------------------------------------------------------
# Writes
# ---------------------------------------------------------------------------


class TestWrites:
    async def test_lock_locale_locks_that_row(self, db, sql):
        loc = await _locale(db)
        sql.clear()
        await store.lock_locale(db, loc)
        (statement,) = sql
        assert statement.startswith("SELECT custom_locales.id FROM custom_locales WHERE")
        assert "custom_locales.id = " in statement and statement.endswith("FOR UPDATE")

    async def test_locked_row_is_the_locales_own(self, db):
        nl = await _locale(db)
        he = await _locale(db, "he")
        mine = CustomLocaleString(locale_id=he.id, namespace="common", strings={"a": "he"})
        db.add_all([CustomLocaleString(locale_id=nl.id, namespace="common"), mine])
        await db.flush()
        assert await store.locked_row(db, he, "common", create=False) is mine
        created = await store.locked_row(db, he, "nav", create=True)
        assert (created.strings, created.meta, created.locale_id) == ({}, {}, he.id)
        assert await store.locked_row(db, he, "grc", create=False) is None

    async def test_a_dry_run_writes_nothing_to_existing_rows(self, db):
        loc = await _locale(db)
        row = CustomLocaleString(
            locale_id=loc.id, namespace="common", strings={"actions.save": "x"}
        )
        db.add(row)
        ct = await create_card_type(db, key="Widget", label="Widget")
        await db.flush()
        report = await store.apply_strings(
            db,
            loc,
            store.catalog(),
            {"common": {"actions.save": "Opslaan"}, "metamodel": {"type.Widget.label": "Ding"}},
            origin="manual",
            dry_run=True,
        )
        assert report["applied"] == 2
        # Read in the session, not re-read: a dry run must not even stage a change.
        assert row.strings == {"actions.save": "x"}
        assert ct.translations == {}

    async def test_stored_meta_of_other_keys_survives_a_write(self, db):
        loc = await _locale(db)
        ns = store.catalog().namespace("common")
        db.add(
            CustomLocaleString(
                locale_id=loc.id,
                namespace="common",
                strings={"actions.save": "Opslaan"},
                meta={"actions.save": {"h": OLD, "o": "import"}},
            )
        )
        await db.flush()
        await store.apply_strings(
            db,
            loc,
            store.catalog(),
            {"common": {"actions.cancel": "Annuleren"}},
            origin="manual",
            source_hashes={"common": "junk"},
        )
        row = (await db.execute(select(CustomLocaleString))).scalar_one()
        await db.refresh(row)
        assert row.meta["actions.save"] == {"h": OLD, "o": "import"}
        assert row.meta["actions.cancel"] == {"h": ns.hashes["actions.cancel"], "o": "manual"}

    async def test_a_non_mapping_namespace_counts_nothing(self, db):
        loc = await _locale(db)
        report = await store.apply_strings(
            db, loc, store.catalog(), {"common": ["a", "b"]}, origin="import"
        )
        assert report["unknown"] == 0 and report["unknown_keys"] == []

    async def test_reset_users(self, db):
        a = await create_user(db, email="a@test.com")
        b = await create_user(db, email="b@test.com")
        a.locale = b.locale = "nl"
        await create_user(db, email="c@test.com")
        await db.flush()
        assert await store.reset_users(db, "nl") == 2
        await db.flush()
        locales = dict((await db.execute(select(User.email, User.locale))).all())
        assert locales["a@test.com"] == locales["b@test.com"] == "en"

    async def test_mark_interrupted_counts_every_job_and_stamps_utc(self, db):
        for code in ("nl", "he"):
            loc = await _locale(db, code)
            loc.translate_job = {"status": "running"}
        await db.flush()
        assert await store.mark_interrupted_jobs(db) == 2
        for loc in await store.list_locales(db):
            assert loc.translate_job["finished_at"].endswith("+00:00")


class TestMetamodelMerge:
    async def test_a_dry_run_on_an_existing_row_writes_nothing(self, db):
        loc = await _locale(db)
        ct = await create_card_type(db, key="A", label="A")
        cat = store.catalog()
        await store.apply_strings(
            db, loc, cat, {"metamodel": {"type.A.label": "Aa"}}, origin="manual"
        )
        report = await store.apply_strings(
            db, loc, cat, {"metamodel": {"type.A.label": "Ab"}}, origin="manual", dry_run=True
        )
        assert report["applied"] == 1
        await db.refresh(ct)
        assert ct.translations["label"]["nl"] == "Aa"

    async def test_a_community_label_needs_its_hash_like_an_import(self, db):
        loc = await _locale(db)
        await create_card_type(db, key="A", label="A", translations={"label": {"nl": "Aa"}})
        await create_card_type(db, key="B", label="B")
        report = await store.apply_strings(
            db,
            loc,
            store.catalog(),
            {"metamodel": {"type.A.label": "Aa", "type.B.label": "Bb"}},
            origin=store.ORIGIN_COMMUNITY,
        )
        # The value already stored is unchanged even without a hash (as for an
        # import); a new one without a hash is refused.
        assert report["unchanged"] == 1
        assert report["rejected"] == [
            {"namespace": "metamodel", "key": "type.B.label", "reason": "source_hash_missing"}
        ]
        assert store.FILE_ORIGINS == {"import", "community"}

    async def test_meta_of_an_untouched_label_is_kept(self, db):
        loc = await _locale(db)
        await create_card_type(db, key="A", label="A", translations={"label": {"nl": "Aa"}})
        await create_card_type(db, key="B", label="B")
        db.add(
            CustomLocaleString(
                locale_id=loc.id,
                namespace="metamodel",
                strings={},
                meta={"type.A.label": {"h": OLD, "o": "import"}},
            )
        )
        await db.flush()
        await store.apply_strings(
            db, loc, store.catalog(), {"metamodel": {"type.B.label": "Bb"}}, origin="manual"
        )
        row = (await db.execute(select(CustomLocaleString))).scalar_one()
        await db.refresh(row)
        assert row.meta["type.A.label"] == {"h": OLD, "o": "import"}
        assert row.meta["type.B.label"] == {"h": lp.source_hash("B"), "o": "manual"}

    async def test_unchanged_from_both_rules_adds_up(self, db):
        loc = await _locale(db)
        await create_card_type(db, key="A", label="A", translations={"label": {"nl": "Aa"}})
        await create_card_type(db, key="B", label="B", translations={"label": {"nl": "Bb"}})
        await create_card_type(db, key="C", label="C")
        report = await store.apply_strings(
            db,
            loc,
            store.catalog(),
            {"metamodel": {"type.A.label": "Aa", "type.B.label": "Bb", "type.C.label": None}},
            origin="mcp",
            source_hashes={"metamodel": {"type.A.label": OLD, "type.B.label": OLD}},
        )
        assert report["unchanged"] == 3

    async def test_an_expected_value_guards_a_label_too(self, db):
        loc = await _locale(db)
        ct = await create_card_type(
            db, key="A", label="A", translations={"label": {"nl": "Handmatig"}}
        )
        report = await store.apply_strings(
            db,
            loc,
            store.catalog(),
            {"metamodel": {"type.A.label": "AI"}},
            origin="ai",
            expected={"metamodel": {"type.A.label": None}},
        )
        assert report["unchanged"] == 1
        await db.refresh(ct)
        assert ct.translations == {"label": {"nl": "Handmatig"}}

    async def test_the_labels_are_read_once_per_write(self, db, monkeypatch):
        loc = await _locale(db)
        await create_card_type(db, key="A", label="A")
        calls = []
        real = mm.load

        async def counting(db_):
            calls.append(1)
            return await real(db_)

        monkeypatch.setattr(mm, "load", counting)
        await store.apply_strings(
            db, loc, store.catalog(), {"metamodel": {"type.A.label": "Aa"}}, origin="manual"
        )
        assert len(calls) == 1

    async def test_two_unchanged_by_the_hash_rule_count_two(self, db):
        loc = await _locale(db)
        await create_card_type(db, key="A", label="A", translations={"label": {"nl": "Aa"}})
        await create_card_type(db, key="B", label="B", translations={"label": {"nl": "Bb"}})
        hashes = {"type.A.label": OLD, "type.B.label": OLD}
        view = store.metamodel_view(await mm.load(db), "nl", None)
        split = store.source_changed(
            view, {"type.A.label": "Aa", "type.B.label": "Bb"}, hashes, origin="mcp"
        )
        assert split.unchanged == 2
        assert loc.code == "nl"
