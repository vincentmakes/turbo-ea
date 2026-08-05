"""Unit tests for migration 134 (realign relation-type English translations).

Migration 134 repairs installs where an admin renamed a relation type before the
fix for #912: the ``label`` column changed but ``translations -> 'label' -> 'en'``
kept the old verb, and that stale entry is what every label resolver renders.
These tests exercise the pure ``plan_repair`` helper — no DB — and assert it is
guarded (never invents an English entry), idempotent, and non-destructive to
other locales.
"""

from __future__ import annotations

import importlib.util
from pathlib import Path

_MIG_PATH = (
    Path(__file__).resolve().parents[2]
    / "alembic"
    / "versions"
    / "134_sync_relation_type_english_labels.py"
)
_spec = importlib.util.spec_from_file_location("mig134", _MIG_PATH)
mig = importlib.util.module_from_spec(_spec)
assert _spec and _spec.loader
_spec.loader.exec_module(mig)


def test_realigns_drifted_forward_label():
    out = mig.plan_repair("runs on", "is run by", {"label": {"en": "uses", "fr": "utilise"}})
    assert out == {"label": {"en": "runs on", "fr": "utilise"}}


def test_realigns_drifted_reverse_label():
    out = mig.plan_repair(
        "uses",
        "hosts",
        {"label": {"en": "uses"}, "reverse_label": {"en": "is used by", "de": "wird genutzt von"}},
    )
    assert out == {
        "label": {"en": "uses"},
        "reverse_label": {"en": "hosts", "de": "wird genutzt von"},
    }


def test_no_op_when_already_aligned():
    assert mig.plan_repair("uses", "is used by", {"label": {"en": "uses"}}) is None


def test_never_mints_an_english_entry():
    """A row without an English entry already resolves via the column fallback."""
    assert mig.plan_repair("runs on", None, {"label": {"fr": "utilise"}}) is None
    assert mig.plan_repair("runs on", None, {}) is None


def test_ignores_non_dict_payloads():
    assert mig.plan_repair("uses", None, None) is None
    assert mig.plan_repair("uses", None, "not-a-dict") is None
    assert mig.plan_repair("uses", None, {"label": "not-a-map"}) is None


def test_drops_english_entry_when_column_cleared():
    out = mig.plan_repair("uses", None, {"reverse_label": {"en": "is used by", "fr": "par"}})
    assert out == {"reverse_label": {"fr": "par"}}


def test_is_idempotent():
    first = mig.plan_repair("runs on", "is run by", {"label": {"en": "uses"}})
    assert first == {"label": {"en": "runs on"}}
    assert mig.plan_repair("runs on", "is run by", first) is None


def test_does_not_mutate_its_input():
    original = {"label": {"en": "uses", "fr": "utilise"}}
    mig.plan_repair("runs on", None, original)
    assert original == {"label": {"en": "uses", "fr": "utilise"}}
