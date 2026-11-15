/**
 * The Licensing section's two-row bar, as an ECharts option. Pure: a "Licensed"
 * row (faded) and an "Actual" row, one stacked segment per license type in each,
 * so the two rows compare at a glance. A missing actual is drawn as 0.
 */
import type { EChartsCoreOption } from "echarts/core";
import type { EChartsChrome } from "@/components/charts/echartsTheme";
import { base, tooltip, type ChartChromeContext } from "@/components/charts/chrome";

export interface LicensingBarSegment {
  key: string;
  label: string;
  licensed: number;
  actual: number | null;
  color: string;
}

export interface LicensingBarOptions {
  chrome: EChartsChrome;
  isRtl: boolean;
  licensedLabel: string;
  actualLabel: string;
}

const LICENSED_OPACITY = 0.35;

export function buildLicensingBarOption(
  segments: LicensingBarSegment[],
  o: LicensingBarOptions,
): EChartsCoreOption {
  const ctx: ChartChromeContext = { theme: o.chrome, isRtl: o.isRtl };
  return {
    ...base(ctx),
    animation: false,
    grid: { left: 0, right: 0, top: 0, bottom: 0 },
    tooltip: tooltip(ctx, {
      trigger: "item",
      confine: false,
      // Out of the chart's wrapper so it is never clipped; ECharts 6 fixes the z-index itself.
      appendTo: "body",
    }),
    xAxis: { type: "value", show: false, inverse: o.isRtl },
    yAxis: { type: "category", show: false, inverse: true, data: [o.licensedLabel, o.actualLabel] },
    series: segments.map((s) => ({
      type: "bar",
      name: s.label,
      stack: "licenses",
      barWidth: "45%",
      itemStyle: { color: s.color },
      data: [{ value: s.licensed, itemStyle: { opacity: LICENSED_OPACITY } }, s.actual ?? 0],
    })),
  };
}
