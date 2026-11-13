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
  niceMax,
  splitLine,
  tooltip,
  type ChartChromeContext,
} from "@/components/charts/chrome";
import { shortMonth } from "@/hooks/useDateFormat";
import type { MonthPoint, YearMonth } from "./costChartData";

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
 * The y axis's ceiling when a budget sits above every plotted value: the
 * highest budget rounded up to a nice figure (`niceMax`: 1 / 2 / 2.5 / 5 ×
 * 10ⁿ). ECharts scales the axis to the series data only, so a budget line
 * above it would be drawn off the chart; rounding up gives the axis a round
 * top tick and keeps the line inside the plot rather than on the grid's top
 * border (a budget already round, like 500, stays the top). Undefined
 * otherwise — the axis keeps its own nice max, which is already above every
 * budget.
 */
export function budgetAxisMax(
  points: MonthPoint[],
  lines: CumulativeLine[],
  references: BudgetReference[],
): number | undefined {
  // No budget line: `Math.max()` is -Infinity, never above the data.
  const budgetMax = Math.max(...references.map((r) => r.value));
  return budgetMax > dataMax(points, lines) ? niceMax(budgetMax) : undefined;
}

/**
 * The x-axis labels for a run of months: the short month name, with the
 * two-digit year appended whenever the run crosses a calendar boundary, so
 * "Jan" is never ambiguous on a multi-year axis. `shortMonth` pins the
 * Gregorian calendar (the months are Gregorian ones: `ar-SA` would otherwise
 * name Hijri months), strips the bidi marks and survives a bad locale tag —
 * the same month names as every formatted date. Shared by the Budget & Costs
 * tab and the initiative PDF.
 */
export function monthAxisLabels(months: YearMonth[], locale: string): string[] {
  const multiYear = new Set(months.map((m) => m.year)).size > 1;
  return months.map((m) => {
    // Day 1 at noon: safe from any timezone rolling the date backwards.
    const label = shortMonth(new Date(m.year, m.month - 1, 1, 12), locale);
    return multiYear ? `${label} '${String(m.year).slice(-2)}` : label;
  });
}

/**
 * The dashed CapEx and OpEx budget lines of a by-category chart, each only
 * when that budget is set, in the colour of the line it is measured against.
 */
export function categoryReferences(
  budget: { capex: number; opex: number },
  names: { capex: string; opex: string },
  colors: { capex: string; opex: string },
): BudgetReference[] {
  return [
    ...(budget.capex > 0 ? [{ value: budget.capex, name: names.capex, color: colors.capex }] : []),
    ...(budget.opex > 0 ? [{ value: budget.opex, name: names.opex, color: colors.opex }] : []),
  ];
}

/** How close to the axis top a budget line's label drops below it: within a tenth of the axis. */
export const BUDGET_LABEL_TOP_BAND = 0.9;

/**
 * Where a budget line's name sits: at the line's end, the latest month — the
 * inverted x axis already puts that on the left in RTL (a horizontal mark
 * line runs from the axis's first category to its last), so the label mirrors
 * with no help. Above the line, or below it when the line is within a label's
 * height of the axis top (`axisTop`: `budgetAxisMax` when a budget is above
 * the data, else the top of the data), where a label above would be clipped.
 */
export function budgetLabelPosition(value: number, axisTop: number): "insideEndTop" | "insideEndBottom" {
  return value >= axisTop * BUDGET_LABEL_TOP_BAND ? "insideEndBottom" : "insideEndTop";
}

/** How close two budget lines are, as a share of the axis, before their labels would collide. */
export const BUDGET_LABEL_CLASH_BAND = 0.1;

export type BudgetLabelPosition =
  | "insideEndTop"
  | "insideEndBottom"
  | "insideStartTop"
  | "insideStartBottom";

/**
 * Where each budget line's name sits. At the line's end (`budgetLabelPosition`)
 * unless an earlier line already labelled at the end is within
 * `BUDGET_LABEL_CLASH_BAND` of the axis: two nearly equal budgets (a CapEx and
 * an OpEx of about the same size) would print one name over the other, so the
 * later one moves to the line's start, keeping its side of the line. The start
 * is the emptiest corner of a cumulative chart — every line starts low — and,
 * like the end, it mirrors with the inverted axis in RTL.
 */
export function budgetLabelPositions(
  references: BudgetReference[],
  axisTop: number,
): BudgetLabelPosition[] {
  // Stryker disable next-line ArrayDeclaration: equivalent, a seeded non-number only ever gives a NaN distance, which is never within the clash band
  const atEnd: number[] = [];
  return references.map((r) => {
    const end = budgetLabelPosition(r.value, axisTop);
    if (!atEnd.some((v) => Math.abs(v - r.value) < axisTop * BUDGET_LABEL_CLASH_BAND)) {
      atEnd.push(r.value);
      return end;
    }
    return end === "insideEndTop" ? "insideStartTop" : "insideStartBottom";
  });
}

export function buildCumulativeOption(
  points: MonthPoint[],
  labels: string[],
  lines: CumulativeLine[],
  references: BudgetReference[],
  o: CumulativeChartOptions,
): EChartsCoreOption {
  const ctx: ChartChromeContext = { theme: o.chrome, isRtl: o.isRtl };
  const max = budgetAxisMax(points, lines, references);
  // The axis's top edge: the highest budget rounded up when it is above the
  // data, else the data's own top (the axis rounds it up, never down).
  const axisTop = max ?? dataMax(points, lines);
  const positions = budgetLabelPositions(references, axisTop);

  const markLine = {
    silent: true,
    symbol: "none",
    animation: false,
    data: references.map((r, i) => ({
      yAxis: r.value,
      name: r.name,
      lineStyle: { color: r.color, type: BUDGET_DASH, opacity: 0.8, width: 1 },
      label: {
        show: true,
        formatter: r.name,
        position: positions[i],
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
      // `interval: 0` offers every month and `hideOverlap` drops only labels
      // that really collide. Left at "auto", ECharts thins the axis from the
      // widest label × 1.3, and Arabic month words are wide enough that it
      // labelled every other month in RTL.
      axisLabel: axisLabel(ctx, { interval: 0, hideOverlap: true }),
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
