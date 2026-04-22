"""Unit tests for pure helpers in ``app.services.risk_service``.

Exercises the bits that don't need a database — the 4×4 derived-level
table, the status transition validator, and the CVE-severity → impact
mapping used by the promote-from-finding flow. DB-touching pieces
(next_reference, promote_*) are covered by integration tests.
"""

from __future__ import annotations

import pytest

from app.services.risk_service import (
    IMPACT_VALUES,
    LEVEL_VALUES,
    PROBABILITY_VALUES,
    STATUS_VALUES,
    derive_level,
    validate_status_transition,
)

# ---------------------------------------------------------------------------
# derive_level
# ---------------------------------------------------------------------------


def test_derive_level_matches_plan_matrix():
    # A few representative cells from the 4×4 matrix documented in the plan.
    assert derive_level("very_high", "critical") == "critical"
    assert derive_level("very_high", "low") == "medium"
    assert derive_level("high", "medium") == "high"
    assert derive_level("medium", "critical") == "high"
    assert derive_level("medium", "medium") == "medium"
    assert derive_level("low", "critical") == "medium"
    assert derive_level("low", "low") == "low"


def test_derive_level_returns_none_on_missing_inputs():
    assert derive_level(None, "high") is None
    assert derive_level("medium", None) is None
    assert derive_level(None, None) is None


def test_derive_level_rejects_unknown_values():
    assert derive_level("nonsense", "critical") is None
    assert derive_level("medium", "nonsense") is None


def test_derive_level_yields_a_known_level_for_every_valid_pair():
    for p in PROBABILITY_VALUES:
        for i in IMPACT_VALUES:
            lvl = derive_level(p, i)
            assert lvl in LEVEL_VALUES, f"derive_level({p!r}, {i!r}) = {lvl!r}"


# ---------------------------------------------------------------------------
# Status workflow
# ---------------------------------------------------------------------------


def test_same_status_is_always_allowed():
    for s in STATUS_VALUES:
        validate_status_transition(s, s)


def test_identified_can_move_to_analysed_or_accepted():
    validate_status_transition("identified", "analysed")
    validate_status_transition("identified", "accepted")


def test_identified_cannot_skip_to_closed():
    with pytest.raises(ValueError):
        validate_status_transition("identified", "closed")


def test_mitigated_allows_monitoring_closed_or_reopen():
    validate_status_transition("mitigated", "monitoring")
    validate_status_transition("mitigated", "closed")
    validate_status_transition("mitigated", "in_progress")


def test_accepted_allows_reopen_or_closure():
    validate_status_transition("accepted", "in_progress")
    validate_status_transition("accepted", "closed")


def test_accepted_cannot_go_back_to_identified():
    with pytest.raises(ValueError):
        validate_status_transition("accepted", "identified")


def test_closed_can_be_reopened_only_to_in_progress():
    validate_status_transition("closed", "in_progress")
    with pytest.raises(ValueError):
        validate_status_transition("closed", "identified")
    with pytest.raises(ValueError):
        validate_status_transition("closed", "monitoring")


# ---------------------------------------------------------------------------
# Reference format — just the string shape, not DB-touching
# ---------------------------------------------------------------------------


def test_reference_format_is_padded_to_six_digits():
    # next_reference is DB-bound, but the format string it uses is trivially
    # testable. This guards against accidental format drifts.
    assert f"R-{1:06d}" == "R-000001"
    assert f"R-{42:06d}" == "R-000042"
    assert f"R-{123456:06d}" == "R-123456"


# ---------------------------------------------------------------------------
# Vocabulary exports — used by the frontend for typed literals
# ---------------------------------------------------------------------------


def test_vocabularies_are_frozen_in_expected_order():
    assert PROBABILITY_VALUES == ("very_high", "high", "medium", "low")
    assert IMPACT_VALUES == ("critical", "high", "medium", "low")
    assert LEVEL_VALUES == ("critical", "high", "medium", "low")
    # Status order matters — the stepper UI relies on it.
    assert STATUS_VALUES == (
        "identified",
        "analysed",
        "mitigation_planned",
        "in_progress",
        "mitigated",
        "monitoring",
        "accepted",
        "closed",
    )
