/**
 * Fiscal-year presentation helpers shared by every screen that shows one.
 *
 * A fiscal year is named after the calendar year it ENDS in — with an October
 * start, 1 October 2025 opens FY2026 — the convention the backend's
 * `app/services/fiscal_year.py` and the PPM charts' `costChartData.ts` use.
 * The workspace's start month comes from Admin → Settings (`fiscalYearStart`,
 * 1-12, January by default).
 */
import type { TFunction } from "i18next";

function validStart(startMonth: number): boolean {
  return Number.isInteger(startMonth) && startMonth >= 1 && startMonth <= 12;
}

/**
 * Local midnight on the first day of fiscal year `fy`: 1 January of `fy` on a
 * January start, otherwise the 1st of the start month in the year before.
 * Mirrors `fiscalYearMonths` so a year always opens on the same day.
 */
export function fiscalYearStartMs(fy: number, startMonth: number): number {
  return !validStart(startMonth) || startMonth === 1
    ? new Date(fy, 0, 1).getTime()
    : new Date(fy - 1, startMonth - 1, 1).getTime();
}

/**
 * The fiscal year a local instant falls in — the inverse of `fiscalYearStartMs`
 * for the instants it returns, and the right answer for any other.
 */
export function fiscalYearOfMs(ms: number, startMonth: number): number {
  const d = new Date(ms);
  const year = d.getFullYear();
  if (!validStart(startMonth) || startMonth === 1) return year;
  return d.getMonth() + 1 >= startMonth ? year + 1 : year;
}

/**
 * How a fiscal year is named on screen: "FY 2026" when it is the calendar
 * year, "FY 2025–2026" when it straddles two — naming only the end year there
 * would read as the calendar year to anyone who does not know the convention.
 */
export function fiscalYearLabel(fy: number, startMonth: number, t: TFunction): string {
  return !validStart(startMonth) || startMonth === 1
    ? t("common:fiscalYear.single", { year: fy })
    : t("common:fiscalYear.span", { from: fy - 1, to: fy });
}
