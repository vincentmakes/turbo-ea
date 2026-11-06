"""Unit tests for ``app.services.cost_attribution`` (discussion #1362).

Exact numbers throughout: each branch of the arithmetic has an assertion that
fails when that branch is mutated.
"""

from __future__ import annotations

import pytest

from app.services.cost_attribution import (
    ATTRIBUTIONS,
    attribute_related_costs,
    distinct_total,
    group_costs,
    link_counts,
    parse_attribution,
    primary_group,
    split_share,
)

# Init (50 000) improves capabilities A and B; Init2 (10 000) improves C only.
PER_PRIMARY = {"A": {"init"}, "B": {"init"}, "C": {"init2"}}
COSTS = {"init": 50_000.0, "init2": 10_000.0}


def test_attributions_are_full_and_split():
    assert ATTRIBUTIONS == frozenset({"full", "split"})


def test_parse_accepts_full_and_split():
    assert parse_attribution("full") == "full"
    assert parse_attribution("split") == "split"


@pytest.mark.parametrize("value", ["Full", "", "both", "SPLIT"])
def test_parse_rejects_anything_else(value):
    with pytest.raises(ValueError) as exc:
        parse_attribution(value)
    assert str(exc.value) == f"Invalid attribution: {value!r}"


def test_split_share_divides_by_the_count():
    assert split_share(90.0, 3) == 30.0
    assert split_share(90.0, 1) == 90.0


def test_split_count_zero_falls_back_to_full():
    assert split_share(90.0, 0) == 90.0
    assert split_share(90.0, -2) == 90.0


def test_link_counts_counts_primaries_per_related_card():
    counts = link_counts({"A": {"x", "y"}, "B": ["x", "x"], "C": set()})
    assert counts == {"x": 2, "y": 1}


def test_full_sums_each_source_in_full_on_every_primary():
    counts = link_counts(PER_PRIMARY)
    got = attribute_related_costs({"A": {"init", "init2"}, "B": {"init"}}, COSTS, counts, "full")
    assert got == {"A": 60_000.0, "B": 50_000.0}


def test_split_divides_by_the_number_of_linking_primaries():
    got = attribute_related_costs(PER_PRIMARY, COSTS, link_counts(PER_PRIMARY), "split")
    assert got == {"A": 25_000.0, "B": 25_000.0, "C": 10_000.0}


def test_split_dedups_a_source_listed_twice_for_one_primary():
    got = attribute_related_costs({"A": ["init", "init"]}, COSTS, {"init": 2}, "split")
    assert got == {"A": 25_000.0}


def test_split_without_a_count_keeps_the_full_cost():
    got = attribute_related_costs({"A": {"init"}}, COSTS, {}, "split")
    assert got == {"A": 50_000.0}


def test_unknown_source_cost_counts_as_zero():
    got = attribute_related_costs({"A": {"ghost"}}, COSTS, {"ghost": 1}, "full")
    assert got == {"A": 0.0}


def test_distinct_total_counts_a_shared_source_once():
    assert distinct_total(PER_PRIMARY, COSTS) == 60_000.0
    assert distinct_total({"A": {"init", "ghost"}}, COSTS) == 50_000.0
    assert distinct_total({}, COSTS) == 0


def test_primary_group_is_alphabetical_first():
    assert primary_group(["Sales", "Marketing", "Ops"]) == "Marketing"
    assert primary_group({"Zeta"}) == "Zeta"


def test_primary_group_without_groups_is_ungrouped():
    assert primary_group([]) == "Ungrouped"


def test_group_costs_full_counts_a_card_in_every_group():
    items = [
        {"cost": 100.0, "groups": ["Marketing", "Sales"]},
        {"cost": 30.0, "groups": ["Sales"]},
    ]
    assert group_costs(items, "full") == {"Marketing": 100.0, "Sales": 130.0}


def test_group_costs_split_shares_evenly():
    items = [
        {"cost": 100.0, "groups": ["Marketing", "Sales"]},
        {"cost": 30.0, "groups": ["Sales"]},
    ]
    assert group_costs(items, "split") == {"Marketing": 50.0, "Sales": 80.0}


def test_group_costs_ungrouped_keeps_full_cost():
    items = [{"cost": 40.0, "groups": []}, {"cost": 2.0}]
    assert group_costs(items, "split") == {"Ungrouped": 42.0}
    assert group_costs(items, "full") == {"Ungrouped": 42.0}
