/**
 * The Costs section's per-year bars, as an ECharts option. Pure: one horizontal
 * stacked bar per fiscal year (the first of `bars`, the forecast, on top), one
 * series per cost item, the year's total printed at the end of its bar. The
 * selected year is drawn at full strength on a light tint; a year carried
 * forward and not confirmed yet is faded.
 */
import type { EChartsCoreOption } from "echarts/core";
import type { EChartsChrome } from "@/components/charts/echartsTheme";
import { base, tooltip, type ChartChromeContext } from "@/components/charts/chrome";

export interface CostYearBar {
  fiscalYear: number;
  /** The short label at the left of the bar. */
  label: string;
  confirmed: boolean;
  segments: { key: string; label: string; amount: number; color: string }[];
  total: number;
}

export interface CostsYearBarsOptions {
  chrome: EChartsChrome;
  isRtl: boolean;
  /** A cost as the workspace's currency prints it. */
  format: (v: number) => string;
  /** The selected row's tint; EChartsChrome has no success colour, so the caller passes one. */
  tintColor: string;
}

const STACK = "costs";
const RADIUS = 4;
const OPACITY_SELECTED_UNCONFIRMED = 0.55;
const OPACITY_OTHER = 0.45;

/** Corner radii [tl, tr, br, bl]: the outer ends of a row's non-zero segments are round. */
function radius(first: boolean, last: boolean, isRtl: boolean): number[] {
  const [start, end] = isRtl ? [last, first] : [first, last];
  const s = start ? RADIUS : 0;
  const e = end ? RADIUS : 0;
  return [s, e, e, s];
}

export function buildCostsYearBarsOption(
  bars: CostYearBar[],
  selectedFy: number,
  o: CostsYearBarsOptions,
): EChartsCoreOption {
  const ctx: ChartChromeContext = { theme: o.chrome, isRtl: o.isRtl, valueFormatter: o.format };
  const selectedIdx = bars.findIndex((b) => b.fiscalYear === selectedFy);
  // The lowest of the rules that apply wins; they are never multiplied.
  const opacity = (b: CostYearBar) =>
    b.fiscalYear === selectedFy
      ? b.confirmed
        ? 1
        : OPACITY_SELECTED_UNCONFIRMED
      : OPACITY_OTHER;

  const items = new Map<string, { label: string; color: string }>();
  for (const b of bars) for (const s of b.segments) items.set(s.key, s);

  const amountOf = (b: CostYearBar, key: string) =>
    b.segments.find((s) => s.key === key)?.amount ?? 0;
  const edges = bars.map((b) => {
    const present = [...items.keys()].filter((k) => amountOf(b, k) > 0);
    return { first: present[0], last: present[present.length - 1] };
  });

  const itemSeries = [...items].map(([key, item]) => ({
    type: "bar",
    name: item.label,
    stack: STACK,
    barWidth: "60%",
    itemStyle: { color: item.color },
    data: bars.map((b, i) => {
      const value = amountOf(b, key);
      return {
        value,
        itemStyle: {
          opacity: opacity(b),
          ...(value > 0 && {
            borderRadius: radius(edges[i].first === key, edges[i].last === key, o.isRtl),
          }),
        },
      };
    }),
  }));

  // A zero-width, transparent last segment: it carries the total label past the
  // bar's end (so an empty year still prints 0) and the tint behind the row.
  const totalSeries = {
    type: "bar",
    name: "",
    stack: STACK,
    barWidth: "60%",
    silent: true,
    tooltip: { show: false },
    itemStyle: { color: "transparent" },
    markArea: {
      silent: true,
      itemStyle: { color: o.tintColor },
      data: selectedIdx < 0 ? [] : [[{ yAxis: bars[selectedIdx].label }, { yAxis: bars[selectedIdx].label }]],
    },
    data: bars.map((b) => ({
      value: 0,
      label: {
        show: true,
        position: o.isRtl ? "left" : "right",
        color: o.chrome.textSecondary,
        fontSize: 12,
        fontWeight: b.fiscalYear === selectedFy ? 600 : "normal",
        formatter: () => o.format(b.total),
      },
    })),
  };

  return {
    ...base(ctx),
    animation: false,
    grid: { left: 0, right: 0, top: 0, bottom: 0, containLabel: true },
    tooltip: tooltip(ctx, {
      trigger: "item",
      confine: false,
      appendTo: "body",
      zIndex: 2000,
      valueFormatter: (v: unknown) => o.format(Number(v ?? 0)),
    }),
    xAxis: { type: "value", show: false, inverse: o.isRtl },
    yAxis: {
      type: "category",
      inverse: true,
      data: bars.map((b) => b.label),
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: {
        color: o.chrome.textSecondary,
        fontSize: 12,
        interval: 0,
        formatter: (v: string, i: number) => (i === selectedIdx ? `{sel|${v}}` : v),
        rich: { sel: { fontWeight: 600, color: o.chrome.textPrimary, fontSize: 12 } },
      },
    },
    series: [...itemSeries, totalSeries],
  };
}
