"""Tests for reading an extension's release notes.

Two sources that answer in different situations — a signed bundle on disk and
the store's published feed — normalised to one markdown shape so the
pre-install dialog and the post-update notification cannot drift.
"""

from __future__ import annotations

import json
import zipfile

import httpx
import pytest

from app.services.extensions import changelog_source as cs
from app.services.extensions.changelog_source import (
    CHANGELOG_NAME,
    EXTENSION_MAX_SECTIONS,
    MAX_CHANGELOG_BYTES,
    bundle_changelog,
    bundle_changelog_from_zip,
    customer_facing_markdown,
    fetch_store_changelog,
    notes_between,
    resolve_extension_notes,
    store_changelog_safe,
    store_json_to_markdown,
    store_listing_url,
)

STORE = "https://store.example.com"

CHANGELOG = """# Changelog

All notable changes.

## [1.3.0] - 2026-08-26

### Added
- A **Retry failed** button on the delivery panel.

## [1.2.0] - 2026-08-20

### Fixed
- Everyone appears under People.

## [1.1.0] - 2026-08-10

### Fixed
- The outbox no longer drains into nothing.
"""


def _feed() -> list[dict]:
    return [
        {
            "version": "1.3.0",
            "date": "2026-08-26",
            "categories": [{"name": "Added", "items": ["A **Retry failed** button."]}],
        },
        {
            "version": "1.2.0",
            "date": "2026-08-20",
            "categories": [{"name": "Fixed", "items": ["Everyone appears under People."]}],
        },
        {
            "version": "1.1.0",
            "date": "2026-08-10",
            "categories": [{"name": "Fixed", "items": ["The outbox drains."]}],
        },
    ]


# ---------------------------------------------------------------------------
# Reading the bundle
# ---------------------------------------------------------------------------


class TestBundleOnDisk:
    def test_reads_the_installed_changelog(self, tmp_path):
        (tmp_path / "acme").mkdir()
        (tmp_path / "acme" / CHANGELOG_NAME).write_text(CHANGELOG, encoding="utf-8")

        assert "## [1.3.0]" in bundle_changelog("acme", extensions_dir=tmp_path)

    def test_a_missing_file_is_not_an_error(self, tmp_path):
        """The normal case for anything packaged before changelogs existed."""
        (tmp_path / "acme").mkdir()

        assert bundle_changelog("acme", extensions_dir=tmp_path) == ""

    def test_a_missing_extension_is_not_an_error(self, tmp_path):
        assert bundle_changelog("never-installed", extensions_dir=tmp_path) == ""

    def test_an_oversized_file_is_refused_rather_than_read(self, tmp_path):
        (tmp_path / "acme").mkdir()
        (tmp_path / "acme" / CHANGELOG_NAME).write_text(
            "x" * (MAX_CHANGELOG_BYTES + 1), encoding="utf-8"
        )

        assert bundle_changelog("acme", extensions_dir=tmp_path) == ""


class TestBundleZip:
    def _zip(self, tmp_path, members: dict[str, str]):
        path = tmp_path / "bundle.teax"
        with zipfile.ZipFile(path, "w") as zf:
            for name, body in members.items():
                zf.writestr(name, body)
        return path

    def test_reads_the_member_from_a_bundle_not_yet_applied(self, tmp_path):
        path = self._zip(tmp_path, {"manifest.json": "{}", CHANGELOG_NAME: CHANGELOG})

        assert "## [1.2.0]" in bundle_changelog_from_zip(path)

    def test_a_bundle_without_one_yields_empty(self, tmp_path):
        path = self._zip(tmp_path, {"manifest.json": "{}"})

        assert bundle_changelog_from_zip(path) == ""

    def test_a_corrupt_bundle_yields_empty_rather_than_raising(self, tmp_path):
        path = tmp_path / "broken.teax"
        path.write_bytes(b"not a zip")

        assert bundle_changelog_from_zip(path) == ""


# ---------------------------------------------------------------------------
# The store feed
# ---------------------------------------------------------------------------


class _FakeResponse:
    def __init__(self, payload, status_code: int = 200):
        self._payload = payload
        self.status_code = status_code
        self.content = json.dumps(payload).encode() if payload is not None else b""

    def raise_for_status(self):
        if self.status_code >= 400:
            raise httpx.HTTPStatusError("boom", request=None, response=None)

    def json(self):
        if self._payload is None:
            raise ValueError("not json")
        return self._payload


class _FakeClient:
    calls: list[str] = []
    response: object = None
    raises: Exception | None = None

    def __init__(self, *args, **kwargs):
        pass

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        return False

    async def get(self, url, **kwargs):
        type(self).calls.append(url)
        if type(self).raises is not None:
            raise type(self).raises
        return type(self).response


@pytest.fixture
def fake_http(monkeypatch):
    _FakeClient.calls = []
    _FakeClient.response = None
    _FakeClient.raises = None
    monkeypatch.setattr(cs.httpx, "AsyncClient", _FakeClient)
    return _FakeClient


class TestStoreFeed:
    async def test_fetches_the_per_key_payload(self, fake_http):
        fake_http.response = _FakeResponse(_feed())

        payload = await fetch_store_changelog(STORE, "slack-notify")

        assert payload is not None and payload[0]["version"] == "1.3.0"
        assert fake_http.calls == [f"{STORE}/changelogs/slack-notify.json"]

    async def test_a_404_means_unpublished_not_broken(self, fake_http):
        """An installed-but-unlisted extension has no feed. That is normal."""
        fake_http.response = _FakeResponse(None, status_code=404)

        assert await fetch_store_changelog(STORE, "private-ext") is None

    async def test_a_non_list_payload_is_refused(self, fake_http):
        fake_http.response = _FakeResponse({"versions": []})

        assert await fetch_store_changelog(STORE, "acme") is None

    async def test_a_key_that_is_not_a_key_never_becomes_a_path(self, fake_http):
        assert await fetch_store_changelog(STORE, "../../etc/passwd") is None
        assert fake_http.calls == []

    async def test_safe_wrapper_swallows_transport_failures(self, fake_http):
        fake_http.raises = httpx.ConnectError("no route")

        assert await store_changelog_safe(STORE, "acme") is None

    async def test_safe_wrapper_makes_no_request_without_a_store(self, fake_http):
        assert await store_changelog_safe("", "acme") is None
        assert fake_http.calls == []


class TestFeedToMarkdown:
    def test_round_trips_into_the_shape_the_parser_slices(self):
        md = store_json_to_markdown(_feed())

        assert md.splitlines()[0] == "## [1.3.0] - 2026-08-26"
        assert "### Added" in md
        assert "- A **Retry failed** button." in md
        # The parser core already owns must be able to read it back.
        assert notes_between(md, version="1.3.0", from_version="1.2.0")

    def test_inline_markdown_survives_for_the_renderer(self):
        assert "**Retry failed**" in store_json_to_markdown(_feed())

    def test_a_section_with_no_version_is_skipped(self):
        md = store_json_to_markdown([{"date": "2026-01-01", "categories": []}, *_feed()])

        assert md.splitlines()[0] == "## [1.3.0] - 2026-08-26"

    def test_malformed_entries_do_not_cost_the_reader_the_rest(self):
        md = store_json_to_markdown(["junk", {"version": "1.0.0", "categories": "nope"}, *_feed()])

        assert "## [1.3.0] - 2026-08-26" in md
        assert "## [1.2.0]" in md

    def test_an_internal_category_is_dropped_and_an_emptied_release_with_it(self):
        """The published feed already omits `### Internal`; a payload from an
        older publisher must land the same way, and a release whose every
        entry was internal has no heading to show for it."""
        md = store_json_to_markdown(
            [
                {"version": "1.4.0", "categories": [{"name": "Internal", "items": ["Wheel fix."]}]},
                {
                    "version": "1.3.0",
                    "categories": [
                        {"name": "Fixed", "items": ["Visible."]},
                        {"name": "internal", "items": ["Build checks."]},
                    ],
                },
            ]
        )

        assert "1.4.0" not in md and "Wheel fix" not in md and "Build checks" not in md
        assert "## [1.3.0]" in md and "- Visible." in md

    def test_an_empty_category_is_dropped(self):
        md = store_json_to_markdown(
            [{"version": "1.0.0", "categories": [{"name": "Added", "items": []}]}]
        )

        assert "### Added" not in md

    def test_a_bullet_with_no_category_still_renders(self):
        md = store_json_to_markdown(
            [{"version": "1.0.0", "categories": [{"name": "", "items": ["Something"]}]}]
        )

        assert "- Something" in md
        assert "###" not in md


# ---------------------------------------------------------------------------
# Selecting a span
# ---------------------------------------------------------------------------


SWEPT = """# Changelog

## [1.4.0] - 2026-09-01

### Internal

- The build checks run again.

## [1.3.0] - 2026-08-26

### Added
- A **Retry failed** button on the delivery panel.

### Internal
- The packaged wheel now carries the same version as the extension.

## [1.2.0] - 2026-08-20

### Fixed
- Everyone appears under People.

## [1.1.0] - 2026-08-10

### fixed
- The outbox no longer drains into nothing.

## [1.0.0] - 2026-08-01

- First release.
"""


class TestCustomerFacingMarkdown:
    def test_strips_internal_blocks_and_keeps_the_rest_of_the_section(self):
        out = customer_facing_markdown(SWEPT)

        assert "packaged wheel" not in out
        assert "### Internal" not in out
        assert "- A **Retry failed** button" in out
        assert "### Added" in out

    def test_a_release_left_with_nothing_disappears_whole(self):
        out = customer_facing_markdown(SWEPT)

        assert "1.4.0" not in out and "build checks" not in out
        assert out.startswith("# Changelog")  # the preamble is not a section

    def test_matching_is_by_name_not_by_case(self):
        out = customer_facing_markdown(
            "## [1.0.0] - x\n\n### INTERNAL\n- hidden\n\n### fixed\n- shown\n"
        )

        assert "hidden" not in out and "shown" in out

    def test_a_bullet_outside_any_category_counts_as_content(self):
        assert "First release" in customer_facing_markdown(SWEPT)

    def test_empty_input(self):
        assert customer_facing_markdown("") == ""


class TestNotesBetween:
    def test_returns_the_span_between_two_versions(self):
        notes = notes_between(CHANGELOG, version="1.3.0", from_version="1.1.0")

        assert "1.3.0" in notes and "1.2.0" in notes
        assert "1.1.0" not in notes  # lower bound is exclusive

    def test_a_first_install_shows_the_newest_two_releases(self):
        """One release says what changed; the second says the extension is
        alive. Anything older is on the store's listing page."""
        notes = notes_between(CHANGELOG, version="1.3.0", from_version=None)

        assert "1.3.0" in notes and "1.2.0" in notes and "1.1.0" not in notes

    def test_an_update_span_is_capped_at_two_without_a_note(self):
        notes = notes_between(SWEPT, version="1.3.0", from_version="1.0.0")

        headings = [line for line in notes.split("\n") if line.startswith("## ")]
        assert len(headings) == EXTENSION_MAX_SECTIONS == 2
        assert "1.3.0" in headings[0] and "1.2.0" in headings[1]
        assert "most recent releases" not in notes

    def test_internal_entries_never_reach_the_reader(self):
        notes = notes_between(SWEPT, version="1.4.0", from_version="1.1.0")

        # 1.4.0 exists (the existence test passes) but had nothing to say, so
        # the reader gets the next two releases that did.
        assert "build checks" not in notes and "packaged wheel" not in notes
        assert "1.3.0" in notes and "1.2.0" in notes and "1.4.0" not in notes

    def test_a_version_below_the_bound_is_not_reached_for(self):
        notes = notes_between(CHANGELOG, version="1.2.0", from_version=None)

        assert "1.3.0" not in notes

    def test_an_unknown_version_never_dumps_the_whole_file(self):
        """``sections_between`` treats ``upto`` as a bound, so an unknown
        version would otherwise match every section below it."""
        assert notes_between(CHANGELOG, version="9.9.9", from_version="1.1.0") == ""

    def test_an_empty_changelog_is_empty(self):
        assert notes_between("", version="1.0.0", from_version=None) == ""


class TestResolveExtensionNotes:
    async def test_prefers_the_store_and_says_so(self, fake_http, tmp_path, monkeypatch):
        monkeypatch.setattr(cs, "EXTENSIONS_DIR", tmp_path)
        fake_http.response = _FakeResponse(_feed())

        result = await resolve_extension_notes(key="acme", version="1.3.0", from_version="1.2.0")

        assert result["source"] == "store"
        assert "Retry failed" in result["notes"]
        # The store answered, so its listing page exists — offer it.
        assert result["changelog_url"].endswith("/ext/acme/#whats-new")

    async def test_falls_back_to_the_bundle_when_the_store_is_unreachable(
        self, fake_http, tmp_path, monkeypatch
    ):
        monkeypatch.setattr(cs, "EXTENSIONS_DIR", tmp_path)
        (tmp_path / "acme").mkdir()
        (tmp_path / "acme" / CHANGELOG_NAME).write_text(CHANGELOG, encoding="utf-8")
        fake_http.raises = httpx.ConnectError("air-gapped")

        result = await resolve_extension_notes(key="acme", version="1.3.0", from_version="1.2.0")

        assert result["source"] == "bundle"
        assert "Retry failed" in result["notes"]
        # Air-gapped: no evidence the store lists this key, so no link to a
        # page that may not exist.
        assert result["changelog_url"] is None

    async def test_prefer_store_false_reads_the_bytes_on_disk_first(
        self, fake_http, tmp_path, monkeypatch
    ):
        """Describing the installed version must describe what is installed."""
        monkeypatch.setattr(cs, "EXTENSIONS_DIR", tmp_path)
        (tmp_path / "acme").mkdir()
        (tmp_path / "acme" / CHANGELOG_NAME).write_text(CHANGELOG, encoding="utf-8")
        fake_http.response = _FakeResponse(_feed())

        result = await resolve_extension_notes(
            key="acme", version="1.3.0", from_version=None, prefer_store=False
        )

        assert result["source"] == "bundle"
        assert fake_http.calls == []

    async def test_neither_source_is_an_honest_empty_state(self, fake_http, tmp_path, monkeypatch):
        monkeypatch.setattr(cs, "EXTENSIONS_DIR", tmp_path)
        fake_http.response = _FakeResponse(None, status_code=404)

        result = await resolve_extension_notes(key="acme", version="1.3.0")

        assert result == {
            "key": "acme",
            "version": "1.3.0",
            "from_version": None,
            "notes": "",
            "source": "none",
            "changelog_url": None,
        }


class TestStoreListingUrl:
    def test_builds_the_whats_new_anchor_on_the_listing_page(self):
        assert store_listing_url("https://store.example.com/", "acme") == (
            "https://store.example.com/ext/acme/#whats-new"
        )

    def test_refuses_a_key_that_is_not_a_key_and_an_empty_store(self):
        assert store_listing_url("https://store.example.com", "../x") is None
        assert store_listing_url("", "acme") is None
