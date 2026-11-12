"""An Initiative's PPM budget and actual cost for one fiscal year.

The PPM cost sync (``_sync_initiative_costs`` in ``app/api/v1/ppm.py``) writes
the sum of *every* budget line into an Initiative's ``costBudget`` and every
cost-line actual into ``costActual``: on the card those fields are the
project's all-years totals. A surface that names a fiscal year for a cost —
the Cost report (``GET /reports/cost-treemap``, ``GET /reports/cost``) and the
homepage dashboard's cost sum / average — must not show that total as the
year's cost (discussion #1362: 25 000 budgeted in FY 2026 and 25 000 in
FY 2027 showed as 50 000 for FY 2026). Those surfaces read the field through
:class:`FiscalCosts` instead:

* an Initiative with budget lines counts the lines whose ``fiscal_year`` is
  the year (``0`` when none is) as its ``costBudget``;
* an Initiative with cost lines counts the actuals of the lines dated in the
  year as its ``costActual``; an undated line belongs to no fiscal year and
  adds nothing to the year, though it still marks the Initiative as having
  lines and counts in its all-lines total;
* an Initiative without lines of that kind keeps its stored (hand-entered)
  figure, read through ``cost_value`` like every other cost.

Beside the year's figure, each sliced card keeps the total of *all* its lines,
read from the lines themselves rather than the stored attribute (lines written
by the demo seeder, the workspace applier or an import never ran the cost
sync, so the attribute can be stale or missing). :meth:`FiscalCosts.lifetime`
gives that total only when it tells the reader something — when some of it
lies outside the year.

The card attribute itself is never changed. Whether the Initiative counts in
the year at all is still ``is_live_in_fiscal_year``'s decision; the lines
decide only how much. A cost line's fiscal year follows ``build_ppm_map``'s
convention (``fiscal_year._fiscal_year`` over the line's year and month), so a
``ppm.byYear`` formula and the report cannot disagree.

The arithmetic is pure and lives apart from the route bodies so every branch
carries a unit test that mutation testing can score.
"""

from __future__ import annotations

from collections.abc import Iterable, Mapping
from dataclasses import dataclass, field

from sqlalchemy import extract, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.ppm_cost_line import PpmBudgetLine, PpmCostLine
from app.services.cost_value import cost_value
from app.services.fiscal_year import _fiscal_year

INITIATIVE_TYPE = "Initiative"
BUDGET_FIELD = "costBudget"
ACTUAL_FIELD = "costActual"
# The two Initiative fields the PPM lines own: the cost sync writes them and a
# calculation must not (``card_write_service``), and a fiscal-year surface
# slices them here.
PPM_COST_FIELDS: frozenset[str] = frozenset({BUDGET_FIELD, ACTUAL_FIELD})


@dataclass(frozen=True)
class LineSums:
    """One initiative's lines of one kind: their amount in the fiscal year and
    across every line (undated cost lines included)."""

    in_year: float = 0.0
    all_lines: float = 0.0


def _add(result: dict[str, LineSums], key: str, amount: float, in_year: bool) -> None:
    prev = result.get(key, LineSums())
    result[key] = LineSums(
        in_year=prev.in_year + (amount if in_year else 0.0),
        all_lines=prev.all_lines + amount,
    )


def budget_in_year(
    rows: Iterable[tuple[object, int, float | None]], fiscal_year: int
) -> dict[str, LineSums]:
    """Initiative id → its budget lines in ``fiscal_year`` and in all years.

    ``rows`` are ``(initiative_id, fiscal_year, amount)``, one per line or
    grouped per year. Every initiative with at least one row is a key, at
    ``in_year == 0.0`` when none falls in the year: having lines, not a
    non-zero sum, is what replaces the stored figure.
    """
    result: dict[str, LineSums] = {}
    for initiative_id, year, amount in rows:
        _add(result, str(initiative_id), float(amount or 0), year == fiscal_year)
    return result


def actual_in_year(
    rows: Iterable[tuple[object, int | float | None, int | float | None, float | None]],
    fiscal_year: int,
    start_month: int,
) -> dict[str, LineSums]:
    """Initiative id → its cost lines' actuals dated in ``fiscal_year`` and in all.

    ``rows`` are ``(initiative_id, year, month, actual)``, grouped per calendar
    month in SQL (``year`` / ``month`` are ``None`` for an undated line). An
    undated row belongs to no fiscal year: it registers the initiative and
    counts in its all-lines total only.
    """
    result: dict[str, LineSums] = {}
    for initiative_id, year, month, actual in rows:
        in_year = False
        if year is not None and month is not None:
            in_year = _fiscal_year(int(year), int(month), start_month) == fiscal_year
        _add(result, str(initiative_id), float(actual or 0), in_year)
    return result


@dataclass(frozen=True)
class FiscalCosts:
    """The year's slice of the PPM-owned fields, per initiative that has lines.

    ``by_field`` maps a field key (``costBudget`` / ``costActual``) to
    ``{initiative id: LineSums}``; an initiative absent from a field's map has
    no lines of that kind and keeps its stored value.
    """

    by_field: Mapping[str, Mapping[str, LineSums]] = field(default_factory=dict)

    def is_sliced(self, card_id: object, field_key: str) -> bool:
        """Whether ``field_key`` on ``card_id`` is read from its PPM lines."""
        return str(card_id) in self.by_field.get(field_key, {})

    def value(self, card_id: object, field_key: str, attributes: Mapping | None) -> float:
        """The cost the year counts for ``field_key`` on the card: the slice of
        its lines when it has any, else the stored attribute."""
        sums = self.by_field.get(field_key, {}).get(str(card_id))
        if sums is not None:
            return sums.in_year
        return cost_value((attributes or {}).get(field_key))

    def lifetime(self, card_id: object, field_key: str) -> float | None:
        """The total of all the card's lines of that kind, when some of it lies
        outside the year; ``None`` when the field was not sliced or the year's
        figure already is the whole."""
        sums = self.by_field.get(field_key, {}).get(str(card_id))
        if sums is None or sums.all_lines == sums.in_year:
            return None
        return sums.all_lines

    def total(
        self, card_id: object, field_keys: Iterable[str], attributes: Mapping | None
    ) -> tuple[float, float | None]:
        """``(the year's cost, the all-years total)`` summed over ``field_keys``.

        The all-years total is ``None`` unless some field has a :meth:`lifetime`;
        a field without one adds its year's figure to both.
        """
        # Integer zeros, like ``cost_value``: a sum of whole costs stays whole.
        year: float = 0
        whole: float = 0
        partial = False
        for key in field_keys:
            cost = self.value(card_id, key, attributes)
            year += cost
            lifetime = self.lifetime(card_id, key)
            if lifetime is None:
                whole += cost
            else:
                partial = True
                whole += lifetime
        return year, (whole if partial else None)


EMPTY = FiscalCosts()


def applies(card_type: str | None, field_keys: Iterable[str]) -> bool:
    """Whether reading ``field_keys`` of ``card_type`` needs the PPM lines."""
    return card_type == INITIATIVE_TYPE and any(k in PPM_COST_FIELDS for k in field_keys)


async def load_fiscal_costs(
    db: AsyncSession,
    *,
    card_type: str | None,
    field_keys: Iterable[str],
    initiative_ids: Iterable[object],
    fiscal_year: int,
    start_month: int,
) -> FiscalCosts:
    """The year's slice for the PPM fields among ``field_keys``.

    Issues no query at all unless ``card_type`` is ``Initiative`` and a field is
    PPM-owned, so every other report runs exactly the SQL it ran before; then
    at most one grouped query per field kind, restricted to ``initiative_ids``
    (the caller's already read-scoped cards). Never commits or rolls back.
    """
    keys = set(field_keys)
    ids = list(initiative_ids)
    if not applies(card_type, keys) or not ids:
        return EMPTY
    by_field: dict[str, dict[str, LineSums]] = {}
    if BUDGET_FIELD in keys:
        budget_rows = await db.execute(
            select(
                PpmBudgetLine.initiative_id,
                PpmBudgetLine.fiscal_year,
                func.coalesce(func.sum(PpmBudgetLine.amount), 0),
            )
            .where(PpmBudgetLine.initiative_id.in_(ids))
            .group_by(PpmBudgetLine.initiative_id, PpmBudgetLine.fiscal_year)
        )
        by_field[BUDGET_FIELD] = budget_in_year(budget_rows.all(), fiscal_year)
    if ACTUAL_FIELD in keys:
        year_col = extract("year", PpmCostLine.date)
        month_col = extract("month", PpmCostLine.date)
        cost_rows = await db.execute(
            select(
                PpmCostLine.initiative_id,
                year_col,
                month_col,
                func.coalesce(func.sum(PpmCostLine.actual), 0),
            )
            .where(PpmCostLine.initiative_id.in_(ids))
            .group_by(PpmCostLine.initiative_id, year_col, month_col)
        )
        by_field[ACTUAL_FIELD] = actual_in_year(cost_rows.all(), fiscal_year, start_month)
    return FiscalCosts(by_field=by_field)
