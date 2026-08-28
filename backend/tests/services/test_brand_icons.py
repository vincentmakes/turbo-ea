"""Unit tests for the bundled brand-icon pack. No database needed."""

from __future__ import annotations

import json

import pytest

from app.services.brand_icons import (
    _ICON_DIR,
    _INDEX_PATH,
    icon_count,
    normalise_slug,
    resolve_brand_icon,
    search_brand_icons,
)


class TestNormaliseSlug:
    @pytest.mark.parametrize(
        "raw,expected",
        [
            ("sap", "sap"),
            ("SAP", "sap"),
            ("  sap  ", "sap"),
            ("simpleicons:sap", "sap"),
            ("SimpleIcons:SAP", "sap"),
            ("apache-kafka", "apache-kafka"),
            ("dot.name", "dot.name"),
        ],
    )
    def test_accepts_and_canonicalises(self, raw, expected):
        assert normalise_slug(raw) == expected

    @pytest.mark.parametrize(
        "raw",
        [
            None,
            "",
            "   ",
            "../../../etc/passwd",
            "sap/../secret",
            "sap/logo",
            "sap\\logo",
            "sap;rm -rf",
            "a" * 65,
        ],
    )
    def test_rejects_anything_that_is_not_a_bare_slug(self, raw):
        """The slug becomes a filename, so the allowlist is the outer guard."""
        assert normalise_slug(raw) is None


class TestResolve:
    def test_resolves_a_known_icon(self):
        resolved = resolve_brand_icon("apachekafka")
        assert resolved is not None
        data, mime, entry = resolved
        assert mime == "image/png"
        assert data.startswith(b"\x89PNG\r\n\x1a\n")
        assert entry["title"] == "Apache Kafka"

    def test_unknown_and_malformed_slugs_return_none_rather_than_raising(self):
        assert resolve_brand_icon("not-a-real-brand") is None
        assert resolve_brand_icon("../../../etc/passwd") is None
        assert resolve_brand_icon(None) is None


class TestSearch:
    def test_ranks_exact_before_prefix_before_contains(self):
        slugs = [e["slug"] for e in search_brand_icons("sap", 10)]
        assert slugs[0] == "sap"
        # "whatsapp" merely contains the term, so it cannot outrank a prefix.
        if "gsap" in slugs and "whatsapp" in slugs:
            assert slugs.index("gsap") < slugs.index("whatsapp")

    def test_matches_on_title_too(self):
        slugs = [e["slug"] for e in search_brand_icons("kafka", 5)]
        assert "apachekafka" in slugs

    def test_empty_search_returns_a_bounded_page(self):
        assert len(search_brand_icons("", 5)) == 5

    def test_limit_is_honoured(self):
        assert len(search_brand_icons("a", 3)) <= 3


class TestPackIntegrity:
    def test_the_pack_is_present_and_substantial(self):
        assert icon_count() > 3000

    def test_every_index_entry_has_a_file_and_every_file_is_indexed(self):
        """Catches a half-run or interrupted generator, which would otherwise
        surface as a 400 on one arbitrary slug."""
        index = json.loads(_INDEX_PATH.read_text(encoding="utf-8"))
        indexed = {e["slug"] for e in index}
        on_disk = {p.stem for p in _ICON_DIR.glob("*.png")}

        assert indexed - on_disk == set(), "index entries with no PNG on disk"
        assert on_disk - indexed == set(), "PNGs on disk missing from the index"

    def test_every_entry_carries_a_title_and_a_hex(self):
        index = json.loads(_INDEX_PATH.read_text(encoding="utf-8"))
        assert all(e.get("title") and e.get("hex") for e in index)
