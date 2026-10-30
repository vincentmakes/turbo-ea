/**
 * cumulativeChartOption — the pure option builder behind the PPM cumulative
 * spend charts: the budget-line extend-the-axis rule, the in-place budget
 * labels, the tooltip figure and the LTR / RTL chrome.
 */
import { describe, expect, it } from "vitest";
import { buildEChartsChrome } from "@/components/charts/echartsTheme";
import type { MonthPoint } from "./costChartData";
import {
  BUDGET_DASH,
  budgetAxisMax,
  budgetLabelPosition,
  buildCumulativeOption,
  dataMax,
  tooltipValue,
  type BudgetReference,
  type CumulativeChartOptions,
  type CumulativeLine,
} from "./cumulativeChartOption";

/* eslint-disable @typescript-eslint/no-explicit-any -- the option is plain JSON a test digs into */

const chrome = buildEChartsChrome({
  mode: "light",
  text: { primary: "#111111", secondary: "#666666" },
  divider: "#dddddd",
  background: { paper: "#ffffff" },
  action: { hover: "#f5f5f5" },
});

const opts = (isRtl = false): CumulativeChartOptions => ({
  chrome,
  isRtl,
  format: (v) => `$${v}.00`,
  formatShort: (v) => `$${v / 1000}k`,
});

function point(month: number, capex: number | null, opex: number | null): MonthPoint {
  const total = capex === null || opex === null ? null : capex + opex;
  return { year: 2020, month, key: `2020-0${month}`, capex, opex, total };
}

const POINTS: MonthPoint[] = [point(1, 0, 0), point(2, 100, 20), point(3, 160, 40), point(4, null, null)];
const LABELS = ["Jan", "Feb", "Mar", "Apr"];

const CAPEX: CumulativeLine = { key: "capex", name: "Cumulative CapEx", color: "#1976d2" };
const OPEX: CumulativeLine = { key: "opex", name: "Cumulative OpEx", color: "#9c27b0" };
const TOTAL: CumulativeLine = { key: "total", name: "Cumulative spend", color: "#1976d2" };

const CAPEX_BUDGET: BudgetReference = { value: 500, name: "CapEx budget", color: "#1976d2" };
const OPEX_BUDGET: BudgetReference = { value: 30, name: "OpEx budget", color: "#9c27b0" };

const build = (
  lines: CumulativeLine[] = [CAPEX, OPEX],
  references: BudgetReference[] = [CAPEX_BUDGET, OPEX_BUDGET],
  isRtl = false,
): any => buildCumulativeOption(POINTS, LABELS, lines, references, opts(isRtl));

describe("tooltipValue", () => {
  const value = tooltipValue((v) => `$${v}`);

  it("formats a number through the currency formatter", () => {
    expect(value(1234)).toBe("$1234");
    expect(value(0)).toBe("$0");
  });

  it("passes a string through unchanged", () => {
    expect(value("n/a")).toBe("n/a");
  });

  it("prints nothing for a missing value", () => {
    expect(value(undefined)).toBe("");
    expect(value(null)).toBe("");
  });
});

describe("dataMax", () => {
  it("is the highest non-null value of the plotted lines only", () => {
    expect(dataMax(POINTS, [CAPEX, OPEX])).toBe(160);
    expect(dataMax(POINTS, [OPEX])).toBe(40);
    // `total` (200) is not plotted on a CapEx / OpEx chart.
    expect(dataMax(POINTS, [TOTAL])).toBe(200);
  });

  it("is -Infinity when nothing is plotted", () => {
    expect(dataMax([], [CAPEX])).toBe(-Infinity);
    expect(dataMax([point(1, null, null)], [CAPEX])).toBe(-Infinity);
    expect(dataMax(POINTS, [])).toBe(-Infinity);
  });

  it("reads negative values too", () => {
    expect(dataMax([point(1, -5, -9)], [CAPEX, OPEX])).toBe(-5);
  });
});

describe("budgetAxisMax", () => {
  it("is undefined without any budget line", () => {
    expect(budgetAxisMax(POINTS, [CAPEX, OPEX], [])).toBeUndefined();
    expect(budgetAxisMax([], [CAPEX, OPEX], [])).toBeUndefined();
  });

  it("is undefined when every budget sits within the data", () => {
    expect(budgetAxisMax(POINTS, [CAPEX], [OPEX_BUDGET])).toBeUndefined();
    // Equal to the highest point: already on the axis.
    expect(budgetAxisMax(POINTS, [CAPEX], [{ ...CAPEX_BUDGET, value: 160 }])).toBeUndefined();
  });

  it("extends the axis to the highest budget when it is above the data", () => {
    const max = budgetAxisMax(POINTS, [CAPEX], [{ ...CAPEX_BUDGET, value: 161 }]);
    expect(max?.({ max: 160 })).toBe(161);
  });

  it("takes the highest budget, in whatever order the lines come", () => {
    const lowFirst = budgetAxisMax(POINTS, [CAPEX], [{ ...OPEX_BUDGET, value: 100 }, CAPEX_BUDGET]);
    const highFirst = budgetAxisMax(POINTS, [CAPEX], [CAPEX_BUDGET, { ...OPEX_BUDGET, value: 100 }]);
    expect(lowFirst?.({ max: 160 })).toBe(500);
    expect(highFirst?.({ max: 160 })).toBe(500);
  });

  it("never lowers an axis ECharts already drew higher", () => {
    const max = budgetAxisMax(POINTS, [CAPEX], [CAPEX_BUDGET]);
    expect(max?.({ max: 600 })).toBe(600);
  });
});

describe("budgetLabelPosition", () => {
  it("sits above a line inside the data", () => {
    expect(budgetLabelPosition(100, 160)).toBe("insideEndTop");
  });

  it("drops below a line at or over the top of the data, where the axis ends", () => {
    expect(budgetLabelPosition(160, 160)).toBe("insideEndBottom");
    expect(budgetLabelPosition(500, 160)).toBe("insideEndBottom");
  });
});

describe("buildCumulativeOption — root and chrome", () => {
  it("never animates", () => {
    expect(build().animation).toBe(false);
    expect(build().series[0].markLine.animation).toBe(false);
  });

  it("spreads the shared chrome root", () => {
    const option = build();
    expect(option.backgroundColor).toBe("transparent");
    expect(option.textStyle).toEqual({ fontFamily: chrome.fontFamily, color: "#666666" });
  });

  it("insets the grid on the trailing side, mirrored in RTL", () => {
    expect(build().grid).toEqual({ left: 8, right: 16, top: 8, bottom: 40, containLabel: true });
    expect(build(undefined, undefined, true).grid).toEqual({
      left: 16,
      right: 8,
      top: 8,
      bottom: 40,
      containLabel: true,
    });
  });

  it("uses an axis tooltip with a divider-coloured pointer and the currency figure", () => {
    const { tooltip } = build();
    expect(tooltip.trigger).toBe("axis");
    expect(tooltip.axisPointer).toEqual({ type: "line", lineStyle: { color: "#dddddd" } });
    expect(tooltip.valueFormatter(1234)).toBe("$1234.00");
    expect(tooltip.valueFormatter("n/a")).toBe("n/a");
    expect(tooltip.valueFormatter(undefined)).toBe("");
    expect(tooltip.extraCssText).toBe("");
    expect(build(undefined, undefined, true).tooltip.extraCssText).toContain("direction: rtl");
  });

  it("keys the lines in a legend that does not toggle them", () => {
    const { legend } = build();
    expect(legend.data).toEqual(["Cumulative CapEx", "Cumulative OpEx"]);
    expect(legend.selectedMode).toBe(false);
    expect(legend.left).toBe("left");
    expect(build(undefined, undefined, true).legend.left).toBe("right");
  });
});

describe("buildCumulativeOption — axes", () => {
  it("draws the months edge to edge, every label it can fit, first and last always", () => {
    const { xAxis } = build();
    expect(xAxis).toMatchObject({
      type: "category",
      boundaryGap: false,
      inverse: false,
      data: LABELS,
      axisTick: { show: false },
      axisLine: { lineStyle: { color: "#dddddd" } },
    });
    expect(xAxis.axisLabel).toMatchObject({
      color: "#666666",
      fontSize: 12,
      hideOverlap: true,
      showMinLabel: true,
      showMaxLabel: true,
    });
  });

  it("runs the months right to left in RTL, with the value axis on the right", () => {
    const option = build(undefined, undefined, true);
    expect(option.xAxis.inverse).toBe(true);
    expect(option.yAxis.position).toBe("right");
    expect(build().yAxis.position).toBe("left");
  });

  it("prints the value ticks compactly over dashed split lines", () => {
    const { yAxis } = build();
    expect(yAxis.type).toBe("value");
    expect(yAxis.axisLabel.formatter(2500)).toBe("$2.5k");
    expect(yAxis.axisLabel).toMatchObject({ color: "#666666", fontSize: 12 });
    expect(yAxis.splitLine).toEqual({ show: true, lineStyle: { color: "#dddddd", type: "dashed" } });
  });

  it("stretches the value axis to a budget above the data", () => {
    const { yAxis } = build([CAPEX, OPEX], [CAPEX_BUDGET]);
    expect(yAxis.max({ max: 160 })).toBe(500);
  });

  it("leaves the value axis its own ceiling when no budget is above the data", () => {
    expect(build([CAPEX, OPEX], [OPEX_BUDGET]).yAxis).not.toHaveProperty("max");
    expect(build([CAPEX, OPEX], []).yAxis).not.toHaveProperty("max");
  });
});

describe("buildCumulativeOption — series", () => {
  it("draws one smoothed line per plotted field, in its colour, with no resting dots", () => {
    const { series } = build();
    expect(series).toHaveLength(2);
    expect(series[1]).toEqual({
      type: "line",
      id: "opex",
      name: "Cumulative OpEx",
      smooth: true,
      smoothMonotone: "x",
      showSymbol: false,
      symbol: "circle",
      symbolSize: 8,
      connectNulls: false,
      lineStyle: { width: 2, color: "#9c27b0" },
      itemStyle: { color: "#9c27b0" },
      data: [0, 20, 40, null],
    });
    expect(series[0]).toMatchObject({ id: "capex", name: "Cumulative CapEx", data: [0, 100, 160, null] });
  });

  it("keeps a month with no point as a null gap", () => {
    const { series } = build([TOTAL], []);
    expect(series[0].data).toEqual([0, 120, 200, null]);
    expect(series[0].connectNulls).toBe(false);
  });

  it("puts the budget lines on the first series only", () => {
    const { series } = build();
    expect(series[0].markLine).toMatchObject({ silent: true, symbol: "none", animation: false });
    expect(series[1]).not.toHaveProperty("markLine");
  });

  it("draws an empty set of budget lines when there is no budget", () => {
    expect(build([CAPEX], []).series[0].markLine.data).toEqual([]);
  });

  it("draws each budget as a dotted, slightly faded line labelled in place", () => {
    const [capex, opex] = build().series[0].markLine.data;
    expect(capex).toEqual({
      yAxis: 500,
      name: "CapEx budget",
      lineStyle: { color: "#1976d2", type: [6, 4], opacity: 0.8, width: 1 },
      label: {
        show: true,
        formatter: "CapEx budget",
        // 500 is above the data (160): the axis's top edge.
        position: "insideEndBottom",
        color: "#1976d2",
        fontSize: 11,
      },
    });
    expect(BUDGET_DASH).toEqual([6, 4]);
    // 30 sits inside the data: room above the line.
    expect(opex).toMatchObject({ yAxis: 30, name: "OpEx budget", label: { position: "insideEndTop" } });
  });

  it("keeps the label at the line's end in RTL — the inverted axis mirrors it", () => {
    const [capex, opex] = build(undefined, undefined, true).series[0].markLine.data;
    expect(capex.label.position).toBe("insideEndBottom");
    expect(opex.label.position).toBe("insideEndTop");
  });
});
