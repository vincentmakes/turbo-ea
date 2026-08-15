"""Tests for cutting version sections out of the bundled CHANGELOG.md."""

from __future__ import annotations

import pathlib

from app.services import changelog
from app.services.changelog import read_changelog, section_for, sections_between

SAMPLE = """# Changelog

Some preamble that belongs to no version.

## [2.60.0] - 2026-08-15

### Added
- The newest thing

## [2.59.1] - 2026-08-14

### Fixed
- A patch

## [2.9.0] - 2026-07-01

### Added
- An older thing
"""


class TestSectionsBetween:
    def test_returns_only_versions_above_the_lower_bound(self):
        out = sections_between(SAMPLE, after="2.59.1", upto="2.60.0")

        assert "The newest thing" in out
        assert "A patch" not in out
        assert "An older thing" not in out

    def test_spans_every_version_the_upgrade_skipped(self):
        out = sections_between(SAMPLE, after="2.9.0", upto="2.60.0")

        assert "The newest thing" in out
        assert "A patch" in out
        # The lower bound itself is excluded — the user already had it.
        assert "An older thing" not in out

    def test_the_lower_bound_is_exclusive_and_the_upper_inclusive(self):
        out = sections_between(SAMPLE, after="2.9.0", upto="2.9.0")
        assert out == ""

        out = sections_between(SAMPLE, after="2.59.1", upto="2.59.1")
        assert out == ""

        out = sections_between(SAMPLE, after=None, upto="2.9.0")
        assert "An older thing" in out
        assert "A patch" not in out

    def test_compares_numerically_not_as_strings(self):
        """2.10.0 is newer than 2.9.0 — a string compare would say otherwise."""
        text = "## [2.10.0] - x\n\n- ten\n\n## [2.9.0] - x\n\n- nine\n"

        out = sections_between(text, after="2.9.0", upto="2.10.0")

        assert "ten" in out
        assert "nine" not in out

    def test_drops_the_preamble(self):
        out = sections_between(SAMPLE, after=None, upto="2.60.0")
        assert "belongs to no version" not in out

    def test_caps_a_very_long_span_and_says_so(self):
        text = "".join(f"## [1.0.{i}] - x\n\n- entry {i}\n\n" for i in range(30, 0, -1))

        out = sections_between(text, after="1.0.0", upto="1.0.30")

        headings = [line for line in out.split("\n") if line.startswith("## ")]
        assert len(headings) == changelog.MAX_SECTIONS
        assert "entry 30" in out  # newest kept
        assert "entry 1" not in out  # oldest dropped
        assert f"Showing the {changelog.MAX_SECTIONS} most recent releases" in out

    def test_empty_or_unparseable_input_yields_nothing(self):
        assert sections_between("", after=None, upto="2.60.0") == ""
        assert sections_between("   \n  ", after=None, upto="2.60.0") == ""
        assert sections_between("no headings here at all", after=None, upto="2.60.0") == ""


class TestSectionFor:
    def test_returns_exactly_one_section(self):
        out = section_for(SAMPLE, "2.59.1")

        assert out.startswith("## 2.59.1 — 2026-08-14")
        assert "A patch" in out
        assert "The newest thing" not in out
        assert "An older thing" not in out

    def test_absent_version_yields_nothing(self):
        assert section_for(SAMPLE, "99.0.0") == ""

    def test_empty_input_yields_nothing(self):
        assert section_for("", "2.60.0") == ""


class TestReadChangelog:
    def test_reads_the_repository_changelog_in_local_dev(self):
        """The file must be findable from source — the Docker path is covered
        by the COPY in /Dockerfile plus the .dockerignore negation."""
        text = read_changelog()

        assert text.startswith("# Changelog")
        assert "## [" in text

    def test_the_running_version_has_a_section(self):
        """Guards the release chore: a VERSION bump without a matching
        CHANGELOG heading would leave the what's-new dialog empty."""
        from app.config import APP_VERSION

        assert section_for(read_changelog(), APP_VERSION) != ""


class TestImagePackaging:
    """Source-level guards that the changelog actually reaches the image.

    ``read_changelog`` finding the file in a source checkout proves nothing
    about the container: `.dockerignore` excludes `*.md` wholesale, so the file
    only ships because of an explicit negation and two `COPY` lines. Break
    either and the what's-new dialog silently goes empty in production while
    every test here still passes — hence checking the build files themselves.
    """

    def _repo_root(self) -> pathlib.Path:
        return pathlib.Path(__file__).resolve().parents[3]

    def test_dockerignore_readmits_the_changelog_after_excluding_md(self):
        lines = [
            line.strip()
            for line in (self._repo_root() / ".dockerignore")
            .read_text(encoding="utf-8")
            .split("\n")
            if line.strip() and not line.strip().startswith("#")
        ]

        assert "*.md" in lines, "the broad markdown exclusion is gone — re-check this guard"
        assert "!CHANGELOG.md" in lines, (
            "CHANGELOG.md is no longer re-admitted to the build context"
        )
        # Docker applies the last matching pattern, so the negation must follow.
        assert lines.index("!CHANGELOG.md") > lines.index("*.md"), (
            "!CHANGELOG.md must come after *.md — the last matching pattern wins"
        )

    def test_the_dockerfile_copies_the_changelog_into_the_backend_image(self):
        dockerfile = (self._repo_root() / "Dockerfile").read_text(encoding="utf-8")

        # Into the build stage…
        assert "COPY CHANGELOG.md ./CHANGELOG.md" in dockerfile
        # …and through to the runtime stage.
        assert "COPY --from=backend-build /app/CHANGELOG.md ./CHANGELOG.md" in dockerfile

    def test_the_docker_path_candidate_matches_the_image_layout(self):
        """`/app/CHANGELOG.md` next to `/app/app/` is what the COPY produces."""
        source = pathlib.Path(changelog.__file__).read_text(encoding="utf-8")
        assert 'here.parent.parent / "CHANGELOG.md"' in source
