"""Unit tests for migration 158 (repair four Arabic relation verbs).

Four built-in relation types shipped the Arabic text of their attribute as
their verb. Migration 158 rewrites those on existing installs, guarded per value
so an admin's own wording survives, and touches nothing but ``label.ar``.

These exercise the pure ``plan_relation_fix`` helper — no DB.
"""

from __future__ import annotations

import importlib.util
from pathlib import Path

import pytest

from app.services import seed

_MIG_PATH = (
    Path(__file__).resolve().parents[2]
    / "alembic"
    / "versions"
    / "158_fix_arabic_relation_verbs.py"
)
_spec = importlib.util.spec_from_file_location("mig158", _MIG_PATH)
mig = importlib.util.module_from_spec(_spec)
assert _spec and _spec.loader
_spec.loader.exec_module(mig)

_SEED_RELATIONS = {r["key"]: r for r in seed.RELATIONS}


def _stored(ar_label: str) -> dict:
    return {
        "label": {"en": "uses", "de": "nutzt", "ar": ar_label},
        "reverse_label": {"en": "is used by", "ar": "يُستخدَم بواسطة"},
    }


@pytest.mark.parametrize("key", sorted(mig.RELATION_LABEL_FIXES))
def test_rewrites_the_shipped_value_to_the_seed_verb(key):
    old, new = mig.RELATION_LABEL_FIXES[key]
    stored = _stored(old)

    fixed = mig.plan_relation_fix(key, stored)

    assert fixed is not None
    assert fixed["label"]["ar"] == new
    # The migration and the seed agree, so a fresh install and a repaired one match.
    assert _SEED_RELATIONS[key]["translations"]["label"]["ar"] == new
    # Nothing else moves, and the stored row is not mutated in place.
    assert fixed["label"]["de"] == "nutzt"
    assert fixed["label"]["en"] == "uses"
    assert fixed["reverse_label"] == stored["reverse_label"]
    assert stored["label"]["ar"] == old


def test_keeps_an_admins_own_wording():
    assert mig.plan_relation_fix("relOrgToApp", _stored("كلمة المسؤول")) is None


def test_is_idempotent():
    old, new = mig.RELATION_LABEL_FIXES["relProcessToApp"]
    once = mig.plan_relation_fix("relProcessToApp", _stored(old))
    assert mig.plan_relation_fix("relProcessToApp", once) is None
    assert once["label"]["ar"] == new


def test_ignores_other_relations_and_malformed_rows():
    # relAppToBizCtx's verb is the same word, but it was never wrong.
    assert mig.plan_relation_fix("relAppToBizCtx", _stored("نوع الدعم")) is None
    assert mig.plan_relation_fix("relOrgToApp", None) is None
    assert mig.plan_relation_fix("relOrgToApp", {"label": "نوع الاستخدام"}) is None
    assert mig.plan_relation_fix("relOrgToApp", {}) is None


def test_the_wrong_values_are_gone_from_the_seed():
    for key, (old, _new) in mig.RELATION_LABEL_FIXES.items():
        assert _SEED_RELATIONS[key]["translations"]["label"]["ar"] != old
