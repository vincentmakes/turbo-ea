"""Unit tests for migration 147 (repair the lineage relation's reverse verb).

The lineage relation types shipped with ``label = "succeeds"`` and
``reverse_label = "is preceded by"`` — two phrases that both mean *comes after*,
so both directions of one relation read identically (#1091). Migration 147
rewrites the wording on existing installs, guarded per value so an admin's own
verb survives, and swaps the Russian pair, which was transposed.

These exercise the pure ``plan_fix`` helper — no DB.
"""

from __future__ import annotations

import importlib.util
from pathlib import Path

_MIG_PATH = (
    Path(__file__).resolve().parents[2]
    / "alembic"
    / "versions"
    / "147_fix_successor_reverse_labels.py"
)
_spec = importlib.util.spec_from_file_location("mig147", _MIG_PATH)
mig = importlib.util.module_from_spec(_spec)
assert _spec and _spec.loader
_spec.loader.exec_module(mig)


def _shipped_translations() -> dict:
    """The exact wording every lineage relation type carried before the fix."""
    return {
        "label": {
            "en": "succeeds",
            "de": "folgt auf",
            "fr": "succède à",
            "es": "sucede a",
            "it": "succede a",
            "pt": "sucede a",
            "zh": "继承",
            "ru": "предшествует",
            "da": "efterfølger",
            "ar": "يخلف",
        },
        "reverse_label": {
            "en": "is preceded by",
            "de": "wird abgelöst durch",
            "fr": "est précédé par",
            "es": "es precedido por",
            "it": "è preceduto da",
            "pt": "é precedido por",
            "zh": "被继承",
            "ru": "следует за",
            "da": "efterfølges af",
            "ar": "مسبوق بـ",
        },
    }


class TestPlanFix:
    def test_repairs_the_shipped_default_in_one_pass(self):
        new_reverse, patched = mig.plan_fix("is preceded by", _shipped_translations())
        assert new_reverse == "is succeeded by"
        assert patched["reverse_label"] == {
            "en": "is succeeded by",
            "de": "wird abgelöst durch",
            "fr": "a pour successeur",
            "es": "es sucedido por",
            "it": "ha come successore",
            "pt": "é sucedido por",
            "zh": "被继承",
            "ru": "предшествует",
            "da": "efterfølges af",
            "ar": "يُخلَف بواسطة",
        }

    def test_russian_pair_is_swapped_not_aliased(self):
        """`label.ru` and `reverse_label.ru` trade values in ONE pass.

        Both are compared against the pre-edit snapshot, so neither fix can see
        the other's output — the failure mode would be both ending up equal.
        """
        _, patched = mig.plan_fix("is preceded by", _shipped_translations())
        assert patched["label"]["ru"] == "следует за"
        assert patched["reverse_label"]["ru"] == "предшествует"
        assert patched["label"]["ru"] != patched["reverse_label"]["ru"]

    def test_leaves_already_correct_locales_alone(self):
        _, patched = mig.plan_fix("is preceded by", _shipped_translations())
        assert patched["label"]["de"] == "folgt auf"
        assert patched["reverse_label"]["de"] == "wird abgelöst durch"
        assert patched["reverse_label"]["zh"] == "被继承"
        assert patched["reverse_label"]["da"] == "efterfølges af"

    def test_forward_label_locales_other_than_ru_untouched(self):
        _, patched = mig.plan_fix("is preceded by", _shipped_translations())
        shipped = _shipped_translations()["label"]
        for locale in ("en", "de", "fr", "es", "it", "pt", "zh", "da", "ar"):
            assert patched["label"][locale] == shipped[locale]

    def test_idempotent(self):
        new_reverse, patched = mig.plan_fix("is preceded by", _shipped_translations())
        assert mig.plan_fix(new_reverse, patched) is None

    def test_already_correct_row_is_skipped(self):
        translations = {
            "label": {"en": "succeeds"},
            "reverse_label": {"en": "is succeeded by"},
        }
        assert mig.plan_fix("is succeeded by", translations) is None


class TestGuards:
    def test_custom_column_still_repairs_locales(self):
        new_reverse, patched = mig.plan_fix("is replaced by", _shipped_translations())
        assert new_reverse is None
        assert patched["reverse_label"]["fr"] == "a pour successeur"

    def test_custom_locale_survives_while_others_repair(self):
        translations = _shipped_translations()
        translations["reverse_label"]["fr"] = "cède la place à"
        _, patched = mig.plan_fix("is preceded by", translations)
        assert patched["reverse_label"]["fr"] == "cède la place à"
        assert patched["reverse_label"]["es"] == "es sucedido por"

    def test_default_locales_repair_when_column_alone_is_custom(self):
        """A row whose column was reworded keeps it; only the locales change."""
        new_reverse, patched = mig.plan_fix("comes after", _shipped_translations())
        assert new_reverse is None
        assert patched is not None

    def test_column_repairs_when_translations_are_all_custom(self):
        translations = {"label": {"en": "succeeds"}, "reverse_label": {"en": "handed over to"}}
        new_reverse, patched = mig.plan_fix("is preceded by", translations)
        assert new_reverse == "is succeeded by"
        assert patched is None


class TestMalformedPayloads:
    def test_none_translations(self):
        new_reverse, patched = mig.plan_fix("is preceded by", None)
        assert new_reverse == "is succeeded by"
        assert patched is None

    def test_string_translations(self):
        assert mig.plan_fix("is succeeded by", "not-a-map") is None

    def test_property_that_is_not_a_map(self):
        assert mig.plan_fix("is succeeded by", {"label": "not-a-map"}) is None
        new_reverse, patched = mig.plan_fix("is preceded by", {"label": "not-a-map"})
        assert new_reverse == "is succeeded by"
        assert patched is None
