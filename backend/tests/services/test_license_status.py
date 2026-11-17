"""License status maths (pure, no database)."""

from __future__ import annotations

from app.services.license_status import (
    MetricResult,
    card_status,
    metric_result,
    type_result,
)


def _m(status) -> MetricResult:
    return MetricResult("users", [], False, status, None, False, 0, None)


def test_over_when_actual_above_licensed():
    assert type_result("a", {"licensed": 10, "actual": 12}).status == "over"


def test_approaching_at_80_and_at_100():
    got = [type_result("a", {"licensed": 10, "actual": v}).status for v in (8, 10, 7)]
    assert got == ["approaching", "approaching", "compliant"]


def test_zero_licensed_zero_actual_is_compliant_zero_pct():
    r = type_result("a", {"licensed": 0, "actual": 0})
    assert (r.status, r.pct, r.no_licence) == ("compliant", 0.0, False)


def test_zero_licensed_positive_actual_is_over_no_licence():
    r = type_result("a", {"licensed": 0, "actual": 1})
    assert (r.status, r.pct, r.no_licence) == ("over", None, True)


def test_missing_licensed_counts_as_zero():
    assert type_result("a", {"actual": 3}).status == "over"


def test_missing_actual_is_no_data_not_zero():
    r = type_result("a", {"licensed": 20, "actual": None})
    assert (r.status, r.pct) == ("no_data", None)


def test_pct_has_one_decimal():
    assert type_result("a", {"licensed": 3, "actual": 1}).pct == 33.3


def test_no_compensation_between_types():
    m = metric_result(
        "users",
        {"a": {"licensed": 10, "actual": 12}, "b": {"licensed": 200, "actual": 150}},
        ["a", "b"],
    )
    assert m.status == "over" and m.licensed_total == 210 and m.actual_total == 162


def test_metric_without_any_actual_is_no_actual_data():
    m = metric_result("users", {"a": {"licensed": 5, "actual": None}}, ["a"])
    assert m.status == "no_actual_data" and not m.has_actual and m.actual_total is None


def test_no_data_type_never_changes_metric_status():
    m = metric_result(
        "users",
        {"a": {"licensed": 10, "actual": 5}, "b": {"licensed": 20, "actual": None}},
        ["a", "b"],
    )
    assert m.status == "compliant"


def test_priority_over_approaching_no_data_compliant():
    assert card_status([_m("compliant"), _m("no_actual_data"), _m("approaching")]) == "approaching"
    assert card_status([_m("approaching"), _m("over")]) == "over"
    assert card_status([_m("compliant"), _m("no_actual_data")]) == "no_actual_data"
    assert card_status([_m("compliant")]) == "compliant"


def test_card_with_no_metric_is_no_actual_data():
    assert card_status([]) == "no_actual_data"


def test_worst_pct_is_the_highest_type_pct_and_no_licence_wins():
    m = metric_result(
        "users",
        {"a": {"licensed": 10, "actual": 12}, "b": {"licensed": 10, "actual": 5}},
        ["a", "b"],
    )
    assert m.worst_pct == 120.0 and not m.worst_no_licence
    assert metric_result("users", {"a": {"licensed": 0, "actual": 2}}, ["a"]).worst_no_licence


def test_order_follows_catalogue_then_unknown_keys_sorted():
    m = metric_result("users", {"z": {}, "b": {}, "a": {}}, ["b", "a"])
    assert [t.key for t in m.types] == ["b", "a", "z"]


def test_catalogue_key_without_cell_is_left_out():
    assert metric_result("users", {"a": {}}, ["b", "a"]).types[0].key == "a"
