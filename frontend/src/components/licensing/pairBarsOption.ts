/**
 * The Licensing section's pair bars, as an ECharts option. Pure: one grid per metric
 * group (a metric is only compared with itself), one row per pair. Licensed is the wide
 * pale bar behind, Actual the narrow solid one in front; the consumption is printed at
 * the end of the longer of the two. A missing actual is `null`, never a zero bar.
 */
import type { EChartsCoreOption } from "echarts/core";
import type { EChartsChrome } from "@/components/charts/echartsTheme";
import {
  base,
  escapeHtml,
  GRID_TRAILING_INSET,
  LABEL_CHAR_WIDTH,
  tooltip,
  VALUE_LABEL_FONT_SIZE,
  type ChartChromeContext,
} from "@/components/charts/chrome";

export interface PairBar {
  key: string;
  label: string;
  licensed: number;
  actual: number | null;
  color: string;
  /** The status as the user reads it (already translated). */
  status: string;
}

export interface PairGroup {
  metric: string;
  label: string;
  pairs: PairBar[];
}

export interface PairBarsOptions {
  selectedKey: string | null;
  chrome: EChartsChrome;
  isRtl: boolean;
  licensedLabel: string;
  actualLabel: string;
  /** Printed for a cell with neither a licensed nor an actual count. */
  noDataLabel: string;
}

const ROW_HEIGHT = 32;
const GROUP_GAP = 8;
const LICENSED_WIDTH = 22;
const ACTUAL_WIDTH = 10;
const LICENSED_OPACITY = 0.35;
const LICENSED_OPACITY_DIMMED = 0.12;
const ACTUAL_OPACITY_DIMMED = 0.35;

/** The height of the chart drawing these groups, in px. */
export function pairBarsHeight(groups: PairGroup[]): number {
  const rows = groups.reduce((n, g) => n + g.pairs.length, 0);
  return rows * ROW_HEIGHT + GROUP_GAP * Math.max(0, groups.length - 1);
}

export function pairBarsOption(groups: PairGroup[], o: PairBarsOptions): EChartsCoreOption {
  const ctx: ChartChromeContext = { theme: o.chrome, isRtl: o.isRtl };
  const end = o.isRtl ? "left" : "right";
  const consumption = (p: PairBar): string =>
    p.actual != null
      ? `${p.actual} / ${p.licensed}`
      : p.licensed === 0
        ? o.noDataLabel
        : String(p.licensed);
  const label = (p: PairBar) => ({
    show: true,
    position: end,
    color: o.chrome.textSecondary,
    fontSize: VALUE_LABEL_FONT_SIZE,
    formatter: () => consumption(p),
  });

  const grids: Record<string, unknown>[] = [];
  const series: Record<string, unknown>[] = [];
  let top = 0;
  groups.forEach((g, i) => {
    const height = g.pairs.length * ROW_HEIGHT;
    // The text is drawn past the bar's end, which a grid does not reserve room for.
    const chars = g.pairs.reduce((m, p) => Math.max(m, consumption(p).length), 0);
    const inset = Math.max(GRID_TRAILING_INSET, Math.ceil(chars * LABEL_CHAR_WIDTH) + 12);
    grids.push({
      top,
      height,
      containLabel: true,
      [o.isRtl ? "right" : "left"]: 8,
      [end]: inset,
    });
    top += height + GROUP_GAP;
    const dimmed = (p: PairBar) => o.selectedKey != null && p.key !== o.selectedKey;
    // The text rides the longer bar, so the narrow one never covers it.
    const onActual = (p: PairBar) => p.actual != null && p.actual > p.licensed;
    const common = { type: "bar", xAxisIndex: i, yAxisIndex: i, barGap: "-100%" };
    series.push({
      ...common,
      name: o.licensedLabel,
      barWidth: LICENSED_WIDTH,
      z: 2,
      data: g.pairs.map((p) => ({
        value: p.licensed,
        itemStyle: {
          color: p.color,
          opacity: dimmed(p) ? LICENSED_OPACITY_DIMMED : LICENSED_OPACITY,
        },
        label: onActual(p) ? { show: false } : label(p),
      })),
    });
    series.push({
      ...common,
      name: o.actualLabel,
      barWidth: ACTUAL_WIDTH,
      z: 3,
      data: g.pairs.map((p) => ({
        value: p.actual,
        itemStyle: { color: p.color, opacity: dimmed(p) ? ACTUAL_OPACITY_DIMMED : 1 },
        label: onActual(p) ? label(p) : { show: false },
      })),
    });
  });

  return {
    ...base(ctx),
    animation: false,
    grid: grids,
    series,
    tooltip: tooltip(ctx, {
      trigger: "item",
      confine: false,
      // Out of the chart's wrapper so it is never clipped; ECharts 6 fixes the z-index itself.
      appendTo: "body",
      formatter: (p: { seriesIndex: number; dataIndex: number }) => {
        const g = groups[Math.floor(p.seriesIndex / 2)];
        const pair = g?.pairs[p.dataIndex];
        if (!pair) return "";
        return [
          `<b>${escapeHtml(g.label)}: ${escapeHtml(pair.label)}</b>`,
          `${escapeHtml(o.licensedLabel)}: ${pair.licensed}`,
          `${escapeHtml(o.actualLabel)}: ${pair.actual ?? "—"}`,
          escapeHtml(pair.status),
        ].join("<br/>");
      },
    }),
    xAxis: groups.map((_, i) => ({ type: "value", show: false, gridIndex: i, inverse: o.isRtl })),
    yAxis: groups.map((g, i) => ({
      type: "category",
      gridIndex: i,
      inverse: true,
      position: o.isRtl ? "right" : "left",
      data: g.pairs.map((p) => p.label),
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: { color: o.chrome.textSecondary, fontSize: 12, interval: 0 },
    })),
  };
}
