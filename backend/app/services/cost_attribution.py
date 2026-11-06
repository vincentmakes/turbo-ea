"""How a related card's cost is attributed to the cards it links to.

The cost treemap's ``aggregate`` mode, its ``group_by`` mode and the capability
heatmap's Total Cost all roll a card's cost up onto the cards it is related
to. When one related card links to several of them (one Initiative improving
two Business Capabilities, discussion #1362) there are two honest readings:

* ``full`` (the default): every linked card carries the related card's whole
  cost — "how much money depends on this card". The tiles then overlap, so a
  report total counts each related card once (:func:`distinct_total`) instead
  of adding the tiles up.
* ``split``: the cost is shared equally between the linked cards
  (:func:`split_share`), so the tiles are disjoint and add up to the total.

The arithmetic lives here, apart from the route bodies, so every branch has a
unit test of its own.
"""

from __future__ import annotations

from collections.abc import Iterable, Mapping

FULL = "full"
SPLIT = "split"
ATTRIBUTIONS = frozenset({FULL, SPLIT})

UNGROUPED = "Ungrouped"


def parse_attribution(value: str) -> str:
    """``value`` when it names an attribution, else ``ValueError``.

    Case-sensitive on purpose: the frontend and the MCP tools send the lower-case
    keys, and a near miss should fail loudly rather than silently mean ``full``.
    """
    if value not in ATTRIBUTIONS:
        raise ValueError(f"Invalid attribution: {value!r}")
    return value


def split_share(cost: float, count: int) -> float:
    """One linked card's share of ``cost`` shared among ``count`` cards.

    A count below one (nothing readable links the card) keeps the whole cost
    rather than dividing by zero.
    """
    return cost / max(count, 1)


def link_counts(per_primary: Mapping[str, Iterable[str]]) -> dict[str, int]:
    """Related card id → number of primary cards linking it.

    ``per_primary`` maps each primary card id to the related card ids it links,
    already de-duplicated per primary, so a related card reached through two
    relation types counts once for that primary.
    """
    counts: dict[str, int] = {}
    for related in per_primary.values():
        for rid in set(related):
            counts[rid] = counts.get(rid, 0) + 1
    return counts


def attribute_related_costs(
    per_primary: Mapping[str, Iterable[str]],
    related_cost_by_id: Mapping[str, float],
    counts: Mapping[str, int],
    attribution: str,
) -> dict[str, float]:
    """Primary card id → the related cost attributed to it.

    ``full`` adds each linked related card's whole cost; ``split`` adds its
    :func:`split_share` over ``counts`` (the number of primaries linking it).
    """
    result: dict[str, float] = {}
    for pid, related in per_primary.items():
        total = 0.0
        for rid in set(related):
            cost = related_cost_by_id.get(rid, 0.0)
            if attribution == SPLIT:
                # A related card missing from ``counts`` is linked here only.
                cost = split_share(cost, counts.get(rid, 1))
            total += cost
        result[pid] = total
    return result


def distinct_total(
    per_primary: Mapping[str, Iterable[str]], related_cost_by_id: Mapping[str, float]
) -> float:
    """The cost of every related card linked to any primary, each counted once."""
    union: set[str] = set()
    for related in per_primary.values():
        union.update(related)
    return sum(related_cost_by_id.get(rid, 0.0) for rid in union)


def primary_group(groups: Iterable[str]) -> str:
    """The one group a card is filed under: the alphabetically first, or
    ``"Ungrouped"`` when it has none — deterministic, unlike the last relation
    row read."""
    ordered = sorted(groups)
    return ordered[0] if ordered else UNGROUPED


def group_costs(items: Iterable[Mapping], attribution: str) -> dict[str, float]:
    """Group name → cost of the items in it.

    Each item carries ``cost`` and ``groups`` (the names of every group card it
    links to). ``full`` counts an item in every one of its groups; ``split``
    shares its cost equally between them. An item with no group goes, whole,
    to ``"Ungrouped"``.
    """
    result: dict[str, float] = {}
    for item in items:
        cost = item["cost"]
        names = set(item.get("groups") or ())
        if not names:
            result[UNGROUPED] = result.get(UNGROUPED, 0.0) + cost
            continue
        share = split_share(cost, len(names)) if attribution == SPLIT else cost
        for name in names:
            result[name] = result.get(name, 0.0) + share
    return result
