/**
 * The Cost report's history chart, as an ECharts option. Pure: one stacked
 * column per fiscal year, one segment per cost field that adds up to the
 * total, coloured from the categorical palette in the order of `components`.
 */
import type { EChartsCoreOption } from "echarts/core";
import type { EChartsChrome } from "@/components/charts/echartsTheme";
import {
  axisLabel,
  base,
  BAR_MAX_THICKNESS,
  grid,
  legend,
  splitLine,
  tooltip,
  type ChartChromeContext,
} from "@/components/charts/chrome";
import { CATEGORICAL_COLORS } from "@/theme/tokens";

/** One year of the history: its fiscal year and the total of each component. */
export type CostTrendRow = { fiscalYear: number } & Record<string, number>;

export interface CostTrendOptions {
  chrome: EChartsChrome;
  isRtl: boolean;
  /** A cost as the workspace's currency prints it. */
  format: (v: number) => string;
  /** A fiscal year as the report names it (`FY26 - Current`). */
  yearLabel: (year: number) => string;
  /** A component's display label; the key itself when omitted. */
  componentLabel?: (component: string) => string;
}

export function buildCostTrendOption(
  rows: CostTrendRow[],
  components: string[],
  o: CostTrendOptions,
): EChartsCoreOption {
  const nameOf = (component: string) => o.componentLabel?.(component) ?? component;
  const ctx: ChartChromeContext = { theme: o.chrome, isRtl: o.isRtl, valueFormatter: o.format };
  return {
    ...base(ctx),
    grid: grid(ctx, 16, 40),
    tooltip: tooltip(ctx, {
      trigger: "axis",
      axisPointer: { type: "shadow", shadowStyle: { color: ctx.theme.hover } },
      valueFormatter: (v: unknown) => o.format(Number(v ?? 0)),
    }),
    legend: legend(ctx, components.map(nameOf)),
    xAxis: {
      type: "category",
      inverse: o.isRtl,
      data: rows.map((r) => o.yearLabel(r.fiscalYear)),
      axisTick: { show: false },
      axisLine: { lineStyle: { color: ctx.theme.divider } },
      axisLabel: axisLabel(ctx, { interval: 0, hideOverlap: true }),
    },
    yAxis: {
      type: "value",
      position: o.isRtl ? "right" : "left",
      axisLabel: axisLabel(ctx, { formatter: (v: number) => o.format(v) }),
      splitLine: splitLine(ctx),
    },
    series: [
      ...components.map((component, i) => ({
        type: "bar",
        name: nameOf(component),
        stack: "cost",
        barMaxWidth: BAR_MAX_THICKNESS,
        emphasis: { focus: "series" },
        itemStyle: { color: CATEGORICAL_COLORS[i % CATEGORICAL_COLORS.length] },
        data: rows.map((r) => r[component] ?? 0),
      })),
    ],
  };
}
