"""``validate_role_order``: a stakeholder-role reorder lists every role once (#1439)."""

from __future__ import annotations

import pytest

from app.services.stakeholder_service import validate_role_order

CURRENT = ["responsible", "observer", "steward"]


def test_a_permutation_comes_back_in_the_requested_order():
    assert validate_role_order(CURRENT, ["steward", "responsible", "observer"]) == [
        "steward",
        "responsible",
        "observer",
    ]
    assert validate_role_order(CURRENT, list(CURRENT)) == CURRENT
    assert validate_role_order([], []) == []


@pytest.mark.parametrize(
    "requested, message",
    [
        (["responsible", "observer", "steward", "observer"], "more than once"),
        (["responsible", "observer"], "every stakeholder role"),
        (["responsible", "observer", "steward", "ghost"], "every stakeholder role"),
        (["responsible", "observer", "ghost"], "every stakeholder role"),
    ],
)
def test_a_dropped_doubled_or_unknown_key_is_refused(requested, message):
    with pytest.raises(ValueError, match=message):
        validate_role_order(CURRENT, requested)
