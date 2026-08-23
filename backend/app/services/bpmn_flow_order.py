"""Causal ordering for a directed graph of BPMN flow nodes.

Deliberately free of any XML/BPMN knowledge: the caller hands over node ids in
document order, the edges it managed to resolve, and a containment map. That
keeps the graph theory unit-testable on plain tuples and keeps `bpmn_parser`
about parsing.

The ordering the callers want is *causal*: a step should be listed after the
steps that can lead to it. Three properties make that well-defined on real
BPMN, which is neither a tree nor a DAG:

* **Loops.** A rework branch makes a cycle, and a cycle has no topological
  order. Strongly connected components are condensed first, so a loop becomes
  one causal level and never blocks the elements downstream of it.
* **Levels, not a walk.** Rank is the *longest* path from a source, so a node
  waits for its slowest predecessor. A greedy topological walk would emit a
  short branch's tail before a long branch's head, which reads wrong in a
  two-pool process where one pool waits on a message from the other.
* **Containers.** Sub-process internals are ordered among themselves and
  emitted directly after their sub-process, so an expanded sub-process stays
  one contiguous block instead of interleaving with its siblings.

Every tie is broken by document order, which is a total order, so the result is
deterministic. Ties are never broken on the element id: modeller-generated ids
are unstable across edits.
"""

from __future__ import annotations

from collections.abc import Iterable, Mapping, Sequence

__all__ = ["order_flow_nodes"]


def order_flow_nodes(
    node_ids: Sequence[str],
    edges: Iterable[tuple[str, str]],
    parent_of: Mapping[str, str | None],
) -> list[str]:
    """Return ``node_ids`` re-ordered to follow causal flow.

    Args:
        node_ids: every orderable node, in document order, without duplicates.
        edges: ``(predecessor, successor)`` pairs. Endpoints outside
            ``node_ids`` are ignored, so the caller may pass raw refs.
        parent_of: node id → id of the enclosing container (a sub-process), or
            ``None`` for a top-level node. Containers are themselves nodes.

    The returned list is a permutation of ``node_ids``.
    """
    known = set(node_ids)
    doc_index = {node_id: i for i, node_id in enumerate(node_ids)}

    # Group nodes by their container. `None` is the top level, which holds
    # every pool of a collaboration — grouping by <process> instead would order
    # the pools one after another and lose the message-flow interleaving that
    # makes a cross-pool process readable.
    children_of: dict[str | None, list[str]] = {}
    for node_id in node_ids:
        container = parent_of.get(node_id)
        if container is not None and container not in known:
            container = None
        children_of.setdefault(container, []).append(node_id)

    # Assign every edge to the container in which both of its endpoints are
    # siblings, lifting each endpoint to its ancestor there. BPMN forbids a
    # sequence flow from crossing a sub-process boundary, so in practice only a
    # message flow needs lifting.
    edges_of: dict[str | None, set[tuple[str, str]]] = {}
    for source, target in edges:
        if source not in known or target not in known or source == target:
            continue
        container = _lowest_common_container(source, target, parent_of, known)
        lifted_source = _lift(source, container, parent_of, known)
        lifted_target = _lift(target, container, parent_of, known)
        if lifted_source is None or lifted_target is None:
            continue
        if lifted_source == lifted_target:
            continue
        edges_of.setdefault(container, set()).add((lifted_source, lifted_target))

    order_of: dict[str | None, list[str]] = {
        container: _order_within(siblings, edges_of.get(container, set()), doc_index)
        for container, siblings in children_of.items()
    }

    # Emit the top level, splicing each container's own ordering in directly
    # after it. Iterative so that deeply nested sub-processes can't recurse.
    ordered: list[str] = []
    stack: list[Iterable[str]] = [iter(order_of.get(None, []))]
    while stack:
        node_id = next(stack[-1], None)  # type: ignore[call-overload]
        if node_id is None:
            stack.pop()
            continue
        ordered.append(node_id)
        nested = order_of.get(node_id)
        if nested:
            stack.append(iter(nested))
    return ordered


# ---------------------------------------------------------------------------
# Containment
# ---------------------------------------------------------------------------


def _ancestors(
    node_id: str, parent_of: Mapping[str, str | None], known: set[str]
) -> list[str | None]:
    """Containers of ``node_id``, nearest first, always ending in ``None``."""
    chain: list[str | None] = []
    seen: set[str] = set()
    current = parent_of.get(node_id)
    while current is not None and current in known and current not in seen:
        seen.add(current)
        chain.append(current)
        current = parent_of.get(current)
    chain.append(None)
    return chain


def _lowest_common_container(
    source: str,
    target: str,
    parent_of: Mapping[str, str | None],
    known: set[str],
) -> str | None:
    target_chain = set(_ancestors(target, parent_of, known))
    for container in _ancestors(source, parent_of, known):
        if container in target_chain:
            return container
    return None


def _lift(
    node_id: str,
    container: str | None,
    parent_of: Mapping[str, str | None],
    known: set[str],
) -> str | None:
    """The ancestor of ``node_id`` (possibly itself) that sits in ``container``."""
    current: str | None = node_id
    seen: set[str] = set()
    while current is not None:
        parent = parent_of.get(current)
        if parent is not None and parent not in known:
            parent = None
        if parent == container:
            return current
        if current in seen:
            return None
        seen.add(current)
        current = parent
    return None


# ---------------------------------------------------------------------------
# Ranking
# ---------------------------------------------------------------------------


def _order_within(
    siblings: Sequence[str],
    edges: set[tuple[str, str]],
    doc_index: Mapping[str, int],
) -> list[str]:
    """Order one container's nodes by causal level, document order breaking ties."""
    if len(siblings) < 2:
        return list(siblings)

    members = set(siblings)
    internal = {(s, t) for s, t in edges if s in members and t in members}
    successors: dict[str, set[str]] = {node_id: set() for node_id in siblings}
    for source, target in internal:
        successors[source].add(target)

    component_of, components = _tarjan_scc(siblings, successors)
    rank = _longest_path_ranks(components, component_of, successors)
    group = _weak_component_rank(siblings, internal, doc_index)

    return sorted(
        siblings,
        key=lambda node_id: (group[node_id], rank[component_of[node_id]], doc_index[node_id]),
    )


def _tarjan_scc(
    nodes: Sequence[str], successors: Mapping[str, set[str]]
) -> tuple[dict[str, int], list[list[str]]]:
    """Iterative Tarjan.

    Returns ``(component_of, components)``. Tarjan closes a component only once
    everything it can reach is closed, so ``components`` comes out in *reverse*
    topological order of the condensation — iterating it backwards is a
    topological order, which is all the ranking pass needs. That is why no
    separate topological sort is used here: `graphlib.TopologicalSorter` would
    add a second pass and raise `CycleError` on a self-loop.
    """
    index_of: dict[str, int] = {}
    lowlink: dict[str, int] = {}
    on_stack: set[str] = set()
    stack: list[str] = []
    component_of: dict[str, int] = {}
    components: list[list[str]] = []
    counter = 0

    for root in nodes:
        if root in index_of:
            continue
        index_of[root] = lowlink[root] = counter
        counter += 1
        stack.append(root)
        on_stack.add(root)
        work: list[tuple[str, Iterable[str]]] = [(root, iter(sorted(successors.get(root, ()))))]
        while work:
            node_id, pending = work[-1]
            successor = next(pending, None)  # type: ignore[call-overload]
            if successor is not None:
                if successor not in index_of:
                    index_of[successor] = lowlink[successor] = counter
                    counter += 1
                    stack.append(successor)
                    on_stack.add(successor)
                    work.append((successor, iter(sorted(successors.get(successor, ())))))
                elif successor in on_stack:
                    lowlink[node_id] = min(lowlink[node_id], index_of[successor])
                continue
            work.pop()
            if work:
                parent = work[-1][0]
                lowlink[parent] = min(lowlink[parent], lowlink[node_id])
            if lowlink[node_id] == index_of[node_id]:
                component: list[str] = []
                while True:
                    member = stack.pop()
                    on_stack.discard(member)
                    component_of[member] = len(components)
                    component.append(member)
                    if member == node_id:
                        break
                components.append(component)
    return component_of, components


def _longest_path_ranks(
    components: Sequence[Sequence[str]],
    component_of: Mapping[str, int],
    successors: Mapping[str, set[str]],
) -> dict[int, int]:
    """Longest path from a source, measured on the condensation."""
    rank = dict.fromkeys(range(len(components)), 0)
    # `components` is in reverse topological order, so walking it backwards
    # guarantees a component's own rank is final before it is propagated.
    for index in reversed(range(len(components))):
        current = rank[index]
        for member in components[index]:
            for successor in successors.get(member, ()):
                other = component_of[successor]
                if other != index and rank[other] < current + 1:
                    rank[other] = current + 1
    return rank


def _weak_component_rank(
    nodes: Sequence[str],
    edges: set[tuple[str, str]],
    doc_index: Mapping[str, int],
) -> dict[str, int]:
    """Rank each weakly-connected component by its earliest member.

    Two unrelated processes in one file share no edge, so without this their
    nodes would interleave rank by rank (``P1a, P2a, P1b, P2b``). Grouping by
    weak component keeps each of them a contiguous block, in first-appearance
    order. A file with no flows at all becomes one component per node, i.e.
    plain document order.
    """
    parent: dict[str, str] = {node_id: node_id for node_id in nodes}

    def find(node_id: str) -> str:
        root = node_id
        while parent[root] != root:
            root = parent[root]
        while parent[node_id] != root:
            parent[node_id], node_id = root, parent[node_id]
        return root

    for source, target in edges:
        if source in parent and target in parent:
            source_root, target_root = find(source), find(target)
            if source_root != target_root:
                parent[source_root] = target_root

    earliest: dict[str, int] = {}
    for node_id in nodes:
        root = find(node_id)
        position = doc_index[node_id]
        if root not in earliest or position < earliest[root]:
            earliest[root] = position

    order = {root: i for i, root in enumerate(sorted(earliest, key=lambda r: earliest[r]))}
    return {node_id: order[find(node_id)] for node_id in nodes}
