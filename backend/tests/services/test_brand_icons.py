"""Unit tests for the bundled brand-icon pack. No database needed."""

from __future__ import annotations

import json

import pytest

from app.services.brand_icons import (
    _INDEX_PATH,
    _PACK_PATH,
    _read_icon_bytes,
    icon_count,
    normalise_slug,
    parse_ref,
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
            ("logos:sap", "sap"),
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
    def test_both_packs_are_present_and_substantial(self):
        index = json.loads(_INDEX_PATH.read_text(encoding="utf-8"))
        packs = {e["pack"] for e in index}
        assert packs == {"logos", "simpleicons"}
        assert icon_count() > 5000

    def test_every_index_entry_points_at_a_real_png_inside_the_pack(self):
        """Catches a half-run generator or a stale index.

        The offsets are the only thing standing between a slug and the wrong
        icon's bytes, so an off-by-one here would surface as a corrupted image
        on a card rather than as an error anywhere.
        """
        index = json.loads(_INDEX_PATH.read_text(encoding="utf-8"))
        pack_size = _PACK_PATH.stat().st_size
        assert index

        for entry in index:
            offset, length = entry["offset"], entry["length"]
            assert length > 0
            assert offset + length <= pack_size, f"{entry['slug']} runs past the pack"
            data = _read_icon_bytes(entry["slug"], entry["pack"])
            assert data is not None and len(data) == length
            assert data.startswith(b"\x89PNG\r\n\x1a\n"), entry["slug"]

    def test_the_entries_tile_the_pack_without_gaps_or_overlap(self):
        """Every byte of the blob belongs to exactly one icon.

        A gap means bytes nothing can reach; an overlap means two slugs share
        a region and at least one of them is wrong.
        """
        index = sorted(
            json.loads(_INDEX_PATH.read_text(encoding="utf-8")),
            key=lambda e: e["offset"],
        )
        cursor = 0
        for entry in index:
            assert entry["offset"] == cursor, f"gap or overlap at {entry['slug']}"
            cursor += entry["length"]
        assert cursor == _PACK_PATH.stat().st_size

    def test_every_entry_carries_a_title(self):
        index = json.loads(_INDEX_PATH.read_text(encoding="utf-8"))
        assert all(e.get("title") for e in index)

    def test_only_the_monochrome_pack_carries_a_brand_hex(self):
        """The colour set has no single brand colour — it has the real logo.

        Pinned because the search payload omits `hex` for those entries, and a
        caller that assumed it was always present would break on 2110 of them.
        """
        index = json.loads(_INDEX_PATH.read_text(encoding="utf-8"))
        mono = [e for e in index if e["pack"] == "simpleicons"]
        colour = [e for e in index if e["pack"] == "logos"]
        assert mono and colour
        assert all(e.get("hex") for e in mono)
        assert not any(e.get("hex") for e in colour)


class TestNoPathIsBuiltFromCallerInput:
    """The slug is a key into an index; it never becomes a path.

    CodeQL flagged an earlier `_ICON_DIR / f"{slug}.png"` as high-severity path
    injection. It was not exploitable — the callers validated first — but the
    safety lived entirely in whoever remembered to call the validator. With a
    single packed blob the only file this module opens is a constant.
    """

    @pytest.mark.parametrize(
        "slug",
        [
            "../../../etc/passwd",
            "..",
            "../brand_icons",
            "sap/../../../etc/passwd",
            "",
        ],
    )
    def test_a_traversal_slug_reads_nothing_even_without_the_validator(self, slug):
        """Called directly, bypassing `normalise_slug` entirely.

        A future caller that forgets the validator still cannot reach anything
        outside the pack, because there is nothing to reach.
        """
        assert _read_icon_bytes(slug) is None

    def test_a_slug_absent_from_the_index_resolves_to_none(self):
        assert _read_icon_bytes("definitely-not-a-real-brand") is None


class TestSearchPayload:
    def test_results_do_not_leak_the_storage_layout(self):
        # Offsets are an implementation detail; a client depending on them
        # would freeze the pack format. `hex` is optional — the colour pack
        # has no single brand colour.
        for entry in search_brand_icons("sap", 5):
            assert set(entry) <= {"ref", "slug", "title", "pack", "hex"}
            assert {"ref", "slug", "title", "pack"} <= set(entry)
            assert "offset" not in entry and "length" not in entry


class TestTwoPacks:
    """Addressing, and which pack a bare slug lands in."""

    def test_a_bare_slug_prefers_the_colour_pack(self):
        # A reader recognises Google's four colours far faster than a grey
        # silhouette of them, so the real mark wins where both packs have one.
        resolved = resolve_brand_icon("sap")
        assert resolved is not None
        assert resolved[2]["pack"] == "logos"

    def test_either_pack_can_be_addressed_exactly(self):
        colour = resolve_brand_icon("logos:sap")
        mono = resolve_brand_icon("simpleicons:sap")
        assert colour is not None and mono is not None
        assert colour[2]["pack"] == "logos"
        assert mono[2]["pack"] == "simpleicons"
        # Different artwork, not the same bytes served twice.
        assert colour[0] != mono[0]

    def test_a_slug_only_the_monochrome_pack_has_still_resolves(self):
        # The colour set is the smaller of the two; the fallback is the whole
        # reason the monochrome pack is still shipped.
        resolved = resolve_brand_icon("apachekafka")
        assert resolved is not None
        assert resolved[2]["pack"] == "simpleicons"

    def test_an_unknown_pack_name_is_rejected_rather_than_read_as_a_slug(self):
        # Otherwise "bogus:sap" would quietly resolve to something, and a typo
        # in the pack name would be invisible.
        assert parse_ref("bogus:sap") is None
        assert resolve_brand_icon("bogus:sap") is None

    def test_search_returns_each_slug_once_with_an_exact_ref(self):
        results = search_brand_icons("sap", 20)
        refs = [e["ref"] for e in results]
        assert len(set(refs)) == len(refs)
        # One row per slug: SAP twice, once in colour and once as a
        # silhouette, would look broken and give an agent two
        # indistinguishable choices.
        slugs = [e["slug"] for e in results]
        assert len(set(slugs)) == len(slugs)
        # Every ref pins its pack, so a pick cannot drift if the preference
        # order ever changes.
        for ref in refs:
            assert ref.split(":")[0] in {"logos", "simpleicons"}
            assert resolve_brand_icon(ref) is not None
