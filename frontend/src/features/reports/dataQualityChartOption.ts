/**
 * The Data Quality report's two charts — completeness by type and EOL
 * coverage — are the same shape: one horizontal bar per card type, stacked
 * from a fixed set of segments, every segment clickable. This builds that
 * ECharts option from the shared chart chrome, with the dashboard's bar
 * conventions (first row on top, the category axis on the reading side, the
 * value axis mirrored in RTL, the trailing end of the stack rounded), so the
 * report reads like the homepage widgets. Pure: the page resolves labels and
 * colours, this only arranges them.
 */
import type { EChartsCoreOption } from "echarts/core";
import type { EChartsChrome } from "@/components/charts/echartsTheme";
import {
  BAR_MAX_THICKNESS,
  axisLabel,
  base,
  escapeHtml,
  grid,
  legend,
  splitLine,
  tooltip,
  type ChartChromeContext,
} from "@/components/charts/chrome";

/** One bar: a card type, its label, and its segment values in series order. */
export interface StackedBarRow {
  key: string;
  label: string;
  values: number[];
}

/** One segment of every bar. `key` rides on each datum so a click can name it. */
export interface StackedBarSeries {
  key: string;
  name: string;
  color: string;
}

export interface StackedBarOptions {
  chrome: EChartsChrome;
  isRtl: boolean;
  /** The category axis's label gutter, in px. */
  axisWidth: number;
  tickFontSize: number;
  /** The tooltip's "N total items" line. */
  totalLabel: (total: number) => string;
}

/** The subset of an ECharts axis-tooltip param the tooltip reads. */
export interface StackedBarTooltipParam {
  name: string;
  seriesName: string;
  value: number;
  marker: string;
  color: string;
}

/**
 * Widest a legend entry's name is drawn, in px. The report's legends hold two
 * to four entries, so they can afford whole names ("Linked to endoflife.date",
 * "Date entered by hand") where the chrome's default caps them at 120 px.
 */
export const DATA_QUALITY_LEGEND_LABEL_WIDTH = 260;

/** The chart's height: `perRow` px a bar, never less than `min`. */
export function stackedBarHeight(rowCount: number, min: number, perRow: number): number {
  return Math.max(min, rowCount * perRow);
}

/**
 * The hover tooltip: the type's name, its total, then one line per segment
 * with its share of that total. `marker` is ECharts' own swatch HTML and is
 * inlined as is; every other string is escaped.
 */
export function stackedBarTooltipHtml(
  params: StackedBarTooltipParam | StackedBarTooltipParam[],
  totalLabel: (total: number) => string,
): string {
  const list = Array.isArray(params) ? params : [params];
  if (list.length === 0) return "";
  const total = list.reduce((sum, p) => sum + Number(p.value), 0);
  const lines = list.map((p) => {
    const value = Number(p.value);
    const pct = total > 0 ? ((value / total) * 100).toFixed(0) : 0;
    return `<div>${p.marker} ${escapeHtml(p.seriesName)}: ${value} (${pct}%)</div>`;
  });
  return (
    `<div style="font-weight:700">${escapeHtml(list[0].name)}</div>` +
    `<div style="opacity:.7">${escapeHtml(totalLabel(total))}</div>` +
    lines.join("")
  );
}

export function buildStackedBarOption(
  rows: StackedBarRow[],
  series: StackedBarSeries[],
  o: StackedBarOptions,
): EChartsCoreOption {
  const ctx: ChartChromeContext = { theme: o.chrome, isRtl: o.isRtl, cursor: "pointer" };
  const lastIndex = series.length - 1;
  const trailingRadius = o.isRtl ? [4, 0, 0, 4] : [0, 4, 4, 0];
  return {
    ...base(ctx),
    // The legend sits in the band at the bottom.
    grid: grid(ctx, 5, 40),
    tooltip: tooltip(ctx, {
      trigger: "axis",
      axisPointer: { type: "shadow", shadowStyle: { color: o.chrome.hover } },
      formatter: (params: StackedBarTooltipParam | StackedBarTooltipParam[]) =>
        stackedBarTooltipHtml(params, o.totalLabel),
    }),
    // A key, not a filter: hiding a segment would leave the bars' totals lying.
    // Its few entries are wide enough for a whole name such as "Linked to
    // endoflife.date", which the chrome's default 120 px cap cut short.
    legend: legend(
      ctx,
      series.map((s) => s.name),
      { selectedMode: false, textStyle: { width: DATA_QUALITY_LEGEND_LABEL_WIDTH } },
    ),
    xAxis: {
      type: "value",
      inverse: o.isRtl,
      minInterval: 1,
      axisLabel: axisLabel(ctx, { fontSize: o.tickFontSize }),
      splitLine: splitLine(ctx),
    },
    yAxis: {
      type: "category",
      // First row at the top.
      inverse: true,
      position: o.isRtl ? "right" : "left",
      data: rows.map((r) => r.label),
      axisTick: { show: false },
      axisLine: { lineStyle: { color: o.chrome.divider } },
      axisLabel: axisLabel(ctx, { width: o.axisWidth, overflow: "truncate", fontSize: o.tickFontSize }),
      splitLine: { show: false },
    },
    series: series.map((s, i) => ({
      type: "bar",
      name: s.name,
      stack: "a",
      barMaxWidth: BAR_MAX_THICKNESS,
      barCategoryGap: "30%",
      cursor: "pointer",
      // Only the outer end of the stack is rounded.
      itemStyle: { color: s.color, borderRadius: i === lastIndex ? trailingRadius : 0 },
      emphasis: { focus: "none" },
      // Each datum names its card type and segment, so a click needs nothing else.
      data: rows.map((r) => ({ value: r.values[i], type: r.key, segment: s.key })),
    })),
  };
}
