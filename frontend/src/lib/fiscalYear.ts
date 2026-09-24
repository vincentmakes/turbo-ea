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
 * How a fiscal year is named on screen: "FY 2026" when it is the calendar
 * year, "FY 2025–2026" when it straddles two — naming only the end year there
 * would read as the calendar year to anyone who does not know the convention.
 */
export function fiscalYearLabel(fy: number, startMonth: number, t: TFunction): string {
  return !validStart(startMonth) || startMonth === 1
    ? t("common:fiscalYear.single", { year: fy })
    : t("common:fiscalYear.span", { from: fy - 1, to: fy });
}
