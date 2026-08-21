/**
 * Pure maths behind the PPM Budget & Costs charts.
 *
 * Kept free of React and of `Date.now()` (today is always injected) so every
 * rule below is unit-testable without a DOM or a clock.
 *
 * The fiscal-year convention is a deliberate mirror of
 * `backend/app/services/calculation_ppm.py` — a fiscal year is named after the
 * year it *ends* in, so with a start month of October 2025-10-15 opens FY2026
 * and 2025-09-30 closes FY2025. Diverging here would make the charts disagree
 * with the `fiscal_year` column stored on budget lines and with the
 * `ppm.byYear` calculation context.
 */
import type { PpmCostLine, PpmBudgetLine } from "@/types";

export type Bucket = "capex" | "opex";
export type SeriesMode = "both" | "capex" | "opex";
/** "current" = whichever fiscal year contains today; resolved at render time. */
export type FiscalYearChoice = number | "all" | "current";

export interface YearMonth {
  year: number;
  /** 1-12. */
  month: number;
}

export interface MonthPoint extends YearMonth {
  /** Stable `YYYY-MM` key, used as the Recharts dataKey for the X axis. */
  key: string;
  capex: number | null;
  opex: number | null;
  total: number | null;
}

export interface BudgetTotals {
  capex: number;
  opex: number;
  total: number;
}

/**
 * Map a free-text category onto capex/opex, or null when it is neither.
 *
 * `category` is a plain text column and the API response schema types it as a
 * bare string, so an imported or hand-edited row can hold anything.
 * Unrecognised categories still count towards the totals; they simply land in
 * neither split — same rule as `_bucket_for` on the backend.
 */
export function bucketFor(category: string | null | undefined): Bucket | null {
  const key = (category || "").trim().toLowerCase();
  return key === "capex" || key === "opex" ? key : null;
}

/** Fiscal year for a (year, month), named after the year the year *ends* in. */
function fiscalYearOf(year: number, month: number, startMonth: number): number {
  return year + (startMonth > 1 && startMonth <= 12 && month >= startMonth ? 1 : 0);
}

/**
 * `YYYY-MM-DD` (or a longer ISO timestamp) to its year and 1-12 month.
 *
 * Parsed by hand rather than via `new Date()` so a bare `YYYY-MM-DD` is never
 * shifted across a month boundary by the local timezone.
 */
export function parseIsoMonth(iso: string | null | undefined): YearMonth | null {
  if (!iso) return null;
  const m = /^(\d{4})-(\d{2})/.exec(iso);
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  if (!Number.isInteger(month) || month < 1 || month > 12) return null;
  return { year, month };
}

/**
 * Fiscal year an ISO date string falls in, or null when the date is missing or
 * unparseable.
 */
export function fiscalYearFor(
  iso: string | null | undefined,
  startMonth: number,
): number | null {
  const parsed = parseIsoMonth(iso);
  return parsed ? fiscalYearOf(parsed.year, parsed.month, startMonth) : null;
}

/** `count` consecutive months starting at `start`. */
export function monthsFrom(start: YearMonth, count: number): YearMonth[] {
  const out: YearMonth[] = [];
  let { year, month } = start;
  for (let i = 0; i < count; i++) {
    out.push({ year, month });
    month += 1;
    if (month > 12) {
      month = 1;
      year += 1;
    }
  }
  return out;
}

/** The 12 ordered months of a fiscal year. */
export function fiscalYearMonths(fy: number, startMonth: number): YearMonth[] {
  const valid = Number.isInteger(startMonth) && startMonth >= 1 && startMonth <= 12;
  const start: YearMonth =
    !valid || startMonth === 1 ? { year: fy, month: 1 } : { year: fy - 1, month: startMonth };
  return monthsFrom(start, 12);
}

/** Sortable `YYYY-MM` key for a month. */
export function monthKey({ year, month }: YearMonth): string {
  return `${year}-${String(month).padStart(2, "0")}`;
}

/** Months elapsed between two months; negative when `b` precedes `a`. */
function monthDiff(a: YearMonth, b: YearMonth): number {
  return (b.year - a.year) * 12 + (b.month - a.month);
}

/**
 * Every fiscal year that has budget or cost data, ascending.
 *
 * Budget lines carry their fiscal year as a stored column; cost lines have
 * theirs derived from the date. Undated cost lines contribute no year.
 */
export function availableFiscalYears(
  costLines: PpmCostLine[],
  budgetLines: PpmBudgetLine[],
  startMonth: number,
): number[] {
  const years = new Set<number>();
  for (const bl of budgetLines) {
    if (Number.isInteger(bl.fiscal_year)) years.add(bl.fiscal_year);
  }
  for (const cl of costLines) {
    const fy = fiscalYearFor(cl.date, startMonth);
    if (fy !== null) years.add(fy);
  }
  return [...years].sort((a, b) => a - b);
}

/**
 * Every month from the first to the last dated cost line, inclusive. Empty
 * when no cost line carries a date — there is no timeline to draw.
 */
export function projectMonthRange(costLines: PpmCostLine[]): YearMonth[] {
  let first: YearMonth | null = null;
  let last: YearMonth | null = null;
  for (const cl of costLines) {
    const ym = parseIsoMonth(cl.date);
    if (!ym) continue;
    if (!first || monthDiff(first, ym) < 0) first = ym;
    if (!last || monthDiff(last, ym) > 0) last = ym;
  }
  if (!first || !last) return [];
  return monthsFrom(first, monthDiff(first, last) + 1);
}

/** Cost lines with no usable date — excluded from every time series. */
export function countUndated(costLines: PpmCostLine[]): number {
  return costLines.filter((cl) => parseIsoMonth(cl.date) === null).length;
}

/**
 * Budget totals for one fiscal year, or across every year when `fy` is "all".
 *
 * `total` sums every budget line so it reconciles with the Total Budget KPI,
 * including any row whose category is neither capex nor opex.
 */
export function budgetTotals(
  budgetLines: PpmBudgetLine[],
  fy: number | "all",
): BudgetTotals {
  const totals: BudgetTotals = { capex: 0, opex: 0, total: 0 };
  for (const bl of budgetLines) {
    if (fy !== "all" && bl.fiscal_year !== fy) continue;
    const amount = Number(bl.amount) || 0;
    const bucket = bucketFor(bl.category);
    totals.total += amount;
    if (bucket) totals[bucket] += amount;
  }
  return totals;
}

function clampToRange(idx: number, length: number): number {
  if (idx < 0) return -1;
  return idx >= length ? length - 1 : idx;
}

/**
 * Running cumulative spend over an ordered list of months.
 *
 * Where the line stops: cumulative values run to
 * `max(index of the current month, last index carrying data)`, and every month
 * after that is null. That single rule covers each case the charts hit — an
 * in-progress fiscal year ends at the current month instead of running flat to
 * year end, a completed past year draws all twelve months, and a legitimately
 * future-dated cost line still gets a point rather than silently vanishing.
 *
 * `total` sums every dated cost line regardless of category, so chart 2
 * reconciles with the Total Actual KPI.
 */
export function buildCumulativeSeries(opts: {
  costLines: PpmCostLine[];
  months: YearMonth[];
  today: Date;
}): MonthPoint[] {
  const { costLines, months, today } = opts;
  if (months.length === 0) return [];

  const index = new Map<string, number>();
  months.forEach((ym, i) => index.set(monthKey(ym), i));

  const perMonth = months.map(() => ({ capex: 0, opex: 0, total: 0 }));
  let lastWithData = -1;

  for (const cl of costLines) {
    const ym = parseIsoMonth(cl.date);
    if (!ym) continue;
    const i = index.get(monthKey(ym));
    if (i === undefined) continue;
    const amount = Number(cl.actual) || 0;
    const bucket = bucketFor(cl.category);
    perMonth[i].total += amount;
    if (bucket) perMonth[i][bucket] += amount;
    if (i > lastWithData) lastWithData = i;
  }

  // Where "now" sits on this axis: before the range starts => -1, after it
  // ends => the final index, so a past year draws in full.
  const currentIdx = clampToRange(
    monthDiff(months[0], { year: today.getFullYear(), month: today.getMonth() + 1 }),
    months.length,
  );
  const lastPlotted = Math.max(currentIdx, lastWithData);

  let capex = 0;
  let opex = 0;
  let total = 0;
  return months.map((ym, i) => {
    capex += perMonth[i].capex;
    opex += perMonth[i].opex;
    total += perMonth[i].total;
    const plotted = i <= lastPlotted;
    return {
      ...ym,
      key: monthKey(ym),
      capex: plotted ? capex : null,
      opex: plotted ? opex : null,
      total: plotted ? total : null,
    };
  });
}
