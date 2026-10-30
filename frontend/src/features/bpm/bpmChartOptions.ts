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
import { BPM_ASSESSMENT_COLORS, STATUS_COLORS, brand } from "@/theme/tokens";
import type { DashboardKeyRow } from "@/types";
import { ATTR_COLORS } from "./processNavigatorState";

/** One colour per option key of a Process Navigator overlay map. */
function overlayColors(overlay: keyof typeof ATTR_COLORS): Record<string, string> {
  return Object.fromEntries(Object.entries(ATTR_COLORS[overlay]).map(([key, { color }]) => [key, color]));
}

// Maturity is a 5-step CMMI scale on the severity hues, worst (red) to best
// (deep green). Derived from the Process Navigator's maturity overlay so the
// dashboard and the navigator cannot drift apart. The fallback when the
// metamodel's maturity option carries no colour of its own.
export const MATURITY_COLORS: Record<string, string> = overlayColors("maturity");

// Process risk on the 4-step severity scale, derived from the Process
// Navigator's risk overlay for the same reason. The fallback when the
// metamodel's riskLevel option carries no colour of its own.
export const RISK_COLORS: Record<string, string> = overlayColors("riskLevel");

/** The colour of a value with none of its own. */
export const BPM_NEUTRAL_COLOR = STATUS_COLORS.neutral;

/** The one hue of the automation-level columns. */
export const AUTOMATION_COLOR = brand.primary;

/**
 * The five assessment dimensions, in form, table and series order: the
 * assessment field each scores, the `bpm` translation key of its name (the
 * table header's), and its trend colour.
 */
export const DIMENSIONS = [
  { key: "overall_score", labelKey: "assessment.overall", color: BPM_ASSESSMENT_COLORS.overall_score },
  { key: "efficiency", labelKey: "assessment.efficiency", color: BPM_ASSESSMENT_COLORS.efficiency },
  { key: "effectiveness", labelKey: "assessment.effectiveness", color: BPM_ASSESSMENT_COLORS.effectiveness },
  { key: "compliance", labelKey: "assessment.compliance", color: BPM_ASSESSMENT_COLORS.compliance },
  { key: "automation", labelKey: "assessment.automation", color: BPM_ASSESSMENT_COLORS.automation },
] as const;

/**
 * The colour of a value on a fixed scale: the metamodel option's own colour
 * when it defines one, else the scale's, else neutral — a value neither knows
 * is grey, never missing.
 */
export function scaleColor(scale: Record<string, string>): (key: string, optionColor?: string) => string {
  return (key, optionColor) => optionColor || scale[key] || BPM_NEUTRAL_COLOR;
}

/** A maturity level's colour: the metamodel option's, else the CMMI scale's, else neutral. */
export const maturityColor = scaleColor(MATURITY_COLORS);

/** A risk level's colour: the metamodel option's, else the risk scale's, else neutral. */
export const riskColor = scaleColor(RISK_COLORS);

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
 * columns get some 70 px a band: 64 px keeps a gap between neighbours. A
 * longer label ("4 - Measured", "Partially Automated") goes onto two lines
 * (`wrapAtSpace`); a single word wider than the band is cut with an ellipsis.
 * The builders are pure and never see the card's pixel width, hence a
 * constant.
 */
export const BPM_COLUMN_LABEL_WIDTH = 64;

/** The line height of a wrapped BPM column label, in px. */
export const BPM_COLUMN_LABEL_LINE_HEIGHT = 14;

/**
 * A category label on at most two lines, broken at the space closest to the
 * middle ("2 - Managed" → "2 -\nManaged"); on a tie, the earlier space. A label
 * with no space is returned as it is. Surrounding spaces are trimmed.
 *
 * Wrapping is done here rather than by ECharts' `overflow: "break"`: zrender
 * treats a non-Latin letter as a break opportunity, so it split Arabic words
 * mid-letter. A break only ever lands on a space here, in any script. Pure.
 */
export function wrapAtSpace(label: string): string {
  const text = label.trim();
  // The index of the middle character: a space there leaves the two lines
  // equally long.
  const middle = (text.length - 1) / 2;
  // -1 is farther from the middle than any index, so the first space replaces it.
  let at = -1;
  // Stryker disable next-line EqualityOperator: `text[text.length]` is undefined, never a space, so `<=` changes nothing
  for (let i = 0; i < text.length; i++) {
    if (text[i] === " " && Math.abs(i - middle) < Math.abs(at - middle)) at = i;
  }
  if (at === -1) return text;
  return `${text.slice(0, at).trimEnd()}\n${text.slice(at + 1).trimStart()}`;
}

/**
 * A column option whose every category keeps its label: none skipped or
 * hidden for overlap, each on at most two lines broken at a space
 * (`wrapAtSpace`), every line cut to `width` with an ellipsis (`truncate`
 * applies per line, so a word is never split). The grid is untouched: its
 * `containLabel` already measures the two-line labels. Pure.
 */
export function wrapColumnLabels(option: EChartsCoreOption, width: number): EChartsCoreOption {
  const xAxis = option.xAxis as Record<string, unknown>;
  return {
    ...option,
    xAxis: {
      ...xAxis,
      axisLabel: {
        ...(xAxis.axisLabel as Record<string, unknown>),
        interval: 0,
        hideOverlap: false,
        overflow: "truncate",
        width,
        lineHeight: BPM_COLUMN_LABEL_LINE_HEIGHT,
        formatter: (v: string) => wrapAtSpace(v),
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
