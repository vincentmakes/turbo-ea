/**
 * Pure grouping behind the Budget & Costs tables: one group per fiscal year,
 * each carrying its CapEx / OpEx / Total subtotals.
 *
 * The bucket rule and the fiscal-year rule are `costChartData`'s, never
 * re-implemented here, so a table subtotal always reconciles with the charts
 * drawn above it and with the summary bar.
 */
import type { PpmBudgetLine, PpmCostLine } from "@/types";
import { bucketFor, fiscalYearFor, type BudgetTotals } from "./costChartData";

/** A fiscal year, or the cost lines that carry no usable date. */
export type GroupKey = number | "undated";

export interface LineGroup<T> {
  key: GroupKey;
  lines: T[];
  totals: BudgetTotals;
}

/**
 * CapEx / OpEx / Total of some lines. `total` sums every line; a line whose
 * category is neither capex nor opex counts towards `total` only — the
 * `budgetTotals` rule.
 */
function sumLines<T>(
  lines: T[],
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

/** Bucket `lines` by `keyOf`, preserving the input order inside each bucket. */
function bucketLines<T>(lines: T[], keyOf: (line: T) => GroupKey): Map<GroupKey, T[]> {
  const byKey = new Map<GroupKey, T[]>();
  for (const line of lines) {
    const key = keyOf(line);
    const bucket = byKey.get(key);
    if (bucket) bucket.push(line);
    else byKey.set(key, [line]);
  }
  return byKey;
}

/** Fiscal years ascending, the undated group last. */
function compareKeys(a: GroupKey, b: GroupKey): number {
  if (a === "undated") return 1;
  if (b === "undated") return -1;
  return a - b;
}

/**
 * Budget lines grouped by their stored `fiscal_year`, ascending. Lines inside
 * a group keep the order the API returned them in.
 */
export function groupBudgetLines(lines: PpmBudgetLine[]): LineGroup<PpmBudgetLine>[] {
  const byKey = bucketLines(lines, (line) => line.fiscal_year);
  return [...byKey.keys()].sort(compareKeys).map((key) => {
    const groupLines = byKey.get(key) as PpmBudgetLine[];
    return {
      key,
      lines: groupLines,
      totals: sumLines(groupLines, (line) => line.amount, (line) => line.category),
    };
  });
}

/**
 * Cost lines grouped by the fiscal year their date falls in, ascending, with
 * the lines that carry no usable date in an `"undated"` group last. Inside a
 * year, lines run by date and equal dates keep their input order; the undated
 * group keeps its input order.
 */
export function groupCostLines(
  lines: PpmCostLine[],
  startMonth: number,
): LineGroup<PpmCostLine>[] {
  const byKey = bucketLines(
    lines,
    (line) => fiscalYearFor(line.date, startMonth) ?? "undated",
  );
  return [...byKey.keys()].sort(compareKeys).map((key) => {
    const inputOrder = byKey.get(key) as PpmCostLine[];
    // Array.prototype.sort is stable, so equal dates keep their input order.
    // The undated group has no date to order by and keeps its input order.
    const groupLines =
      key === "undated"
        ? inputOrder
        : [...inputOrder].sort((a, b) => (a.date as string).localeCompare(b.date as string));
    return {
      key,
      lines: groupLines,
      totals: sumLines(groupLines, (line) => line.actual, (line) => line.category),
    };
  });
}

/** The totals across every group: the all-years row under a table. */
export function grandTotals(groups: LineGroup<unknown>[]): BudgetTotals {
  const totals: BudgetTotals = { capex: 0, opex: 0, total: 0 };
  for (const group of groups) {
    totals.capex += group.totals.capex;
    totals.opex += group.totals.opex;
    totals.total += group.totals.total;
  }
  return totals;
}

/**
 * The group a table opens with: the current fiscal year when it has lines,
 * else the latest year that has, else the undated group when it is all there
 * is — so a table never loads fully collapsed while it holds lines.
 */
export function defaultExpandedKey(
  groups: LineGroup<unknown>[],
  currentFy: number,
): GroupKey | null {
  const years = groups
    .map((group) => group.key)
    .filter((key): key is number => key !== "undated");
  if (years.includes(currentFy)) return currentFy;
  if (years.length > 0) return Math.max(...years);
  return groups.length > 0 ? "undated" : null;
}
