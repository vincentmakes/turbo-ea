"""Unit tests for migration 130 (drop ``transition_plans`` + retire its permission keys).

``seed.py`` is insert-only, so a role seeded while the removed planning module
existed keeps ``transition_plans.*`` inside its ``permissions`` JSONB forever.
``POST``/``PATCH /roles`` validates submitted permission dicts against
``ALL_APP_PERMISSION_KEYS`` and rejects unknown keys, so those dead keys would
turn any later role edit into a hard rejection. Migration 130 strips them.

These tests exercise the pure ``strip_keys`` helper — no DB — and assert it is
guarded, idempotent, and non-destructive.
"""

from __future__ import annotations

import importlib.util
from pathlib import Path

_MIG_PATH = (
    Path(__file__).resolve().parents[2] / "alembic" / "versions" / "130_drop_transition_plans.py"
)
_spec = importlib.util.spec_from_file_location("mig130", _MIG_PATH)
mig = importlib.util.module_from_spec(_spec)
assert _spec and _spec.loader
_spec.loader.exec_module(mig)


def test_strips_all_three_keys():
    perms = {
        "transition_plans.view": True,
        "transition_plans.manage": True,
        "transition_plans.commit": True,
        "inventory.view": True,
    }
    out = mig.strip_keys(perms)
    assert out == {"inventory.view": True}


def test_strips_a_partial_subset():
    """A viewer-shaped role only carried some of the keys as True — still stripped."""
    perms = {
        "transition_plans.view": True,
        "transition_plans.manage": False,
        "adr.view": True,
    }
    out = mig.strip_keys(perms)
    assert out == {"adr.view": True}


def test_preserves_unrelated_keys_and_their_values():
    perms = {
        "transition_plans.view": True,
        "inventory.view": True,
        "inventory.delete": False,
        "costs.view": True,
    }
    out = mig.strip_keys(perms)
    assert out == {"inventory.view": True, "inventory.delete": False, "costs.view": True}


def test_returns_none_when_no_dead_keys():
    assert mig.strip_keys({"inventory.view": True, "adr.sign": False}) is None


def test_returns_none_for_wildcard_admin():
    """The admin role is ``{"*": True}`` and must be left completely alone."""
    assert mig.strip_keys({"*": True}) is None


def test_returns_none_for_empty_dict():
    assert mig.strip_keys({}) is None


def test_returns_none_for_non_dict():
    assert mig.strip_keys(None) is None
    assert mig.strip_keys([]) is None
    assert mig.strip_keys("transition_plans.view") is None


def test_does_not_mutate_input():
    perms = {"transition_plans.view": True, "inventory.view": True}
    snapshot = dict(perms)
    mig.strip_keys(perms)
    assert perms == snapshot


def test_is_idempotent():
    perms = {"transition_plans.commit": True, "inventory.view": True}
    once = mig.strip_keys(perms)
    assert once is not None
    # A second pass finds nothing left to do.
    assert mig.strip_keys(once) is None


def test_prefix_match_does_not_catch_lookalike_keys():
    """Only the dotted namespace is dead — a key merely starting with the word stays."""
    perms = {"transition_plansible.view": True, "transition_plans.view": True}
    out = mig.strip_keys(perms)
    assert out == {"transition_plansible.view": True}
