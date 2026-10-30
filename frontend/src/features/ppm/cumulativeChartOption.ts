/**
 * The ECharts option behind each cumulative-spend chart on the PPM Budget &
 * Costs tab (`PpmCostCharts.tsx`): one smoothed line per cost category over
 * the months, and the dotted budget lines it is measured against. Pure — the
 * component hands it the month series, the axis labels, the palette and the
 * currency formatters, so every branch is testable without a canvas.
 */
import type { EChartsCoreOption } from "echarts/core";
import type { EChartsChrome } from "@/components/charts/echartsTheme";
import {
  axisLabel,
  base,
  grid,
  legend,
  splitLine,
  tooltip,
  type ChartChromeContext,
} from "@/components/charts/chrome";
import type { MonthPoint } from "./costChartData";

/** A plotted cumulative line: which `MonthPoint` field, its legend name, its colour. */
export interface CumulativeLine {
  key: "capex" | "opex" | "total";
  name: string;
  color: string;
}

/** A dotted budget line, labelled in place (it has no legend entry). */
export interface BudgetReference {
  value: number;
  name: string;
  color: string;
}

export interface CumulativeChartOptions {
  chrome: EChartsChrome;
  isRtl: boolean;
  /** Full currency figure, for the tooltip. */
  format: (v: number) => string;
  /** Compact currency figure, for the y-axis ticks. */
  formatShort: (v: number) => string;
}

/**
 * Widest a legend entry's name is drawn, in px. The legend holds two or three
 * cumulative series in a report-width chart, so it can afford whole names —
 * translated ones run long (the Arabic and German series names were cut short)
 * — where the chrome's default caps them at 120 px. The Data Quality report widens its legend the
 * same way.
 */
export const PPM_LEGEND_LABEL_WIDTH = 260;

/** Dotted budget lines, distinct from the solid actuals: 6 px dash, 4 px gap. */
export const BUDGET_DASH: [number, number] = [6, 4];

/**
 * The tooltip's figure: a number through the currency formatter, a string as
 * it is, anything else (a month with no point yet) as nothing at all.
 */
export function tooltipValue(format: (v: number) => string): (v: unknown) => string {
  return (v) => {
    if (typeof v === "number") return format(v);
    if (typeof v === "string") return v;
    return "";
  };
}

/** The highest point any plotted line reaches; `-Infinity` when none has one. */
export function dataMax(points: MonthPoint[], lines: CumulativeLine[]): number {
  let max = -Infinity;
  for (const p of points) {
    for (const l of lines) {
      const v = p[l.key];
      if (v !== null) max = Math.max(max, v);
    }
  }
  return max;
}

/**
 * The y axis's ceiling when a budget sits above every plotted value: ECharts
 * scales the axis to the series data only, so a budget line above it would be
 * drawn off the chart. Undefined otherwise — the axis keeps its own nice max.
 */
export function budgetAxisMax(
  points: MonthPoint[],
  lines: CumulativeLine[],
  references: BudgetReference[],
): ((extent: { max: number }) => number) | undefined {
  // No budget line: `Math.max()` is -Infinity, never above the data.
  const budgetMax = Math.max(...references.map((r) => r.value));
  if (budgetMax <= dataMax(points, lines)) return undefined;
  return (extent) => Math.max(extent.max, budgetMax);
}

/**
 * Where a budget line's name sits: at the line's end, the latest month — the
 * inverted x axis already puts that on the left in RTL (a horizontal mark
 * line runs from the axis's first category to its last), so the label mirrors
 * with no help. Above the line, or below it when the line is at (or over) the
 * top of the data: there it is the axis's top edge, and a label above it
 * would be clipped.
 */
export function budgetLabelPosition(value: number, max: number): "insideEndTop" | "insideEndBottom" {
  return value >= max ? "insideEndBottom" : "insideEndTop";
}

export function buildCumulativeOption(
  points: MonthPoint[],
  labels: string[],
  lines: CumulativeLine[],
  references: BudgetReference[],
  o: CumulativeChartOptions,
): EChartsCoreOption {
  const ctx: ChartChromeContext = { theme: o.chrome, isRtl: o.isRtl };
  const top = dataMax(points, lines);
  const max = budgetAxisMax(points, lines, references);

  const markLine = {
    silent: true,
    symbol: "none",
    animation: false,
    data: references.map((r) => ({
      yAxis: r.value,
      name: r.name,
      lineStyle: { color: r.color, type: BUDGET_DASH, opacity: 0.8, width: 1 },
      label: {
        show: true,
        formatter: r.name,
        position: budgetLabelPosition(r.value, top),
        color: r.color,
        fontSize: 11,
      },
    })),
  };

  return {
    ...base(ctx),
    animation: false,
    grid: grid(ctx, 8, 40),
    tooltip: tooltip(ctx, {
      trigger: "axis",
      axisPointer: { type: "line", lineStyle: { color: o.chrome.divider } },
      valueFormatter: tooltipValue(o.format),
    }),
    // A key, not a filter: the lines cannot be switched off from it.
    legend: legend(
      ctx,
      lines.map((l) => l.name),
      { selectedMode: false, textStyle: { width: PPM_LEGEND_LABEL_WIDTH } },
    ),
    xAxis: {
      type: "category",
      boundaryGap: false,
      inverse: o.isRtl,
      data: labels,
      axisTick: { show: false },
      axisLine: { lineStyle: { color: o.chrome.divider } },
      axisLabel: axisLabel(ctx, { hideOverlap: true, showMinLabel: true, showMaxLabel: true }),
    },
    yAxis: {
      type: "value",
      position: o.isRtl ? "right" : "left",
      // The grid's `containLabel` sizes the axis to its widest tick, so a long
      // compact figure ("CHF9999k") is never clipped.
      axisLabel: axisLabel(ctx, { formatter: (v: number) => o.formatShort(v) }),
      splitLine: splitLine(ctx),
      ...(max !== undefined && { max }),
    },
    series: lines.map((l, i) => ({
      type: "line",
      // The `MonthPoint` field it plots, so a series can be told apart by more than its label.
      id: l.key,
      name: l.name,
      smooth: true,
      smoothMonotone: "x",
      showSymbol: false,
      symbol: "circle",
      symbolSize: 8,
      // A month not reached yet is null: a gap, never a drop to zero.
      connectNulls: false,
      lineStyle: { width: 2, color: l.color },
      itemStyle: { color: l.color },
      data: points.map((p) => p[l.key]),
      // The budget lines ride on the first series; they need none of their own.
      ...(i === 0 && { markLine }),
    })),
  };
}
