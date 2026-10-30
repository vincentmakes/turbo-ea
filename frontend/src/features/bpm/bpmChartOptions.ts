/**
 * The BPM charts' ECharts options: the dashboard's process-type pie and its
 * maturity / automation-level columns, and a process's assessment trend.
 *
 * The three dashboard charts are the homepage widget kinds, so they go
 * through the dashboard's `buildOption` and read like the homepage; the page
 * resolves each option key's label and colour from the metamodel and every
 * datum keeps its raw `key`, which is what a click drills down with. The
 * trend is five scores over time on the fixed 1–5 assessment scale. Pure.
 */
import type { EChartsCoreOption } from "echarts/core";
import type { EChartsChrome } from "@/components/charts/echartsTheme";
import { axisLabel, base, grid, legend, splitLine, tooltip, type ChartChromeContext } from "@/components/charts/chrome";
import { buildOption } from "@/features/dashboard/charts/buildOption";
import { RAG_COLORS, SEVERITY_COLORS, STATUS_COLORS, brand } from "@/theme/tokens";
import type { DashboardKeyRow } from "@/types";

// Maturity is a 5-step CMMI scale; reuses severity hues to convey progression
// from worst (red) to best (deep green). The fallback when the metamodel's
// maturity option carries no colour of its own.
export const MATURITY_COLORS: Record<string, string> = {
  initial: SEVERITY_COLORS.critical,
  managed: SEVERITY_COLORS.high,
  defined: SEVERITY_COLORS.medium,
  measured: SEVERITY_COLORS.low,
  optimized: RAG_COLORS.green,
};

/** The colour of a value with none of its own. */
export const BPM_NEUTRAL_COLOR = STATUS_COLORS.neutral;

/** The one hue of the automation-level columns. */
export const AUTOMATION_COLOR = brand.primary;

/** The five assessment dimensions, in form, table and series order. */
export const DIMENSIONS = [
  { key: "overall_score", label: "Overall", color: "#1976d2" },
  { key: "efficiency", label: "Efficiency", color: "#4caf50" },
  { key: "effectiveness", label: "Effectiveness", color: "#ff9800" },
  { key: "compliance", label: "Compliance", color: "#9c27b0" },
  { key: "automation", label: "Automation", color: "#00bcd4" },
] as const;

/** A maturity column's colour: the metamodel option's, else the CMMI scale's, else neutral. */
export function maturityColor(key: string, optionColor?: string): string {
  return optionColor || MATURITY_COLORS[key] || BPM_NEUTRAL_COLOR;
}

/** What every dashboard chart option reads. */
export interface BpmChartContext {
  chrome: EChartsChrome;
  isRtl: boolean;
  /** The label of a stored option key. */
  label: (key: string) => string;
  /** Series name shown in the tooltip. */
  seriesName: string;
}

export interface BpmColoredChartContext extends BpmChartContext {
  /** The colour of a stored option key. */
  color: (key: string) => string;
}

/** The process-type pie: one slice per type, coloured from the metamodel. */
export function processTypePieOption(rows: DashboardKeyRow[], ctx: BpmColoredChartContext): EChartsCoreOption {
  return buildOption("pie", rows, {
    theme: ctx.chrome,
    isRtl: ctx.isRtl,
    labels: ctx.label,
    colors: ctx.color,
    seriesName: ctx.seriesName,
    cursor: "pointer",
  });
}

/**
 * Widest a BPM column's category label is drawn, in px. The dashboard's
 * charts sit in a third of the page (about 350 px wide), so five maturity
 * columns get some 70 px a band: 64 px keeps a gap between neighbours, and a
 * longer label ("4 - Measured", "Partially Automated") wraps onto a second
 * line instead of being truncated or hidden. The builders are pure and never
 * see the card's pixel width, hence a constant.
 */
export const BPM_COLUMN_LABEL_WIDTH = 64;

/** The line height of a wrapped BPM column label, in px. */
export const BPM_COLUMN_LABEL_LINE_HEIGHT = 14;

/**
 * A column option whose every category keeps its label: none skipped or
 * hidden for overlap, each wrapped at word boundaries (`break`, never
 * `breakAll`, so a word is not split) within `width`, and the grid's bottom
 * inset raised by one line so a two-line label has room. Pure.
 */
export function wrapColumnLabels(option: EChartsCoreOption, width: number): EChartsCoreOption {
  const xAxis = option.xAxis as Record<string, unknown>;
  const grid = option.grid as Record<string, unknown>;
  return {
    ...option,
    grid: { ...grid, bottom: Number(grid.bottom) + BPM_COLUMN_LABEL_LINE_HEIGHT },
    xAxis: {
      ...xAxis,
      axisLabel: {
        ...(xAxis.axisLabel as Record<string, unknown>),
        interval: 0,
        hideOverlap: false,
        overflow: "break",
        width,
        lineHeight: BPM_COLUMN_LABEL_LINE_HEIGHT,
      },
    },
  };
}

/** The maturity columns: one per level, each in its level's colour. */
export function maturityColumnOption(rows: DashboardKeyRow[], ctx: BpmColoredChartContext): EChartsCoreOption {
  const option = buildOption("column", rows, {
    theme: ctx.chrome,
    isRtl: ctx.isRtl,
    labels: ctx.label,
    colors: ctx.color,
    colorByCategory: true,
    seriesName: ctx.seriesName,
    cursor: "pointer",
  });
  return wrapColumnLabels(option, BPM_COLUMN_LABEL_WIDTH);
}

/** The automation-level columns: one series, one hue. */
export function automationColumnOption(rows: DashboardKeyRow[], ctx: BpmChartContext): EChartsCoreOption {
  const option = buildOption("column", rows, {
    theme: ctx.chrome,
    isRtl: ctx.isRtl,
    labels: ctx.label,
    colors: () => AUTOMATION_COLOR,
    colorByCategory: false,
    seriesColor: AUTOMATION_COLOR,
    seriesName: ctx.seriesName,
    cursor: "pointer",
  });
  return wrapColumnLabels(option, BPM_COLUMN_LABEL_WIDTH);
}

/** One assessment on the trend: its formatted date and its scores in dimension order. */
export interface AssessmentTrendPoint {
  date: string;
  scores: number[];
}

export interface AssessmentDimension {
  label: string;
  color: string;
}

/** The assessment trend: one line per dimension, oldest assessment first, on the 1–5 scale. */
export function assessmentTrendOption(
  points: AssessmentTrendPoint[],
  dimensions: readonly AssessmentDimension[],
  opts: { chrome: EChartsChrome; isRtl: boolean },
): EChartsCoreOption {
  const ctx: ChartChromeContext = { theme: opts.chrome, isRtl: opts.isRtl };
  return {
    ...base(ctx),
    grid: grid(ctx, 8, 40),
    tooltip: tooltip(ctx, { trigger: "axis", axisPointer: { type: "line", lineStyle: { color: ctx.theme.divider } } }),
    legend: legend(
      ctx,
      dimensions.map((d) => d.label),
      { selectedMode: false },
    ),
    xAxis: {
      type: "category",
      boundaryGap: false,
      inverse: ctx.isRtl,
      data: points.map((p) => p.date),
      axisTick: { show: false },
      axisLine: { lineStyle: { color: ctx.theme.divider } },
      axisLabel: axisLabel(ctx, { fontSize: 11, hideOverlap: true }),
    },
    yAxis: {
      type: "value",
      min: 1,
      max: 5,
      interval: 1,
      position: ctx.isRtl ? "right" : "left",
      axisLabel: axisLabel(ctx, { fontSize: 11 }),
      splitLine: splitLine(ctx),
    },
    series: dimensions.map((d, i) => ({
      type: "line",
      name: d.label,
      smooth: true,
      smoothMonotone: "x",
      showSymbol: true,
      symbol: "circle",
      symbolSize: 6,
      lineStyle: { width: 2, color: d.color },
      itemStyle: { color: d.color },
      data: points.map((p) => p.scores[i]),
    })),
  };
}
