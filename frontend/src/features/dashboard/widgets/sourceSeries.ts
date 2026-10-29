/**
 * Module data on the homepage: the series a chart or KPI widget can read off
 * one of the modules' shared reports (`config.source` + `config.series`).
 *
 * `SOURCE_SERIES` mirrors `SOURCE_SERIES` in
 * `backend/app/services/dashboard_defaults.py` EXACTLY — the API refuses a
 * series it does not know (`unknown_source` / `unknown_series`), and
 * `sourceSeries.test.ts` pins the two together by reading that file. A
 * `single` series is one number (a KPI or a gauge); a `keyed` one is a set of
 * `{key, value}` rows (any other chart kind but heatmap, sankey and stacked
 * columns).
 *
 * Pure: the payload extraction and the label / colour rules are unit-tested
 * without rendering; `ChartWidget` / `KpiWidget` read the payload through the
 * dashboard's shared sources.
 */
import { SEVERITY_COLORS, STATUS_COLORS } from "@/theme/tokens";
import type { DashboardKeyRow } from "@/types";
import { OTHER_KEY } from "../charts/buildOption";
import { findField, type DimensionResolver, type ResolverDeps } from "../charts/dimensions";

export const SOURCE_SERIES = {
  risks_metrics: ["total", "open", "overdue", "by_level", "by_status", "by_category"],
  compliance_overview: ["score_avg", "scores"],
  ppm_dashboard: ["total", "at_risk", "by_status", "by_subtype", "health_schedule", "health_cost", "health_scope"],
  bpm_dashboard: ["total", "without_diagram", "by_maturity", "by_process_type", "by_automation", "by_risk"],
} as const satisfies Record<string, readonly string[]>;

export type ModuleSourceName = keyof typeof SOURCE_SERIES;
export type SourceSeriesKey<S extends ModuleSourceName = ModuleSourceName> = (typeof SOURCE_SERIES)[S][number];

export const MODULE_SOURCE_NAMES = Object.keys(SOURCE_SERIES) as ModuleSourceName[];

/** The series that are one number; every other series is keyed rows. */
export const SINGLE_SERIES: ReadonlySet<string> = new Set([
  "total",
  "open",
  "overdue",
  "score_avg",
  "at_risk",
  "without_diagram",
]);

export type SeriesShape = "single" | "keyed";

export function seriesShape(series: string): SeriesShape {
  return SINGLE_SERIES.has(series) ? "single" : "keyed";
}

export function isModuleSource(source: unknown): source is ModuleSourceName {
  return typeof source === "string" && Object.prototype.hasOwnProperty.call(SOURCE_SERIES, source);
}

export function isSourceSeries(source: unknown, series: unknown): boolean {
  return (
    isModuleSource(source) &&
    typeof series === "string" &&
    (SOURCE_SERIES[source] as readonly string[]).includes(series)
  );
}

export type ModuleKey = "bpm" | "ppm" | "grc";

/** Which optional module each source belongs to — a source widget needs it on. */
export const SOURCE_MODULES: Record<ModuleSourceName, ModuleKey> = {
  risks_metrics: "grc",
  compliance_overview: "grc",
  ppm_dashboard: "ppm",
  bpm_dashboard: "bpm",
};

/** The permission each source's endpoint enforces. */
export const SOURCE_PERMISSIONS: Record<ModuleSourceName, string> = {
  risks_metrics: "risks.view",
  compliance_overview: "compliance.view",
  ppm_dashboard: "ppm.view",
  bpm_dashboard: "reports.bpm_dashboard",
};

/** The icon of a module's KPI tile. */
export const SOURCE_ICONS: Record<ModuleSourceName, string> = {
  risks_metrics: "report",
  compliance_overview: "verified_user",
  ppm_dashboard: "rocket_launch",
  bpm_dashboard: "account_tree",
};

export const MODULE_SOURCE_PATHS: Record<ModuleSourceName, string> = {
  risks_metrics: "/risks/metrics",
  compliance_overview: "/compliance/overview",
  ppm_dashboard: "/reports/ppm/dashboard",
  bpm_dashboard: "/reports/bpm/dashboard",
};

// ── Payload shapes (only what the series read) ───────────────────────────

type Counts = Record<string, number>;

export interface RiskMetricsPayload {
  total: number;
  by_status: Counts;
  by_level: Counts;
  by_category: Counts;
  overdue: number;
  created_this_month?: number;
}

export interface ComplianceOverviewPayload {
  compliance_scores: Counts;
  compliance_by_status?: Record<string, Counts>;
}

export interface HealthCounts {
  onTrack: number;
  atRisk: number;
  offTrack: number;
  noReport: number;
}

export interface PpmDashboardPayload {
  total_initiatives: number;
  by_subtype: Counts;
  by_status: Counts;
  total_budget?: number;
  total_actual?: number;
  health_schedule: HealthCounts;
  health_cost: HealthCounts;
  health_scope: HealthCounts;
}

export interface BpmDashboardPayload {
  total_processes: number;
  by_process_type: Counts;
  by_maturity: Counts;
  by_automation: Counts;
  by_risk: Counts;
  diagram_coverage: { with_diagram: number; total: number; percentage?: number };
}

export interface ModuleSourcePayloads {
  risks_metrics: RiskMetricsPayload;
  compliance_overview: ComplianceOverviewPayload;
  ppm_dashboard: PpmDashboardPayload;
  bpm_dashboard: BpmDashboardPayload;
}

// ── Fixed orders ─────────────────────────────────────────────────────────

export const RISK_LEVEL_ORDER = ["critical", "high", "medium", "low"] as const;
export const RISK_STATUS_ORDER = [
  "identified",
  "analysed",
  "mitigation_planned",
  "in_progress",
  "mitigated",
  "monitoring",
  "accepted",
  "closed",
] as const;
export const RISK_CATEGORY_ORDER = [
  "security",
  "compliance",
  "operational",
  "technology",
  "financial",
  "reputational",
  "strategic",
] as const;
export const HEALTH_ORDER = ["onTrack", "atRisk", "offTrack", "noReport"] as const;

/** Health keys in their status colours. */
export const HEALTH_SERIES_COLORS: Record<string, string> = {
  onTrack: STATUS_COLORS.success,
  atRisk: STATUS_COLORS.warning,
  offTrack: STATUS_COLORS.error,
  noReport: STATUS_COLORS.neutral,
};

// ── Extraction ───────────────────────────────────────────────────────────

export type ExtractedSeries = { shape: "single"; value: number } | { shape: "keyed"; rows: DashboardKeyRow[] };

const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);

function counts(obj: unknown): Counts {
  return obj && typeof obj === "object" ? (obj as Counts) : {};
}

/** Rows of a counts map: the fixed keys first (zeros filled when `fill`), then the rest largest first. */
export function keyedRows(map: unknown, order: readonly string[] = [], fill = false): DashboardKeyRow[] {
  const c = counts(map);
  const known = order.filter((k) => fill || k in c).map((k) => ({ key: k, value: num(c[k]) }));
  const rest = Object.entries(c)
    .filter(([k]) => !order.includes(k))
    .map(([key, value]) => ({ key, value: num(value) }))
    .sort((a, b) => b.value - a.value || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  return [...known, ...rest];
}

const single = (value: number): ExtractedSeries => ({ shape: "single", value });
const keyed = (rows: DashboardKeyRow[]): ExtractedSeries => ({ shape: "keyed", rows });

/**
 * One series out of a source's payload, or null when the source / series is
 * unknown or the payload has not arrived. The derived series follow the
 * contract the backend validates against: `open` = total − closed −
 * accepted; `at_risk` = schedule at risk + off track; `without_diagram` =
 * processes − processes with a diagram; `score_avg` = the mean regulation
 * score (0 with none).
 */
export function extractSeries(source: string, series: string, payload: unknown): ExtractedSeries | null {
  if (!isSourceSeries(source, series) || !payload || typeof payload !== "object") return null;
  const p = payload as Record<string, unknown>;
  switch (source as ModuleSourceName) {
    case "risks_metrics": {
      const byStatus = counts(p.by_status);
      switch (series) {
        case "total":
          return single(num(p.total));
        case "open":
          return single(Math.max(num(p.total) - num(byStatus.closed) - num(byStatus.accepted), 0));
        case "overdue":
          return single(num(p.overdue));
        case "by_level":
          return keyed(keyedRows(p.by_level, RISK_LEVEL_ORDER, true));
        case "by_status":
          return keyed(keyedRows(p.by_status, RISK_STATUS_ORDER));
        case "by_category":
          return keyed(keyedRows(p.by_category, RISK_CATEGORY_ORDER));
      }
      return null;
    }
    case "compliance_overview": {
      const scores = counts(p.compliance_scores);
      if (series === "scores") return keyed(keyedRows(scores));
      const values = Object.values(scores).map(num);
      return single(values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0);
    }
    case "ppm_dashboard": {
      switch (series) {
        case "total":
          return single(num(p.total_initiatives));
        case "at_risk": {
          const h = counts(p.health_schedule);
          return single(num(h.atRisk) + num(h.offTrack));
        }
        case "by_status":
          return keyed(keyedRows(p.by_status));
        case "by_subtype":
          return keyed(keyedRows(p.by_subtype));
        case "health_schedule":
        case "health_cost":
        case "health_scope":
          return keyed(keyedRows(p[series], HEALTH_ORDER, true));
      }
      return null;
    }
    case "bpm_dashboard": {
      switch (series) {
        case "total":
          return single(num(p.total_processes));
        case "without_diagram": {
          const cov = counts(p.diagram_coverage);
          return single(Math.max(num(cov.total) - num(cov.with_diagram), 0));
        }
        case "by_maturity":
        case "by_process_type":
        case "by_automation":
        case "by_risk":
          return keyed(keyedRows(p[series]));
      }
      return null;
    }
  }
  return null;
}

// ── Labels and colours ───────────────────────────────────────────────────

/** Keys a module report uses for "nothing recorded". */
const UNKNOWN_KEYS = new Set(["unknown", "Unknown", "Other", "none", ""]);

/** The card type and field behind a keyed series whose keys are that field's options. */
const FIELD_SERIES: Partial<Record<string, { type: string; field: string }>> = {
  "ppm_dashboard:by_status": { type: "Initiative", field: "initiativeStatus" },
  "bpm_dashboard:by_maturity": { type: "BusinessProcess", field: "maturity" },
  "bpm_dashboard:by_process_type": { type: "BusinessProcess", field: "processType" },
  "bpm_dashboard:by_automation": { type: "BusinessProcess", field: "automationLevel" },
  "bpm_dashboard:by_risk": { type: "BusinessProcess", field: "riskLevel" },
};

export interface SourceResolverDeps extends ResolverDeps {
  /** A compliance regulation's display name (the admin-managed label, then the built-in one). */
  regulationLabel?: (key: string) => string;
}

function slot(categorical: readonly string[], index: number): string {
  return index >= 0 && index < categorical.length ? categorical[index] : STATUS_COLORS.neutral;
}

/**
 * How a keyed source series names and colours its keys: the module's own
 * vocabulary (risk levels, statuses and categories from the GRC strings, PPM
 * health from the PPM strings, regulations through their resolver), and for
 * keys that are a card type's field options (PPM status, BPM maturity,
 * process type, automation, risk) the metamodel's option labels — so a
 * renamed or translated option reads the same here as on the card.
 */
export function sourceSeriesResolver(source: string, series: string, deps: SourceResolverDeps): DimensionResolver {
  const { t, types, inlineLabel, categorical } = deps;
  const notSet = t("labels.notSet");
  const wrap = (r: DimensionResolver): DimensionResolver => ({
    colorByCategory: r.colorByCategory,
    label: (key) => (key === OTHER_KEY ? t("dashboard.query.other") : UNKNOWN_KEYS.has(key) ? notSet : r.label(key)),
    color: (key, index) => (key === OTHER_KEY || UNKNOWN_KEYS.has(key) ? STATUS_COLORS.neutral : r.color(key, index)),
  });
  const fromOrder = (order: readonly string[]) => (key: string, index: number) => {
    const i = order.indexOf(key);
    return slot(categorical, i >= 0 ? i : index);
  };
  const severity = (key: string, index: number) =>
    SEVERITY_COLORS[key as keyof typeof SEVERITY_COLORS] ?? slot(categorical, index);

  const id = `${source}:${series}`;
  switch (id) {
    case "risks_metrics:by_level":
      return wrap({
        colorByCategory: true,
        label: (key) => t(`grc:risks.level.${key}`, { defaultValue: key }),
        color: severity,
      });
    case "risks_metrics:by_status":
      return wrap({
        colorByCategory: true,
        label: (key) => t(`grc:risks.status.${key}`, { defaultValue: key }),
        color: fromOrder(RISK_STATUS_ORDER),
      });
    case "risks_metrics:by_category":
      return wrap({
        colorByCategory: true,
        label: (key) => t(`grc:risks.category.${key}`, { defaultValue: key }),
        color: fromOrder(RISK_CATEGORY_ORDER),
      });
    case "compliance_overview:scores":
      return wrap({
        colorByCategory: false,
        label: (key) => deps.regulationLabel?.(key) ?? t(`admin:compliance_regulation_${key}`, { defaultValue: key }),
        color: () => slot(categorical, 0),
      });
    case "ppm_dashboard:health_schedule":
    case "ppm_dashboard:health_cost":
    case "ppm_dashboard:health_scope":
      return wrap({
        colorByCategory: true,
        label: (key) => t(`ppm:health_${key}`, { defaultValue: key }),
        color: (key) => HEALTH_SERIES_COLORS[key] ?? STATUS_COLORS.neutral,
      });
    case "ppm_dashboard:by_subtype": {
      const type = types.find((ct) => ct.key === "Initiative");
      const subtypes = type?.subtypes ?? [];
      return wrap({
        colorByCategory: true,
        label: (key) => {
          const st = subtypes.find((s) => s.key === key);
          return st ? inlineLabel(st) : key;
        },
        color: (key, index) => {
          const i = subtypes.findIndex((s) => s.key === key);
          return slot(categorical, i >= 0 ? i : index);
        },
      });
    }
  }
  const fieldRef = FIELD_SERIES[id];
  if (fieldRef) {
    const options = findField(types, fieldRef.type, fieldRef.field)?.options ?? [];
    return wrap({
      colorByCategory: true,
      label: (key) => {
        const option = options.find((o) => o.key === key);
        return option ? inlineLabel(option) : key;
      },
      color: (key, index) => {
        const i = options.findIndex((o) => o.key === key);
        if (i >= 0) return options[i].color ?? slot(categorical, i);
        // A BPM risk level that is not an option still reads on the severity scale.
        return series === "by_risk" ? severity(key, index) : slot(categorical, index);
      },
    });
  }
  return wrap({ colorByCategory: false, label: (key) => key, color: () => slot(categorical, 0) });
}

/** The i18n key of a source series' name (catalogue entries, tooltips). */
export function seriesLabelKey(source: string, series: string): string {
  return `dashboard.source.series.${source}.${series}`;
}
