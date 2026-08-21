/**
 * View preferences for the PPM Budget & Costs charts, persisted in
 * localStorage under the app-wide `turboea.<page>.prefs` convention (see
 * `features/todos/TodosPage.tsx`, `admin/AuditLogAdmin.tsx`).
 *
 * Deliberately **global rather than per-initiative**: these are view
 * preferences, not project data, and a key per initiative would grow
 * localStorage without bound as projects accumulate.
 */
import type { FiscalYearChoice, SeriesMode } from "./costChartData";

const PREFS_KEY = "turboea.ppm.costcharts.prefs";

const SERIES_VALUES: readonly SeriesMode[] = ["both", "capex", "opex"];

export interface CostChartPrefs {
  series: SeriesMode;
  fiscalYear: FiscalYearChoice;
  expanded: boolean;
}

export const DEFAULT_COST_CHART_PREFS: CostChartPrefs = {
  series: "both",
  fiscalYear: "current",
  expanded: true,
};

function coerceFiscalYear(value: unknown): FiscalYearChoice {
  if (value === "all" || value === "current") return value;
  // A concrete year is only ever stored when the user picked one explicitly.
  if (typeof value === "number" && Number.isInteger(value) && value > 1900 && value < 3000) {
    return value;
  }
  return "current";
}

export function loadCostChartPrefs(): CostChartPrefs {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    const parsed = raw ? (JSON.parse(raw) as Partial<CostChartPrefs>) : {};
    return {
      series: SERIES_VALUES.includes(parsed.series as SeriesMode)
        ? (parsed.series as SeriesMode)
        : DEFAULT_COST_CHART_PREFS.series,
      fiscalYear: coerceFiscalYear(parsed.fiscalYear),
      expanded:
        typeof parsed.expanded === "boolean"
          ? parsed.expanded
          : DEFAULT_COST_CHART_PREFS.expanded,
    };
  } catch {
    return { ...DEFAULT_COST_CHART_PREFS };
  }
}

export function saveCostChartPrefs(prefs: CostChartPrefs): void {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch {
    // Storage unavailable (private mode) — the preference just won't stick.
  }
}

/**
 * Resolve a stored choice against the years *this* initiative actually has.
 *
 * A concrete year carried over from another project would otherwise render an
 * empty chart, so anything not in `available` falls back to the current
 * fiscal year.
 */
export function resolveFiscalYear(
  choice: FiscalYearChoice,
  available: number[],
  currentFy: number,
): number | "all" {
  if (choice === "all") return "all";
  if (choice === "current") return currentFy;
  return available.includes(choice) ? choice : currentFy;
}
