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
  BUDGET_LABEL_TOP_BAND,
  PPM_LEGEND_LABEL_WIDTH,
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

  it("is the highest budget rounded up to a nice figure when it is above the data", () => {
    // 161 would put the line on the grid's top border: the axis runs on to 200.
    expect(budgetAxisMax(POINTS, [CAPEX], [{ ...CAPEX_BUDGET, value: 161 }])).toBe(200);
    expect(budgetAxisMax(POINTS, [CAPEX], [{ ...CAPEX_BUDGET, value: 800 }])).toBe(1000);
    expect(budgetAxisMax(POINTS, [CAPEX], [{ ...CAPEX_BUDGET, value: 240 }])).toBe(250);
    // A budget already round stays the top.
    expect(budgetAxisMax(POINTS, [CAPEX], [{ ...CAPEX_BUDGET, value: 200 }])).toBe(200);
  });

  it("takes the highest budget, in whatever order the lines come", () => {
    expect(budgetAxisMax(POINTS, [CAPEX], [{ ...OPEX_BUDGET, value: 100 }, CAPEX_BUDGET])).toBe(500);
    expect(budgetAxisMax(POINTS, [CAPEX], [CAPEX_BUDGET, { ...OPEX_BUDGET, value: 100 }])).toBe(500);
  });

  it("is the budget itself when nothing is plotted yet", () => {
    expect(budgetAxisMax([], [CAPEX], [CAPEX_BUDGET])).toBe(500);
  });
});

describe("budgetLabelPosition", () => {
  it("sits above a line well below the axis top", () => {
    expect(budgetLabelPosition(100, 160)).toBe("insideEndTop");
    expect(budgetLabelPosition(89, 100)).toBe("insideEndTop");
  });

  it("drops below a line within a tenth of the axis top, where a label above would be clipped", () => {
    expect(BUDGET_LABEL_TOP_BAND).toBe(0.9);
    expect(budgetLabelPosition(90, 100)).toBe("insideEndBottom");
    expect(budgetLabelPosition(100, 100)).toBe("insideEndBottom");
    expect(budgetLabelPosition(97_000, 100_000)).toBe("insideEndBottom");
  });

  it("drops below a line above the given top too", () => {
    expect(budgetLabelPosition(120, 100)).toBe("insideEndBottom");
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

  it("draws whole series names in the legend, widened past the chrome's default", () => {
    expect(PPM_LEGEND_LABEL_WIDTH).toBe(260);
    const { legend } = build();
    expect(legend.textStyle).toEqual({
      color: "#111111",
      fontSize: 12,
      width: 260,
      overflow: "truncate",
    });
    expect(legend.selectedMode).toBe(false);
    expect(build(undefined, undefined, true).legend.textStyle.width).toBe(260);
  });
});

describe("buildCumulativeOption — axes", () => {
  it("draws the months edge to edge, offering every month and hiding only true overlaps", () => {
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
      interval: 0,
      hideOverlap: true,
    });
    // ECharts' "auto" interval thinned wide (Arabic) month labels to every
    // other month; the min/max overrides only mattered under that thinning.
    expect(xAxis.axisLabel).not.toHaveProperty("showMinLabel");
    expect(xAxis.axisLabel).not.toHaveProperty("showMaxLabel");
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
    expect(yAxis.max).toBe(500);
  });

  it("rounds the stretched axis up past a budget that is not a nice figure", () => {
    const option: any = build([CAPEX], [{ ...CAPEX_BUDGET, value: 420 }]);
    expect(option.yAxis.max).toBe(500);
    // 420 is under nine tenths of the 500 top: its label fits above the line.
    expect(option.series[0].markLine.data[0].label.position).toBe("insideEndTop");
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

  it("measures a label against the axis top, the highest budget when it is above the data", () => {
    // Data tops out at 160; the axis runs to the 500 budget. 400 is well below
    // that edge, so its label fits above the line — though it is over the data.
    const [high, mid] = build([CAPEX], [CAPEX_BUDGET, { ...OPEX_BUDGET, value: 400 }]).series[0].markLine.data;
    expect(high.label.position).toBe("insideEndBottom");
    expect(mid.label.position).toBe("insideEndTop");
    // Over 450 (nine tenths of 500) it would be clipped.
    const [, near] = build([CAPEX], [CAPEX_BUDGET, { ...OPEX_BUDGET, value: 460 }]).series[0].markLine.data;
    expect(near.label.position).toBe("insideEndBottom");
  });

  it("measures a label against the data's top when every budget is within it", () => {
    // 150 is within a tenth of the data's 160 top; 100 is not.
    const [near, low] = build([CAPEX], [
      { ...CAPEX_BUDGET, value: 150 },
      { ...OPEX_BUDGET, value: 100 },
    ]).series[0].markLine.data;
    expect(near.label.position).toBe("insideEndBottom");
    expect(low.label.position).toBe("insideEndTop");
  });

  it("drops the label of a budget just under a much larger data top", () => {
    const points = [point(1, 50_000, 0), point(2, 100_000, 0)];
    const option: any = buildCumulativeOption(
      points,
      ["Jan", "Feb"],
      [CAPEX],
      [{ ...CAPEX_BUDGET, value: 97_000 }],
      opts(),
    );
    expect(option.yAxis).not.toHaveProperty("max");
    expect(option.series[0].markLine.data[0].label.position).toBe("insideEndBottom");
  });

  it("keeps the label at the line's end in RTL — the inverted axis mirrors it", () => {
    const [capex, opex] = build(undefined, undefined, true).series[0].markLine.data;
    expect(capex.label.position).toBe("insideEndBottom");
    expect(opex.label.position).toBe("insideEndTop");
  });
});
