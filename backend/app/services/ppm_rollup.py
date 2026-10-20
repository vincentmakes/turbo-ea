"""What the initiatives beneath a PPM parent add up to.

A parent initiative on the PPM board shows its **own** budget and cost lines and
its **own** dates when it has any. When it has none, the board shows what the
initiatives beneath it add up to instead: the summed figures for costs, the
earliest start and latest end for dates. The two rules are independent — a
program may carry its own dates and still derive its costs. Own data wins
because a program that carries its own lines usually already covers its
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

#: The four cost keys ``build_cost_aggregates`` returns per initiative.
COST_KEYS = ("capex_planned", "capex_actual", "opex_planned", "opex_actual")

Figures = dict[str, float]
DateSpan = tuple[str | None, str | None]


@dataclass(frozen=True)
class Rollup:
    """What the board shows for a parent in place of data it has not got.

    ``figures`` is set only when the parent has no budget or cost line of its
    own and some initiative beneath it has, and the dates only when it has
    neither a start nor an end date (each side ``None`` when nothing beneath
    carries one). An
    initiative with descendants but nothing to derive still carries its
    ``descendant_count``.
    """

    descendant_count: int
    figures: Figures | None
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


def rollup_for_board(
    parents: Mapping[uuid.UUID, uuid.UUID | None],
    figures: Mapping[uuid.UUID, Figures],
    dates: Mapping[uuid.UUID, DateSpan],
) -> dict[uuid.UUID, Rollup]:
    """The derived figures and dates for every board row with rows beneath it.

    ``figures`` is keyed only for initiatives with at least one budget or cost
    line, so ``i not in figures`` is exactly "no lines of its own" (a zero
    amount still counts as data entered). Costs are derived only when some
    initiative beneath has lines, and dates only when some has a date, so a
    row never claims figures that nobody recorded.
    """
    children = children_index(parents)
    out: dict[uuid.UUID, Rollup] = {}
    for i in parents:
        beneath = walk(children, i)
        if not beneath:
            continue
        own_start, own_end = dates[i]
        no_own_dates = not own_start and not own_end
        start, end = date_span(beneath, dates) if no_own_dates else (None, None)
        # Derive costs only when the row has no lines of its own and some
        # initiative beneath it has: zeros summed from nothing are not data.
        derive_costs = i not in figures and any(d in figures for d in beneath)
        out[i] = Rollup(
            descendant_count=len(beneath),
            figures=sum_figures(beneath, figures) if derive_costs else None,
            start_date=start,
            end_date=end,
        )
    return out
