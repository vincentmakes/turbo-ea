"""Unit tests for the migration apply pipeline — pure helpers only.

Database-backed integration tests (savepoint rollback, idempotency,
end-to-end import round-trip) require the project conftest and a live
test Postgres; they live in the api/ test suite.
"""

from __future__ import annotations

from dataclasses import dataclass

from app.services.migration.apply import _remap_attributes, _topo_sort


@dataclass
class _FakeStaged:
    source_id: str
    parent_source_id: str | None = None


def test_topo_sort_orders_parents_before_children() -> None:
    a = _FakeStaged("a")  # root
    b = _FakeStaged("b", parent_source_id="a")
    c = _FakeStaged("c", parent_source_id="b")
    out = _topo_sort([c, b, a])  # type: ignore[list-item]
    order = [r.source_id for r in out]
    assert order.index("a") < order.index("b") < order.index("c")


def test_topo_sort_unknown_parent_schedules_immediately() -> None:
    # Parent is not in the staged set — should not block the child.
    orphan = _FakeStaged("only", parent_source_id="external-parent")
    out = _topo_sort([orphan])  # type: ignore[list-item]
    assert [r.source_id for r in out] == ["only"]


def test_topo_sort_cycle_keeps_all_rows() -> None:
    # a ↔ b cycle; both depend on each other. The function must not
    # drop rows on cycle — it appends them in arrival order and logs.
    a = _FakeStaged("a", parent_source_id="b")
    b = _FakeStaged("b", parent_source_id="a")
    out = _topo_sort([a, b])  # type: ignore[list-item]
    assert {r.source_id for r in out} == {"a", "b"}


def test_topo_sort_preserves_arrival_order_among_siblings() -> None:
    a = _FakeStaged("a")
    b = _FakeStaged("b")  # also a root
    c = _FakeStaged("c", parent_source_id="a")
    d = _FakeStaged("d", parent_source_id="b")
    out = _topo_sort([a, b, c, d])  # type: ignore[list-item]
    order = [r.source_id for r in out]
    # All roots scheduled first; among siblings the input order is kept.
    assert order.index("a") < order.index("c")
    assert order.index("b") < order.index("d")
    assert order.index("a") < order.index("b")


def test_remap_attributes_passes_unmapped_keys_through() -> None:
    attrs, lifecycle = _remap_attributes(
        {"criticality": "high", "vendorName": "Acme"},
        {"criticality": "businessCriticality"},
    )
    assert attrs == {"businessCriticality": "high", "vendorName": "Acme"}
    assert lifecycle == {}


def test_remap_attributes_drops_skip_targets() -> None:
    attrs, lifecycle = _remap_attributes(
        {"criticality": "high", "noise": "ignore me"},
        {"noise": "__skip__"},
    )
    assert attrs == {"criticality": "high"}
    assert lifecycle == {}


def test_remap_attributes_empty_mapping_is_identity() -> None:
    src = {"a": 1, "b": "x"}
    attrs, lifecycle = _remap_attributes(src, {})
    assert attrs == src
    assert lifecycle == {}


def test_remap_attributes_collision_last_write_wins() -> None:
    attrs, _ = _remap_attributes({"a": 1, "b": 2}, {"a": "merged", "b": "merged"})
    assert list(attrs.keys()) == ["merged"]


def test_remap_attributes_routes_lifecycle_target_into_lifecycle_dict() -> None:
    attrs, lifecycle = _remap_attributes(
        {
            "lxVendorLifecycle:endOfLife": "2027-06-30",
            "criticality": "high",
        },
        {
            "lxVendorLifecycle:endOfLife": "__lifecycle__:endOfLife",
            "criticality": "businessCriticality",
        },
        lifecycle={"active": "2020-01-01"},
    )
    # Lifecycle value moved out of attributes into the lifecycle map.
    assert attrs == {"businessCriticality": "high"}
    assert lifecycle == {"active": "2020-01-01", "endOfLife": "2027-06-30"}


def test_remap_attributes_lifecycle_truncates_datetime_to_date_part() -> None:
    # LeanIX's ``_jsonify`` on a ``datetime`` cell produces an ISO 8601
    # string with a time part — the lifecycle slot wants ``YYYY-MM-DD``,
    # so we truncate.
    _, lifecycle = _remap_attributes(
        {"customDate": "2027-06-30T00:00:00"},
        {"customDate": "__lifecycle__:endOfLife"},
    )
    assert lifecycle == {"endOfLife": "2027-06-30"}


def test_remap_attributes_lifecycle_drops_unparseable_values() -> None:
    # A value mapped to a lifecycle slot that isn't ISO-date-shaped is
    # dropped rather than landing as garbage. Empty / "TBD" / vendor
    # name should not corrupt the lifecycle map.
    _, lifecycle = _remap_attributes(
        {"a": "", "b": "TBD", "c": "Acme Inc"},
        {
            "a": "__lifecycle__:plan",
            "b": "__lifecycle__:active",
            "c": "__lifecycle__:endOfLife",
        },
    )
    assert lifecycle == {}


def test_remap_attributes_lifecycle_does_not_clobber_existing_phase() -> None:
    # If both the parser-extracted lifecycle and the admin's mapping
    # populate the same phase, the mapping wins (the admin's intent
    # was to override; the parser's value came from a different source
    # field that the admin chose to remap).
    _, lifecycle = _remap_attributes(
        {"customEndOfLife": "2030-12-31"},
        {"customEndOfLife": "__lifecycle__:endOfLife"},
        lifecycle={"endOfLife": "2025-01-01"},
    )
    assert lifecycle == {"endOfLife": "2030-12-31"}
