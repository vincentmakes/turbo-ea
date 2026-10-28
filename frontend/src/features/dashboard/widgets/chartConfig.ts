/**
 * A chart widget's configuration, read defensively from the stored JSON, and
 * the shape its endpoint answers in. Pure — `ChartWidget` and the
 * configuration dialog share it.
 */
import type {
  DashboardChartKind,
  DashboardKpiHistory,
  DashboardQuery,
  DashboardQueryResult,
  DashboardQueryRow,
} from "@/types";
import { withQuery } from "../dashboardQuery";

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
];

/** Kinds that give every category its own hue — capped at the palette. */
export const PART_TO_WHOLE: DashboardChartKind[] = ["pie", "donut", "treemap"];

export interface ChartConfig {
  query: DashboardQuery;
  chart: DashboardChartKind;
  drill: boolean;
  max?: number;
  series?: string;
}

export function readChartConfig(config: Record<string, unknown> | undefined): ChartConfig {
  const c = config ?? {};
  const chart = CHART_KINDS.includes(c.chart as DashboardChartKind) ? (c.chart as DashboardChartKind) : "bar";
  const max = typeof c.max === "number" && c.max > 0 ? c.max : undefined;
  return {
    query: c.query && typeof c.query === "object" ? (c.query as DashboardQuery) : {},
    chart,
    drill: c.drill === true,
    max,
    series: typeof c.series === "string" ? c.series : undefined,
  };
}

/** The endpoint a chart config reads. */
export function chartPath(config: ChartConfig): string {
  if (config.chart === "line" && config.series === "kpi_history") {
    return withQuery("/dashboards/kpi-history", config.query, "days=90");
  }
  return withQuery("/dashboards/query", config.query);
}

export interface NormalizedChartResult {
  dimension: string | null;
  dimension2: string | null;
  rows: DashboardQueryRow[];
  total: number;
}

export function normalizeChartResult(raw: unknown, config: ChartConfig): NormalizedChartResult | null {
  if (!raw || typeof raw !== "object") return null;
  if (config.chart === "line" && config.series === "kpi_history") {
    const points = Array.isArray(raw) ? raw : (raw as DashboardKpiHistory).points ?? [];
    const rows = (points as { date: string; value: number }[]).map((p) => ({ key: p.date, value: p.value }));
    return { dimension: "date", dimension2: null, rows, total: rows.length ? rows[rows.length - 1].value : 0 };
  }
  const r = raw as DashboardQueryResult;
  return {
    dimension: r.dimension ?? config.query.group_by ?? null,
    dimension2: r.dimension_2 ?? config.query.group_by_2 ?? null,
    rows: Array.isArray(r.rows) ? r.rows : [],
    total: typeof r.total === "number" ? r.total : 0,
  };
}
