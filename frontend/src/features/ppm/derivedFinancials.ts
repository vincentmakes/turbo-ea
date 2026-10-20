/**
 * What an initiative's own pages (the Overview and the Budget & Costs tab)
 * show for its budget and its actuals.
 *
 * The board's rule (`rowFigures`), applied per side: an initiative with budget
 * lines of its own shows its own budget; one without shows the budget of the
 * initiatives beneath it, when they recorded any. The actuals are decided the
 * same way from cost lines, independently — so a program that holds the budget
 * while its projects record the spend shows its own budget against their
 * actuals. Nothing here is stored or ever added to the initiative's own
 * figures; the figures beneath come from `GET /ppm/initiatives/{id}/rollup`,
 * which counts only the initiatives the reader may see.
 *
 * A derived side's totals are summed from the same per-year rows its table
 * draws, so the KPI and the table footer can never disagree.
 */
import type { PpmBudgetLine, PpmCostLine, PpmRollupOut } from "@/types";
import { bucketFor, type BudgetTotals } from "./costChartData";
import type { GroupKey } from "./costTableGroups";

/** Budget lines (the planned side) or cost lines (the actual side). */
export type DerivedSide = "budget" | "cost";

/** One read-only row of a derived table: a fiscal year, or the undated cost lines. */
export interface DerivedYearRow extends BudgetTotals {
  key: GroupKey;
}

/** A side's figures and whether they are the initiatives' beneath. */
export interface SideTotals extends BudgetTotals {
  derived: boolean;
}

export interface FinancialTotals {
  budget: SideTotals;
  actual: SideTotals;
}

/**
 * The rows a derived table draws for `side`, in the rollup's order (fiscal
 * years ascending, the undated cost lines last). A year with nothing on this
 * side is left out: the budget side never has an undated row, and a year
 * that only carries actuals is no budget row.
 */
export function derivedYearGroups(
  rollup: PpmRollupOut | null,
  side: DerivedSide,
): DerivedYearRow[] {
  const rows: DerivedYearRow[] = [];
  for (const y of rollup?.by_year ?? []) {
    const capex = side === "budget" ? y.capex_budget : y.capex_actual;
    const opex = side === "budget" ? y.opex_budget : y.opex_actual;
    if (capex === 0 && opex === 0) continue;
    rows.push({ key: y.year ?? "undated", capex, opex, total: capex + opex });
  }
  return rows;
}

/**
 * CapEx / OpEx / Total of an initiative's own lines. `total` sums every line;
 * a line whose category is neither capex nor opex counts towards it only.
 */
export function ownTotals<T>(
  lines: readonly T[],
  amountOf: (line: T) => number,
  categoryOf: (line: T) => string,
): BudgetTotals {
  const totals: BudgetTotals = { capex: 0, opex: 0, total: 0 };
  for (const line of lines) {
    const amount = Number(amountOf(line)) || 0;
    const bucket = bucketFor(categoryOf(line));
    totals.total += amount;
    if (bucket) totals[bucket] += amount;
  }
  return totals;
}

/** The sum of a derived table's rows: its footer, and the side's KPI. */
export function sumRows(rows: readonly DerivedYearRow[]): BudgetTotals {
  const totals: BudgetTotals = { capex: 0, opex: 0, total: 0 };
  for (const row of rows) {
    totals.capex += row.capex;
    totals.opex += row.opex;
    totals.total += row.total;
  }
  return totals;
}

/** Own figures when there are own lines or nothing beneath; else the rows' sum. */
function sideTotals(own: BudgetTotals, ownCount: number, rows: DerivedYearRow[]): SideTotals {
  if (ownCount > 0 || rows.length === 0) return { ...own, derived: false };
  return { ...sumRows(rows), derived: true };
}

/** The budget and actual figures an initiative's page shows, each side decided on its own. */
export function financialTotals(
  budgetLines: readonly PpmBudgetLine[],
  costLines: readonly PpmCostLine[],
  rollup: PpmRollupOut | null,
): FinancialTotals {
  return {
    budget: sideTotals(
      ownTotals(budgetLines, (l) => l.amount, (l) => l.category),
      budgetLines.length,
      derivedYearGroups(rollup, "budget"),
    ),
    actual: sideTotals(
      ownTotals(costLines, (l) => l.actual, (l) => l.category),
      costLines.length,
      derivedYearGroups(rollup, "cost"),
    ),
  };
}
