#!/usr/bin/env python3
"""Check the two-way contract between the user manual and the screenshot automation.

* every image a doc page references (`../assets/img/<locale>/<file>.png`) exists on disk;
* every referenced image has an entry in `scripts/screenshots/pages.ts` (DOC_PAGES), except the
  extension pages under `docs/extensions/`, whose screenshots are taken by hand;
* every DOC_PAGES entry is referenced by at least one doc page, in its own locale.

Exit code 1 when any of the three fails. Standard library only, so it runs anywhere.
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
REF = re.compile(r"\(\.\./(?:\.\./)*assets/img/([a-z]{2})/([^)\s]+?)\.png\)")


def doc_page_entries(pages: Path) -> dict[str, dict[str, str]]:
    """Return {entry id: {locale: filename}} for DOC_PAGES (locales not listed use the id)."""
    text = pages.read_text(encoding="utf-8")
    start = text.index("export const DOC_PAGES")
    end = text.index("export const MARKETING_PAGES")
    locales = re.search(r"export const LOCALES = \[(.*?)\]", text, re.DOTALL)
    all_locales = re.findall(r'"([a-z]{2})"', locales.group(1)) if locales else []
    body = text[start:end]
    marks = list(re.finditer(r'\n    id: "([^"]+)"', body))
    out: dict[str, dict[str, str]] = {}
    for i, mark in enumerate(marks):
        chunk = body[
            mark.start() : marks[i + 1].start() if i + 1 < len(marks) else len(body)
        ]
        names = {loc: mark.group(1) for loc in all_locales}
        block = re.search(r"filenames: \{(.*?)\}", chunk, re.DOTALL)
        if block:
            names.update(
                dict(re.findall(r'(?<![a-z])([a-z]{2}): "([^"]+)"', block.group(1)))
            )
        out[mark.group(1)] = names
    return out


def check(root: Path) -> tuple[list[str], int, int]:
    """Return (problems, entries, distinct images referenced)."""
    docs = root / "docs"
    entries = doc_page_entries(root / "scripts" / "screenshots" / "pages.ts")
    known = {(loc, name) for names in entries.values() for loc, name in names.items()}
    refs: dict[tuple[str, str], list[str]] = {}
    for md in sorted(docs.rglob("*.md")):
        for loc, name in REF.findall(md.read_text(encoding="utf-8")):
            refs.setdefault((loc, name), []).append(md.relative_to(root).as_posix())

    problems: list[str] = []
    for (loc, name), pages in sorted(refs.items()):
        if not (docs / "assets" / "img" / loc / f"{name}.png").is_file():
            problems.append(
                f"missing file docs/assets/img/{loc}/{name}.png (used by {pages[0]})"
            )
        elif (loc, name) not in known and not all(
            p.startswith("docs/extensions/") for p in pages
        ):
            problems.append(
                f"no pages.ts entry for {loc}/{name}.png (used by {pages[0]})"
            )
    for entry_id, names in sorted(entries.items()):
        if not any((loc, name) in refs for loc, name in names.items()):
            problems.append(
                f"pages.ts entry {entry_id} is not referenced by any doc page"
            )
    return problems, len(entries), len(refs)


def main() -> int:
    problems, entries, refs = check(ROOT)
    for line in problems:
        print("FAIL", line)
    print(
        f"{entries} entries, {refs} distinct images referenced, {len(problems)} problem(s)"
    )
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main())
