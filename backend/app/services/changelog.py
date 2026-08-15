"""Read the bundled ``CHANGELOG.md`` and cut version sections out of it.

Turbo EA ships its own changelog inside the backend image (see the `COPY` in
``/Dockerfile`` and the `!CHANGELOG.md` negation in ``.dockerignore``), so the
notes for the running version are always on disk. That is deliberately not the
GitHub releases feed: this is the changelog for the exact version executing,
it needs no network, and an air-gapped install behaves identically to a
connected one.

The file follows Keep a Changelog, with one ``## [x.y.z] - date`` heading per
version, newest first — the same structure
``.github/workflows/github-release.yml`` already relies on when it cuts a
section for a GitHub release.
"""

from __future__ import annotations

import logging
import re
from collections.abc import Iterator
from pathlib import Path

from app.services.catalogue_common import version_tuple

logger = logging.getLogger(__name__)

#: `## [2.60.0] - 2026-08-15` — the version is what we key on; the date is free text.
VERSION_HEADING = re.compile(r"^##\s*\[(?P<version>[^\]]+)\]")


def read_changelog() -> str:
    """Return the bundled changelog, or ``""`` when it is not on disk.

    Same two-candidate search as ``config._read_version``: the repository root
    when running from source, ``/app/CHANGELOG.md`` inside the image. Missing
    is not an error — a stripped or hand-built image simply has no notes to
    show, and the dialog degrades to its empty state.
    """
    here = Path(__file__).resolve().parent
    # backend/app/services/changelog.py -> ../../../CHANGELOG.md (repo root)
    # /app/app/services/changelog.py    -> /app/CHANGELOG.md
    for candidate in (
        here.parent.parent.parent / "CHANGELOG.md",
        here.parent.parent / "CHANGELOG.md",
    ):
        if candidate.is_file():
            return candidate.read_text(encoding="utf-8")
    logger.debug("No bundled CHANGELOG.md found")
    return ""


def _normalise_heading(line: str) -> str:
    """``## [2.60.0] - 2026-08-15`` → ``## 2.60.0 — 2026-08-15``.

    Keep a Changelog's square brackets are file syntax, not something a reader
    of the what's-new dialog should see; left alone they render as literal
    ``[2.60.0]`` because there is no link target after them.
    """
    match = re.match(r"^##\s*\[(?P<version>[^\]]+)\]\s*-?\s*(?P<rest>.*)$", line)
    if not match:
        return line
    rest = match.group("rest").strip()
    return f"## {match.group('version')} — {rest}" if rest else f"## {match.group('version')}"


def _iter_sections(text: str) -> Iterator[tuple[str, list[str]]]:
    """Yield ``(version, lines)`` per ``## [version]`` heading, file order.

    ``lines`` includes the heading itself. Anything before the first version
    heading (the file's preamble) is skipped.
    """
    version: str | None = None
    lines: list[str] = []

    for line in text.replace("\r\n", "\n").split("\n"):
        match = VERSION_HEADING.match(line)
        if match:
            if version is not None:
                yield version, lines
            version = match.group("version")
            lines = [_normalise_heading(line)]
            continue
        if version is not None:
            lines.append(line)

    if version is not None:
        yield version, lines


#: Most version sections a single span will return. The bundled changelog is
#: ~480 KB of history, so an instance upgrading across a year of releases would
#: otherwise hand the dialog the better part of a megabyte. Ten sections is
#: already more than anyone reads in one sitting; the rest stays one click away
#: on the project's releases page.
MAX_SECTIONS = 10


def sections_between(text: str, *, after: str | None, upto: str) -> str:
    """Markdown for the version sections in ``(after, upto]``, newest first.

    An upgrade usually skips releases — 2.57.0 straight to 2.60.0 — and showing
    only the newest section would hide most of what changed for the reader, so
    the whole span is returned as one document, capped at ``MAX_SECTIONS``.

    ``after=None`` means "no lower bound": everything up to and including
    ``upto``. Versions are compared numerically via ``version_tuple``, so
    2.10.0 correctly sorts above 2.9.0.
    """
    if not text.strip():
        return ""

    lower = version_tuple(after) if after else None
    upper = version_tuple(upto)

    kept: list[str] = []
    taken = 0
    truncated = False

    for version, lines in _iter_sections(text):
        parsed = version_tuple(version)
        if not (parsed <= upper and (lower is None or parsed > lower)):
            continue
        if taken == MAX_SECTIONS:
            truncated = True
            break
        kept.extend(lines)
        taken += 1

    body = "\n".join(kept).strip()
    if truncated:
        body += f"\n\n_Showing the {MAX_SECTIONS} most recent releases._"
    return body


def section_for(text: str, version: str) -> str:
    """Markdown for exactly one version's section, or ``""`` if it is absent."""
    if not text.strip():
        return ""

    wanted = version_tuple(version)
    for candidate, lines in _iter_sections(text):
        if version_tuple(candidate) == wanted:
            return "\n".join(lines).strip()
    return ""
