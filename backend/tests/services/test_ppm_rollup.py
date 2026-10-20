"""Unit tests for the PPM roll-up helpers (``app.services.ppm_rollup``)."""

from __future__ import annotations

import uuid

from app.services.ppm_rollup import (
    COST_KEYS,
    Rollup,
    children_index,
    date_span,
    descendants_within,
    rollup_for_board,
    sum_figures,
    walk,
)


def _ids(n: int) -> list[uuid.UUID]:
    return [uuid.uuid4() for _ in range(n)]


def _fig(cp: float, ca: float, op: float, oa: float) -> dict[str, float]:
    return {"capex_planned": cp, "capex_actual": ca, "opex_planned": op, "opex_actual": oa}


class TestChildrenIndex:
    def test_groups_children_under_their_parent_and_skips_roots(self):
        a, b, c = _ids(3)
        idx = children_index({a: None, b: a, c: a})
        assert dict(idx) == {a: [b, c]}

    def test_empty_map(self):
        assert dict(children_index({})) == {}


class TestDescendantsWithin:
    def test_multi_level_excludes_the_root(self):
        root, child, grandchild, other = _ids(4)
        parents = {root: None, child: root, grandchild: child, other: None}
        assert set(descendants_within(parents, root)) == {child, grandchild}
        assert descendants_within(parents, child) == [grandchild]
        assert descendants_within(parents, grandchild) == []
        assert descendants_within(parents, other) == []

    def test_cycle_terminates_and_never_returns_the_root(self):
        a, b, c = _ids(3)
        parents = {a: c, b: a, c: b}
        assert sorted(descendants_within(parents, a)) == sorted([b, c])
        assert len(descendants_within(parents, a)) == 2

    def test_chain_broken_by_an_absent_id_stops_there(self):
        root, hidden, below = _ids(3)
        # ``hidden`` is not in the map (archived, hidden, off the board), so the
        # initiative beneath it is not reached through it.
        parents = {root: None, below: hidden}
        assert descendants_within(parents, root) == []

    def test_root_absent_from_the_map_still_walks(self):
        root, child = _ids(2)
        assert descendants_within({child: root}, root) == [child]

    def test_diamond_like_reuse_is_counted_once(self):
        root, a, b = _ids(3)
        children = {root: [a, b], a: [b]}
        assert sorted(walk(children, root)) == sorted([a, b])
        assert len(walk(children, root)) == 2

    def test_empty_map(self):
        assert descendants_within({}, uuid.uuid4()) == []


class TestSumFigures:
    def test_sums_every_key_and_ignores_ids_without_lines(self):
        a, b, c = _ids(3)
        figures = {a: _fig(1, 2, 3, 4), b: _fig(10, 20, 30, 40)}
        assert sum_figures([a, b, c], figures) == _fig(11, 22, 33, 44)

    def test_nothing_to_sum_is_zero_on_every_key(self):
        assert sum_figures([], {}) == dict.fromkeys(COST_KEYS, 0.0)
        assert sum_figures(_ids(2), {}) == _fig(0, 0, 0, 0)


class TestDateSpan:
    def test_min_start_and_max_end_ignoring_missing(self):
        a, b, c, d = _ids(4)
        dates = {
            a: ("2026-03-01", "2026-06-30"),
            b: ("2025-11-15", None),
            c: (None, "2027-01-31"),
            d: ("", ""),
        }
        assert date_span([a, b, c, d], dates) == ("2025-11-15", "2027-01-31")

    def test_one_side_missing_everywhere(self):
        a, b = _ids(2)
        dates = {a: ("2026-01-01", None), b: ("2026-02-01", None)}
        assert date_span([a, b], dates) == ("2026-01-01", None)
        dates = {a: (None, "2026-01-01"), b: (None, "2026-02-01")}
        assert date_span([a, b], dates) == (None, "2026-02-01")

    def test_no_ids(self):
        assert date_span([], {}) == (None, None)


class TestRollupForBoard:
    def test_parent_without_lines_or_dates_derives_both_from_its_subtree(self):
        root, child, grandchild, leaf = _ids(4)
        parents = {root: None, child: root, grandchild: child, leaf: None}
        figures = {
            child: _fig(1, 2, 3, 4),
            grandchild: _fig(10, 20, 30, 40),
            leaf: _fig(9, 9, 9, 9),
        }
        dates = {
            root: (None, None),
            child: ("2026-03-01", "2026-06-30"),
            grandchild: ("2026-01-01", "2026-04-30"),
            leaf: ("2020-01-01", "2030-01-01"),
        }
        out = rollup_for_board(parents, figures, dates)
        assert out[root] == Rollup(
            descendant_count=2,
            figures=_fig(11, 22, 33, 44),
            start_date="2026-01-01",
            end_date="2026-06-30",
        )
        # A middle level derives from its own descendants only (not itself).
        assert out[child] == Rollup(
            descendant_count=1, figures=None, start_date=None, end_date=None
        )
        assert set(out) == {root, child}

    def test_parent_with_own_lines_keeps_its_count_but_derives_no_costs(self):
        root, child = _ids(2)
        out = rollup_for_board(
            {root: None, child: root},
            {root: _fig(0, 0, 0, 0), child: _fig(5, 5, 5, 5)},
            {root: (None, None), child: ("2026-01-01", "2026-02-01")},
        )
        assert out[root] == Rollup(
            descendant_count=1, figures=None, start_date="2026-01-01", end_date="2026-02-01"
        )

    def test_parent_with_one_own_date_derives_neither_date(self):
        root, child = _ids(2)
        figures = {child: _fig(1, 1, 1, 1)}
        children_dates = ("2025-01-01", "2028-01-01")
        for own in (("2026-05-01", None), (None, "2026-05-01")):
            out = rollup_for_board(
                {root: None, child: root}, figures, {root: own, child: children_dates}
            )
            assert out[root] == Rollup(
                descendant_count=1, figures=_fig(1, 1, 1, 1), start_date=None, end_date=None
            )

    def test_children_without_anything_still_give_a_count(self):
        root, a, b = _ids(3)
        out = rollup_for_board(
            {root: None, a: root, b: root},
            {},
            {root: (None, None), a: (None, None), b: (None, None)},
        )
        assert out == {
            root: Rollup(descendant_count=2, figures=None, start_date=None, end_date=None)
        }

    def test_one_line_anywhere_beneath_is_enough_to_derive(self):
        root, mid, leaf = _ids(3)
        out = rollup_for_board(
            {root: None, mid: root, leaf: mid},
            {leaf: _fig(0, 0, 0, 0)},
            {root: (None, None), mid: (None, None), leaf: (None, None)},
        )
        assert out[root].figures == _fig(0, 0, 0, 0)
        assert out[mid].figures == _fig(0, 0, 0, 0)

    def test_empty_board(self):
        assert rollup_for_board({}, {}, {}) == {}
