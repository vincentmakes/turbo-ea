"""Unit tests for the LeanIX apply pipeline — pure helpers only.

Database-backed integration tests (savepoint rollback, idempotency,
end-to-end import round-trip) require the project conftest and a live
test Postgres; they live in the api/ test suite.
"""

from __future__ import annotations

from dataclasses import dataclass

from app.services.leanix_migration_apply import _topo_sort


@dataclass
class _FakeStaged:
    leanix_id: str
    parent_leanix_id: str | None = None


def test_topo_sort_orders_parents_before_children() -> None:
    a = _FakeStaged("a")  # root
    b = _FakeStaged("b", parent_leanix_id="a")
    c = _FakeStaged("c", parent_leanix_id="b")
    out = _topo_sort([c, b, a])  # type: ignore[list-item]
    order = [r.leanix_id for r in out]
    assert order.index("a") < order.index("b") < order.index("c")


def test_topo_sort_unknown_parent_schedules_immediately() -> None:
    # Parent is not in the staged set — should not block the child.
    orphan = _FakeStaged("only", parent_leanix_id="external-parent")
    out = _topo_sort([orphan])  # type: ignore[list-item]
    assert [r.leanix_id for r in out] == ["only"]


def test_topo_sort_cycle_keeps_all_rows() -> None:
    # a ↔ b cycle; both depend on each other. The function must not
    # drop rows on cycle — it appends them in arrival order and logs.
    a = _FakeStaged("a", parent_leanix_id="b")
    b = _FakeStaged("b", parent_leanix_id="a")
    out = _topo_sort([a, b])  # type: ignore[list-item]
    assert {r.leanix_id for r in out} == {"a", "b"}


def test_topo_sort_preserves_arrival_order_among_siblings() -> None:
    a = _FakeStaged("a")
    b = _FakeStaged("b")  # also a root
    c = _FakeStaged("c", parent_leanix_id="a")
    d = _FakeStaged("d", parent_leanix_id="b")
    out = _topo_sort([a, b, c, d])  # type: ignore[list-item]
    order = [r.leanix_id for r in out]
    # All roots scheduled first; among siblings the input order is kept.
    assert order.index("a") < order.index("c")
    assert order.index("b") < order.index("d")
    assert order.index("a") < order.index("b")
