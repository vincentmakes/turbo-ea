"""Tests for resolving the notes of *one specific version*.

The regression these guard is subtle and only shows up over time: every
notification the bell keeps is a claim about a particular release, and before
this module the dialog answered all of them with "whatever is newest". So most
of what follows checks that an *old* version resolves to its *own* section, and
that the cached GitHub body — which only ever describes the newest release —
never leaks in as a substitute for one.
"""

from __future__ import annotations

import pytest

from app.services import release_notes
from app.services.release_notes import resolve_release_notes, valid_version

CHANGELOG = """# Changelog

Preamble that must never be returned.

## [2.61.0] - 2026-08-15

### Added
- Newest thing.

## [2.60.0] - 2026-08-01

### Fixed
- Middle thing.

## [2.55.0] - 2026-05-01

### Added
- Old thing.
"""


@pytest.fixture(autouse=True)
def _bundled_changelog(monkeypatch):
    monkeypatch.setattr(release_notes, "read_changelog", lambda: CHANGELOG)
    monkeypatch.setattr(release_notes, "APP_VERSION", "2.61.0")


# The changelog path never touches the database — passing None both proves that
# and keeps these runnable without Postgres.
NO_DB = None


class TestChangelogIsTheSource:
    async def test_an_old_version_resolves_to_its_own_section(self):
        """The bug in one test: 2.55.0 must not answer with 2.61.0's notes."""
        result = await resolve_release_notes(
            NO_DB, version="2.55.0", from_version=None, allow_cached_github=True
        )

        assert "Old thing" in result["notes"]
        assert "Newest thing" not in result["notes"]
        assert result["source"] == "changelog"
        assert result["version"] == "2.55.0"

    async def test_a_span_covers_every_version_the_upgrade_crossed(self):
        result = await resolve_release_notes(
            NO_DB, version="2.61.0", from_version="2.55.0", allow_cached_github=False
        )

        assert "Newest thing" in result["notes"]
        assert "Middle thing" in result["notes"]
        # The lower bound is exclusive — you already read that one.
        assert "Old thing" not in result["notes"]

    async def test_an_empty_span_falls_back_to_the_landing_version(self):
        """`from_version` above `version` yields no span; show the one section."""
        result = await resolve_release_notes(
            NO_DB, version="2.55.0", from_version="2.61.0", allow_cached_github=False
        )

        assert "Old thing" in result["notes"]
        assert result["source"] == "changelog"

    async def test_the_preamble_is_never_returned(self):
        result = await resolve_release_notes(
            NO_DB, version="2.61.0", from_version=None, allow_cached_github=False
        )

        assert "Preamble" not in result["notes"]

    async def test_marks_whether_the_version_is_installed(self):
        older = await resolve_release_notes(
            NO_DB, version="2.55.0", from_version=None, allow_cached_github=False
        )
        assert older["is_installed"] is True
        assert older["current_version"] == "2.61.0"

    async def test_compares_versions_numerically_not_as_strings(self):
        """2.9.0 must sort below 2.61.0 — string order would say otherwise."""
        result = await resolve_release_notes(
            NO_DB, version="2.9.0", from_version=None, allow_cached_github=False
        )

        assert result["is_installed"] is True


class TestUnknownVersion:
    async def test_a_version_with_no_section_yields_an_honest_empty_state(self, monkeypatch):
        """Better to say nothing than to show another release's notes."""
        monkeypatch.setattr(release_notes, "read_changelog", lambda: CHANGELOG)

        result = await resolve_release_notes(
            NO_DB, version="2.99.0", from_version=None, allow_cached_github=False
        )

        assert result["notes"] == ""
        assert result["source"] == "none"
        assert result["is_installed"] is False

    async def test_a_missing_changelog_degrades_rather_than_raising(self, monkeypatch):
        monkeypatch.setattr(release_notes, "read_changelog", lambda: "")

        result = await resolve_release_notes(
            NO_DB, version="2.55.0", from_version=None, allow_cached_github=False
        )

        assert result["notes"] == ""
        assert result["source"] == "none"


class TestCachedGithubFallback:
    """The cache holds exactly one release — the newest one seen.

    It is the right answer for a version that is not installed yet, and the
    wrong answer for every other version, which is what these pin down.
    """

    @staticmethod
    def _status(**over):
        base = {
            "latest_version": "2.62.0",
            "release_notes": "### Added\n- Unreleased thing.",
            "release_url": "https://example.com/v2.62.0",
        }
        base.update(over)
        return base

    async def test_serves_the_cached_body_for_the_version_it_describes(self, monkeypatch):
        async def _read_status(_db):
            return self._status()

        monkeypatch.setattr("app.services.update_check.read_status", _read_status)

        result = await resolve_release_notes(
            NO_DB, version="2.62.0", from_version=None, allow_cached_github=True
        )

        assert "Unreleased thing" in result["notes"]
        assert result["source"] == "github"
        assert result["release_url"] == "https://example.com/v2.62.0"
        assert result["is_installed"] is False

    async def test_never_serves_the_cached_body_for_a_different_version(self, monkeypatch):
        """A stale 2.99.0 notice must not be answered with 2.62.0's notes."""

        async def _read_status(_db):
            return self._status()

        monkeypatch.setattr("app.services.update_check.read_status", _read_status)

        result = await resolve_release_notes(
            NO_DB, version="2.99.0", from_version=None, allow_cached_github=True
        )

        assert result["notes"] == ""
        assert result["source"] == "none"

    async def test_withheld_without_the_admin_settings_permission(self, monkeypatch):
        async def _read_status(_db):
            raise AssertionError("read_status must not be called without permission")

        monkeypatch.setattr("app.services.update_check.read_status", _read_status)

        result = await resolve_release_notes(
            NO_DB, version="2.62.0", from_version=None, allow_cached_github=False
        )

        assert result["notes"] == ""
        assert result["source"] == "none"

    async def test_the_changelog_wins_over_the_cache(self, monkeypatch):
        """An installed version is described on disk; never re-fetch it."""

        async def _read_status(_db):
            raise AssertionError("the changelog already answered")

        monkeypatch.setattr("app.services.update_check.read_status", _read_status)

        result = await resolve_release_notes(
            NO_DB, version="2.55.0", from_version=None, allow_cached_github=True
        )

        assert result["source"] == "changelog"


class TestVersionValidation:
    @pytest.mark.parametrize("value", ["2", "2.61", "2.61.1", "2026.5.11.505"])
    def test_accepts_versions_we_could_have_published(self, value):
        assert valid_version(value)

    @pytest.mark.parametrize(
        "value",
        ["", None, "banana", "2.61.0; DROP", "../../etc/passwd", "2.-1.0", "999999", "2.61.0.1.2"],
    )
    def test_rejects_anything_else(self, value):
        """`version_tuple` parses junk as zeros, so the shape is pinned here."""
        assert not valid_version(value)
