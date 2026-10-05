"""The building blocks of ``order_flow_nodes``, each on its own.

``test_bpmn_flow_order.py`` proves the reading order end to end. Several of the
helpers are defensive against inputs the orchestrator never hands them today —
a cyclic containment map, a container outside the known set, an edge with an
endpoint outside the siblings — and a defence is only worth keeping if a test
would notice it going. So each helper is called directly here, with exact
expected values.
"""

from __future__ import annotations

from app.services.bpmn_flow_order import (
    _ancestors,
    _lift,
    _longest_path_ranks,
    _order_within,
    _tarjan_scc,
    _weak_component_rank,
    order_flow_nodes,
)


class TestAncestors:
    def test_nearest_first_ending_in_none(self):
        parent_of = {"t": "inner", "inner": "outer", "outer": None}
        assert _ancestors("t", parent_of, {"t", "inner", "outer"}) == ["inner", "outer", None]

    def test_a_top_level_node(self):
        assert _ancestors("t", {"t": None}, {"t"}) == [None]

    def test_a_container_outside_the_known_set_ends_the_chain(self):
        parent_of = {"t": "inner", "inner": "ghost", "ghost": None}
        assert _ancestors("t", parent_of, {"t", "inner"}) == ["inner", None]

    def test_a_cyclic_containment_map_terminates(self):
        parent_of = {"t": "a", "a": "b", "b": "a"}
        assert _ancestors("t", parent_of, {"t", "a", "b"}) == ["a", "b", None]


class TestLift:
    PARENT_OF = {"t": "inner", "inner": "outer", "outer": None}
    KNOWN = {"t", "inner", "outer"}

    def test_a_node_already_in_the_container_is_itself(self):
        assert _lift("t", "inner", self.PARENT_OF, self.KNOWN) == "t"

    def test_lifts_through_every_level(self):
        assert _lift("t", "outer", self.PARENT_OF, self.KNOWN) == "inner"
        assert _lift("t", None, self.PARENT_OF, self.KNOWN) == "outer"

    def test_an_unknown_parent_reads_as_the_top_level(self):
        assert _lift("t", None, {"t": "ghost"}, {"t"}) == "t"

    def test_a_container_the_node_is_not_in(self):
        assert _lift("t", "elsewhere", self.PARENT_OF, self.KNOWN) is None

    def test_a_cycle_that_never_reaches_the_container_gives_up(self):
        parent_of = {"t": "a", "a": "b", "b": "a"}
        assert _lift("t", "nowhere", parent_of, {"t", "a", "b"}) is None


class TestTarjan:
    def test_components_in_reverse_topological_order(self):
        component_of, components = _tarjan_scc(
            ["a", "b", "c", "d"], {"a": {"b"}, "b": {"c"}, "c": {"b", "d"}, "d": set()}
        )
        assert [sorted(c) for c in components] == [["d"], ["b", "c"], ["a"]]
        assert component_of == {"d": 0, "b": 1, "c": 1, "a": 2}

    def test_nodes_missing_from_the_successor_map_have_no_successors(self):
        component_of, components = _tarjan_scc(["a", "b"], {})
        assert components == [["a"], ["b"]]
        assert component_of == {"a": 0, "b": 1}

    def test_a_successor_missing_from_the_map(self):
        _, components = _tarjan_scc(["a", "b"], {"a": {"b"}})
        assert components == [["b"], ["a"]]


class TestLongestPathRanks:
    def test_the_longest_path_wins(self):
        # a → b → c and a → c: c sits at depth 2, not 1.
        successors = {"a": {"b", "c"}, "b": {"c"}, "c": set()}
        component_of, components = _tarjan_scc(["a", "b", "c"], successors)
        ranks = _longest_path_ranks(components, component_of, successors)
        assert {n: ranks[component_of[n]] for n in "abc"} == {"a": 0, "b": 1, "c": 2}

    def test_a_cycle_is_one_level(self):
        successors = {"a": {"b"}, "b": {"a", "c"}, "c": set()}
        component_of, components = _tarjan_scc(["a", "b", "c"], successors)
        ranks = _longest_path_ranks(components, component_of, successors)
        assert {n: ranks[component_of[n]] for n in "abc"} == {"a": 0, "b": 0, "c": 1}

    def test_members_missing_from_the_successor_map(self):
        assert _longest_path_ranks([["a"], ["b"]], {"a": 0, "b": 1}, {}) == {0: 0, 1: 0}


class TestOrderWithin:
    def test_edges_leaving_the_siblings_are_ignored(self):
        doc = {"x": 0, "a": 1, "b": 2}
        # The edge from outside would otherwise drag "b" ahead of "a".
        assert _order_within(["a", "b"], {("x", "b"), ("b", "outside")}, doc) == ["a", "b"]

    def test_a_single_sibling(self):
        assert _order_within(["a"], set(), {"a": 0}) == ["a"]


class TestWeakComponentRank:
    def test_unrelated_groups_rank_by_their_earliest_member(self):
        doc = {"p1a": 0, "p2a": 1, "p1b": 2, "p2b": 3}
        ranks = _weak_component_rank(list(doc), {("p1a", "p1b"), ("p2a", "p2b")}, doc)
        assert ranks["p1a"] == ranks["p1b"] < ranks["p2a"] == ranks["p2b"]

    def test_edges_to_unknown_nodes_join_nothing(self):
        doc = {"a": 0, "b": 1}
        ranks = _weak_component_rank(["a", "b"], {("a", "ghost"), ("ghost", "b")}, doc)
        assert ranks["a"] != ranks["b"]


class TestEdgeFiltering:
    """An edge ``order_flow_nodes`` must ignore is skipped on its own — the
    edges after it still order the nodes."""

    def test_a_self_loop_listed_first(self):
        order = order_flow_nodes(["a", "b"], [("a", "a"), ("b", "a")], {})
        assert order == ["b", "a"]

    def test_a_flow_into_its_own_sub_process_listed_first(self):
        # x sits inside S; x → S lifts to S → S at the top level, which says
        # nothing about the order there.
        order = order_flow_nodes(
            ["a", "b", "S", "x"], [("x", "S"), ("b", "a")], {"x": "S", "a": None, "b": None}
        )
        assert order.index("b") < order.index("a")
        assert order.index("S") < order.index("x")
