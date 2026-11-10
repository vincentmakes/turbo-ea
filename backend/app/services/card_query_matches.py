"""The cards behind a match: for rows a card query lists, which cards at one
step of the query made each row match.

A query view lists only the first card of each line ("Organizations that use
an Application that uses an end-of-life IT Component" lists Organizations).
``POST /cards/query/matches`` answers, per listed row and per requested step,
the cards at that step through which the row matches — the Applications
and the IT Components above.

A step is named by a **node key**, ``"<line>:<hop path>"``:

- ``line`` is the zero-based position of the line among every line of the
  query, in document order (``card_query.query_lines``): a plain query is
  line 0, an ``all_of``'s lines are 0..n-1, and an ``any_of``'s groups number
  their lines consecutively, group after group.
- ``hop path`` is the dot-joined zero-based indices into ``related`` from
  the line's first card down to the node: ``0:0`` is the first hop of line
  0, ``0:0.1`` the second hop below it, ``2:0`` the first hop of line 2.

``resolve_card_query`` keeps the parsed order of lines and hops (it walks
``query_groups`` and each ``related`` list in order and drops nothing), so a
key indexes the resolved tree exactly as it indexes the stored query. The
first card of a line has no key (its cards are the rows), and a negated hop
or any hop below one has none either (it stands for an absence): such a key,
one that does not parse or one that names no node is ``unknown_node``.

The semantics are the list's, step by step. For node M, one statement:

- the row (``root``) is one of the requested ids, readable in inventory
  mode, and matching the whole AND group its line belongs to (which pins
  its type to the line's, one resolution already checked is not hidden) —
  so it is a row the query really lists. No status filter: the
  inventory can show archived rows, and they resolve like any other;
- one relation join per step from the row down to M (``relation_join``, by
  relation type and side, never by card-type pair); every card on the path
  is of its hop's type, ACTIVE, readable in inventory mode and meets its own
  condition, exactly as the list's ``EXISTS`` does at that hop — so a hidden
  or archived middle card carries no match;
- every hop that leaves the path (a sibling of a path node, negated or not)
  stays an ``EXISTS`` on its node, compiled by the list's own builder
  (``card_query.hop_condition``), and so do M's own hops.

Per row, M's distinct cards ordered by name then id; ``limit`` of them are
returned and ``more`` says a further one exists. A card the caller may not
read is filtered before the cut, so it is never a name, never a row and
never the reason ``more`` is set.

Reads only; never commits.
"""

from __future__ import annotations

import re
import uuid
from collections.abc import Iterable, Sequence
from dataclasses import dataclass
from datetime import date
from typing import Any

from sqlalchemy import any_, func, literal, select
from sqlalchemy.dialects.postgresql import ARRAY
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import aliased

from app.models.card import Card
from app.services.card_query import (
    CardQueryError,
    PairStatuses,
    ResolvedHop,
    ResolvedNode,
    group_condition,
    hop_condition,
    inventory_scope,
    where_conditions,
)
from app.services.card_read_scope import CardReadScope
from app.services.dashboard_query import relation_join

#: Node keys in one request, at most.
MAX_NODES = 12
#: Row ids in one request, at most (the inventory's page size).
MAX_IDS = 10000
#: Cards returned per row and node; ``more`` says one more exists.
MATCH_LIMIT = 100
#: A node key's longest spelling.
MAX_KEY_CHARS = 32

#: ``<line>:<index>(.<index>)*`` with canonical numbers (no leading zero), so
#: one node has exactly one key. An index is below ``MAX_HOPS`` (10) and a
#: line below ``MAX_LINES`` (6), so two digits are plenty.
_INDEX = r"(?:0|[1-9][0-9]?)"
_KEY = re.compile(rf"({_INDEX}):({_INDEX}(?:\.{_INDEX})*)")


@dataclass(frozen=True)
class MatchNode:
    """A requested node: its ``key``, the AND ``group`` its line belongs to,
    the ``line``'s first card and the hops from it down to the node."""

    key: str
    group: list[ResolvedNode]
    line: ResolvedNode
    path: tuple[int, ...]

    def hops(self) -> list[ResolvedHop]:
        """The hops from the line's first card down to the node, in order."""
        out: list[ResolvedHop] = []
        node = self.line
        for index in self.path:
            hop = node.hops[index]
            out.append(hop)
            node = hop.node
        return out


def numbered_lines(
    groups: Sequence[list[ResolvedNode]],
) -> list[tuple[list[ResolvedNode], ResolvedNode]]:
    """Every line of ``groups`` as ``(its group, its first card)``, numbered
    by position: the order ``query_lines`` gives the parsed query."""
    return [(group, line) for group in groups for line in group]


def match_node(groups: Sequence[list[ResolvedNode]], key: str) -> MatchNode:
    """``key`` as the node it names in ``groups``.

    ``unknown_node`` for a key that does not parse, a line or an index past
    the end, and a negated hop or a hop below one."""
    parsed = _KEY.fullmatch(key) if isinstance(key, str) else None
    if parsed is None:
        raise CardQueryError("unknown_node")
    line_no = int(parsed.group(1))
    path = tuple(int(part) for part in parsed.group(2).split("."))
    lines = numbered_lines(groups)
    if line_no >= len(lines):
        raise CardQueryError("unknown_node")
    group, line = lines[line_no]
    node = line
    for index in path:
        if index >= len(node.hops) or node.hops[index].negate:
            raise CardQueryError("unknown_node")
        node = node.hops[index].node
    return MatchNode(key, group, line, path)


def match_nodes(groups: Sequence[list[ResolvedNode]], keys: Iterable[str]) -> list[MatchNode]:
    """``keys`` as nodes (``match_node``), each once, in request order."""
    return [match_node(groups, key) for key in dict.fromkeys(keys)]


def _ids_param(ids: Sequence[uuid.UUID]) -> Any:
    """``ids`` as ONE ``uuid[]`` parameter (asyncpg caps a statement at 32767
    binds; ``eol_query._pair_in`` does the same for its pairs)."""
    return literal(list(ids), ARRAY(PG_UUID(as_uuid=True)))


def matches_statement(
    target: MatchNode,
    ids: Sequence[uuid.UUID],
    read_scope: CardReadScope,
    *,
    today: date | None = None,
    pair_statuses: PairStatuses | None = None,
    limit: int | None = MATCH_LIMIT,
) -> Any:
    """The statement answering ``target`` for the rows ``ids``: rows of
    ``(row_id, card_id, name)``, per row the node's distinct cards by name
    then id, at most ``limit + 1`` of them (``None``: all)."""
    root = aliased(Card)
    # No hidden-type filter on the row: resolution refuses a hidden start type
    # (``unknown_card_type``) and the group condition pins the row's type.
    conditions: list[Any] = [
        root.id == any_(_ids_param(ids)),
        *read_scope.where(root, mode="inventory"),
        group_condition(root, target.group, read_scope, today, pair_statuses),
    ]
    path = target.hops()
    steps: list[tuple[ResolvedHop, Any]] = []
    for depth, hop in enumerate(path):
        far = aliased(Card)
        steps.append((hop, far))
        conditions.extend(
            (far.type == hop.node.type, far.status == "ACTIVE", *inventory_scope(read_scope, far))
        )
        conditions.extend(where_conditions(far, hop.node, today=today, pair_statuses=pair_statuses))
        on_path = target.path[depth + 1] if depth + 1 < len(path) else None
        conditions.extend(
            hop_condition(far, sub, read_scope, today, pair_statuses)
            for index, sub in enumerate(hop.node.hops)
            if index != on_path
        )
    card = steps[-1][1]
    statement = select(
        root.id.label("row_id"), card.id.label("card_id"), card.name.label("name")
    ).select_from(root)
    near = root
    for hop, far in steps:
        statement = relation_join(statement, near, hop.side, far)
        near = far
    matched = statement.where(*conditions).distinct().subquery()
    rank = (
        func.row_number()
        .over(partition_by=matched.c.row_id, order_by=(matched.c.name, matched.c.card_id))
        .label("rank")
    )
    ranked = select(matched.c.row_id, matched.c.card_id, matched.c.name, rank).subquery()
    out = select(ranked.c.row_id, ranked.c.card_id, ranked.c.name)
    if limit is not None:
        out = out.where(ranked.c.rank <= limit + 1)
    return out.order_by(ranked.c.row_id, ranked.c.rank)


def cells(rows: Iterable[Any], limit: int | None) -> dict[str, dict[str, Any]]:
    """``(row_id, card_id, name)`` rows, ordered per row, as ``{row id:
    {"cards": [{id, name}], "more": bool}}`` with at most ``limit`` cards."""
    out: dict[str, dict[str, Any]] = {}
    for row_id, card_id, name in rows:
        cell = out.setdefault(str(row_id), {"cards": [], "more": False})
        if limit is not None and len(cell["cards"]) >= limit:
            cell["more"] = True
            continue
        cell["cards"].append({"id": str(card_id), "name": name})
    return out


async def card_query_matches(
    db: AsyncSession,
    targets: Sequence[MatchNode],
    ids: Sequence[uuid.UUID],
    read_scope: CardReadScope,
    *,
    today: date | None = None,
    pair_statuses: PairStatuses | None = None,
    limit: int | None = MATCH_LIMIT,
) -> dict[str, dict[str, dict[str, Any]]]:
    """``{row id: {node key: {"cards": [...], "more": bool}}}`` for the rows
    ``ids`` — one statement per node, only non-empty cells, a row with none
    absent. ``pair_statuses`` as ``PreparedCardQuery.pair_statuses`` fetched
    them (needed by an ``eol_status`` condition anywhere in a target's group
    or path). Never commits."""
    rows: dict[str, dict[str, dict[str, Any]]] = {}
    for target in targets:
        statement = matches_statement(
            target, ids, read_scope, today=today, pair_statuses=pair_statuses, limit=limit
        )
        result = await db.execute(statement)
        for row_id, cell in cells(result.all(), limit).items():
            rows.setdefault(row_id, {})[target.key] = cell
    return rows
