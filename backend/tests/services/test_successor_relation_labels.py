"""The lineage relation's verbs read in opposite directions, in every locale.

The direction convention is **source succeeds target**: in a row (A, X), A comes
AFTER X, which is why card detail lists X's *Successors* as the rows where X is
the target. Read from the target's side the verb must therefore mean "is
succeeded by".

It used to say "is preceded by", which means the same as "succeeds" — so both
directions of one relation read identically wherever a verb is rendered, and the
Survey Builder offered two rows nobody could tell apart (#1091). The wording was
hand-copied into seven seed entries plus the API's auto-provisioner, which is how
it stayed wrong in eight places at once; there is now ONE definition, and these
tests pin it.
"""

from __future__ import annotations

import pytest

from app.api.v1 import metamodel
from app.services import seed

SUCCESSOR_RELATIONS = [r for r in seed.RELATIONS if r["key"].endswith("Successor")]

# Wordings that read "comes after" on the reverse side — the shape of the bug.
RETIRED_REVERSE_WORDINGS = {
    "is preceded by",
    "est précédé par",
    "es precedido por",
    "è preceduto da",
    "é precedido por",
    "مسبوق بـ",
}


def _locales(rel: dict, prop: str) -> dict:
    """One property's translations without ``en`` — see `test_reverse_locales`."""
    return {k: v for k, v in rel["translations"][prop].items() if k != "en"}


def test_every_card_type_with_lineage_has_one_relation_type():
    keys = {r["key"] for r in SUCCESSOR_RELATIONS}
    assert keys == {
        "relAppSuccessor",
        "relITCSuccessor",
        "relInitiativeSuccessor",
        "relPlatformSuccessor",
        "relProcessSuccessor",
        "relInterfaceSuccessor",
        "relDataObjectSuccessor",
    }


@pytest.mark.parametrize("rel", SUCCESSOR_RELATIONS, ids=lambda r: r["key"])
class TestSeededVerbs:
    def test_verbs(self, rel):
        assert rel["label"] == "succeeds"
        assert rel["reverse_label"] == "is succeeded by"

    def test_self_referencing(self, rel):
        assert rel["source_type_key"] == rel["target_type_key"]

    def test_reverse_locales(self, rel):
        # `en` is excluded: `_inject_english_translations_relation` stamps it
        # into these very dicts IN PLACE at seed time, so whether it is present
        # depends on whether something has seeded in this process. The English
        # verb is pinned on the raw column above and on the constant below.
        assert _locales(rel, "reverse_label") == {
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

    def test_forward_locales(self, rel):
        assert _locales(rel, "label") == {
            "de": "folgt auf",
            "fr": "succède à",
            "es": "sucede a",
            "it": "succede a",
            "pt": "sucede a",
            "zh": "继承",
            "ru": "следует за",
            "da": "efterfølger",
            "ar": "يخلف",
        }

    def test_no_direction_reads_the_same_both_ways(self, rel):
        """The regression itself: forward and reverse must differ per locale.

        Russian had the two transposed, so this catches a swap as well as a copy.
        """
        forward = _locales(rel, "label")
        reverse = _locales(rel, "reverse_label")
        for locale, verb in forward.items():
            assert reverse[locale] != verb, locale
        assert rel["reverse_label"] not in RETIRED_REVERSE_WORDINGS
        assert not set(reverse.values()) & RETIRED_REVERSE_WORDINGS


def test_entries_do_not_share_a_translations_object():
    """`_inject_english_translations_relation` mutates in place — a shared dict
    would be stamped seven times onto seven rows and corrupt the constant."""
    seen = [rel["translations"] for rel in SUCCESSOR_RELATIONS]
    for i, a in enumerate(seen):
        for b in seen[i + 1 :]:
            assert a is not b
    assert all(a is not seed.SUCCESSOR_TRANSLATIONS for a in seen)


class TestAutoProvisionMatchesSeed:
    """The relation type created by "Supports Lineage" must be byte-identical."""

    def test_verbs(self):
        assert metamodel._SUCCESSOR_LABEL == seed.SUCCESSOR_LABEL == "succeeds"
        assert metamodel._SUCCESSOR_REVERSE_LABEL == seed.SUCCESSOR_REVERSE_LABEL
        assert metamodel._SUCCESSOR_REVERSE_LABEL == "is succeeded by"

    def test_translations_match_the_seed_plus_english(self):
        for prop, value in (
            ("label", seed.SUCCESSOR_LABEL),
            ("reverse_label", seed.SUCCESSOR_REVERSE_LABEL),
        ):
            assert metamodel._SUCCESSOR_TRANSLATIONS[prop] == {
                **seed.SUCCESSOR_TRANSLATIONS[prop],
                "en": value,
            }

    def test_seed_constant_was_not_mutated_by_the_injection(self):
        """The factory deep-copies, so stamping English never reaches here.

        `_inject_english_translations_relation` writes into whatever dict it is
        handed; a shared constant would collect an `en` entry the first time
        anything seeded, and `_SUCCESSOR_TRANSLATIONS` above would then be built
        from an already-stamped map.
        """
        assert "en" not in seed.SUCCESSOR_TRANSLATIONS["label"]
        assert "en" not in seed.SUCCESSOR_TRANSLATIONS["reverse_label"]
