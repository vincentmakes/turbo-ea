"""The helpers the three reference catalogues share (``catalogue_common``).

Each rule is pinned against literal expectations. The services' own suites
exercise the same helpers through a full import; these tests name the rule
that broke when one fails.
"""

from __future__ import annotations

import io
import json
import types
import uuid
import zipfile
from typing import Any

import httpx
import pytest
from sqlalchemy import select

from app.models.card import Card
from app.models.event import Event
from app.models.relation import Relation
from app.services import catalogue_common as common
from tests.conftest import create_card, create_user
from tests.seams import patch_httpx_client

# ---------------------------------------------------------------------------
# Pure helpers
# ---------------------------------------------------------------------------


class TestRemoteWins:
    def test_no_cache_never_wins(self):
        assert common.remote_wins(None, "1.0.0") is False

    def test_a_strictly_newer_cache_wins(self):
        assert common.remote_wins({"catalogue_version": "1.10.0"}, "1.9.0") is True

    def test_the_same_version_does_not_win(self):
        assert common.remote_wins({"catalogue_version": "1.9.0"}, "1.9.0") is False

    def test_an_older_cache_does_not_win(self):
        assert common.remote_wins({"catalogue_version": "1.8.9"}, "1.9.0") is False

    def test_a_cache_without_a_version_reads_as_zero(self):
        assert common.remote_wins({}, "0.0.1") is False
        assert common.remote_wins({}, "0") is False


def _fake_pkg(locales: tuple[str, ...] = ("en", "fr")) -> types.ModuleType:
    pkg = types.ModuleType("turbo_ea_capabilities")
    pkg.VERSION = "3.1.4"
    pkg.SCHEMA_VERSION = 2
    pkg.GENERATED_AT = "2026-10-01T00:00:00Z"
    pkg.available_locales = lambda: locales
    return pkg


class TestBundledPayload:
    def test_english_payload_and_meta(self, monkeypatch):
        monkeypatch.setattr(common, "bundled_i18n_table", lambda locale: {"A": {"name": "X"}})
        raw = [{"id": "A", "name": "Alpha"}, {"id": "B", "name": "Beta"}]
        flat, meta = common.bundled_payload(_fake_pkg(), locale="en", raw=raw, count_key="n")
        assert flat == raw
        assert meta == {
            "catalogue_version": "3.1.4",
            "schema_version": "2",
            "generated_at": "2026-10-01T00:00:00Z",
            "n": 2,
            "available_locales": ["en", "fr"],
            "active_locale": "en",
        }

    def test_another_locale_overlays_its_table(self, monkeypatch):
        tables = {"fr": {"A": {"name": "Alpha FR"}}}
        monkeypatch.setattr(common, "bundled_i18n_table", lambda locale: tables.get(locale))
        raw = [{"id": "A", "name": "Alpha"}, {"id": "B", "name": "Beta"}]
        flat, meta = common.bundled_payload(
            _fake_pkg(), locale="fr-CH", raw=raw, count_key="n", count=7
        )
        assert flat == [{"id": "A", "name": "Alpha FR"}, {"id": "B", "name": "Beta"}]
        assert meta["active_locale"] == "fr"
        assert meta["n"] == 7

    def test_a_locale_with_no_table_keeps_english(self, monkeypatch):
        monkeypatch.setattr(common, "bundled_i18n_table", lambda locale: None)
        raw = [{"id": "A", "name": "Alpha"}]
        flat, meta = common.bundled_payload(_fake_pkg(), locale="fr", raw=raw, count_key="n")
        assert flat == [{"id": "A", "name": "Alpha"}]
        assert meta["active_locale"] == "fr"

    def test_an_unshipped_locale_falls_back_to_english(self, monkeypatch):
        monkeypatch.setattr(common, "bundled_i18n_table", lambda locale: {"A": {"name": "X"}})
        raw = [{"id": "A", "name": "Alpha"}]
        flat, meta = common.bundled_payload(_fake_pkg(("en",)), locale="de", raw=raw, count_key="n")
        assert flat == [{"id": "A", "name": "Alpha"}]
        assert meta["active_locale"] == "en"
        assert meta["available_locales"] == ["en"]

    def test_flatten_runs_before_the_count(self, monkeypatch):
        monkeypatch.setattr(common, "bundled_i18n_table", lambda locale: None)
        raw = [{"id": "S", "parts": [{"id": "S.1"}, {"id": "S.2"}]}]

        def flatten(streams):
            return [{"id": p["id"]} for s in streams for p in s["parts"]]

        flat, meta = common.bundled_payload(
            _fake_pkg(), locale="en", raw=raw, count_key="n", flatten=flatten
        )
        assert flat == [{"id": "S.1"}, {"id": "S.2"}]
        assert meta["n"] == 2


class TestCatalogueAttributes:
    def test_the_header_every_import_carries(self):
        attrs = common.catalogue_attributes(
            {"id": "BC-1"},
            {"catalogue_version": "2.0.0", "active_locale": "en"},
            "2026-10-10T00:00:00+00:00",
            ("capabilityLevel", "L1"),
        )
        assert attrs == {
            "catalogueId": "BC-1",
            "catalogueVersion": "2.0.0",
            "catalogueImportedAt": "2026-10-10T00:00:00+00:00",
            "capabilityLevel": "L1",
        }

    def test_a_localized_import_records_its_locale(self):
        attrs = common.catalogue_attributes(
            {"id": "BC-1"}, {"active_locale": "de"}, "t", ("processLevel", "L2")
        )
        assert attrs == {
            "catalogueId": "BC-1",
            "catalogueVersion": None,
            "catalogueImportedAt": "t",
            "processLevel": "L2",
            "catalogueLocale": "de",
        }

    def test_copied_fields_keep_truthy_values_only(self):
        aliases = ["One", "Two"]
        node = {
            "id": "BP-1",
            "aliases": aliases,
            "industry": "Retail",
            "references": [],
            "notes": "",
            "deprecated": False,
            "in_scope": None,
            "stage_order": 0,
        }
        attrs = common.catalogue_attributes(
            node,
            {},
            "t",
            ("processLevel", "L3"),
            (
                ("aliases", "aliases"),
                ("industry", "industry"),
                ("references", "references"),
                ("notes", "notes"),
                ("deprecated", "deprecated"),
                ("in_scope", "inScope"),
                ("stage_order", "stageOrder"),
            ),
        )
        assert attrs == {
            "catalogueId": "BP-1",
            "catalogueVersion": None,
            "catalogueImportedAt": "t",
            "processLevel": "L3",
            "aliases": ["One", "Two"],
            "industry": "Retail",
        }
        # a list is copied, never shared with the catalogue node
        aliases.append("Three")
        assert attrs["aliases"] == ["One", "Two"]

    def test_a_true_flag_is_kept(self):
        attrs = common.catalogue_attributes(
            {"id": "X", "deprecated": True}, {}, "t", ("k", "v"), (("deprecated", "deprecated"),)
        )
        assert attrs["deprecated"] is True


# ---------------------------------------------------------------------------
# Wheel extraction
# ---------------------------------------------------------------------------


def _wheel(files: dict[str, Any]) -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, mode="w") as zf:
        for name, content in files.items():
            body = content if isinstance(content, str) else json.dumps(content)
            zf.writestr(f"turbo_ea_capabilities/data/{name}", body)
    return buf.getvalue()


class TestExtractAllCataloguesFromWheel:
    def test_every_artefact_is_read_and_children_are_stripped(self):
        wheel = _wheel(
            {
                "version.json": {"catalogue_version": "5.0.0"},
                "capabilities.json": [{"id": "BC-1", "children": ["BC-1.1"]}],
                "business-processes.json": [{"id": "BP-1", "children": ["BP-1.1"], "level": 1}],
                "value-streams.json": [{"id": "VS-1", "stages": [{"id": "VS-1.1"}]}],
                "macro-capabilities.json": [{"id": "MC-1", "capability_ids": ["BC-1"]}],
                "i18n/fr.json": {"BC-1": {"name": "Un"}},
                "i18n/de.json": {"BC-1": {"name": "Eins"}},
                "i18n/README.md": "not a table",
                "i18n/.json": {"BC-1": {"name": "nameless"}},
                "i18n/xx.json": ["not", "a", "dict"],
            }
        )
        out = common.extract_all_catalogues_from_wheel(wheel)
        assert out == {
            "version": {"catalogue_version": "5.0.0"},
            "capabilities": [{"id": "BC-1"}],
            "processes": [{"id": "BP-1", "level": 1}],
            "value_streams": [{"id": "VS-1", "stages": [{"id": "VS-1.1"}]}],
            "macros": [{"id": "MC-1", "capability_ids": ["BC-1"]}],
            "i18n": {"fr": {"BC-1": {"name": "Un"}}, "de": {"BC-1": {"name": "Eins"}}},
        }

    def test_an_old_wheel_leaves_the_missing_artefacts_none(self):
        out = common.extract_all_catalogues_from_wheel(_wheel({"capabilities.json": []}))
        assert out == {
            "version": None,
            "capabilities": [],
            "processes": None,
            "value_streams": None,
            "macros": None,
            "i18n": {},
        }

    def test_an_artefact_that_is_not_a_list_is_ignored(self):
        wheel = _wheel(
            {
                "capabilities.json": {"oops": True},
                "business-processes.json": {"oops": True},
                "value-streams.json": "null",
                "macro-capabilities.json": {"oops": True},
            }
        )
        out = common.extract_all_catalogues_from_wheel(wheel)
        assert (out["capabilities"], out["processes"], out["value_streams"], out["macros"]) == (
            None,
            None,
            None,
            None,
        )


# ---------------------------------------------------------------------------
# PyPI: version probe + fetch (outbound HTTP faked by MockTransport)
# ---------------------------------------------------------------------------


def _pypi(version: str | None, wheel_url: str = "https://files.invalid/w.whl") -> dict:
    info = {"version": version} if version is not None else {}
    return {"info": info, "urls": [{"packagetype": "bdist_wheel", "url": wheel_url}]}


class TestWheelUrlFromPypiPayload:
    def test_the_wheel_is_chosen_whatever_its_position(self):
        sdist = {"packagetype": "sdist", "url": "https://files.invalid/w.tar.gz"}
        wheel = {"packagetype": "bdist_wheel", "url": "https://files.invalid/w.whl"}
        payload = {"info": {"version": "2.1.0"}, "urls": [sdist, wheel]}
        assert common.wheel_url_from_pypi_payload(payload) == (
            "https://files.invalid/w.whl",
            "2.1.0",
        )

    def test_a_release_with_only_an_sdist_is_refused_by_name(self):
        payload = {
            "info": {"version": "2.1.0"},
            "urls": [{"packagetype": "sdist", "url": "https://files.invalid/w.tar.gz"}],
        }
        with pytest.raises(ValueError) as exc:
            common.wheel_url_from_pypi_payload(payload)
        assert str(exc.value) == "PyPI lists no wheel for turbo-ea-capabilities 2.1.0"

    def test_a_wheel_entry_without_a_url_counts_as_no_wheel(self):
        payload = {"info": {"version": "2.1.0"}, "urls": [{"packagetype": "bdist_wheel"}]}
        with pytest.raises(ValueError, match="lists no wheel"):
            common.wheel_url_from_pypi_payload(payload)
        with pytest.raises(ValueError, match="lists no wheel"):
            common.wheel_url_from_pypi_payload({"info": {"version": "2.1.0"}})

    def test_a_payload_without_a_version_is_refused_first(self):
        with pytest.raises(ValueError) as exc:
            common.wheel_url_from_pypi_payload(_pypi(None))
        assert str(exc.value) == "PyPI response missing info.version"
        with pytest.raises(ValueError, match="missing info.version"):
            common.wheel_url_from_pypi_payload(_pypi(""))


class TestCheckRemoteVersion:
    async def test_no_cache_compares_pypi_with_the_bundled_wheel(self, db, monkeypatch):
        seen = patch_httpx_client(
            monkeypatch, common, lambda request: httpx.Response(200, json=_pypi("2.1.0"))
        )
        result = await common.check_remote_version_for(
            db, cache_key="test_catalogue", bundled_version="2.0.0"
        )
        assert result == {
            "active_version": "2.0.0",
            "active_source": "bundled",
            "bundled_version": "2.0.0",
            "cached_remote_version": None,
            "remote": {
                "catalogue_version": "2.1.0",
                "source": "pypi",
                "project": "turbo-ea-capabilities",
            },
            "update_available": True,
            "error": None,
        }
        assert [str(r.url) for r in seen] == [common.PYPI_INDEX_URL]
        assert seen[0].headers["accept"] == "application/json"

    async def test_a_newer_cache_is_the_active_source(self, db, monkeypatch):
        await common.set_cached_remote(
            db, {"test_catalogue": {"data": [{"id": "A"}], "catalogue_version": "2.1.0"}}
        )
        patch_httpx_client(
            monkeypatch, common, lambda request: httpx.Response(200, json=_pypi("2.1.0"))
        )
        result = await common.check_remote_version_for(
            db, cache_key="test_catalogue", bundled_version="2.0.0"
        )
        assert result["active_version"] == "2.1.0"
        assert result["active_source"] == "remote"
        assert result["cached_remote_version"] == "2.1.0"
        assert result["update_available"] is False

    async def test_a_stale_cache_is_not_the_active_source(self, db, monkeypatch):
        # The cache lost to a newer bundled wheel, so the bundled one is
        # served — and must be reported as the source.
        await common.set_cached_remote(
            db, {"test_catalogue": {"data": [{"id": "A"}], "catalogue_version": "1.0.0"}}
        )
        patch_httpx_client(
            monkeypatch, common, lambda request: httpx.Response(200, json=_pypi("2.0.0"))
        )
        result = await common.check_remote_version_for(
            db, cache_key="test_catalogue", bundled_version="2.0.0"
        )
        assert result["active_version"] == "2.0.0"
        assert result["active_source"] == "bundled"
        assert result["cached_remote_version"] == "1.0.0"
        assert result["update_available"] is False

    async def test_an_error_status_is_reported_not_raised(self, db, monkeypatch):
        patch_httpx_client(monkeypatch, common, lambda request: httpx.Response(503))
        result = await common.check_remote_version_for(
            db, cache_key="test_catalogue", bundled_version="2.0.0"
        )
        assert result["remote"] is None
        assert result["error"] == "Could not reach PyPI"
        assert result["update_available"] is False

    async def test_a_payload_without_a_version_has_no_remote(self, db, monkeypatch):
        patch_httpx_client(
            monkeypatch, common, lambda request: httpx.Response(200, json=_pypi(None))
        )
        result = await common.check_remote_version_for(
            db, cache_key="test_catalogue", bundled_version="2.0.0"
        )
        assert result["remote"] is None
        assert result["error"] is None


class TestFetchAndCacheAll:
    async def test_one_wheel_fills_all_three_caches(self, db, monkeypatch):
        wheel = _wheel(
            {
                "version.json": {
                    "catalogue_version": "7.0.0",
                    "schema_version": 3,
                    "generated_at": "2026-10-09",
                    "node_count": 40,
                    "process_count": 30,
                },
                "capabilities.json": [{"id": "BC-1", "children": []}],
                "business-processes.json": [{"id": "BP-1"}, {"id": "BP-2"}],
                "value-streams.json": [{"id": "VS-1", "stages": []}],
                "macro-capabilities.json": [{"id": "MC-1"}],
                "i18n/fr.json": {"BC-1": {"name": "Un"}},
            }
        )

        def handler(request: httpx.Request) -> httpx.Response:
            if str(request.url) == common.PYPI_INDEX_URL:
                return httpx.Response(200, json=_pypi("7.0.0"))
            return httpx.Response(200, content=wheel)

        seen = patch_httpx_client(monkeypatch, common, handler)
        result = await common.fetch_and_cache_all(db)

        assert [str(r.url) for r in seen] == [common.PYPI_INDEX_URL, "https://files.invalid/w.whl"]
        fetched_at = result.pop("fetched_at")
        assert result == {
            "catalogue_version": "7.0.0",
            "node_count": 40,
            "process_count": 30,
            "value_stream_count": 1,
            "available_locales": ["en", "fr"],
        }
        caps = await common.get_cached_remote(db, common.CAPABILITY_CACHE_KEY)
        assert caps == {
            "data": [{"id": "BC-1"}],
            "macros": [{"id": "MC-1"}],
            "i18n": {"fr": {"BC-1": {"name": "Un"}}},
            "catalogue_version": "7.0.0",
            "schema_version": "3",
            "generated_at": "2026-10-09",
            "node_count": 40,
            "fetched_at": fetched_at,
            "source": "pypi",
        }
        procs = await common.get_cached_remote(db, common.PROCESS_CACHE_KEY)
        assert procs["data"] == [{"id": "BP-1"}, {"id": "BP-2"}]
        assert procs["process_count"] == 30
        streams = await common.get_cached_remote(db, common.VALUE_STREAM_CACHE_KEY)
        assert streams["data"] == [{"id": "VS-1", "stages": []}]
        assert streams["value_stream_count"] == 1

    async def test_a_wheel_without_version_json_takes_the_pypi_version(self, db, monkeypatch):
        wheel = _wheel({"capabilities.json": [{"id": "BC-1"}, {"id": "BC-2"}]})

        def handler(request: httpx.Request) -> httpx.Response:
            if str(request.url) == common.PYPI_INDEX_URL:
                return httpx.Response(200, json=_pypi("8.1.0"))
            return httpx.Response(200, content=wheel)

        patch_httpx_client(monkeypatch, common, handler)
        result = await common.fetch_and_cache_all(db)
        assert result["catalogue_version"] == "8.1.0"
        assert result["node_count"] == 2
        assert result["process_count"] is None
        assert result["value_stream_count"] is None
        caps = await common.get_cached_remote(db, common.CAPABILITY_CACHE_KEY)
        assert caps["macros"] == []
        assert caps["schema_version"] == ""
        assert await common.get_cached_remote(db, common.PROCESS_CACHE_KEY) is None


# ---------------------------------------------------------------------------
# Existing-card matching, relinking, relations
# ---------------------------------------------------------------------------


class TestMatchExistingCards:
    async def test_a_name_two_entries_share_never_matches(self, db):
        # Two catalogue entries carry the same English name, as stages of two
        # value streams do. A card named that way stands for neither: one
        # import would otherwise skip the other's entry and re-parent the card.
        user = await create_user(db, email="m1@x.com")
        shared = await create_card(
            db, card_type="BusinessCapability", name="Renewal", user_id=user.id
        )
        unique = await create_card(
            db, card_type="BusinessCapability", name="Billing", user_id=user.id
        )
        flat = [
            {"id": "BC-1", "name": "Renewal"},
            {"id": "BC-2", "name": "renewal "},
            {"id": "BC-3", "name": "Billing"},
            {"id": "BC-4", "name": "Unrelated"},
        ]
        english = {n["id"]: n for n in flat}
        matches = await common.match_existing_cards(
            db, flat=flat, english=english, card_type="BusinessCapability"
        )
        assert matches == {"BC-3": str(unique.id)}
        assert str(shared.id) not in matches.values()

    async def test_a_catalogue_id_matches_even_a_shared_name(self, db):
        user = await create_user(db, email="m2@x.com")
        card = await create_card(
            db,
            card_type="BusinessCapability",
            name="Renamed by the customer",
            user_id=user.id,
            attributes={"catalogueId": "BC-2"},
        )
        flat = [{"id": "BC-1", "name": "Renewal"}, {"id": "BC-2", "name": "Renewal"}]
        matches = await common.match_existing_cards(
            db, flat=flat, english={n["id"]: n for n in flat}, card_type="BusinessCapability"
        )
        assert matches == {"BC-2": str(card.id)}

    async def test_names_match_in_english_whatever_the_served_locale(self, db):
        user = await create_user(db, email="m3@x.com")
        card = await create_card(
            db, card_type="BusinessCapability", name="Customer Care", user_id=user.id
        )
        flat = [{"id": "BC-1", "name": "Service client"}]
        english = {"BC-1": {"id": "BC-1", "name": "Customer Care"}}
        matches = await common.match_existing_cards(
            db, flat=flat, english=english, card_type="BusinessCapability"
        )
        assert matches == {"BC-1": str(card.id)}

    async def test_by_id_only_entries_never_match_by_name(self, db):
        user = await create_user(db, email="m4@x.com")
        await create_card(
            db, card_type="BusinessCapability", name="Finance & Risk", user_id=user.id
        )
        flat = [{"id": "MC-1", "name": "Finance & Risk"}]
        matches = await common.match_existing_cards(
            db,
            flat=flat,
            english={n["id"]: n for n in flat},
            card_type="BusinessCapability",
            by_id_only=lambda node: node["id"].startswith("MC-"),
        )
        assert matches == {}

    async def test_subtypes_narrow_the_cards_considered(self, db):
        user = await create_user(db, email="m5@x.com")
        await create_card(db, card_type="BusinessContext", name="Order to Cash", user_id=user.id)
        stream = await create_card(
            db,
            card_type="BusinessContext",
            subtype="valueStream",
            name="Order to Cash",
            user_id=user.id,
        )
        flat = [{"id": "VS-1", "name": "Order to Cash"}]
        matches = await common.match_existing_cards(
            db,
            flat=flat,
            english={n["id"]: n for n in flat},
            card_type="BusinessContext",
            subtypes=("valueStream",),
        )
        assert matches == {"VS-1": str(stream.id)}

    async def test_subtypes_narrow_the_catalogue_id_match_too(self, db):
        user = await create_user(db, email="m6@x.com")
        await create_card(
            db,
            card_type="BusinessContext",
            name="Renamed elsewhere",
            user_id=user.id,
            attributes={"catalogueId": "VS-1"},
        )
        flat = [{"id": "VS-1", "name": "Order to Cash"}]
        matches = await common.match_existing_cards(
            db,
            flat=flat,
            english={n["id"]: n for n in flat},
            card_type="BusinessContext",
            subtypes=("valueStream",),
        )
        assert matches == {}

    async def test_an_entry_missing_from_the_english_index_keeps_its_own_name(self, db):
        user = await create_user(db, email="m7@x.com")
        card = await create_card(
            db, card_type="BusinessCapability", name="Billing", user_id=user.id
        )
        flat = [{"id": "BC-1", "name": "Billing"}]
        matches = await common.match_existing_cards(
            db, flat=flat, english={}, card_type="BusinessCapability"
        )
        assert matches == {"BC-1": str(card.id)}


class TestEnglishIndex:
    async def test_an_english_payload_is_its_own_index(self, db):
        calls: list[str] = []

        async def resolve(db_, *, locale):
            calls.append(locale)
            return [], {}

        flat = [{"id": "A", "name": "Alpha"}]
        index = await common.english_index(resolve, db, flat, {"active_locale": "en"})
        assert index == {"A": {"id": "A", "name": "Alpha"}}
        assert calls == []

    async def test_another_locale_asks_the_resolver_for_english(self, db):
        calls: list[str] = []

        async def resolve(db_, *, locale):
            calls.append(locale)
            return [{"id": "A", "name": "Alpha"}], {}

        flat = [{"id": "A", "name": "Alpha FR"}]
        index = await common.english_index(resolve, db, flat, {"active_locale": "fr"})
        assert index == {"A": {"id": "A", "name": "Alpha"}}
        assert calls == ["en"]


class TestRelinkPreExisting:
    async def test_moves_the_card_and_records_it_in_history(self, db):
        user = await create_user(db, email="r1@x.com")
        old_parent = await create_card(
            db, card_type="BusinessCapability", name="Old home", user_id=user.id
        )
        child = await create_card(
            db,
            card_type="BusinessCapability",
            name="Child",
            parent_id=old_parent.id,
            user_id=user.id,
        )
        new_parent = await create_card(
            db, card_type="BusinessCapability", name="New home", user_id=user.id
        )
        relinked = await common.relink_pre_existing(
            db,
            pre_existing={"BC-1.1", "BC-9"},
            by_id={
                "BC-1": {"id": "BC-1", "parent_id": None},
                "BC-1.1": {"id": "BC-1.1", "parent_id": "BC-1"},
                "BC-9": {"id": "BC-9", "parent_id": "BC-8"},
            },
            created_in_batch={"BC-1"},
            card_ids={
                "BC-1": str(new_parent.id),
                "BC-1.1": str(child.id),
                "BC-9": str(uuid.uuid4()),
            },
            user_id=user.id,
        )
        assert relinked == [
            {
                "catalogue_id": "BC-1.1",
                "card_id": str(child.id),
                "new_parent_card_id": str(new_parent.id),
            }
        ]
        await db.refresh(child)
        assert child.parent_id == new_parent.id
        events = (await db.execute(select(Event).where(Event.card_id == child.id))).scalars().all()
        assert [(e.event_type, e.data["changes"]) for e in events] == [
            (
                "card.updated",
                {"parent_id": {"old": str(old_parent.id), "new": str(new_parent.id)}},
            )
        ]
        assert events[0].user_id == user.id

    async def test_a_root_card_records_no_old_parent(self, db):
        user = await create_user(db, email="r2@x.com")
        child = await create_card(db, card_type="BusinessCapability", name="C", user_id=user.id)
        parent = await create_card(db, card_type="BusinessCapability", name="P", user_id=user.id)
        await common.relink_pre_existing(
            db,
            pre_existing={"C"},
            by_id={"C": {"id": "C", "parent_id": "P"}},
            created_in_batch={"P"},
            card_ids={"C": str(child.id), "P": str(parent.id)},
            user_id=user.id,
        )
        event = (await db.execute(select(Event).where(Event.card_id == child.id))).scalar_one()
        assert event.data["changes"] == {"parent_id": {"old": None, "new": str(parent.id)}}

    async def test_skipped_entries_do_not_stop_the_ones_after_them(self, db):
        # Entries are walked in sorted order. An unknown id, one whose parent
        # this import did not create and one whose card is gone all sort
        # before the card that moves, and each is skipped, not the end.
        owner = await create_user(db, email="r4@x.com")
        importer = await create_user(db, email="r5@x.com")
        child = await create_card(db, card_type="BusinessCapability", name="D", user_id=owner.id)
        parent = await create_card(db, card_type="BusinessCapability", name="P", user_id=owner.id)
        relinked = await common.relink_pre_existing(
            db,
            pre_existing={"A-unknown", "B-kept", "C-gone", "D"},
            by_id={
                "B-kept": {"id": "B-kept", "parent_id": "OLD"},
                "C-gone": {"id": "C-gone", "parent_id": "P"},
                "D": {"id": "D", "parent_id": "P"},
            },
            created_in_batch={"P"},
            card_ids={
                "B-kept": str(uuid.uuid4()),
                "C-gone": str(uuid.uuid4()),
                "D": str(child.id),
                "P": str(parent.id),
            },
            user_id=importer.id,
        )
        assert relinked == [
            {"catalogue_id": "D", "card_id": str(child.id), "new_parent_card_id": str(parent.id)}
        ]
        await db.refresh(child)
        assert (child.parent_id, child.updated_by) == (parent.id, importer.id)
        event = (await db.execute(select(Event).where(Event.card_id == child.id))).scalar_one()
        assert event.data["id"] == str(child.id)
        assert event.user_id == importer.id

    async def test_nothing_moves_unless_the_parent_was_created_now(self, db):
        user = await create_user(db, email="r3@x.com")
        child = await create_card(db, card_type="BusinessCapability", name="C", user_id=user.id)
        relinked = await common.relink_pre_existing(
            db,
            pre_existing={"C", "GONE"},
            by_id={"C": {"id": "C", "parent_id": "P"}},
            created_in_batch=set(),
            card_ids={"C": str(child.id), "P": str(uuid.uuid4())},
            user_id=user.id,
        )
        assert relinked == []
        await db.refresh(child)
        assert child.parent_id is None


class TestCreateCatalogueCard:
    async def test_a_created_card_takes_the_write_path(self, db):
        user = await create_user(db, email="cc1@x.com")
        parent = await create_card(
            db, card_type="BusinessCapability", name="Parent", user_id=user.id
        )
        card, reason = await common.create_catalogue_card(
            db,
            common.WriteActor.from_user(user),
            type_key="BusinessCapability",
            name="Child",
            subtype=None,
            description="d",
            parent_id=str(parent.id),
            attributes={"catalogueId": "BC-1.1", "capabilityLevel": "L5"},
            allocator=common.ReferenceAllocator(),
        )
        assert reason == ""
        assert card is not None
        # The string id the imports carry arrives as a UUID, and the level the
        # catalogue claimed gives way to the card's real depth.
        assert card.parent_id == parent.id
        assert card.attributes["capabilityLevel"] == "L2"
        assert (card.created_by, card.updated_by, card.approval_status) == (
            user.id,
            user.id,
            "DRAFT",
        )
        events = (await db.execute(select(Event).where(Event.card_id == card.id))).scalars().all()
        assert [(e.event_type, e.user_id) for e in events] == [("card.created", user.id)]

    async def test_a_refused_row_rolls_back_alone_and_names_the_reason(self, db):
        user = await create_user(db, email="cc2@x.com")
        taken = await create_card(db, card_type="BusinessCapability", name="Taken", user_id=user.id)
        actor = common.WriteActor.from_user(user)
        allocator = common.ReferenceAllocator()
        card, reason = await common.create_catalogue_card(
            db,
            actor,
            type_key="BusinessCapability",
            name="Taken",
            subtype=None,
            description=None,
            parent_id=None,
            attributes={},
            allocator=allocator,
        )
        assert card is None
        assert "Taken" in reason and "{" not in reason
        # The transaction is still usable: the next row goes through.
        after, reason_after = await common.create_catalogue_card(
            db,
            actor,
            type_key="BusinessCapability",
            name="Free",
            subtype=None,
            description=None,
            parent_id=None,
            attributes={},
            allocator=allocator,
        )
        assert reason_after == "" and after is not None
        named = (await db.execute(select(Card.id).where(Card.name == "Taken"))).scalars().all()
        assert named == [taken.id]


class TestAddRelationOnce:
    async def test_adds_once_then_reports_the_existing_row(self, db):
        user = await create_user(db, email="a1@x.com")
        proc = await create_card(db, card_type="BusinessProcess", name="P", user_id=user.id)
        cap = await create_card(db, card_type="BusinessCapability", name="C", user_id=user.id)
        kwargs = {"relation_type": "relProcessToBC", "source_id": proc.id, "target_id": cap.id}
        assert await common.add_relation_once(db, **kwargs) is True
        await db.flush()
        assert await common.add_relation_once(db, **kwargs) is False
        await db.flush()
        rows = (await db.execute(select(Relation))).scalars().all()
        assert [(r.type, r.source_id, r.target_id, r.attributes) for r in rows] == [
            ("relProcessToBC", proc.id, cap.id, {})
        ]

    async def test_another_type_between_the_same_cards_is_its_own_row(self, db):
        user = await create_user(db, email="a2@x.com")
        a = await create_card(db, card_type="BusinessProcess", name="P", user_id=user.id)
        b = await create_card(db, card_type="BusinessCapability", name="C", user_id=user.id)
        assert await common.add_relation_once(
            db, relation_type="relOne", source_id=a.id, target_id=b.id
        )
        await db.flush()
        assert await common.add_relation_once(
            db, relation_type="relTwo", source_id=a.id, target_id=b.id
        )

    async def test_the_same_type_to_another_card_is_its_own_row(self, db):
        user = await create_user(db, email="a3@x.com")
        proc = await create_card(db, card_type="BusinessProcess", name="P1", user_id=user.id)
        other_proc = await create_card(db, card_type="BusinessProcess", name="P2", user_id=user.id)
        cap = await create_card(db, card_type="BusinessCapability", name="C1", user_id=user.id)
        other_cap = await create_card(
            db, card_type="BusinessCapability", name="C2", user_id=user.id
        )
        rel = "relProcessToBC"
        assert await common.add_relation_once(
            db, relation_type=rel, source_id=proc.id, target_id=cap.id
        )
        await db.flush()
        assert await common.add_relation_once(
            db, relation_type=rel, source_id=other_proc.id, target_id=cap.id
        )
        await db.flush()
        assert await common.add_relation_once(
            db, relation_type=rel, source_id=proc.id, target_id=other_cap.id
        )
        await db.flush()
        rows = (await db.execute(select(Relation.source_id, Relation.target_id))).all()
        assert sorted(tuple(r) for r in rows) == sorted(
            [(proc.id, cap.id), (other_proc.id, cap.id), (proc.id, other_cap.id)]
        )


class TestCardLookup:
    async def test_catalogue_ids_and_names_share_one_index(self, db):
        user = await create_user(db, email="l1@x.com")
        tagged = await create_card(
            db,
            card_type="BusinessCapability",
            name="Tagged",
            user_id=user.id,
            attributes={"catalogueId": "BC-7"},
        )
        plain = await create_card(
            db, card_type="BusinessCapability", name="  Plain   Name ", user_id=user.id
        )
        await create_card(db, card_type="BusinessProcess", name="Other type", user_id=user.id)
        lookup = await common.card_lookup(db, "BusinessCapability")
        assert lookup == {
            "tagged": str(tagged.id),
            "plain name": str(plain.id),
            "BC-7": str(tagged.id),
        }
