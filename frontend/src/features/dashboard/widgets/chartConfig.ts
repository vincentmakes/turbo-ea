/**
 * A chart widget's configuration, read defensively from the stored JSON, and
 * the shape its endpoint answers in. Pure — `ChartWidget` and the
 * configuration dialog share it.
 *
 * A chart reads either a `DashboardQuery` (`GET /dashboards/query`, or a KPI's
 * history) or one series of a module's shared report (`source` + `series`,
 * `sourceSeries.ts`) — never both.
 */
import type {
  DashboardChartKind,
  DashboardKpiHistory,
  DashboardQuery,
  DashboardQueryResult,
  DashboardQueryRow,
} from "@/types";
import { isCardKeyed, withQuery } from "../dashboardQuery";
import { isSourceSeries, type ModuleSourceName } from "./sourceSeries";

export const CHART_KINDS: DashboardChartKind[] = [
  "bar",
  "column",
  "line",
  "pie",
  "donut",
  "gauge",
  "heatmap",
  "treemap",
  "sankey",
  "stacked_column",
];

/** Kinds that give every category its own hue — capped at the palette. */
export const PART_TO_WHOLE: DashboardChartKind[] = ["pie", "donut", "treemap"];

/** Kinds that read two dimensions (`group_by` + `group_by_2`). */
export const TWO_DIMENSION_KINDS: DashboardChartKind[] = ["heatmap", "stacked_column"];

/** Server-side fold of a card-keyed dimension: the default and bounds of `top`. */
export const DEFAULT_TOP = 20;
export const MAX_TOP = 200;

export interface ChartConfig {
  query: DashboardQuery;
  chart: DashboardChartKind;
  drill: boolean;
  max?: number;
  /** `kpi_history` on a query chart; a source series on a source chart. */
  series?: string;
  /** Set on a chart that draws a module's shared report. */
  source?: ModuleSourceName;
}

export function readChartConfig(config: Record<string, unknown> | undefined): ChartConfig {
  const c = config ?? {};
  const chart = CHART_KINDS.includes(c.chart as DashboardChartKind) ? (c.chart as DashboardChartKind) : "bar";
  const max = typeof c.max === "number" && c.max > 0 ? c.max : undefined;
  const series = typeof c.series === "string" ? c.series : undefined;
  const source =
    typeof c.source === "string" && series !== undefined && isSourceSeries(c.source, series)
      ? (c.source as ModuleSourceName)
      : undefined;
  return {
    query: c.query && typeof c.query === "object" ? (c.query as DashboardQuery) : {},
    chart,
    drill: c.drill === true,
    max,
    series,
    source,
  };
}

/** Whether the chart groups by a dimension whose keys are card ids. */
export function usesCardKeys(config: ChartConfig): boolean {
  return isCardKeyed(config.query.group_by) || isCardKeyed(config.query.group_by_2);
}

/** The `top` a card-keyed chart asks the server to fold at. */
export function chartTop(config: ChartConfig): number {
  const top = config.max ?? DEFAULT_TOP;
  return Math.min(Math.max(Math.round(top), 1), MAX_TOP);
}

/** The endpoint a chart config reads, or null for a source chart (the shared payload). */
export function chartPath(config: ChartConfig): string | null {
  if (config.source) return null;
  if (config.chart === "line" && config.series === "kpi_history") {
    return withQuery("/dashboards/kpi-history", config.query, "days=90");
  }
  // `top` is a parameter of the endpoint, never part of the stored query.
  return withQuery("/dashboards/query", config.query, usesCardKeys(config) ? `top=${chartTop(config)}` : undefined);
}

export interface NormalizedChartResult {
  dimension: string | null;
  dimension2: string | null;
  rows: DashboardQueryRow[];
  total: number;
  /** Card names of card-keyed rows. */
  labels: Record<string, string>;
  fiscalYear: number | null;
  fiscalYearStart: number | null;
}

export function normalizeChartResult(raw: unknown, config: ChartConfig): NormalizedChartResult | null {
  if (!raw || typeof raw !== "object") return null;
  if (config.chart === "line" && config.series === "kpi_history") {
    const points = Array.isArray(raw) ? raw : (raw as DashboardKpiHistory).points ?? [];
    const rows = (points as { date: string; value: number }[]).map((p) => ({ key: p.date, value: p.value }));
    return {
      dimension: "date",
      dimension2: null,
      rows,
      total: rows.length ? rows[rows.length - 1].value : 0,
      labels: {},
      fiscalYear: null,
      fiscalYearStart: null,
    };
  }
  const r = raw as DashboardQueryResult;
  return {
    dimension: r.dimension ?? config.query.group_by ?? null,
    dimension2: r.dimension_2 ?? config.query.group_by_2 ?? null,
    rows: Array.isArray(r.rows) ? r.rows : [],
    total: typeof r.total === "number" ? r.total : 0,
    labels: r.labels && typeof r.labels === "object" ? r.labels : {},
    fiscalYear: typeof r.fiscal_year === "number" ? r.fiscal_year : null,
    fiscalYearStart: typeof r.fiscal_year_start === "number" ? r.fiscal_year_start : null,
  };
}
