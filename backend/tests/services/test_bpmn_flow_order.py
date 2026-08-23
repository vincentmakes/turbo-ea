"""Unit tests for the causal-ordering graph engine.

Pure graph theory on plain tuples — no XML, no database. Keeping these separate
from the parser tests means a ranking regression points straight at the
algorithm instead of at BPMN parsing.
"""

from __future__ import annotations

from app.services.bpmn_flow_order import order_flow_nodes


def _order(nodes, edges, parents=None):
    return order_flow_nodes(nodes, edges, parents or dict.fromkeys(nodes))


class TestDegenerate:
    def test_empty(self):
        assert _order([], []) == []

    def test_single_node(self):
        assert _order(["a"], []) == ["a"]

    def test_no_edges_is_document_order(self):
        assert _order(["c", "a", "b"], []) == ["c", "a", "b"]

    def test_result_is_a_permutation(self):
        nodes = ["a", "b", "c", "d"]
        assert sorted(_order(nodes, [("d", "a"), ("c", "b")])) == sorted(nodes)


class TestRanking:
    def test_chain_beats_document_order(self):
        assert _order(["c", "b", "a"], [("a", "b"), ("b", "c")]) == ["a", "b", "c"]

    def test_diamond_join_waits_for_longest_branch(self):
        # a → b → d and a → c1 → c2 → d. `d` must wait for the long branch, so
        # it lands after c2 rather than sharing a level with it.
        nodes = ["a", "b", "c1", "c2", "d"]
        edges = [("a", "b"), ("b", "d"), ("a", "c1"), ("c1", "c2"), ("c2", "d")]
        assert _order(nodes, edges) == ["a", "b", "c1", "c2", "d"]

    def test_same_level_falls_back_to_document_order(self):
        assert _order(["r", "y", "x"], [("r", "x"), ("r", "y")]) == ["r", "y", "x"]

    def test_deterministic_across_runs(self):
        nodes = ["a", "b", "c", "d", "e"]
        edges = [("a", "b"), ("a", "c"), ("b", "d"), ("c", "d"), ("d", "e")]
        assert _order(nodes, edges) == _order(nodes, edges)


class TestCycles:
    def test_loop_does_not_block_downstream(self):
        # b ⇄ c is one causal level; d must still come last.
        nodes = ["a", "b", "c", "d"]
        edges = [("a", "b"), ("b", "c"), ("c", "b"), ("c", "d")]
        assert _order(nodes, edges) == ["a", "b", "c", "d"]

    def test_self_loop_is_not_an_error(self):
        assert _order(["a", "b"], [("a", "a"), ("a", "b")]) == ["a", "b"]

    def test_whole_graph_is_one_cycle(self):
        assert _order(["a", "b", "c"], [("a", "b"), ("b", "c"), ("c", "a")]) == ["a", "b", "c"]

    def test_duplicate_edges_change_nothing(self):
        once = _order(["a", "b"], [("a", "b")])
        twice = _order(["a", "b"], [("a", "b"), ("a", "b")])
        assert once == twice == ["a", "b"]


class TestWeakComponents:
    def test_disjoint_chains_stay_blocked(self):
        # Without weak-component grouping these interleave rank by rank as
        # a1, b1, a2, b2 — two unrelated processes read as one mixed list.
        nodes = ["a1", "a2", "b1", "b2"]
        edges = [("a1", "a2"), ("b1", "b2")]
        assert _order(nodes, edges) == ["a1", "a2", "b1", "b2"]

    def test_blocks_follow_first_appearance(self):
        nodes = ["b1", "a1", "a2", "b2"]
        edges = [("a1", "a2"), ("b1", "b2")]
        assert _order(nodes, edges) == ["b1", "b2", "a1", "a2"]

    def test_isolated_node_keeps_its_document_position(self):
        nodes = ["a", "lonely", "b"]
        assert _order(nodes, [("a", "b")]) == ["a", "b", "lonely"]


class TestContainers:
    def test_children_emitted_after_their_container(self):
        nodes = ["a", "s", "c1", "c2", "b"]
        edges = [("a", "s"), ("s", "b"), ("c1", "c2")]
        parents = {"a": None, "s": None, "b": None, "c1": "s", "c2": "s"}
        assert order_flow_nodes(nodes, edges, parents) == ["a", "s", "c1", "c2", "b"]

    def test_sibling_cannot_interleave_into_a_container(self):
        # The flat "container → child" edge variant yields a, s, c1, b, c2, c3
        # here: `b` inherits the container's rank while the children climb past
        # it. Container decomposition keeps the body contiguous.
        nodes = ["a", "s", "c1", "c2", "c3", "b"]
        edges = [("a", "s"), ("s", "b"), ("c1", "c2"), ("c2", "c3")]
        parents = {"a": None, "s": None, "b": None, "c1": "s", "c2": "s", "c3": "s"}
        assert order_flow_nodes(nodes, edges, parents) == ["a", "s", "c1", "c2", "c3", "b"]

    def test_nested_containers(self):
        nodes = ["s", "c1", "s2", "d1", "d2", "b"]
        edges = [("c1", "s2"), ("d1", "d2"), ("s", "b")]
        parents = {"s": None, "b": None, "c1": "s", "s2": "s", "d1": "s2", "d2": "s2"}
        assert order_flow_nodes(nodes, edges, parents) == ["s", "c1", "s2", "d1", "d2", "b"]

    def test_cross_container_edge_is_lifted_to_the_container(self):
        # An edge from inside a container to an outside sibling orders the
        # *container* against that sibling, not the child.
        nodes = ["s", "c1", "b"]
        edges = [("c1", "b")]
        parents = {"s": None, "b": None, "c1": "s"}
        assert order_flow_nodes(nodes, edges, parents) == ["s", "c1", "b"]

    def test_edge_between_two_children_of_one_container_is_not_lifted(self):
        nodes = ["s", "c2", "c1"]
        edges = [("c1", "c2")]
        parents = {"s": None, "c1": "s", "c2": "s"}
        assert order_flow_nodes(nodes, edges, parents) == ["s", "c1", "c2"]

    def test_unknown_container_is_treated_as_top_level(self):
        assert order_flow_nodes(["a", "b"], [], {"a": "ghost", "b": None}) == ["a", "b"]


class TestRobustness:
    def test_edges_to_unknown_nodes_are_ignored(self):
        assert _order(["a", "b"], [("a", "ghost"), ("ghost", "b"), ("a", "b")]) == ["a", "b"]

    def test_long_chain_does_not_recurse(self):
        nodes = [f"n{i}" for i in range(3000)]
        edges = [(f"n{i + 1}", f"n{i}") for i in range(2999)]
        result = _order(nodes, edges)
        assert result[0] == "n2999"
        assert result[-1] == "n0"
