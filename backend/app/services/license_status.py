"""License status maths: the only definition of a status (pure, no database).

Per license type, no compensation between types. A type is ``over`` when actual
exceeds licensed (licensed 0 with any actual is "no license", also ``over``),
``approaching`` from 80 % of licensed up to and including 100 %. A missing
actual (``None``) is "no data", never 0.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

APPROACHING = 0.8

TypeStatus = Literal["over", "approaching", "compliant", "no_data"]
MetricStatus = Literal["over", "approaching", "no_actual_data", "compliant"]

# Higher wins when the statuses of several metrics are folded into the card's.
_PRIORITY: dict[str, int] = {"over": 3, "approaching": 2, "no_actual_data": 1, "compliant": 0}


@dataclass(frozen=True)
class TypeResult:
    key: str
    licensed: int
    actual: int | None
    pct: float | None  # actual / licensed * 100, one decimal; None when no actual or no license
    no_licence: bool  # licensed == 0 and actual > 0
    status: TypeStatus


@dataclass(frozen=True)
class MetricResult:
    metric: str
    types: list[TypeResult]  # catalogue order, then unknown keys sorted
    has_actual: bool
    status: MetricStatus
    worst_pct: float | None
    worst_no_licence: bool
    licensed_total: int
    actual_total: int | None  # None when no type has an actual


def type_result(key: str, cell: dict | None) -> TypeResult:
    cell = cell or {}
    licensed = cell.get("licensed") or 0
    actual = cell.get("actual")
    if actual is None:
        return TypeResult(key, licensed, None, None, False, "no_data")
    if licensed == 0:
        if actual > 0:
            return TypeResult(key, licensed, actual, None, True, "over")
        return TypeResult(key, licensed, actual, 0.0, False, "compliant")
    pct = round(actual / licensed * 100, 1)
    if actual > licensed:
        status: TypeStatus = "over"
    elif actual >= APPROACHING * licensed:
        status = "approaching"
    else:
        status = "compliant"
    return TypeResult(key, licensed, actual, pct, False, status)


def metric_result(metric: str, cells: dict[str, dict], order: list[str]) -> MetricResult:
    keys = [k for k in order if k in cells] + sorted(k for k in cells if k not in order)
    types = [type_result(k, cells[k]) for k in keys]
    actuals = [t.actual for t in types if t.actual is not None]
    if not actuals:
        status: MetricStatus = "no_actual_data"
    elif any(t.status == "over" for t in types):
        status = "over"
    elif any(t.status == "approaching" for t in types):
        status = "approaching"
    else:
        status = "compliant"
    pcts = [t.pct for t in types if t.pct is not None]
    return MetricResult(
        metric=metric,
        types=types,
        has_actual=bool(actuals),
        status=status,
        worst_pct=max(pcts) if pcts else None,
        worst_no_licence=any(t.no_licence for t in types),
        licensed_total=sum(t.licensed for t in types),
        actual_total=sum(actuals) if actuals else None,
    )


def card_status(metrics: list[MetricResult]) -> MetricStatus:
    """The highest-priority status among the metrics (``no_actual_data`` for none)."""
    return max((m.status for m in metrics), key=_PRIORITY.__getitem__, default="no_actual_data")
