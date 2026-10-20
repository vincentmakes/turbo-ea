"""What the initiatives beneath a PPM parent add up to.

A parent initiative on the PPM board shows its **own** budget lines, its **own**
cost lines and its **own** dates when it has any. When it has none of one kind,
the board shows what the initiatives beneath it add up to instead: the summed
budget, the summed actuals, the earliest start and latest end. The three rules
are independent — a program may hold the budget while its projects record the
spend, and then shows its own budget against its projects' actuals. Own data
wins because a program that carries its own lines usually already covers its
projects, so adding the two would count the same money twice.

Everything here is pure: the callers load the rows (already narrowed to what the
reader may see), and these functions walk the child → parent map they are
handed. A chain broken by an initiative absent from that map — archived, hidden
by the read scope, outside a portal's filters — stops there, the same rule the
board's ``parent_id`` follows, so a hidden initiative never leaks its cost or its
dates into an ancestor's row.

Nothing computed here is ever written back: ``costBudget`` / ``costActual`` stay
the sums of the parent's own lines, and ``startDate`` / ``endDate`` stay what the
user entered.
"""

from __future__ import annotations

import uuid
from collections import defaultdict
from collections.abc import Iterable, Mapping
from dataclasses import dataclass
from typing import Any, NamedTuple

#: The four cost keys ``cost_aggregates_from`` returns per initiative.
COST_KEYS = ("capex_planned", "capex_actual", "opex_planned", "opex_actual")
#: The budget half (from budget lines) and the actual half (from cost lines).
PLANNED_KEYS = ("capex_planned", "opex_planned")
ACTUAL_KEYS = ("capex_actual", "opex_actual")

Figures = dict[str, float]
DateSpan = tuple[str | None, str | None]


class LinePresence(NamedTuple):
    """Which kinds of PPM line an initiative has recorded (a zero amount counts)."""

    has_budget: bool
    has_cost: bool


@dataclass(frozen=True)
class Rollup:
    """What the board shows for a parent in place of data it has not got.

    ``planned`` (the budget pair) is set only when the parent has no budget line
    of its own and some initiative beneath it has; ``actual`` (the actual pair)
    only when it has no cost line of its own and some initiative beneath it has.
    The dates only when it has neither a start nor an end date (each side
    ``None`` when nothing beneath carries one). An initiative with descendants
    but nothing to derive still carries its ``descendant_count``.
    """

    descendant_count: int
    planned: Figures | None
    actual: Figures | None
    start_date: str | None
    end_date: str | None


def children_index(
    parents: Mapping[uuid.UUID, uuid.UUID | None],
) -> dict[uuid.UUID, list[uuid.UUID]]:
    """Map each parent id to the ids naming it as their parent."""
    children: dict[uuid.UUID, list[uuid.UUID]] = defaultdict(list)
    for child, parent in parents.items():
        if parent is not None:
            children[parent].append(child)
    return children


def walk(children: Mapping[uuid.UUID, list[uuid.UUID]], root: uuid.UUID) -> list[uuid.UUID]:
    """Every id reachable from ``root`` through ``children``, ``root`` excluded.

    Iterative and cycle-safe: an id is visited once, and ``root`` is marked as
    seen before the walk starts, so a cycle back to it ends there.
    """
    seen = {root}
    out: list[uuid.UUID] = []
    stack = [root]
    while stack:
        for child in children.get(stack.pop(), ()):
            if child not in seen:
                seen.add(child)
                out.append(child)
                stack.append(child)
    return out


def descendants_within(
    parents: Mapping[uuid.UUID, uuid.UUID | None], root: uuid.UUID
) -> list[uuid.UUID]:
    """Every initiative beneath ``root`` in the child → parent map ``parents``."""
    return walk(children_index(parents), root)


def anchor_groups(
    parents: Mapping[uuid.UUID, uuid.UUID | None],
    subtype_of: Mapping[uuid.UUID, str | None],
    key: str,
) -> dict[uuid.UUID, uuid.UUID]:
    """Map each id to the highest initiative of subtype ``key`` on its chain.

    The PPM board's "group by a subtype" groups every initiative under the
    top-most initiative of that subtype above it — the row itself included, so
    such an initiative anchors its own group and a nested one of the same subtype
    is a row in the top-most one's group. An id with none on its chain is absent.

    The walk goes **up** the child → parent map ``parents``, so a chain broken by
    an initiative absent from it (archived, hidden, outside a portal's filters)
    stops there, the rule ``parent_id`` follows, and so does a parent id that is not
    itself a key of ``parents``. The subtype is matched exactly;
    each walk keeps its own ``seen`` set, so a cycle ends it.
    """
    out: dict[uuid.UUID, uuid.UUID] = {}
    for start in parents:
        seen: set[uuid.UUID] = set()
        node: uuid.UUID | None = start
        top: uuid.UUID | None = None
        # An id that is not a key of ``parents`` is not on the board: the walk
        # ends there, which also covers ``None`` (a root).
        while node is not None and node in parents and node not in seen:
            seen.add(node)
            if subtype_of.get(node) == key:
                top = node
            node = parents[node]
        if top is not None:
            out[start] = top
    return out


def sum_figures(ids: Iterable[uuid.UUID], figures: Mapping[uuid.UUID, Figures]) -> Figures:
    """The four cost keys summed over ``ids``; an id without lines adds nothing."""
    total = dict.fromkeys(COST_KEYS, 0.0)
    for i in ids:
        own = figures.get(i)
        if own is None:
            continue
        for key in COST_KEYS:
            total[key] += own[key]
    return total


def date_span(ids: Iterable[uuid.UUID], dates: Mapping[uuid.UUID, DateSpan]) -> DateSpan:
    """The earliest start and the latest end over ``ids``.

    Dates are ISO strings, which compare in date order; a missing date is
    ignored, and a span with no date at all on one side reads ``None`` there.
    Every id must have an entry in ``dates``.
    """
    starts: list[str] = []
    ends: list[str] = []
    for i in ids:
        start, end = dates[i]
        if start:
            starts.append(start)
        if end:
            ends.append(end)
    return (min(starts) if starts else None, max(ends) if ends else None)


def _derives(i: uuid.UUID, beneath: list[uuid.UUID], has: Mapping[uuid.UUID, bool]) -> bool:
    """No line of this kind on ``i`` itself, and at least one on some id ``beneath``."""
    return not has.get(i, False) and any(has.get(d, False) for d in beneath)


def rollup_for_board(
    parents: Mapping[uuid.UUID, uuid.UUID | None],
    figures: Mapping[uuid.UUID, Figures],
    presence: Mapping[uuid.UUID, LinePresence],
    dates: Mapping[uuid.UUID, DateSpan],
) -> dict[uuid.UUID, Rollup]:
    """The derived figures and dates for every board row with rows beneath it.

    ``presence`` says which kinds of line each initiative has (a zero amount
    still counts as data entered; an initiative with neither is absent). The
    budget pair is derived only when the row has no budget line and some
    initiative beneath has one, the actual pair likewise for cost lines, and the
    dates only when some initiative beneath has a date, so a row never claims
    figures that nobody recorded.
    """
    children = children_index(parents)
    has_budget = {i: p.has_budget for i, p in presence.items()}
    has_cost = {i: p.has_cost for i, p in presence.items()}
    out: dict[uuid.UUID, Rollup] = {}
    for i in parents:
        beneath = walk(children, i)
        if not beneath:
            continue
        own_start, own_end = dates[i]
        no_own_dates = not own_start and not own_end
        start, end = date_span(beneath, dates) if no_own_dates else (None, None)
        summed = sum_figures(beneath, figures)
        out[i] = Rollup(
            descendant_count=len(beneath),
            planned=(
                {k: summed[k] for k in PLANNED_KEYS} if _derives(i, beneath, has_budget) else None
            ),
            actual=(
                {k: summed[k] for k in ACTUAL_KEYS} if _derives(i, beneath, has_cost) else None
            ),
            start_date=start,
            end_date=end,
        )
    return out


#: One ``ppm.byYear`` entry's keys → the roll-up's per-year keys.
_YEAR_KEYS = {
    "capexBudget": "capex_budget",
    "opexBudget": "opex_budget",
    "capexActual": "capex_actual",
    "opexActual": "opex_actual",
}
#: The undated actuals of a ``build_ppm_map`` payload → the per-year keys.
_UNDATED_KEYS = {
    "unscheduledCapexActual": "capex_actual",
    "unscheduledOpexActual": "opex_actual",
}


def sum_by_year(payloads: Iterable[Mapping[str, Any]]) -> list[dict[str, Any]]:
    """Budget and actuals per fiscal year, summed over ``build_ppm_map`` payloads.

    One entry per fiscal year any payload carries, ascending, plus a
    ``year=None`` entry last for cost lines without a date. An entry whose four
    figures are all zero is dropped: nobody recorded anything there that the
    split can show (a category outside CapEx / OpEx counts in neither).
    """
    years: dict[int | None, dict[str, float]] = defaultdict(
        lambda: dict.fromkeys(_YEAR_KEYS.values(), 0.0)
    )
    for payload in payloads:
        for entry in payload["byYear"]:
            slot = years[entry["year"]]
            for source, target in _YEAR_KEYS.items():
                slot[target] += entry[source]
        undated = years[None]
        for source, target in _UNDATED_KEYS.items():
            undated[target] += payload[source]
    order = [*sorted(y for y in years if y is not None), None]
    return [{"year": y, **years[y]} for y in order if any(years[y].values())]
