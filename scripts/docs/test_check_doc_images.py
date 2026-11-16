"""Tests for scripts/docs/check_doc_images.py (run: python -m pytest scripts/docs)."""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import check_doc_images as c

PAGES = """export const LOCALES = [
  "en", "de",
] as const;
export const DOC_PAGES: PageDef[] = [
  {
    id: "01_a",
    route: "/",
    filenames: {
      en: "01_a",
      de: "01_a_de",
    },
  },
  {
    id: "02_b",
    route: "/b",
    filenames: {
      en: "02_b",
    },
  },
];
export const MARKETING_PAGES: PageDef[] = [];
"""


def build(tmp_path: Path, doc: str, images: list[str]) -> Path:
    (tmp_path / "scripts" / "screenshots").mkdir(parents=True)
    (tmp_path / "scripts" / "screenshots" / "pages.ts").write_text(
        PAGES, encoding="utf-8"
    )
    (tmp_path / "docs" / "guide").mkdir(parents=True)
    (tmp_path / "docs" / "guide" / "a.md").write_text(doc, encoding="utf-8")
    for rel in images:
        f = tmp_path / "docs" / "assets" / "img" / rel
        f.parent.mkdir(parents=True, exist_ok=True)
        f.write_bytes(b"png")
    return tmp_path


def test_clean_manual_has_no_problems(tmp_path):
    root = build(
        tmp_path,
        "![a](../assets/img/en/01_a.png)\n![b](../assets/img/en/02_b.png)\n"
        "![d](../assets/img/de/01_a_de.png)\n",
        ["en/01_a.png", "en/02_b.png", "de/01_a_de.png"],
    )
    problems, entries, refs = c.check(root)
    assert (problems, entries, refs) == ([], 2, 3)


def test_unreferenced_entry_is_reported(tmp_path):
    root = build(tmp_path, "![a](../assets/img/en/01_a.png)\n", ["en/01_a.png"])
    problems, _, _ = c.check(root)
    assert problems == ["pages.ts entry 02_b is not referenced by any doc page"]


def test_missing_file_and_missing_entry_are_reported(tmp_path):
    root = build(
        tmp_path,
        "![a](../assets/img/en/01_a.png)\n![b](../assets/img/en/02_b.png)\n"
        "![x](../assets/img/en/03_x.png)\n![g](../assets/img/en/04_gone.png)\n",
        ["en/01_a.png", "en/02_b.png", "en/03_x.png"],
    )
    problems, _, _ = c.check(root)
    assert "no pages.ts entry for en/03_x.png (used by docs/guide/a.md)" in problems
    assert (
        "missing file docs/assets/img/en/04_gone.png (used by docs/guide/a.md)"
        in problems
    )


def test_locale_without_a_filename_key_uses_the_entry_id(tmp_path):
    entries = c.doc_page_entries(
        build(tmp_path, "", []) / "scripts" / "screenshots" / "pages.ts"
    )
    assert entries["02_b"] == {"en": "02_b", "de": "02_b"}


def test_extension_pages_are_not_held_to_pages_ts(tmp_path):
    root = build(
        tmp_path,
        "![a](../assets/img/en/01_a.png)\n![b](../assets/img/en/02_b.png)\n",
        ["en/01_a.png", "en/02_b.png", "en/79_ext.png"],
    )
    (root / "docs" / "extensions").mkdir()
    (root / "docs" / "extensions" / "e.md").write_text(
        "![e](../assets/img/en/79_ext.png)\n", encoding="utf-8"
    )
    problems, _, _ = c.check(root)
    assert problems == []
