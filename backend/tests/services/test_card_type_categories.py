"""Unit tests for ``services/card_type_categories``.

The pure helpers (key normalisation, duplicate detection, adoption planning,
order validation) need no database; ``ensure_categories`` /
``seed_default_categories`` / ``types_using`` run against the test DB.
"""

from __future__ import annotations

from types import SimpleNamespace

import pytest
from sqlalchemy import select

from app.models.card_type_category import CardTypeCategory
from app.services import card_type_categories as ctc
from app.services.seed import CARD_TYPE_CATEGORIES, DEFAULT_CATEGORY_KEYS
from tests.conftest import create_card_type


class TestNormalizeKey:
    def test_trims(self):
        assert ctc.normalize_key("  Security  ") == "Security"

    def test_keeps_inner_text_and_case(self):
        assert ctc.normalize_key("Data & AI") == "Data & AI"

    def test_exactly_the_column_length_is_accepted(self):
        assert ctc.normalize_key("x" * 100) == "x" * 100

    @pytest.mark.parametrize(
        "value", ["", "   ", "x" * 101, None, 5, "__uncategorized__", " __UNCATEGORIZED__ "]
    )
    def test_refuses(self, value):
        with pytest.raises(ctc.CategoryError) as exc:
            ctc.normalize_key(value)
        assert exc.value.code == "invalid_category"


class TestNormalizeCategoryValue:
    def test_none_stays_none(self):
        assert ctc.normalize_category_value(None) is None

    def test_blank_is_uncategorised(self):
        assert ctc.normalize_category_value("   ") is None
        assert ctc.normalize_category_value("") is None

    def test_trims(self):
        assert ctc.normalize_category_value(" Business Architecture ") == "Business Architecture"

    def test_non_string_is_refused(self):
        with pytest.raises(ctc.CategoryError) as exc:
            ctc.normalize_category_value(["x"])
        assert exc.value.code == "invalid_category"


def _row(key: str, label: str | None = None) -> SimpleNamespace:
    return SimpleNamespace(key=key, label=label if label is not None else key)


class TestIsDuplicate:
    def test_case_insensitive_key_match_returns_the_row(self):
        row = _row("Application & Data")
        assert ctc.is_duplicate([row], "APPLICATION & data") is row

    def test_new_name_is_none(self):
        assert ctc.is_duplicate([_row("Application & Data")], "Security") is None

    def test_empty_registry(self):
        assert ctc.is_duplicate([], "Security") is None

    def test_matches_a_renamed_rows_label(self):
        # Custom 'Foo' renamed to label 'Bar': a new 'bar' reads as the same
        # layer, though no row has that key.
        renamed = _row("Foo", "Bar")
        assert ctc.is_duplicate([_row("Security"), renamed], "bar") is renamed

    def test_still_matches_a_renamed_rows_key(self):
        renamed = _row("Foo", "Bar")
        assert ctc.is_duplicate([renamed], "FOO") is renamed

    def test_exclude_key_skips_the_row_being_renamed(self):
        renamed = _row("Foo", "Bar")
        assert ctc.is_duplicate([renamed], "foo", exclude_key="Foo") is None
        assert ctc.is_duplicate([renamed], "BAR", exclude_key="Foo") is None

    def test_exclude_key_keeps_every_other_row(self):
        other = _row("Baz", "Bar")
        assert ctc.is_duplicate([_row("Foo"), other], "bar", exclude_key="Foo") is other


class TestPlanAdoption:
    def test_adopts_unknown_values_in_first_seen_order(self):
        assert ctc.plan_adoption(["Zeta", "Alpha", "Zeta"], []) == ["Zeta", "Alpha"]

    def test_skips_known_blank_and_non_strings(self):
        values = ["Business Architecture", None, "", "  ", 7, " Security "]
        assert ctc.plan_adoption(values, ["Business Architecture"]) == ["Security"]

    def test_exact_after_trimming(self):
        # A case variant is a different stored value: it must resolve exactly.
        assert ctc.plan_adoption(["business architecture"], ["Business Architecture"]) == [
            "business architecture"
        ]

    def test_overlong_values_are_skipped(self):
        assert ctc.plan_adoption(["x" * 101], []) == []


class TestValidateOrder:
    def test_returns_the_requested_permutation(self):
        assert ctc.validate_order(["a", "b", "c"], ["c", "a", "b"]) == ["c", "a", "b"]

    @pytest.mark.parametrize(
        "requested",
        [["a", "b"], ["a", "b", "b"], ["a", "b", "d"], ["a", "b", "c", "d"], ["a", "b", 3]],
    )
    def test_refuses_a_non_permutation(self, requested):
        with pytest.raises(ctc.CategoryError) as exc:
            ctc.validate_order(["a", "b", "c"], requested)
        assert exc.value.code == "invalid_order"


class TestSeedConstant:
    def test_four_defaults_in_layer_order(self):
        assert [c["key"] for c in CARD_TYPE_CATEGORIES] == [
            "Strategy & Transformation",
            "Business Architecture",
            "Application & Data",
            "Technical Architecture",
        ]
        assert [c["sort_order"] for c in CARD_TYPE_CATEGORIES] == [0, 1, 2, 3]
        assert DEFAULT_CATEGORY_KEYS == {c["key"] for c in CARD_TYPE_CATEGORIES}

    def test_label_is_the_key(self):
        assert all(c["label"] == c["key"] for c in CARD_TYPE_CATEGORIES)


async def _rows(db) -> dict[str, CardTypeCategory]:
    result = await db.execute(select(CardTypeCategory))
    return {c.key: c for c in result.scalars().all()}


class TestSeedDefaults:
    async def test_inserts_the_four_locked_layers(self, db):
        inserted = await ctc.seed_default_categories(db)
        assert inserted == [c["key"] for c in CARD_TYPE_CATEGORIES]
        rows = await _rows(db)
        app_data = rows["Application & Data"]
        assert app_data.built_in is True
        assert app_data.color == "#0f7eb5"
        assert app_data.sort_order == 2
        assert app_data.translations["de"] == "Anwendung & Daten"

    async def test_insert_only(self, db):
        await ctc.seed_default_categories(db)
        rows = await _rows(db)
        rows["Business Architecture"].sort_order = 9
        await db.flush()
        assert await ctc.seed_default_categories(db) == []
        assert (await _rows(db))["Business Architecture"].sort_order == 9


class TestEnsureCategories:
    async def test_adopts_after_everything_with_the_default_colour(self, db):
        await ctc.seed_default_categories(db)
        created = await ctc.ensure_categories(db, ["Security", "Business Architecture", None])
        assert created == ["Security"]
        row = (await _rows(db))["Security"]
        assert (row.label, row.color, row.built_in) == ("Security", "#999999", False)
        assert row.sort_order == ctc.ADOPTED_SORT_ORDER_START
        assert row.translations == {}

    async def test_is_idempotent(self, db):
        assert await ctc.ensure_categories(db, ["Security", "Data"]) == ["Security", "Data"]
        assert await ctc.ensure_categories(db, ["Security", "Data"]) == []
        rows = await _rows(db)
        assert rows["Data"].sort_order == rows["Security"].sort_order + 1

    async def test_numbers_after_a_high_sort_order(self, db):
        db.add(CardTypeCategory(key="Hand placed", label="Hand placed", sort_order=250))
        await db.flush()
        await ctc.ensure_categories(db, ["Late"])
        assert (await _rows(db))["Late"].sort_order == 251

    async def test_nothing_to_adopt(self, db):
        assert await ctc.ensure_categories(db, [None, "", "  "]) == []
        assert await _rows(db) == {}


class TestUsage:
    async def test_types_using_is_alphabetical(self, db):
        await create_card_type(db, key="Z", label="Zulu", category="Security")
        await create_card_type(db, key="Y", label="Alpha", category="Security")
        await create_card_type(db, key="X", label="Other", category="Data")
        assert await ctc.types_using(db, "Security") == ["Alpha", "Zulu"]
        assert await ctc.types_using(db, "Nothing") == []


class TestNextSortOrder:
    async def test_empty_registry_starts_at_zero(self, db):
        assert await ctc.next_sort_order(db) == 0

    async def test_floor(self, db):
        assert await ctc.next_sort_order(db, 100) == 100
        await ctc.seed_default_categories(db)
        assert await ctc.next_sort_order(db) == 4
        assert await ctc.next_sort_order(db, 2) == 4


class TestSerialize:
    async def test_shape(self, db):
        await ctc.seed_default_categories(db)
        row = (await _rows(db))["Technical Architecture"]
        out = ctc.serialize(row)
        assert set(out) == {"id", "key", "label", "color", "sort_order", "built_in", "translations"}
        assert out["key"] == "Technical Architecture"
        assert out["built_in"] is True
