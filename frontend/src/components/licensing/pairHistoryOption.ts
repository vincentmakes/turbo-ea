/**
 * One pair's history over the fiscal years, as an ECharts option. Pure: Licensed is the
 * wide pale column behind, Actual the narrow solid one in front. A year with no actual
 * (the Forecast, or an empty cell) leaves the actual out rather than drawing a zero.
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

export interface PairHistoryRow {
  year: string;
  /** `null` for a year with no cell for the pair: nothing is drawn, not a zero. */
  licensed: number | null;
  actual: number | null;
  forecast: boolean;
}

export interface PairHistoryOptions {
  chrome: EChartsChrome;
  isRtl: boolean;
  color: string;
  licensedLabel: string;
  actualLabel: string;
  /** Marks the Forecast year's column. */
  forecastLabel: string;
}

export function pairHistoryOption(
  rows: PairHistoryRow[],
  o: PairHistoryOptions,
): EChartsCoreOption {
  const ctx: ChartChromeContext = { theme: o.chrome, isRtl: o.isRtl };
  const common = { type: "bar", barGap: "-100%" };
  return {
    ...base(ctx),
    animation: false,
    legend: legend(ctx, [o.licensedLabel, o.actualLabel], { selectedMode: false }),
    // the bottom inset holds the legend band
    grid: grid(ctx, 8, 36),
    tooltip: tooltip(ctx, {
      trigger: "axis",
      confine: false,
      // Out of the chart's wrapper so it is never clipped; ECharts 6 fixes the z-index itself.
      appendTo: "body",
    }),
    xAxis: {
      type: "category",
      inverse: o.isRtl,
      data: rows.map((r) => (r.forecast ? `${r.year} (${o.forecastLabel})` : r.year)),
      axisLabel: axisLabel(ctx, { interval: 0 }),
      axisTick: { show: false },
    },
    yAxis: {
      type: "value",
      position: o.isRtl ? "right" : "left",
      splitLine: splitLine(ctx),
      axisLabel: axisLabel(ctx),
    },
    series: [
      {
        ...common,
        name: o.licensedLabel,
        barWidth: 28,
        z: 2,
        itemStyle: { color: o.color, opacity: 0.35 },
        data: rows.map((r) => r.licensed),
      },
      {
        ...common,
        name: o.actualLabel,
        barWidth: 12,
        z: 3,
        itemStyle: { color: o.color },
        data: rows.map((r) => (r.forecast ? null : r.actual)),
      },
    ],
  };
}
