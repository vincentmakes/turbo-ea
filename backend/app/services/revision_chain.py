"""Revision chains: the one definition of "which revision is current".

Architecture decisions and Statements of Architecture Work (SoAW) are revised
by creating a new row whose ``parent_id`` points at the revision it replaces.
This module is the single place that turns those rows into chains and decides,
for each chain, which revision is current, which are earlier and which are
upcoming, whether a revision is still being drafted, and whether a given
revision may be revised. Every endpoint, importer and bridge that needs one of
those answers asks this module; none re-derives it.

It is pure: no models, no database. Callers build :class:`RevisionNode`
values from whatever rows they loaded and pass ``today`` explicitly.

Definitions:

* A node is *locked* when ``status == "signed"``.
* A node is *effective* when locked and ``effective_from`` is ``None`` or on
  or before ``today``.
* A chain's nodes are ordered by ``(revision_number, created_at, id)``.
* ``current`` is the last effective node; if none is effective, the first
  locked node; if none is locked, the last node. Nodes before it are
  ``earlier``, nodes after it ``upcoming``.
* ``open_revision`` is the last unlocked node after ``current``.

Chains are built by unioning ``parent_id`` edges that resolve to a present
node and, when ``group_key`` is set (the ADR reference number), nodes sharing
a ``group_key``. Legacy data may hold forks (two children of one parent),
``parent_id`` cycles, and parents that were deleted; none of them can break
the build: a dangling parent is treated as a root and a cycle simply joins its
members into one chain.
"""

from __future__ import annotations

from collections.abc import Hashable, Iterable
from dataclasses import dataclass, field
from datetime import date, datetime
from typing import Any, Literal

LOCKED_STATUS = "signed"

Role = Literal["earlier", "current", "upcoming"]
RefusalReason = Literal["not_locked", "open_revision_exists", "not_latest"]


@dataclass(frozen=True)
class RevisionNode:
    """One revision row, reduced to what chain reading needs.

    ``id`` and ``parent_id`` are opaque, hashable and mutually comparable
    (``uuid.UUID`` in practice); the id is the last ordering tie-breaker.
    """

    id: Any
    parent_id: Any
    revision_number: int
    status: str
    created_at: datetime
    group_key: Hashable | None = None
    effective_from: date | None = None


def is_locked(node: RevisionNode) -> bool:
    """A signed revision is locked: its content can no longer change."""
    return node.status == LOCKED_STATUS


def is_effective(node: RevisionNode, today: date) -> bool:
    """Locked and in effect on ``today`` (an unset ``effective_from`` means in effect)."""
    return is_locked(node) and (node.effective_from is None or node.effective_from <= today)


def _order_key(node: RevisionNode) -> tuple[int, datetime, Any]:
    return (node.revision_number, node.created_at, node.id)


@dataclass(frozen=True)
class Chain:
    """The revisions of one decision (or SoAW), in order."""

    nodes: tuple[RevisionNode, ...]
    current: RevisionNode
    open_revision: RevisionNode | None
    forked: bool
    _index: dict[Any, int] = field(repr=False, compare=False)

    def position(self, node_id: Any) -> int:
        """The node's index in :attr:`nodes`; ``KeyError`` when not in this chain."""
        return self._index[node_id]

    def role(self, node_id: Any) -> Role:
        """``"earlier"``, ``"current"`` or ``"upcoming"`` relative to :attr:`current`."""
        pos = self.position(node_id)
        cur = self.position(self.current.id)
        if pos < cur:
            return "earlier"
        if pos > cur:
            return "upcoming"
        return "current"


def _make_chain(members: list[RevisionNode], today: date) -> Chain:
    nodes = tuple(sorted(members, key=_order_key))
    index = {n.id: i for i, n in enumerate(nodes)}

    effective = [n for n in nodes if is_effective(n, today)]
    if effective:
        current = effective[-1]
    else:
        locked = [n for n in nodes if is_locked(n)]
        current = locked[0] if locked else nodes[-1]

    cur_pos = index[current.id]
    after = [n for n in nodes[cur_pos + 1 :] if not is_locked(n)]
    open_revision = after[-1] if after else None

    child_counts: dict[Any, int] = {}
    for n in nodes:
        if n.parent_id != n.id and n.parent_id in index:
            child_counts[n.parent_id] = child_counts.get(n.parent_id, 0) + 1
    numbers = [n.revision_number for n in nodes]
    forked = any(c > 1 for c in child_counts.values()) or len(set(numbers)) != len(numbers)

    return Chain(
        nodes=nodes,
        current=current,
        open_revision=open_revision,
        forked=forked,
        _index=index,
    )


def build_chains(nodes: Iterable[RevisionNode], *, today: date) -> dict[Any, Chain]:
    """Group ``nodes`` into chains; map every node id to its chain.

    All members of one chain map to the same :class:`Chain` object. Raises
    ``ValueError`` when two nodes share an id.
    """
    by_id: dict[Any, RevisionNode] = {}
    for n in nodes:
        if n.id in by_id:
            raise ValueError(f"duplicate revision id: {n.id!r}")
        by_id[n.id] = n

    parent: dict[Any, Any] = {nid: nid for nid in by_id}

    def find(x: Any) -> Any:
        while parent[x] != x:
            x = parent[x]
        return x

    def union(a: Any, b: Any) -> None:
        parent[find(b)] = find(a)

    first_by_group: dict[Hashable, Any] = {}
    for n in by_id.values():
        if n.parent_id in by_id:
            union(n.parent_id, n.id)
        if n.group_key is not None:
            first = first_by_group.setdefault(n.group_key, n.id)
            union(first, n.id)

    members: dict[Any, list[RevisionNode]] = {}
    for nid, n in by_id.items():
        members.setdefault(find(nid), []).append(n)

    result: dict[Any, Chain] = {}
    for group in members.values():
        chain = _make_chain(group, today)
        for n in group:
            result[n.id] = chain
    return result


def next_revision_number(chain: Chain) -> int:
    """The number a new revision of this chain gets: the chain's maximum + 1."""
    return max(n.revision_number for n in chain.nodes) + 1


def revise_refusal(chain: Chain, node_id: Any) -> RefusalReason | None:
    """Why ``node_id`` may not be revised, or ``None`` when it may.

    Checked in order: the node is not locked (``"not_locked"``); the chain
    already has an unlocked revision other than this node
    (``"open_revision_exists"``); a locked revision is ordered after this node
    (``"not_latest"``).
    """
    pos = chain.position(node_id)
    node = chain.nodes[pos]
    if not is_locked(node):
        return "not_locked"
    if any(not is_locked(n) and n.id != node_id for n in chain.nodes):
        return "open_revision_exists"
    if any(is_locked(n) for n in chain.nodes[pos + 1 :]):
        return "not_latest"
    return None
