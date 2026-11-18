import { describe, expect, it } from "vitest";
import { buildEChartsChrome } from "@/components/charts/echartsTheme";
import { CATEGORICAL_COLORS } from "@/theme/tokens";
import { buildCostTrendOption, type CostTrendRow } from "./costTrendOption";

/* eslint-disable @typescript-eslint/no-explicit-any -- option trees are plain JSON here */

const chrome = buildEChartsChrome({
  mode: "light",
  text: { primary: "#111111", secondary: "#555555" },
  divider: "#dddddd",
  background: { paper: "#ffffff" },
  action: { hover: "#eeeeee" },
});

const ROWS: CostTrendRow[] = [
  { fiscalYear: 2025, licenseCost: 100, serviceCost: 50 },
  { fiscalYear: 2026, licenseCost: 120 },
];
const COMPONENTS = ["licenseCost", "serviceCost"];

const build = (isRtl = false) =>
  buildCostTrendOption(ROWS, COMPONENTS, {
    chrome,
    isRtl,
    format: (v) => `$${v}`,
    yearLabel: (y) => `FY${y}`,
  }) as any;

describe("buildCostTrendOption", () => {
  it("stacks one bar series per component, in the order given, with distinct colours", () => {
    const { series } = build();
    expect(series.map((s: any) => s.name)).toEqual(COMPONENTS);
    expect(new Set(series.map((s: any) => s.stack))).toEqual(new Set(["cost"]));
    expect(series.map((s: any) => s.itemStyle.color)).toEqual(CATEGORICAL_COLORS.slice(0, 2));
  });

  it("names the series and the legend by the given label, keeping the data keyed by component", () => {
    const o = buildCostTrendOption(ROWS, COMPONENTS, {
      chrome,
      isRtl: false,
      format: (v) => `$${v}`,
      yearLabel: (y) => `FY${y}`,
      componentLabel: (c) => `L:${c}`,
    }) as any;
    expect(o.series.map((s: any) => s.name)).toEqual(["L:licenseCost", "L:serviceCost"]);
    expect(o.legend.data).toEqual(["L:licenseCost", "L:serviceCost"]);
    expect(o.series[0].data).toEqual([100, 120]);
  });

  it("plots each year's total per component, and zero where a year lacks one", () => {
    const { series } = build();
    expect(series[0].data).toEqual([100, 120]);
    expect(series[1].data).toEqual([50, 0]);
  });

  it("labels the years through the report's fiscal-year names", () => {
    expect(build().xAxis.data).toEqual(["FY2025", "FY2026"]);
  });

  it("prints the costs in the report's currency", () => {
    const o = build();
    expect(o.yAxis.axisLabel.formatter(1500)).toBe("$1500");
    expect(o.tooltip.valueFormatter(70)).toBe("$70");
  });

  it("mirrors the axes in a right-to-left locale", () => {
    const o = build(true);
    expect(o.xAxis.inverse).toBe(true);
    expect(o.yAxis.position).toBe("right");
    expect(build().yAxis.position).toBe("left");
  });

  it("cost defaults unchanged", () => {
    const o = build();
    expect(o.series).toHaveLength(2);
    expect(o.legend.data).toEqual(COMPONENTS);
  });
});
