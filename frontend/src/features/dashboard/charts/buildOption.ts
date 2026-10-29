/**
 * Pure ECharts option builders for the dashboard chart widget — one per chart
 * kind. Rows carry keys only; `ctx` resolves labels and colours, so these stay
 * free of React, i18n and the metamodel and are unit-tested without rendering.
 *
 * Mark rules (dataviz): thin bars with 4px rounded data ends, 2px lines, a 2px
 * surface gap between adjacent fills, recessive axes and grid, no number on
 * every mark (pie / donut slices keep their value label, as the homepage
 * always had), a legend wherever colour carries identity across several
 * categories, a hover tooltip on every form.
 */
import type { EChartsCoreOption } from "echarts/core";
import type {
  DashboardCellRow,
  DashboardChartKind,
  DashboardFlowRow,
  DashboardKeyRow,
  DashboardQueryRow,
} from "@/types";
import type { EChartsChrome } from "./echartsTheme";

/** Key of the row that folds every category past `max`. */
export const OTHER_KEY = "__other__";

/** Lifecycle phases in life order; `none` = no phase set. */
export const LIFECYCLE_ORDER = ["plan", "phaseIn", "active", "phaseOut", "endOfLife", "none"] as const;
export const DATA_QUALITY_ORDER = ["0-25", "25-50", "50-75", "75-100"] as const;
export const APPROVAL_ORDER = ["DRAFT", "APPROVED", "BROKEN", "REJECTED"] as const;
export const EOL_COVERAGE_ORDER = ["linked", "manual", "missing"] as const;
export const STAKEHOLDER_ORDER = ["true", "false"] as const;

export interface BuildContext {
  /** Label of a row key (the x / category dimension). */
  labels: (key: string) => string;
  /** Label of a second-dimension key — a heatmap row, a stacked column's
   *  series, a sankey target node; defaults to `labels`. */
  labels2?: (key: string) => string;
  /** Colour of a category. `index` is its position in the rows. */
  colors: (key: string, index: number) => string;
  /** Colour of a second-dimension key (stacked series, sankey target nodes);
   *  defaults to `colors`. */
  colors2?: (key: string, index: number) => string;
  /**
   * Colour bars / columns per category (`true`, the default — the dimension
   * has colours of its own, like card types or statuses) or draw the single
   * series in `seriesColor` (a dimension whose values carry no colour: one
   * series is one hue).
   */
  colorByCategory?: boolean;
  /** The one hue of a single-series line, gauge or uncoloured bar chart;
   *  defaults to the first categorical slot. */
  seriesColor?: string;
  theme: EChartsChrome;
  isRtl: boolean;
  valueFormatter?: (value: number) => string;
  /** Gauge maximum. */
  max?: number;
  /** Series name shown in tooltips. */
  seriesName?: string;
  /** Mark cursor — "pointer" when a click drills somewhere. */
  cursor?: "pointer" | "default";
}

export function defaultValueFormatter(value: number): string {
  if (!Number.isFinite(value)) return "0";
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

const isKeyRow = (r: DashboardQueryRow): r is DashboardKeyRow => "key" in r;
const isFlowRow = (r: DashboardQueryRow): r is DashboardFlowRow => "source" in r && "target" in r;
const isCellRow = (r: DashboardQueryRow): r is DashboardCellRow => "x" in r && "y" in r;

function fixedOrder(rows: DashboardKeyRow[], order: readonly string[], fillMissing: boolean): DashboardKeyRow[] {
  const byKey = new Map(rows.map((r) => [r.key, r]));
  const known = order
    .filter((k) => fillMissing || byKey.has(k))
    .map((k) => byKey.get(k) ?? { key: k, value: 0 });
  const rest = rows.filter((r) => !order.includes(r.key));
  return [...known, ...rest];
}

/**
 * Put rows in reading order for their dimension: ordinal dimensions keep their
 * natural order (and lifecycle / completion show every bucket, zeros
 * included, as the homepage always did); months run oldest first; nominal
 * dimensions run largest first. With `max`, everything past the first
 * `max - 1` rows folds into one `OTHER_KEY` row, so a chart never needs more
 * hues than the palette holds.
 */
export function orderRows(
  dimension: string | null | undefined,
  rows: DashboardKeyRow[],
  max?: number,
  fold: FoldMode = "sum",
): DashboardKeyRow[] {
  let ordered: DashboardKeyRow[];
  switch (dimension) {
    case "lifecycle_phase":
      ordered = fixedOrder(rows, LIFECYCLE_ORDER, true);
      break;
    case "data_quality_bucket":
      ordered = fixedOrder(rows, DATA_QUALITY_ORDER, true);
      break;
    case "approval_status":
      ordered = fixedOrder(rows, APPROVAL_ORDER, false);
      break;
    case "eol_coverage":
      ordered = fixedOrder(rows, EOL_COVERAGE_ORDER, true);
      break;
    case "stakeholders":
      ordered = fixedOrder(rows, STAKEHOLDER_ORDER, true);
      break;
    case "created_month":
    case "date":
      ordered = [...rows].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
      break;
    default:
      if (dimension?.startsWith("phase_month:")) {
        ordered = [...rows].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
        break;
      }
      // Largest first; a row the server already folded stays last.
      ordered = [...rows].sort(
        (a, b) =>
          Number(a.key === OTHER_KEY) - Number(b.key === OTHER_KEY) ||
          b.value - a.value ||
          (a.key < b.key ? -1 : a.key > b.key ? 1 : 0),
      );
  }
  // A related-card grouping keeps its "no related card" row whole, as the
  // server's `fold_keyed` does.
  if (dimension?.startsWith("related:")) {
    const none = ordered.filter((r) => r.key === "none");
    if (none.length > 0) {
      const rest = ordered.filter((r) => r.key !== "none");
      return [...foldRows(rest, max === undefined ? undefined : Math.max(max - 1, 1), fold), ...none];
    }
  }
  return foldRows(ordered, max, fold);
}

/**
 * How rows past the limit go: summed into one `OTHER_KEY` row (counts and
 * sums), or dropped (averages and shares — the server drops them too, since
 * adding up averages or percentages means nothing).
 */
export type FoldMode = "sum" | "drop";

/** The fold a metric takes. */
export function foldModeOf(metric: string | null | undefined): FoldMode {
  return metric === "avg" || metric === "share" ? "drop" : "sum";
}

/**
 * Keep rows in the order given, folding everything past the first `max - 1`
 * into one `OTHER_KEY` row (a row the server already folded joins it) — or,
 * with `fold: "drop"`, keeping the first `max` rows and dropping the rest.
 */
export function foldRows(rows: DashboardKeyRow[], max?: number, fold: FoldMode = "sum"): DashboardKeyRow[] {
  if (max === undefined || !(max > 0) || rows.length <= max) return rows;
  if (fold === "drop") return rows.filter((r) => r.key !== OTHER_KEY).slice(0, max);
  const head = rows.slice(0, Math.max(max - 1, 1)).filter((r) => r.key !== OTHER_KEY);
  const tail = rows.filter((r) => !head.includes(r));
  const other = tail.reduce((sum, r) => sum + r.value, 0);
  return [...head, { key: OTHER_KEY, value: other }];
}

/**
 * Fold the x categories of a two-dimension grid past `max` into one
 * `OTHER_KEY` column: the first `max - 1` categories by total stay, in their
 * row order, and the rest are summed per second-dimension key (or, with
 * `fold: "drop"`, the `max` largest stay and the rest go). The server never
 * folds a grid, so this is the only fold a stacked chart gets. Pure; the
 * input is not mutated.
 */
export function foldGrid(cells: DashboardCellRow[], max?: number, fold: FoldMode = "sum"): DashboardCellRow[] {
  const xs = uniqueInOrder(cells.map((c) => c.x));
  if (max === undefined || !(max > 0) || xs.length <= max) return cells;
  const totals = new Map<string, number>();
  for (const c of cells) totals.set(c.x, (totals.get(c.x) ?? 0) + c.value);
  const keep = new Set(
    xs
      .filter((x) => x !== OTHER_KEY)
      .sort((a, b) => (totals.get(b) ?? 0) - (totals.get(a) ?? 0))
      .slice(0, Math.max(max - 1, 1)),
  );
  if (fold === "drop") {
    // Keep the `max` largest columns whole; averages are not added up.
    const kept = new Set(
      xs.filter((x) => x !== OTHER_KEY).sort((a, b) => (totals.get(b) ?? 0) - (totals.get(a) ?? 0)).slice(0, max),
    );
    return cells.filter((c) => kept.has(c.x));
  }
  const out: DashboardCellRow[] = [];
  const other = new Map<string, number>();
  for (const c of cells) {
    if (keep.has(c.x)) out.push(c);
    else other.set(c.y, (other.get(c.y) ?? 0) + c.value);
  }
  for (const [y, value] of other) out.push({ x: OTHER_KEY, y, value });
  return out;
}

// ── Shared chrome ────────────────────────────────────────────────────────

function fmt(ctx: BuildContext): (value: number) => string {
  return ctx.valueFormatter ?? defaultValueFormatter;
}

function base(ctx: BuildContext): Record<string, unknown> {
  return {
    backgroundColor: "transparent",
    aria: { enabled: true },
    animationDuration: 300,
    textStyle: { fontFamily: ctx.theme.fontFamily, color: ctx.theme.textSecondary },
  };
}

function tooltip(ctx: BuildContext, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    confine: true,
    backgroundColor: ctx.theme.tooltipBackground,
    borderColor: ctx.theme.divider,
    textStyle: { color: ctx.theme.textPrimary, fontFamily: ctx.theme.fontFamily },
    extraCssText: ctx.isRtl ? "direction: rtl; text-align: right;" : "",
    valueFormatter: (v: unknown) => fmt(ctx)(Number(v)),
    ...extra,
  };
}

function axisLabel(ctx: BuildContext, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { color: ctx.theme.textSecondary, fontSize: 12, ...extra };
}

function splitLine(ctx: BuildContext): Record<string, unknown> {
  return { show: true, lineStyle: { color: ctx.theme.divider, type: "dashed" } };
}

function legend(ctx: BuildContext, names: string[]): Record<string, unknown> {
  return {
    type: "scroll",
    bottom: 0,
    left: ctx.isRtl ? "right" : "left",
    align: ctx.isRtl ? "right" : "left",
    icon: "roundRect",
    itemWidth: 10,
    itemHeight: 10,
    textStyle: { color: ctx.theme.textPrimary, fontSize: 12 },
    pageTextStyle: { color: ctx.theme.textSecondary },
    data: names,
  };
}

function seriesColor(ctx: BuildContext): string {
  return ctx.seriesColor ?? ctx.theme.categorical[0];
}

function barColor(ctx: BuildContext, key: string, index: number): string {
  return ctx.colorByCategory === false ? seriesColor(ctx) : ctx.colors(key, index);
}

function keyRows(rows: DashboardQueryRow[]): DashboardKeyRow[] {
  return rows.filter(isKeyRow);
}

// ── Builders ─────────────────────────────────────────────────────────────

/** Horizontal bars, categories down the y axis (the homepage's Cards by type). */
function buildBar(rows: DashboardQueryRow[], ctx: BuildContext): EChartsCoreOption {
  const data = keyRows(rows);
  const radius = ctx.isRtl ? [4, 0, 0, 4] : [0, 4, 4, 0];
  return {
    ...base(ctx),
    grid: { left: 8, right: 16, top: 8, bottom: 8, containLabel: true },
    tooltip: tooltip(ctx, { trigger: "axis", axisPointer: { type: "shadow", shadowStyle: { color: ctx.theme.hover } } }),
    xAxis: {
      type: "value",
      inverse: ctx.isRtl,
      minInterval: 1,
      axisLabel: axisLabel(ctx),
      splitLine: splitLine(ctx),
    },
    yAxis: {
      type: "category",
      // First row at the top.
      inverse: true,
      position: ctx.isRtl ? "right" : "left",
      data: data.map((r) => ctx.labels(r.key)),
      axisTick: { show: false },
      axisLine: { lineStyle: { color: ctx.theme.divider } },
      axisLabel: axisLabel(ctx, { width: 150, overflow: "truncate" }),
    },
    series: [
      {
        type: "bar",
        name: ctx.seriesName,
        barMaxWidth: 24,
        barCategoryGap: "30%",
        cursor: ctx.cursor ?? "default",
        data: data.map((r, i) => ({
          value: r.value,
          key: r.key,
          itemStyle: { color: barColor(ctx, r.key, i), borderRadius: radius },
        })),
      },
    ],
  };
}

/** Vertical columns, categories along the x axis. */
function buildColumn(rows: DashboardQueryRow[], ctx: BuildContext): EChartsCoreOption {
  const data = keyRows(rows);
  return {
    ...base(ctx),
    grid: { left: 8, right: 16, top: 16, bottom: 8, containLabel: true },
    tooltip: tooltip(ctx, { trigger: "axis", axisPointer: { type: "shadow", shadowStyle: { color: ctx.theme.hover } } }),
    xAxis: {
      type: "category",
      inverse: ctx.isRtl,
      data: data.map((r) => ctx.labels(r.key)),
      axisTick: { show: false },
      axisLine: { lineStyle: { color: ctx.theme.divider } },
      axisLabel: axisLabel(ctx, { interval: 0, hideOverlap: true, width: 96, overflow: "truncate" }),
    },
    yAxis: {
      type: "value",
      position: ctx.isRtl ? "right" : "left",
      minInterval: 1,
      axisLabel: axisLabel(ctx),
      splitLine: splitLine(ctx),
    },
    series: [
      {
        type: "bar",
        name: ctx.seriesName,
        barMaxWidth: 32,
        barCategoryGap: "30%",
        cursor: ctx.cursor ?? "default",
        data: data.map((r, i) => ({
          value: r.value,
          key: r.key,
          itemStyle: { color: barColor(ctx, r.key, i), borderRadius: [4, 4, 0, 0] },
        })),
      },
    ],
  };
}

/** One series over time; markers only while they stay sparse. */
function buildLine(rows: DashboardQueryRow[], ctx: BuildContext): EChartsCoreOption {
  const data = keyRows(rows);
  const color = seriesColor(ctx);
  return {
    ...base(ctx),
    grid: { left: 8, right: 16, top: 16, bottom: 8, containLabel: true },
    tooltip: tooltip(ctx, { trigger: "axis", axisPointer: { type: "line", lineStyle: { color: ctx.theme.divider } } }),
    xAxis: {
      type: "category",
      boundaryGap: false,
      inverse: ctx.isRtl,
      data: data.map((r) => ctx.labels(r.key)),
      axisTick: { show: false },
      axisLine: { lineStyle: { color: ctx.theme.divider } },
      axisLabel: axisLabel(ctx, { hideOverlap: true }),
    },
    yAxis: {
      type: "value",
      position: ctx.isRtl ? "right" : "left",
      axisLabel: axisLabel(ctx),
      splitLine: splitLine(ctx),
    },
    series: [
      {
        type: "line",
        name: ctx.seriesName,
        smooth: false,
        showSymbol: data.length <= 24,
        symbol: "circle",
        symbolSize: 8,
        cursor: ctx.cursor ?? "default",
        lineStyle: { width: 2, color },
        itemStyle: { color, borderColor: ctx.theme.surface, borderWidth: 2 },
        data: data.map((r) => ({ value: r.value, key: r.key })),
      },
    ],
  };
}

function buildPie(rows: DashboardQueryRow[], ctx: BuildContext, donut: boolean): EChartsCoreOption {
  const data = keyRows(rows).filter((r) => r.value > 0);
  const valueOf = fmt(ctx);
  const items = data.map((r, i) => ({
    value: r.value,
    key: r.key,
    name: ctx.labels(r.key),
    itemStyle: { color: ctx.colors(r.key, i) },
  }));
  return {
    ...base(ctx),
    tooltip: tooltip(ctx, { trigger: "item" }),
    legend: legend(ctx, items.map((d) => d.name)),
    series: [
      {
        type: "pie",
        name: ctx.seriesName,
        radius: donut ? ["38%", "62%"] : [0, "62%"],
        center: ["50%", "45%"],
        padAngle: donut ? 2 : 0,
        avoidLabelOverlap: true,
        cursor: ctx.cursor ?? "default",
        itemStyle: { borderColor: ctx.theme.surface, borderWidth: 2, borderRadius: donut ? 4 : 0 },
        label: {
          show: true,
          position: "outside",
          color: ctx.theme.textSecondary,
          fontSize: 12,
          formatter: (p: { value?: unknown }) => valueOf(Number(p.value ?? 0)),
        },
        labelLine: { show: false, length: 6, length2: 0 },
        emphasis: { scale: true, scaleSize: 4 },
        data: items,
      },
    ],
  };
}

/** A smallest-nice ceiling for a gauge without an explicit max. */
export function niceMax(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 1;
  const exp = Math.pow(10, Math.floor(Math.log10(value)));
  for (const step of [1, 2, 2.5, 5, 10]) {
    if (step * exp >= value) return step * exp;
  }
  return 10 * exp;
}

/** A single number against a range — the progress arc, no needle. */
function buildGauge(rows: DashboardQueryRow[], ctx: BuildContext): EChartsCoreOption {
  const first = keyRows(rows)[0];
  const value = first ? first.value : 0;
  const max = ctx.max !== undefined && ctx.max > 0 ? ctx.max : niceMax(value);
  const color = seriesColor(ctx);
  const valueOf = fmt(ctx);
  return {
    ...base(ctx),
    tooltip: tooltip(ctx, { trigger: "item" }),
    series: [
      {
        type: "gauge",
        name: ctx.seriesName,
        min: 0,
        max,
        // Fill from the reading side: left → right, or right → left in RTL.
        startAngle: ctx.isRtl ? -20 : 200,
        endAngle: ctx.isRtl ? 200 : -20,
        clockwise: !ctx.isRtl,
        radius: "90%",
        center: ["50%", "60%"],
        progress: { show: true, width: 12, roundCap: true, itemStyle: { color } },
        axisLine: { roundCap: true, lineStyle: { width: 12, color: [[1, ctx.theme.divider]] } },
        pointer: { show: false },
        anchor: { show: false },
        axisTick: { show: false },
        splitLine: { show: false },
        axisLabel: { show: false },
        title: { show: false },
        detail: {
          valueAnimation: true,
          offsetCenter: [0, "0%"],
          fontSize: 28,
          fontWeight: 700,
          color: ctx.theme.textPrimary,
          formatter: (v: number) => valueOf(v),
        },
        data: [{ value, key: first?.key ?? "" }],
      },
    ],
  };
}

function uniqueInOrder(values: string[]): string[] {
  return Array.from(new Set(values));
}

/** Two dimensions as a grid of cells on a single-hue ramp. */
function buildHeatmap(rows: DashboardQueryRow[], ctx: BuildContext): EChartsCoreOption {
  const cells = rows.filter(isCellRow);
  const xs = uniqueInOrder(cells.map((c) => c.x));
  const ys = uniqueInOrder(cells.map((c) => c.y));
  const top = cells.reduce((m, c) => Math.max(m, c.value), 0);
  const labelY = ctx.labels2 ?? ctx.labels;
  return {
    ...base(ctx),
    grid: { left: 8, right: 16, top: 8, bottom: 48, containLabel: true },
    tooltip: tooltip(ctx, {
      trigger: "item",
      formatter: (p: { value?: [number, number, number] }) => {
        const [xi, yi, v] = p.value ?? [0, 0, 0];
        return `${ctx.labels(xs[xi] ?? "")} · ${labelY(ys[yi] ?? "")}: ${fmt(ctx)(v)}`;
      },
    }),
    xAxis: {
      type: "category",
      inverse: ctx.isRtl,
      data: xs.map((x) => ctx.labels(x)),
      splitArea: { show: false },
      axisTick: { show: false },
      axisLine: { lineStyle: { color: ctx.theme.divider } },
      axisLabel: axisLabel(ctx, { interval: 0, hideOverlap: true, width: 96, overflow: "truncate" }),
    },
    yAxis: {
      type: "category",
      position: ctx.isRtl ? "right" : "left",
      data: ys.map((y) => labelY(y)),
      axisTick: { show: false },
      axisLine: { lineStyle: { color: ctx.theme.divider } },
      axisLabel: axisLabel(ctx, { width: 120, overflow: "truncate" }),
    },
    visualMap: {
      min: 0,
      max: top > 0 ? top : 1,
      calculable: false,
      orient: "horizontal",
      left: "center",
      bottom: 0,
      itemHeight: 120,
      itemWidth: 10,
      inRange: { color: [...ctx.theme.sequential] },
      textStyle: { color: ctx.theme.textSecondary },
    },
    series: [
      {
        type: "heatmap",
        name: ctx.seriesName,
        cursor: ctx.cursor ?? "default",
        label: { show: false },
        itemStyle: { borderColor: ctx.theme.surface, borderWidth: 2, borderRadius: 2 },
        emphasis: { itemStyle: { borderColor: ctx.theme.textPrimary, borderWidth: 1 } },
        data: cells.map((c) => [xs.indexOf(c.x), ys.indexOf(c.y), c.value]),
      },
    ],
  };
}

/** Part-to-whole as nested rectangles; tiles are labelled, so no legend. */
function buildTreemap(rows: DashboardQueryRow[], ctx: BuildContext): EChartsCoreOption {
  const data = keyRows(rows).filter((r) => r.value > 0);
  return {
    ...base(ctx),
    tooltip: tooltip(ctx, { trigger: "item" }),
    series: [
      {
        type: "treemap",
        name: ctx.seriesName,
        roam: false,
        nodeClick: false,
        breadcrumb: { show: false },
        width: "100%",
        height: "100%",
        top: 0,
        left: 0,
        cursor: ctx.cursor ?? "default",
        itemStyle: { borderColor: ctx.theme.surface, borderWidth: 2, gapWidth: 2, borderRadius: 4 },
        label: { show: true, color: ctx.theme.surface, fontSize: 12, overflow: "truncate" },
        data: data.map((r, i) => ({
          value: r.value,
          key: r.key,
          name: ctx.labels(r.key),
          itemStyle: { color: ctx.colors(r.key, i) },
        })),
      },
    ],
  };
}

/** Flows from source categories to target categories. */
function buildSankey(rows: DashboardQueryRow[], ctx: BuildContext): EChartsCoreOption {
  const flows = rows.filter(isFlowRow).filter((f) => f.value > 0);
  // Prefix node ids by side: a type can be both a source and a target (a
  // self-referencing relation), and a sankey must not loop.
  const sourceKeys = uniqueInOrder(flows.map((f) => f.source));
  const targetKeys = uniqueInOrder(flows.map((f) => f.target));
  // Each side names and colours its keys through its own resolver: the two
  // ends of a relation are different types with different fields.
  const label = new Map<string, string>();
  const labelTarget = ctx.labels2 ?? ctx.labels;
  const colorTarget = ctx.colors2 ?? ctx.colors;
  const nodes = [
    ...sourceKeys.map((k, i) => {
      label.set(`s:${k}`, ctx.labels(k));
      return { name: `s:${k}`, key: k, side: "source", itemStyle: { color: ctx.colors(k, i) } };
    }),
    ...targetKeys.map((k, i) => {
      label.set(`t:${k}`, labelTarget(k));
      const index = ctx.colors2 ? i : sourceKeys.length + i;
      return { name: `t:${k}`, key: k, side: "target", itemStyle: { color: colorTarget(k, index) } };
    }),
  ];
  const arrow = ctx.isRtl ? "←" : "→";
  return {
    ...base(ctx),
    tooltip: tooltip(ctx, {
      trigger: "item",
      formatter: (p: { dataType?: string; name?: string; value?: number; data?: { source?: string; target?: string } }) => {
        const v = fmt(ctx)(Number(p.value ?? 0));
        if (p.dataType === "edge" && p.data) {
          return `${label.get(p.data.source ?? "") ?? ""} ${arrow} ${label.get(p.data.target ?? "") ?? ""}: ${v}`;
        }
        return `${label.get(p.name ?? "") ?? ""}: ${v}`;
      },
    }),
    series: [
      {
        type: "sankey",
        name: ctx.seriesName,
        left: 8,
        right: 8,
        top: 8,
        bottom: 8,
        nodeWidth: 12,
        nodeGap: 8,
        draggable: false,
        cursor: ctx.cursor ?? "default",
        emphasis: { focus: "adjacency" },
        label: {
          color: ctx.theme.textPrimary,
          fontSize: 12,
          formatter: (p: { name?: string }) => label.get(p.name ?? "") ?? "",
        },
        lineStyle: { color: "gradient", opacity: 0.35, curveness: 0.5 },
        itemStyle: { borderColor: ctx.theme.surface, borderWidth: 1 },
        data: nodes,
        links: flows.map((f) => ({ source: `s:${f.source}`, target: `t:${f.target}`, value: f.value })),
      },
    ],
  };
}

/**
 * Two dimensions as stacked columns: one column per first-dimension key (in
 * row order), one stacked series per second-dimension key, coloured by the
 * second dimension, with a legend — colour carries the series' identity.
 */
function buildStackedColumn(rows: DashboardQueryRow[], ctx: BuildContext): EChartsCoreOption {
  const cells = rows.filter(isCellRow);
  const xs = uniqueInOrder(cells.map((c) => c.x));
  const ys = uniqueInOrder(cells.map((c) => c.y));
  const labelY = ctx.labels2 ?? ctx.labels;
  const colorY = ctx.colors2 ?? ctx.colors;
  const value = new Map(cells.map((c) => [`${c.x}\u0000${c.y}`, c.value]));
  const series = ys.map((y, yi) => ({
    type: "bar",
    name: labelY(y),
    stack: "total",
    barMaxWidth: 32,
    barCategoryGap: "30%",
    cursor: ctx.cursor ?? "default",
    emphasis: { focus: "series" },
    itemStyle: {
      color: colorY(y, yi),
      borderColor: ctx.theme.surface,
      borderWidth: 1,
      // Only the top segment of a stack gets the rounded data end.
      borderRadius: yi === ys.length - 1 ? [4, 4, 0, 0] : 0,
    },
    data: xs.map((x) => ({ value: value.get(`${x}\u0000${y}`) ?? 0, key: x, key2: y })),
  }));
  return {
    ...base(ctx),
    grid: { left: 8, right: 16, top: 16, bottom: 40, containLabel: true },
    tooltip: tooltip(ctx, { trigger: "axis", axisPointer: { type: "shadow", shadowStyle: { color: ctx.theme.hover } } }),
    legend: legend(ctx, series.map((s) => s.name)),
    xAxis: {
      type: "category",
      inverse: ctx.isRtl,
      data: xs.map((x) => ctx.labels(x)),
      axisTick: { show: false },
      axisLine: { lineStyle: { color: ctx.theme.divider } },
      axisLabel: axisLabel(ctx, { interval: 0, hideOverlap: true, width: 96, overflow: "truncate" }),
    },
    yAxis: {
      type: "value",
      position: ctx.isRtl ? "right" : "left",
      minInterval: 1,
      axisLabel: axisLabel(ctx),
      splitLine: splitLine(ctx),
    },
    series,
  };
}

/**
 * A KPI tile's sparkline: one thin line and a faint area under it. Its axes
 * exist only because a line series needs a cartesian grid to sit on — they
 * are hidden, and there is no legend, tooltip or marker: the tile's number is
 * the reading, the line only its shape over time.
 */
export function buildSparkline(
  points: { date: string; value: number }[],
  ctx: Pick<BuildContext, "theme" | "isRtl" | "seriesColor">,
): EChartsCoreOption {
  const color = ctx.seriesColor ?? ctx.theme.categorical[0];
  return {
    backgroundColor: "transparent",
    animation: false,
    grid: { left: 0, right: 0, top: 2, bottom: 2 },
    xAxis: { type: "category", show: false, boundaryGap: false, inverse: ctx.isRtl, data: points.map((p) => p.date) },
    yAxis: { type: "value", show: false, scale: true },
    series: [
      {
        type: "line",
        symbol: "none",
        smooth: false,
        silent: true,
        lineStyle: { width: 2, color },
        areaStyle: { color, opacity: 0.12 },
        data: points.map((p) => p.value),
      },
    ],
  };
}

/** The ECharts option for one chart kind. Pure. */
export function buildOption(
  kind: DashboardChartKind,
  rows: DashboardQueryRow[],
  ctx: BuildContext,
): EChartsCoreOption {
  switch (kind) {
    case "bar":
      return buildBar(rows, ctx);
    case "column":
      return buildColumn(rows, ctx);
    case "line":
      return buildLine(rows, ctx);
    case "pie":
      return buildPie(rows, ctx, false);
    case "donut":
      return buildPie(rows, ctx, true);
    case "gauge":
      return buildGauge(rows, ctx);
    case "heatmap":
      return buildHeatmap(rows, ctx);
    case "treemap":
      return buildTreemap(rows, ctx);
    case "sankey":
      return buildSankey(rows, ctx);
    case "stacked_column":
      return buildStackedColumn(rows, ctx);
  }
}

/** True when the rows give the chart nothing to draw. */
export function hasDrawableRows(kind: DashboardChartKind, rows: DashboardQueryRow[]): boolean {
  if (kind === "gauge") return true;
  if (kind === "sankey") return rows.some((r) => isFlowRow(r) && r.value > 0);
  if (kind === "heatmap") return rows.some(isCellRow);
  if (kind === "stacked_column") return rows.some((r) => isCellRow(r) && r.value > 0);
  if (kind === "pie" || kind === "donut" || kind === "treemap") {
    return rows.some((r) => isKeyRow(r) && r.value > 0);
  }
  return rows.some(isKeyRow);
}
