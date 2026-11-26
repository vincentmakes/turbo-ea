"""``language_catalogue``: the community language library, treated as hostile.

The pure rules (URLs, the index, the pack) need no database; the downloads run
against ``tests/language_library.FakeLibrary`` (``httpx.MockTransport``). The
install path on the database is covered here too; the routes are in
``tests/api/test_custom_locales_catalogue.py``.
"""

from __future__ import annotations

import asyncio
import json
from types import SimpleNamespace

import httpx
import pytest
from sqlalchemy import event as sa_event
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from app.api.v1.custom_locales import _install_recorder
from app.models.audit_log import AuditLogEntry
from app.models.card_type import CardType
from app.models.catalogue_cache import CatalogueCache
from app.models.custom_locale import CustomLocale, CustomLocaleString
from app.services import custom_locale_store as store
from app.services import language_catalogue as lc
from app.services import language_pack as lp
from tests.conftest import create_card_type, create_user
from tests.language_library import (
    COMMIT,
    INDEX_URL,
    SAVE_HASH,
    FakeLibrary,
    make_entry,
    make_index,
    make_pack,
    pack_bytes,
    pack_url_for,
    sha,
)

ACTION = "admin.custom_locale.community_installed"


@pytest.fixture(scope="module")
def cat() -> lp.Catalog:
    loaded = store.catalog()
    assert loaded is not None
    return loaded


@pytest.fixture
def library(monkeypatch) -> FakeLibrary:
    return FakeLibrary().install(monkeypatch)


# ---------------------------------------------------------------------------
# URLs
# ---------------------------------------------------------------------------


def test_an_error_carries_its_code():
    err = lc.CatalogueError(lc.PACK_CHECKSUM)
    assert (err.code, str(err)) == (lc.PACK_CHECKSUM, lc.PACK_CHECKSUM)


class TestUrls:
    @pytest.mark.parametrize(
        "url",
        [INDEX_URL, "https://example.org/lang/index.json", "https://example.org:8443/i.json"],
    )
    def test_https_urls(self, url):
        assert lc.is_https_url(url)

    @pytest.mark.parametrize(
        "url",
        [
            "http://example.org/index.json",
            "ftp://example.org/index.json",
            "https:///index.json",
            "https://user:pw@example.org/index.json",
            "https://token@example.org/index.json",
            "https://example.org/index.json\n",
            "https://example.org/a b.json",
            "https://example.org/\x00.json",
            "https://[::1/index.json",
            "/relative/index.json",
            "",
            None,
            42,
        ],
    )
    def test_refused_urls(self, url):
        assert not lc.is_https_url(url)

    def test_the_pack_is_pinned_to_the_commit_on_raw_github(self):
        assert lc.pack_url(INDEX_URL, "nl", COMMIT) == pack_url_for("nl", COMMIT)

    def test_without_a_commit_it_stays_on_the_configured_ref(self):
        assert lc.pack_url(INDEX_URL, "pt-BR", None) == (
            "https://raw.githubusercontent.com/vincentmakes/turbo-ea-translations/"
            "main/packs/pt-BR/pack.json"
        )

    def test_another_host_is_never_pinned_and_keeps_its_directory(self):
        assert (
            lc.pack_url("https://mirror.example/lib/v1/index.json?x=1#f", "nl", COMMIT)
            == "https://mirror.example/lib/v1/packs/nl/pack.json"
        )

    def test_a_raw_github_ref_with_slashes_is_not_rewritten(self):
        url = "https://raw.githubusercontent.com/o/r/refs/heads/main/index.json"
        assert lc.pack_url(url, "nl", COMMIT) == (
            "https://raw.githubusercontent.com/o/r/refs/heads/main/packs/nl/pack.json"
        )

    @pytest.mark.parametrize("code", ["../x", "nl/../../evil", "de", "NL", "nl?x=1", ""])
    def test_only_a_language_code_reaches_the_path(self, code):
        with pytest.raises(lc.CatalogueError) as err:
            lc.pack_url(INDEX_URL, code, COMMIT)
        assert err.value.code == lc.NOT_LISTED


# ---------------------------------------------------------------------------
# The index
# ---------------------------------------------------------------------------


class TestParseEntry:
    def test_a_real_entry_keeps_only_what_the_app_uses(self):
        entry = lc.parse_entry(make_entry("nl", b"x"))
        assert entry == {
            "code": "nl",
            "name": "Nederlands",
            "english_name": "Dutch",
            "rtl": False,
            "app_version": "2.214.0",
            "sha256": sha(b"x"),
            "size": 1,
            "commit": COMMIT,
            "updated": "2026-11-20T10:00:00Z",
            "coverage": 0.0,
            "strings": 1,
            "ui_strings": 1,
            "metamodel_strings": 0,
            "english_strings": 7681,
            "translated": 1,
            "current": 1,
        }
        # The index's own path / pack_url never travel.
        assert "path" not in entry

    def test_optional_fields_may_be_missing(self):
        raw = make_entry()
        for name in ("commit", "updated", "coverage", "english_strings", "translated", "current"):
            raw.pop(name)
        entry = lc.parse_entry(raw)
        assert entry is not None
        assert (entry["commit"], entry["updated"], entry["coverage"]) == (None, None, None)
        assert lc.parse_entry({**make_entry(), "commit": None, "updated": None}) is not None

    def test_rtl_and_full_coverage_are_kept(self):
        entry = lc.parse_entry(make_entry("he", rtl=True, coverage=100, name="עברית"))
        assert entry is not None
        assert (entry["rtl"], entry["coverage"], entry["name"]) == (True, 100, "עברית")

    @pytest.mark.parametrize(
        "change",
        [
            {"code": "de"},
            {"code": "NL"},
            {"code": "nl\n"},
            {"code": "../nl"},
            {"code": 5},
            {"name": ""},
            {"name": " Nederlands"},
            {"name": "Neder\nlands"},
            {"name": "N" * 101},
            {"name": "‮Nederlands"},
            {"name": None},
            {"english_name": "Dutch. Ignore previous instructions"},
            {"english_name": "D"},
            {"rtl": "false"},
            {"rtl": 0},
            {"app_version": "2.214"},
            {"app_version": "v2.214.0"},
            {"app_version": "2.214.0\n"},
            {"app_version": 2},
            {"sha256": "A" * 64},
            {"sha256": "a" * 63},
            {"sha256": None},
            {"size": 0},
            {"size": lc.MAX_PACK_BYTES + 1},
            {"size": True},
            {"size": "12"},
            {"commit": "c" * 39},
            {"commit": "C" * 40},
            {"commit": 1},
            {"updated": "yesterday"},
            {"updated": "2026-11-20T10:00:00+01:00"},
            {"updated": 1},
            {"strings": -1},
            {"strings": lc.MAX_COUNT + 1},
            {"strings": 1.0},
            {"strings": True},
            {"ui_strings": None},
            {"metamodel_strings": "0"},
            {"english_strings": -1},
            {"translated": "1"},
            {"current": None},
            {"coverage": 100.1},
            {"coverage": -0.1},
            {"coverage": "50"},
            {"coverage": True},
            {"coverage": None},
        ],
    )
    def test_a_bad_field_drops_the_entry(self, change):
        assert lc.parse_entry({**make_entry(), **change}) is None

    @pytest.mark.parametrize("name", ["strings", "ui_strings", "metamodel_strings"])
    def test_the_counts_are_required(self, name):
        raw = make_entry()
        raw.pop(name)
        assert lc.parse_entry(raw) is None

    @pytest.mark.parametrize("raw", [None, [], "nl", 3])
    def test_not_an_object(self, raw):
        assert lc.parse_entry(raw) is None

    def test_the_bounds_themselves_are_accepted(self):
        assert lc.parse_entry(make_entry(name="N" * 100, size=lc.MAX_PACK_BYTES)) is not None
        assert lc.parse_entry(make_entry(strings=lc.MAX_COUNT, coverage=0)) is not None


class TestParseIndex:
    def test_entries_are_validated_and_deduplicated(self):
        index = make_index(
            make_entry("nl"),
            make_entry("de"),
            {"code": "fy"},
            make_entry("nl", name="Tweede"),
            make_entry("he", name="עברית", rtl=True),
        )
        out = lc.parse_index(json.dumps(index).encode())
        assert [(e["code"], e["name"]) for e in out] == [("nl", "Nederlands"), ("he", "עברית")]

    def test_an_empty_library(self):
        assert lc.parse_index(json.dumps(make_index()).encode()) == []

    @pytest.mark.parametrize(
        "data",
        [
            b"\xff\xfe",
            b"{",
            b"[]",
            b'{"format": "turbo-ea-language-pack-index", "format": "x"}',
            json.dumps(make_index(format="turbo-ea-language-pack")).encode(),
            json.dumps(make_index(format_version=2)).encode(),
            json.dumps(make_index(format_version=True)).encode(),
            json.dumps(make_index(format_version="1")).encode(),
            json.dumps(make_index(languages={"nl": {}})).encode(),
            json.dumps(make_index(languages=None)).encode(),
            json.dumps(make_index(*[{}] * (lc.MAX_LANGUAGES + 1))).encode(),
            b"[" * 100_000 + b"]" * 100_000,
        ],
    )
    def test_a_bad_file_is_an_error(self, data):
        with pytest.raises(lc.CatalogueError) as err:
            lc.parse_index(data)
        assert err.value.code == lc.INVALID

    def test_the_entry_cap_itself_is_accepted(self):
        index = make_index(*[make_entry("nl")] * lc.MAX_LANGUAGES)
        assert len(lc.parse_index(json.dumps(index).encode())) == 1


# ---------------------------------------------------------------------------
# Downloads
# ---------------------------------------------------------------------------


class TestFetch:
    async def fetch(self, url=INDEX_URL, limit=100):
        return await lc.fetch_limited(url, limit, unreachable="down", too_large="big")

    async def test_a_body_within_the_cap(self, library):
        library.serve(INDEX_URL, b"x" * 100)
        assert await self.fetch() == b"x" * 100
        assert library.requested == [INDEX_URL]

    async def test_a_body_over_the_cap_is_refused_while_it_streams(self, library):
        library.serve(INDEX_URL, b"x" * 101)
        with pytest.raises(lc.CatalogueError) as err:
            await self.fetch()
        assert err.value.code == "big"

    async def test_an_undeclared_length_is_counted_while_it_streams(self, library):
        async def body():
            for _ in range(3):
                yield b"x" * 40

        library.responders[INDEX_URL] = lambda request: httpx.Response(200, content=body())
        with pytest.raises(lc.CatalogueError) as err:
            await self.fetch()
        assert err.value.code == "big"

    async def test_a_length_that_lies_does_not_help(self, library):
        async def body():
            yield b"x" * 60
            yield b"x" * 60

        library.responders[INDEX_URL] = lambda request: httpx.Response(
            200, content=body(), headers={"content-length": "10"}
        )
        with pytest.raises(lc.CatalogueError) as err:
            await self.fetch()
        assert err.value.code == "big"

    async def test_streamed_chunks_within_the_cap_are_joined(self, library):
        async def body():
            yield b"ab"
            yield b"cd"

        library.responders[INDEX_URL] = lambda request: httpx.Response(200, content=body())
        assert await self.fetch() == b"abcd"

    async def test_only_an_uncompressed_body_is_asked_for_and_accepted(self, library):
        library.serve(INDEX_URL, b"ok")
        assert await self.fetch() == b"ok"
        assert library.headers[0]["accept-encoding"] == "identity"
        assert library.methods == ["GET"]
        assert lc.IDENTITY_ONLY == {"Accept-Encoding": "identity"}
        for encoding in ("gzip", "gzip, gzip", "br", "deflate"):
            library.serve(INDEX_URL, b"\x1f\x8b", **{"content-encoding": encoding})
            with pytest.raises(lc.CatalogueError) as err:
                await self.fetch()
            assert err.value.code == "down", encoding
        library.serve(INDEX_URL, b"ok", **{"content-encoding": " Identity "})
        assert await self.fetch() == b"ok"

    async def test_a_download_has_a_total_time_limit(self, library, monkeypatch):
        monkeypatch.setattr(lc, "TOTAL_TIMEOUT", 0.05)

        async def slow(request):
            await asyncio.sleep(5)
            return httpx.Response(200, content=b"late")

        library.responders[INDEX_URL] = slow
        with pytest.raises(lc.CatalogueError) as err:
            await self.fetch()
        assert err.value.code == "down"

    def test_the_total_time_limit(self):
        assert lc.TOTAL_TIMEOUT == 60.0

    async def test_a_declared_length_over_the_cap_is_refused(self, library):
        library.routes[INDEX_URL] = (200, b"x", {"content-length": "101"})
        with pytest.raises(lc.CatalogueError) as err:
            await self.fetch()
        assert err.value.code == "big"

    @pytest.mark.parametrize("status", [404, 500, 204, 206])
    async def test_status(self, library, status):
        library.serve(INDEX_URL, b"{}", status=status)
        with pytest.raises(lc.CatalogueError) as err:
            await self.fetch()
        assert err.value.code == "down"

    async def test_a_network_error_is_unreachable(self, library):
        library.error = httpx.ConnectTimeout("slow")
        with pytest.raises(lc.CatalogueError) as err:
            await self.fetch()
        assert err.value.code == "down"

    async def test_http_is_never_fetched(self, library):
        with pytest.raises(lc.CatalogueError) as err:
            await self.fetch("http://example.org/index.json")
        assert err.value.code == "down"
        assert library.requested == []

    async def test_a_same_host_https_redirect_is_followed(self, library):
        moved = "https://raw.githubusercontent.com/o/r/main/moved.json"
        library.serve(INDEX_URL, b"", status=302, location="/o/r/main/moved.json")
        library.serve(moved, b"ok")
        assert await self.fetch() == b"ok"
        assert library.requested == [INDEX_URL, moved]

    @pytest.mark.parametrize(
        "location",
        [
            "https://evil.example/index.json",
            "http://raw.githubusercontent.com/o/r/main/index.json",
            "//evil.example/index.json",
            "https://raw.githubusercontent.com.evil.example/index.json",
            "https://raw.githubusercontent.com:8443/o/r/main/index.json",
        ],
    )
    async def test_a_redirect_elsewhere_is_refused(self, library, location):
        library.serve(INDEX_URL, b"", status=301, location=location)
        library.serve(location, b"never")
        with pytest.raises(lc.CatalogueError) as err:
            await self.fetch()
        assert err.value.code == "down"
        assert library.requested == [INDEX_URL]

    async def test_the_default_port_written_out_is_the_same_origin(self, library):
        moved = "https://raw.githubusercontent.com:443/o/r/main/moved.json"
        library.serve(INDEX_URL, b"", status=302, location=moved)
        library.serve(moved, b"ok")
        library.serve("https://raw.githubusercontent.com/o/r/main/moved.json", b"ok")
        assert await self.fetch() == b"ok"

    async def test_a_redirect_loop_stops(self, library):
        library.serve(INDEX_URL, b"", status=307, location=INDEX_URL)
        with pytest.raises(lc.CatalogueError) as err:
            await self.fetch()
        assert err.value.code == "down"
        assert len(library.requested) == lc.MAX_REDIRECTS + 1

    def test_the_real_client_follows_no_redirect_and_has_a_timeout(self):
        client = lc._client()
        assert client.follow_redirects is False
        assert client.timeout == lc.TIMEOUT
        assert (lc.TIMEOUT.read, lc.TIMEOUT.connect) == (20.0, 10.0)

    def test_the_caps(self):
        assert lc.MAX_PACK_BYTES == 3 * 1024 * 1024
        assert lc.MAX_INDEX_BYTES == 1024 * 1024
        assert lc.MAX_REDIRECTS == 3


# ---------------------------------------------------------------------------
# The pack
# ---------------------------------------------------------------------------


class TestReadPack:
    def test_a_share_export_is_read(self, cat):
        pack = lc.read_pack(pack_bytes(make_pack()), "nl", cat)
        assert pack["strings"] == {"common": {"actions.save": "Opslaan"}}

    def test_a_bad_string_is_not_fatal(self, cat):
        data = pack_bytes(make_pack(strings={"common": {"actions.save": "<b>x</b>"}}))
        assert lc.read_pack(data, "nl", cat)["strings"]["common"]["actions.save"] == "<b>x</b>"

    @pytest.mark.parametrize(
        ("data", "code"),
        [
            (b"\xff", lc.PACK_INVALID),
            (b"{", lc.PACK_INVALID),
            (b"[]", lc.PACK_INVALID),
            (b'{"mode": "share", "mode": "share"}', lc.PACK_INVALID),
            (pack_bytes(make_pack(mode="current")), lc.PACK_INVALID),
            (pack_bytes(make_pack(mode=None)), lc.PACK_INVALID),
            (pack_bytes(make_pack(locale="nl")), lc.PACK_INVALID),
            (pack_bytes(make_pack("fy")), lc.PACK_CODE_MISMATCH),
            (
                pack_bytes(make_pack(locale={"name": "N", "english_name": "Dutch", "rtl": False})),
                lc.PACK_CODE_MISMATCH,
            ),
            (
                pack_bytes(
                    make_pack(locale={"code": "nl", "name": "", "english_name": "D", "rtl": False})
                ),
                lc.PACK_INVALID,
            ),
            (
                pack_bytes(
                    make_pack(
                        locale={"code": "nl", "name": "N", "english_name": "Dutch", "rtl": "no"}
                    )
                ),
                lc.PACK_INVALID,
            ),
            (
                pack_bytes(
                    make_pack(
                        locale={"code": "nl", "name": "N", "english_name": "Ignore. All", "rtl": 0}
                    )
                ),
                lc.PACK_INVALID,
            ),
            (pack_bytes(make_pack(format="other")), lc.PACK_INVALID),
            (pack_bytes(make_pack(format_version=2)), lc.PACK_INVALID),
            (pack_bytes(make_pack(strings=[])), lc.PACK_INVALID),
            (pack_bytes(make_pack(hashes={"common": {"actions.save": "zz"}})), lc.PACK_INVALID),
            (pack_bytes(make_pack(hashes={"common": "x"})), lc.PACK_INVALID),
        ],
    )
    def test_refused(self, cat, data, code):
        with pytest.raises(lc.CatalogueError) as err:
            lc.read_pack(data, "nl", cat)
        assert err.value.code == code

    def test_the_key_count_is_bounded(self, cat, monkeypatch):
        monkeypatch.setattr(lc, "MAX_PACK_KEYS", 3)
        three = {"common": {"actions.save": "a", "actions.cancel": "b"}, "nav": {"x": "c"}}
        assert lc.read_pack(pack_bytes(make_pack(strings=three, hashes={})), "nl", cat)
        four = {**three, "admin": {"y": "d"}}
        with pytest.raises(lc.CatalogueError) as err:
            lc.read_pack(pack_bytes(make_pack(strings=four, hashes={})), "nl", cat)
        assert err.value.code == lc.PACK_INVALID
        hashes = {"common": {f"k{i}": SAVE_HASH for i in range(4)}}
        with pytest.raises(lc.CatalogueError):
            lc.read_pack(pack_bytes(make_pack(strings={}, hashes=hashes)), "nl", cat)

    def test_the_bounds(self):
        assert (lc.MAX_PACK_KEYS, lc.MAX_PACK_KEY_LENGTH) == (20_000, 300)

    @pytest.mark.parametrize(
        "strings",
        [
            {"common": {"k" * 301: "x"}},
            {"c" * 301: {"a": "x"}},
        ],
    )
    def test_an_overlong_key_is_refused(self, cat, strings):
        with pytest.raises(lc.CatalogueError) as err:
            lc.read_pack(pack_bytes(make_pack(strings=strings, hashes={})), "nl", cat)
        assert err.value.code == lc.PACK_INVALID

    def test_a_section_name_at_the_length_bound_is_read(self, cat):
        strings = {"c" * 300: {"a": "x"}}
        assert lc.read_pack(pack_bytes(make_pack(strings=strings, hashes={})), "nl", cat)

    def test_a_pack_without_source_hashes_is_read(self, cat):
        pack = make_pack()
        del pack["source_hashes"]
        assert lc.read_pack(pack_bytes(pack), "nl", cat)["strings"]

    def test_a_section_that_is_not_an_object_does_not_end_the_bound_check(self, cat):
        strings = {"admin": [], "common": {"k" * 301: "x"}}
        with pytest.raises(lc.CatalogueError) as err:
            lc.read_pack(pack_bytes(make_pack(strings=strings, hashes={})), "nl", cat)
        assert err.value.code == lc.PACK_INVALID

    def test_a_key_at_the_length_bound_is_read(self, cat):
        strings = {"common": {"k" * 300: "x"}}
        assert lc.read_pack(pack_bytes(make_pack(strings=strings, hashes={})), "nl", cat)

    @pytest.mark.parametrize("key", ["actions.save\n", "actions.\u202esave", "a\u0000b"])
    def test_a_key_no_export_could_hold_is_refused(self, cat, key):
        data = pack_bytes(make_pack(strings={"common": {key: "x"}}, hashes={}))
        with pytest.raises(lc.CatalogueError) as err:
            lc.read_pack(data, "nl", cat)
        assert err.value.code == lc.PACK_INVALID

    def test_a_pack_for_a_built_in_language_is_refused(self, cat):
        data = pack_bytes(
            make_pack(
                "de",
                locale={"code": "de", "name": "Deutsch", "english_name": "German", "rtl": False},
            )
        )  # noqa: E501
        with pytest.raises(lc.CatalogueError) as err:
            lc.read_pack(data, "de", cat)
        assert err.value.code == lc.PACK_INVALID

    def test_payload_refuses_null_and_keeps_the_rest(self):
        payload = lc.pack_payload(
            make_pack(
                # A section that is not an object first: the ones after it still count.
                strings={"x": [], "common": {"actions.save": "Opslaan", "actions.cancel": None}},
                hashes={"common": {"actions.save": SAVE_HASH}},
            )
        )
        assert payload.strings == {"x": [], "common": {"actions.save": "Opslaan"}}
        assert payload.hashes == {"common": {"actions.save": SAVE_HASH}}
        assert payload.refused == [
            {"namespace": "common", "key": "actions.cancel", "reason": "not_a_string"}
        ]

    def test_payload_without_hashes(self):
        pack = make_pack()
        del pack["source_hashes"]
        assert lc.pack_payload(pack).hashes == {}


# ---------------------------------------------------------------------------
# The listing
# ---------------------------------------------------------------------------


class TestListing:
    def entry(self, code="nl", digest="a" * 64):
        return {**lc.parse_entry(make_entry(code)), "sha256": digest}

    def test_installed_and_updates(self):
        cached = lc.Cached(
            languages=[self.entry("nl"), self.entry("fy"), self.entry("he"), self.entry("sv")],
            fetched_at="T",
        )
        installed = {
            "nl": SimpleNamespace(source="community", source_sha256="a" * 64),
            "fy": SimpleNamespace(source="community", source_sha256="b" * 64),
            "he": SimpleNamespace(source=None, source_sha256=None),
        }
        out = lc.listing(INDEX_URL, cached, None, installed)
        assert (out["enabled"], out["url"], out["fetched_at"], out["error"]) == (
            True,
            INDEX_URL,
            "T",
            None,
        )
        flags = {
            e["code"]: (e["installed"], e["installed_from_community"], e["update_available"])
            for e in out["languages"]
        }
        assert flags == {
            "nl": (True, True, False),
            "fy": (True, True, True),
            "he": (True, False, True),
            "sv": (False, False, False),
        }

    def test_nothing_cached_with_an_error(self):
        assert lc.listing(INDEX_URL, None, lc.UNREACHABLE, {}) == {
            "enabled": True,
            "url": INDEX_URL,
            "fetched_at": None,
            "error": lc.UNREACHABLE,
            "languages": [],
        }

    def test_disabled(self):
        assert lc.disabled_listing() == {
            "enabled": False,
            "url": None,
            "fetched_at": None,
            "error": None,
            "languages": [],
        }


# ---------------------------------------------------------------------------
# On the database
# ---------------------------------------------------------------------------


@pytest.fixture
def online(library, monkeypatch, db) -> FakeLibrary:
    library.count_sessions(monkeypatch, db)
    return library


async def _cache_row(db):
    return await db.get(CatalogueCache, lc.CACHE_KEY)


class TestCatalogue:
    async def test_off_without_a_url(self, online):
        assert (await lc.catalogue("", refresh=True))["enabled"] is False
        assert online.requested == []

    async def test_first_visit_downloads_and_caches(self, online, db):
        online.publish(make_pack())
        out = await lc.catalogue(INDEX_URL, refresh=False)
        assert [e["code"] for e in out["languages"]] == ["nl"]
        assert out["error"] is None and out["fetched_at"]
        assert online.requested == [INDEX_URL]
        assert online.open_at_request == [0]
        row = await _cache_row(db)
        assert row.payload["data"]["url"] == INDEX_URL
        assert [e["code"] for e in row.payload["data"]["languages"]] == ["nl"]

    async def test_a_cached_index_is_not_downloaded_again(self, online):
        online.publish(make_pack())
        await lc.catalogue(INDEX_URL, refresh=False)
        again = await lc.catalogue(INDEX_URL, refresh=False)
        assert [e["code"] for e in again["languages"]] == ["nl"]
        assert online.requested == [INDEX_URL]

    async def test_refresh_downloads_again(self, online):
        online.publish(make_pack())
        await lc.catalogue(INDEX_URL, refresh=False)
        online.publish(make_pack(), make_pack("fy"))
        out = await lc.catalogue(INDEX_URL, refresh=True)
        assert [e["code"] for e in out["languages"]] == ["nl", "fy"]
        assert online.requested == [INDEX_URL, INDEX_URL]

    async def test_a_failed_refresh_keeps_the_cached_list(self, online):
        online.publish(make_pack())
        await lc.catalogue(INDEX_URL, refresh=False)
        online.serve(INDEX_URL, b"{", status=200)
        out = await lc.catalogue(INDEX_URL, refresh=True)
        assert out["error"] == lc.INVALID
        assert [e["code"] for e in out["languages"]] == ["nl"]
        online.serve(INDEX_URL, b"", status=503)
        assert (await lc.catalogue(INDEX_URL, refresh=True))["error"] == lc.UNREACHABLE

    async def test_an_oversized_index(self, online):
        online.serve(INDEX_URL, b" " * (lc.MAX_INDEX_BYTES + 1))
        out = await lc.catalogue(INDEX_URL, refresh=False)
        assert (out["error"], out["languages"]) == (lc.TOO_LARGE, [])

    async def test_a_cache_of_another_url_does_not_count(self, online, db):
        online.publish(make_pack())
        await lc.catalogue(INDEX_URL, refresh=False)
        other = "https://mirror.example/index.json"
        online.serve(other, make_index())
        out = await lc.catalogue(other, refresh=False)
        assert out["languages"] == []
        assert online.requested == [INDEX_URL, other]
        assert await lc.read_cached(db, INDEX_URL) is None

    async def test_a_concurrent_first_read_is_not_an_error(self, online, db, monkeypatch):
        online.publish(make_pack())
        rolled_back: list[int] = []

        async def collide(*args, **kwargs):
            raise IntegrityError("INSERT", {}, Exception("duplicate key"))

        async def rollback():
            rolled_back.append(1)

        monkeypatch.setattr(lc, "write_cached", collide)
        monkeypatch.setattr(db, "rollback", rollback)
        out = await lc.catalogue(INDEX_URL, refresh=False)
        assert [e["code"] for e in out["languages"]] == ["nl"]
        assert (out["error"], out["fetched_at"]) == (None, None)
        assert rolled_back == [1]

    async def test_a_tampered_cache_row_is_validated_again(self, db):
        stamp = await lc.write_cached(
            db, INDEX_URL, [make_entry("nl"), make_entry("de"), {"code": 1}]
        )
        assert stamp.endswith("+00:00")
        cached = await lc.read_cached(db, INDEX_URL)
        assert [e["code"] for e in cached.languages] == ["nl"]
        assert cached.fetched_at == stamp
        row = await _cache_row(db)
        for odd in ("x", 5, {"nl": {}}):
            row.payload = {"data": {"url": INDEX_URL, "languages": odd}, "fetched_at": 5}
            await db.flush()
            cached = await lc.read_cached(db, INDEX_URL)
            assert (cached.languages, cached.fetched_at) == ([], None), odd

    async def test_installed_languages_are_marked(self, online, db):
        data = online.publish(make_pack())["nl"]
        db.add(
            CustomLocale(
                code="nl",
                name="Nederlands",
                english_name="Dutch",
                source="community",
                source_sha256=sha(data),
            )
        )
        await db.flush()
        (entry,) = (await lc.catalogue(INDEX_URL, refresh=False))["languages"]
        assert (entry["installed"], entry["update_available"]) == (True, False)


async def _install(code="nl", *, overwrite_manual=False, actor=None, url=INDEX_URL):
    return await lc.install(
        url, code, overwrite_manual=overwrite_manual, record=_install_recorder(actor)
    )


@pytest.fixture
async def admin(db):
    return await create_user(db, email="lib-admin@test.com", role="admin")


async def _locale(db, code="nl"):
    return (
        await db.execute(
            select(CustomLocale)
            .where(CustomLocale.code == code)
            .execution_options(populate_existing=True)
        )
    ).scalar_one_or_none()


async def _strings(db, locale, namespace="common"):
    row = (
        await db.execute(
            select(CustomLocaleString)
            .where(
                CustomLocaleString.locale_id == locale.id,
                CustomLocaleString.namespace == namespace,
            )
            .execution_options(populate_existing=True)
        )
    ).scalar_one_or_none()
    return (row.strings, row.meta) if row else ({}, {})


class TestInstall:
    async def test_a_first_install_adds_the_language_disabled(self, online, db, admin):
        online.publish(
            make_pack(
                locale={"code": "nl", "name": "Nederlands", "english_name": "Dutch", "rtl": True}
            )
        )  # noqa: E501
        await lc.catalogue(INDEX_URL, refresh=False)
        result = await _install(actor=admin)
        assert (result["created"], result["applied"], result["kept_manual"]) == (True, 1, 0)
        assert result["rejected"] == [] and result["unknown"] == 0
        locale = await _locale(db)
        assert (locale.enabled, locale.rtl, locale.name, locale.english_name) == (
            False,
            True,
            "Nederlands",
            "Dutch",
        )
        assert (locale.source, locale.source_commit) == ("community", COMMIT)
        strings, meta = await _strings(db, locale)
        assert strings == {"actions.save": "Opslaan"}
        assert meta == {"actions.save": {"h": SAVE_HASH, "o": "community"}}
        assert result["locale"]["source"] == "community"
        assert result["locale"]["enabled"] is False
        # The pack is fetched from the derived, pinned URL, never the index's.
        assert online.requested[-1] == pack_url_for()
        assert online.open_at_request == [0, 0]

    async def test_the_recorded_digest_is_the_packs(self, online, db, admin):
        data = online.publish(make_pack())["nl"]
        await lc.catalogue(INDEX_URL, refresh=False)
        await _install(actor=admin)
        assert (await _locale(db)).source_sha256 == sha(data)

    async def test_the_install_is_audited(self, online, db, admin):
        data = online.publish(make_pack())["nl"]
        await lc.catalogue(INDEX_URL, refresh=False)
        await _install(actor=admin)
        (row,) = (
            await db.execute(select(AuditLogEntry).where(AuditLogEntry.action == ACTION))
        ).scalars()
        assert row.details["context"] == {
            "code": "nl",
            "created": True,
            "previous_source": None,
            "sha256": sha(data),
            "commit": COMMIT,
            "overwrite_manual": False,
            "applied": 1,
            "rejected": 0,
            "kept_manual": 0,
        }
        assert row.category == "admin"
        assert (row.actor_user_id, row.actor_email) == (admin.id, admin.email)
        locale = await _locale(db)
        assert (row.target_type, row.target_id, row.target_label) == (
            "custom_locale",
            str(locale.id),
            "Nederlands",
        )

    async def test_an_update_keeps_strings_corrected_by_hand(self, online, db, admin):
        locale = CustomLocale(code="nl", name="Eigen naam", english_name="Dutch", enabled=True)
        db.add(locale)
        await db.flush()
        cat = store.catalog()
        await store.apply_strings(
            db,
            locale,
            cat,
            {"common": {"actions.save": "Bewaren", "actions.delete": "Wissen"}},
            origin="manual",
        )
        await store.apply_strings(
            db, locale, cat, {"common": {"actions.cancel": "Afbreken"}}, origin="ai"
        )
        online.publish(
            make_pack(
                strings={
                    # A section that is not an object, read before ``common``.
                    "admin": [],
                    "common": {
                        "actions.save": "Opslaan",
                        "actions.cancel": "Annuleren",
                        "actions.delete": "Verwijderen",
                    },
                },
                hashes={
                    "common": {
                        "actions.save": SAVE_HASH,
                        "actions.cancel": lp.source_hash("Cancel"),
                        "actions.delete": lp.source_hash("Delete"),
                    }
                },
                locale={"code": "nl", "name": "Nederlands", "english_name": "Dutch", "rtl": True},
            )
        )
        await lc.catalogue(INDEX_URL, refresh=False)
        result = await _install(actor=admin)
        assert (result["created"], result["applied"], result["kept_manual"]) == (False, 1, 2)
        locale = await _locale(db)
        strings, meta = await _strings(db, locale)
        assert strings == {
            "actions.save": "Bewaren",
            "actions.delete": "Wissen",
            "actions.cancel": "Annuleren",
        }
        assert meta["actions.save"]["o"] == "manual"
        assert meta["actions.cancel"]["o"] == "community"
        # The admin's own name, switch and direction are kept on an update.
        assert (locale.name, locale.enabled, locale.rtl) == ("Eigen naam", True, False)
        assert locale.source == "community"
        # The audit row says the pack was merged into a language added by hand.
        (row,) = (
            await db.execute(select(AuditLogEntry).where(AuditLogEntry.action == ACTION))
        ).scalars()
        context = row.details["context"]
        assert (context["created"], context["previous_source"]) == (False, None)

    async def test_a_second_install_names_the_community_as_the_previous_source(
        self, online, db, admin
    ):
        online.publish(make_pack())
        await lc.catalogue(INDEX_URL, refresh=False)
        await _install(actor=admin)
        await _install(actor=admin)
        rows = (
            (await db.execute(select(AuditLogEntry).where(AuditLogEntry.action == ACTION)))
            .scalars()
            .all()
        )
        assert sorted(r.details["context"]["previous_source"] or "" for r in rows) == [
            "",
            "community",
        ]

    async def test_an_update_may_replace_them_when_asked(self, online, db, admin):
        locale = CustomLocale(code="nl", name="N", english_name="Dutch")
        db.add(locale)
        await db.flush()
        await store.apply_strings(
            db, locale, store.catalog(), {"common": {"actions.save": "Bewaren"}}, origin="manual"
        )
        online.publish(make_pack())
        await lc.catalogue(INDEX_URL, refresh=False)
        result = await _install(actor=admin, overwrite_manual=True)
        assert (result["applied"], result["kept_manual"]) == (1, 0)
        strings, meta = await _strings(db, await _locale(db))
        assert strings == {"actions.save": "Opslaan"}
        assert meta["actions.save"]["o"] == "community"

    async def test_hand_corrected_database_labels_are_kept_too(self, online, db, admin):
        ct = await create_card_type(db, key="Application", label="Application", built_in=True)
        locale = CustomLocale(code="nl", name="N", english_name="Dutch")
        db.add(locale)
        await db.flush()
        await store.apply_strings(
            db,
            locale,
            store.catalog(),
            {"metamodel": {"type.Application.label": "Applicatie (eigen)"}},
            origin="manual",
        )
        online.publish(
            make_pack(
                strings={"metamodel": {"type.Application.label": "Applicatie"}},
                hashes={"metamodel": {"type.Application.label": lp.source_hash("Application")}},
            )
        )
        await lc.catalogue(INDEX_URL, refresh=False)
        result = await _install(actor=admin)
        assert result["kept_manual"] == 1
        ct = (
            await db.execute(
                select(CardType)
                .where(CardType.key == "Application")
                .execution_options(populate_existing=True)
            )
        ).scalar_one()
        assert ct.translations["label"]["nl"] == "Applicatie (eigen)"

    async def test_a_database_label_needs_its_source_hash(self, online, db, admin):
        await create_card_type(db, key="Application", label="Business App", built_in=True)
        online.publish(
            make_pack(
                strings={"metamodel": {"type.Application.label": "Applicatie"}},
                # Translated from "Application" — this installation renamed it.
                hashes={"metamodel": {"type.Application.label": lp.source_hash("Application")}},
            )
        )
        await lc.catalogue(INDEX_URL, refresh=False)
        result = await _install(actor=admin)
        reasons = {r["key"]: r["reason"] for r in result["rejected"]}
        assert reasons["type.Application.label"] == store.SOURCE_CHANGED
        assert result["applied"] == 0

    async def test_a_label_without_any_hash_is_refused(self, online, db, admin):
        await create_card_type(db, key="Application", label="Application", built_in=True)
        online.publish(
            make_pack(strings={"metamodel": {"type.Application.label": "Applicatie"}}, hashes={})
        )
        await lc.catalogue(INDEX_URL, refresh=False)
        result = await _install(actor=admin)
        assert result["rejected"] == [
            {
                "namespace": "metamodel",
                "key": "type.Application.label",
                "reason": store.SOURCE_HASH_MISSING,
            }
        ]

    async def test_bad_strings_are_reported_and_never_stored(self, online, db, admin):
        online.publish(
            make_pack(
                strings={
                    "common": {
                        "actions.save": "<img src=x onerror=alert(1)>",
                        "actions.cancel": None,
                        "actions.delete": "Verwijderen",
                        "no.such.key": "x",
                    },
                    "nonsense": {"a": "b"},
                },
                hashes={},
            )
        )
        await lc.catalogue(INDEX_URL, refresh=False)
        result = await _install(actor=admin)
        assert {(r["key"], r["reason"]) for r in result["rejected"]} == {
            ("actions.save", lp.MARKUP_NOT_IN_SOURCE),
            ("actions.cancel", lp.NOT_A_STRING),
        }
        assert result["applied"] == 1
        assert result["unknown"] == 2
        strings, _ = await _strings(db, await _locale(db))
        assert strings == {"actions.delete": "Verwijderen"}

    async def test_instructions_are_never_stored(self, online, db, admin):
        online.publish(make_pack())
        await lc.catalogue(INDEX_URL, refresh=False)
        await _install(actor=admin)
        rows = (await db.execute(select(CustomLocaleString))).scalars().all()
        assert all("never shown" not in json.dumps(r.strings) for r in rows)
        assert all("instructions" not in r.strings for r in rows)

    async def test_the_language_row_is_locked_for_the_merge(self, online, db, admin):
        online.publish(make_pack())
        await lc.catalogue(INDEX_URL, refresh=False)
        statements: list[str] = []
        bind = db.sync_session.get_bind()

        def record(conn, cursor, statement, parameters, context, executemany):
            statements.append(" ".join(statement.split()))

        sa_event.listen(bind, "before_cursor_execute", record)
        try:
            await _install(actor=admin)
        finally:
            sa_event.remove(bind, "before_cursor_execute", record)
        # The lookup by code itself (``apply_strings`` locks the row by id later).
        assert any(
            "WHERE custom_locales.code =" in s and s.endswith("FOR UPDATE") for s in statements
        ), statements

    async def test_a_concurrent_first_install_is_a_conflict(self, online, db, admin, monkeypatch):
        online.publish(make_pack())
        await lc.catalogue(INDEX_URL, refresh=False)
        db.add(CustomLocale(code="nl", name="Nederlands", english_name="Dutch"))
        await db.flush()

        async def not_yet(*args, **kwargs):
            return None  # what the other install saw: no row yet

        monkeypatch.setattr(store, "get_locale", not_yet)
        with pytest.raises(lc.CatalogueError) as err:
            await _install(actor=admin)
        assert err.value.code == lc.LOCALE_EXISTS
        assert lc.STATUS[err.value.code] == 409

    async def test_the_language_must_be_listed_first(self, online, db, admin):
        online.publish(make_pack())
        with pytest.raises(lc.CatalogueError) as err:
            await _install(actor=admin)
        assert err.value.code == lc.NOT_LISTED
        await lc.catalogue(INDEX_URL, refresh=False)
        with pytest.raises(lc.CatalogueError) as err:
            await _install("fy", actor=admin)
        assert err.value.code == lc.NOT_LISTED
        assert online.requested == [INDEX_URL]

    async def test_off_without_a_url(self, online, admin):
        with pytest.raises(lc.CatalogueError) as err:
            await _install(url="", actor=admin)
        assert err.value.code == lc.DISABLED

    async def _refused(self, online, db, admin, code):
        with pytest.raises(lc.CatalogueError) as err:
            await _install(actor=admin)
        assert err.value.code == code
        assert await _locale(db) is None
        assert (await db.execute(select(CustomLocaleString))).first() is None

    async def test_a_checksum_mismatch_installs_nothing(self, online, db, admin):
        data = online.publish(make_pack())["nl"]
        await lc.catalogue(INDEX_URL, refresh=False)
        online.serve(
            pack_url_for(), pack_bytes(make_pack(strings={"common": {"actions.save": "X"}}))
        )
        await self._refused(online, db, admin, lc.PACK_CHECKSUM)
        # ...but the refusal is in the Security log, with what was expected.
        (row,) = (
            await db.execute(select(AuditLogEntry).where(AuditLogEntry.action == ACTION))
        ).scalars()
        assert row.outcome == "failure"
        assert row.details["context"] == {
            "code": "nl",
            "refusal": lc.PACK_CHECKSUM,
            "sha256": sha(data),
            "commit": COMMIT,
        }
        assert (row.target_type, row.target_id, row.target_label) == (
            "custom_locale",
            None,
            "Nederlands",
        )

    async def test_a_language_not_listed_is_not_logged(self, online, db, admin):
        with pytest.raises(lc.CatalogueError):
            await _install(actor=admin)
        found = await db.execute(select(AuditLogEntry).where(AuditLogEntry.action == ACTION))
        assert found.first() is None

    async def test_an_oversized_pack_installs_nothing(self, online, db, admin):
        online.publish(make_pack())
        await lc.catalogue(INDEX_URL, refresh=False)
        online.serve(pack_url_for(), b" " * (lc.MAX_PACK_BYTES + 1))
        await self._refused(online, db, admin, lc.PACK_TOO_LARGE)

    async def test_an_unreachable_pack_installs_nothing(self, online, db, admin):
        online.publish(make_pack())
        await lc.catalogue(INDEX_URL, refresh=False)
        online.serve(pack_url_for(), b"", status=404)
        await self._refused(online, db, admin, lc.PACK_UNREACHABLE)

    async def test_a_pack_for_another_code_installs_nothing(self, online, db, admin):
        data = pack_bytes(make_pack("fy"))
        online.serve(pack_url_for(), data)
        online.serve(INDEX_URL, make_index(make_entry("nl", data)))
        await lc.catalogue(INDEX_URL, refresh=False)
        await self._refused(online, db, admin, lc.PACK_CODE_MISMATCH)

    async def test_without_the_english_catalogue(self, online, db, admin, monkeypatch):
        online.publish(make_pack())
        await lc.catalogue(INDEX_URL, refresh=False)
        monkeypatch.setattr(store, "catalog", lambda: None)
        await self._refused(online, db, admin, lc.CATALOG_UNAVAILABLE)

    async def test_a_failure_while_writing_commits_nothing(self, online, db, admin, monkeypatch):
        """The writes are one transaction: the language, its strings and the
        provenance are committed together after the audit row, or not at all
        (the session closes and rolls back)."""
        online.publish(make_pack())
        await lc.catalogue(INDEX_URL, refresh=False)
        commits: list[int] = []

        async def commit():
            commits.append(1)

        async def boom(*args, **kwargs):
            raise RuntimeError("audit down")

        monkeypatch.setattr(db, "commit", commit)
        monkeypatch.setattr("app.services.audit_log.record", boom)
        with pytest.raises(RuntimeError):
            await _install(actor=admin)
        assert commits == []

    async def test_a_successful_install_commits_once(self, online, db, admin, monkeypatch):
        online.publish(make_pack())
        await lc.catalogue(INDEX_URL, refresh=False)
        commits: list[int] = []

        async def commit():
            commits.append(1)

        monkeypatch.setattr(db, "commit", commit)
        await _install(actor=admin)
        assert commits == [1]
