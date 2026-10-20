"""Unit tests for the PPM roll-up helpers (``app.services.ppm_rollup``)."""

from __future__ import annotations

import uuid

from app.services.ppm_rollup import (
    COST_KEYS,
    LinePresence,
    Rollup,
    anchor_groups,
    children_index,
    date_span,
    descendants_within,
    rollup_for_board,
    sum_by_year,
    sum_figures,
    walk,
)

BOTH = LinePresence(has_budget=True, has_cost=True)
BUDGET_ONLY = LinePresence(has_budget=True, has_cost=False)
COST_ONLY = LinePresence(has_budget=False, has_cost=True)


def _ids(n: int) -> list[uuid.UUID]:
    return [uuid.uuid4() for _ in range(n)]


def _fig(cp: float, ca: float, op: float, oa: float) -> dict[str, float]:
    return {"capex_planned": cp, "capex_actual": ca, "opex_planned": op, "opex_actual": oa}


def _planned(cp: float, op: float) -> dict[str, float]:
    return {"capex_planned": cp, "opex_planned": op}


def _actual(ca: float, oa: float) -> dict[str, float]:
    return {"capex_actual": ca, "opex_actual": oa}


class TestChildrenIndex:
    def test_groups_children_under_their_parent_and_skips_roots(self):
        a, b, c = _ids(3)
        idx = children_index({a: None, b: a, c: a})
        assert dict(idx) == {a: [b, c]}

    def test_empty_map(self):
        assert dict(children_index({})) == {}


class TestAnchorGroups:
    def test_a_root_program_anchors_itself(self):
        (prog,) = _ids(1)
        assert anchor_groups({prog: None}, {prog: "program"}, "program") == {prog: prog}

    def test_every_level_beneath_maps_to_the_top_most_program(self):
        top, project, epic, nested, under_nested = _ids(5)
        parents = {top: None, project: top, epic: project, nested: top, under_nested: nested}
        subtypes = {
            top: "program",
            project: "project",
            epic: "epic",
            nested: "program",
            under_nested: "project",
        }
        assert anchor_groups(parents, subtypes, "program") == {
            top: top,
            project: top,
            epic: top,
            nested: top,
            under_nested: top,
        }

    def test_a_row_with_no_program_above_is_absent(self):
        prog, child, loose, loose_child = _ids(4)
        parents = {prog: None, child: prog, loose: None, loose_child: loose}
        subtypes = {prog: "program", child: "project", loose: "project", loose_child: "epic"}
        assert anchor_groups(parents, subtypes, "program") == {prog: prog, child: prog}

    def test_a_broken_chain_stops_the_walk_even_below_a_program(self):
        # ``mid`` has no on-board parent (its own parent was hidden), so the
        # program that sits higher in the real hierarchy is never reached.
        prog, mid, leaf = _ids(3)
        parents = {prog: None, mid: None, leaf: mid}
        subtypes = {prog: "program", mid: "project", leaf: "project"}
        assert anchor_groups(parents, subtypes, "program") == {prog: prog}

    def test_a_cycle_terminates(self):
        a, b, c = _ids(3)
        parents = {a: b, b: a, c: None}
        subtypes = {a: "program", b: "project", c: None}
        assert anchor_groups(parents, subtypes, "program") == {a: a, b: a}

    def test_a_cycle_of_two_programs_terminates(self):
        a, b = _ids(2)
        assert anchor_groups({a: b, b: a}, {a: "program", b: "program"}, "program") == {
            a: b,
            b: a,
        }

    def test_none_and_missing_subtypes_never_match(self):
        a, b = _ids(2)
        assert anchor_groups({a: None, b: a}, {a: None}, "program") == {}

    def test_the_key_is_matched_exactly(self):
        (a,) = _ids(1)
        assert anchor_groups({a: None}, {a: "Program"}, "program") == {}
        assert anchor_groups({a: None}, {a: "program"}, "Program") == {}

    def test_a_parent_outside_the_map_ends_the_walk(self):
        a, outside = _ids(2)
        assert anchor_groups({a: outside}, {a: "project", outside: "program"}, "program") == {}

    def test_empty_map(self):
        assert anchor_groups({}, {}, "program") == {}


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
        presence = {child: BOTH, grandchild: BOTH, leaf: BOTH}
        dates = {
            root: (None, None),
            child: ("2026-03-01", "2026-06-30"),
            grandchild: ("2026-01-01", "2026-04-30"),
            leaf: ("2020-01-01", "2030-01-01"),
        }
        out = rollup_for_board(parents, figures, presence, dates)
        assert out[root] == Rollup(
            descendant_count=2,
            planned=_planned(11, 33),
            actual=_actual(22, 44),
            start_date="2026-01-01",
            end_date="2026-06-30",
        )
        # A middle level derives from its own descendants only (not itself).
        assert out[child] == Rollup(
            descendant_count=1, planned=None, actual=None, start_date=None, end_date=None
        )
        assert set(out) == {root, child}

    def test_parent_with_both_kinds_of_line_keeps_its_count_but_derives_no_costs(self):
        root, child = _ids(2)
        out = rollup_for_board(
            {root: None, child: root},
            {root: _fig(0, 0, 0, 0), child: _fig(5, 5, 5, 5)},
            {root: BOTH, child: BOTH},
            {root: (None, None), child: ("2026-01-01", "2026-02-01")},
        )
        assert out[root] == Rollup(
            descendant_count=1,
            planned=None,
            actual=None,
            start_date="2026-01-01",
            end_date="2026-02-01",
        )

    def test_budget_only_parent_derives_its_actuals_only(self):
        # A program that holds the budget while its projects record the spend.
        root, a, b = _ids(3)
        out = rollup_for_board(
            {root: None, a: root, b: root},
            {root: _fig(500, 0, 50, 0), a: _fig(7, 3, 11, 1), b: _fig(0, 2, 0, 4)},
            {root: BUDGET_ONLY, a: BOTH, b: COST_ONLY},
            {root: ("2026-01-01", None), a: (None, None), b: (None, None)},
        )
        assert out[root] == Rollup(
            descendant_count=2,
            planned=None,
            actual=_actual(5, 5),
            start_date=None,
            end_date=None,
        )

    def test_cost_only_parent_derives_its_budget_only(self):
        root, a, b = _ids(3)
        out = rollup_for_board(
            {root: None, a: root, b: root},
            {root: _fig(0, 9, 0, 9), a: _fig(7, 3, 11, 1), b: _fig(2, 0, 4, 0)},
            {root: COST_ONLY, a: BOTH, b: BUDGET_ONLY},
            {root: (None, None), a: (None, None), b: (None, None)},
        )
        assert out[root].planned == _planned(9, 15)
        assert out[root].actual is None

    def test_a_side_nothing_beneath_has_is_not_derived(self):
        # Beneath carries budget lines only: the actual pair has nothing to
        # derive from, so a parent with no lines at all derives the budget alone.
        root, a = _ids(2)
        out = rollup_for_board(
            {root: None, a: root},
            {a: _fig(4, 0, 6, 0)},
            {a: BUDGET_ONLY},
            {root: (None, None), a: (None, None)},
        )
        assert out[root].planned == _planned(4, 6)
        assert out[root].actual is None
        out = rollup_for_board(
            {root: None, a: root},
            {a: _fig(0, 4, 0, 6)},
            {a: COST_ONLY},
            {root: (None, None), a: (None, None)},
        )
        assert out[root].planned is None
        assert out[root].actual == _actual(4, 6)

    def test_parent_with_one_own_date_derives_neither_date(self):
        root, child = _ids(2)
        figures = {child: _fig(1, 1, 1, 1)}
        children_dates = ("2025-01-01", "2028-01-01")
        for own in (("2026-05-01", None), (None, "2026-05-01")):
            out = rollup_for_board(
                {root: None, child: root},
                figures,
                {child: BOTH},
                {root: own, child: children_dates},
            )
            assert out[root] == Rollup(
                descendant_count=1,
                planned=_planned(1, 1),
                actual=_actual(1, 1),
                start_date=None,
                end_date=None,
            )

    def test_children_without_anything_still_give_a_count(self):
        root, a, b = _ids(3)
        out = rollup_for_board(
            {root: None, a: root, b: root},
            {},
            {},
            {root: (None, None), a: (None, None), b: (None, None)},
        )
        assert out == {
            root: Rollup(
                descendant_count=2, planned=None, actual=None, start_date=None, end_date=None
            )
        }

    def test_one_line_anywhere_beneath_is_enough_to_derive(self):
        root, mid, leaf = _ids(3)
        out = rollup_for_board(
            {root: None, mid: root, leaf: mid},
            {leaf: _fig(0, 0, 0, 0)},
            {leaf: BOTH},
            {root: (None, None), mid: (None, None), leaf: (None, None)},
        )
        assert out[root].planned == _planned(0, 0)
        assert out[root].actual == _actual(0, 0)
        assert out[mid].planned == _planned(0, 0)

    def test_empty_board(self):
        assert rollup_for_board({}, {}, {}, {}) == {}


def _payload(by_year, capex_undated=0.0, opex_undated=0.0):
    return {
        "byYear": [
            {
                "year": year,
                "capexBudget": cb,
                "opexBudget": ob,
                "capexActual": ca,
                "opexActual": oa,
                "totalBudget": 999,
                "capexPlanned": 999,
            }
            for year, cb, ob, ca, oa in by_year
        ],
        "unscheduledCapexActual": capex_undated,
        "unscheduledOpexActual": opex_undated,
        "unscheduledActual": 999,
    }


def _year(year, cb=0.0, ob=0.0, ca=0.0, oa=0.0):
    return {
        "year": year,
        "capex_budget": cb,
        "opex_budget": ob,
        "capex_actual": ca,
        "opex_actual": oa,
    }


class TestSumByYear:
    def test_sums_each_year_across_payloads_ascending_with_undated_last(self):
        out = sum_by_year(
            [
                _payload([(2026, 100, 10, 40, 4), (2024, 1, 2, 3, 4)], capex_undated=5),
                _payload([(2025, 7, 0, 0, 0), (2026, 200, 20, 60, 6)], opex_undated=2),
            ]
        )
        assert out == [
            _year(2024, 1, 2, 3, 4),
            _year(2025, cb=7),
            _year(2026, 300, 30, 100, 10),
            _year(None, ca=5, oa=2),
        ]

    def test_all_zero_entries_are_dropped(self):
        out = sum_by_year([_payload([(2025, 0, 0, 0, 0), (2026, 0, 0, 0, 1)])])
        assert out == [_year(2026, oa=1)]

    def test_nothing_to_sum(self):
        assert sum_by_year([]) == []
        assert sum_by_year([_payload([])]) == []
