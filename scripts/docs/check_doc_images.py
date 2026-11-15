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
PAGES = ROOT / "scripts" / "screenshots" / "pages.ts"
DOCS = ROOT / "docs"
IMG = DOCS / "assets" / "img"
REF = re.compile(r"\(\.\./(?:\.\./)*assets/img/([a-z]{2})/([^)\s]+?)\.png\)")


def doc_page_entries() -> dict[str, dict[str, str]]:
    """Return {entry id: {locale: filename}} for DOC_PAGES (locales not listed use the id)."""
    text = PAGES.read_text(encoding="utf-8")
    start = text.index("export const DOC_PAGES")
    end = text.index("export const MARKETING_PAGES")
    locales = re.search(r"export const LOCALES = \[(.*?)\]", text, re.S)
    all_locales = re.findall(r'"([a-z]{2})"', locales.group(1)) if locales else []
    out: dict[str, dict[str, str]] = {}
    marks = list(re.finditer(r'\n    id: "([^"]+)"', text[start:end]))
    body = text[start:end]
    for i, mark in enumerate(marks):
        chunk = body[mark.start() : marks[i + 1].start() if i + 1 < len(marks) else len(body)]
        names = {loc: mark.group(1) for loc in all_locales}
        block = re.search(r"filenames: \{(.*?)\}", chunk, re.S)
        if block:
            names.update(dict(re.findall(r'(?<![a-z])([a-z]{2}): "([^"]+)"', block.group(1))))
        out[mark.group(1)] = names
    return out


def main() -> int:
    entries = doc_page_entries()
    known = {(loc, name) for names in entries.values() for loc, name in names.items()}
    refs: dict[tuple[str, str], list[str]] = {}
    for md in sorted(DOCS.rglob("*.md")):
        for loc, name in REF.findall(md.read_text(encoding="utf-8")):
            refs.setdefault((loc, name), []).append(md.relative_to(ROOT).as_posix())

    errors: list[str] = []
    for (loc, name), pages in sorted(refs.items()):
        if not (IMG / loc / f"{name}.png").is_file():
            errors.append(f"missing file docs/assets/img/{loc}/{name}.png (used by {pages[0]})")
        elif (loc, name) not in known and not all(r.startswith("docs/extensions/") for r in pages):
            errors.append(f"no pages.ts entry for {loc}/{name}.png (used by {pages[0]})")
    for entry_id, names in sorted(entries.items()):
        if not any((loc, name) in refs for loc, name in names.items()):
            errors.append(f"pages.ts entry {entry_id} is not referenced by any doc page")

    for line in errors:
        print("FAIL", line)
    print(f"{len(entries)} entries, {len(refs)} distinct images referenced, {len(errors)} problem(s)")
    return 1 if errors else 0


if __name__ == "__main__":
    sys.exit(main())
