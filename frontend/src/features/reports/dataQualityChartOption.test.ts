import { describe, expect, it } from "vitest";
import { buildEChartsChrome } from "@/components/charts/echartsTheme";
import { BAR_MAX_THICKNESS, GRID_TRAILING_INSET } from "@/components/charts/chrome";
import {
  DATA_QUALITY_LEGEND_LABEL_WIDTH,
  buildStackedBarOption,
  stackedBarHeight,
  stackedBarTooltipHtml,
  type StackedBarOptions,
  type StackedBarRow,
  type StackedBarSeries,
} from "./dataQualityChartOption";

/* eslint-disable @typescript-eslint/no-explicit-any -- option trees are plain JSON here */

const chrome = buildEChartsChrome({
  mode: "light",
  text: { primary: "#111111", secondary: "#555555" },
  divider: "#dddddd",
  background: { paper: "#ffffff" },
  action: { hover: "#eeeeee" },
});

const ROWS: StackedBarRow[] = [
  { key: "Application", label: "App <Core>", values: [4, 3, 3] },
  { key: "ITComponent", label: "IT Component", values: [1, 0, 2] },
];

const SERIES: StackedBarSeries[] = [
  { key: "complete", name: "Complete", color: "#4caf50" },
  { key: "partial", name: "Partial", color: "#ff9800" },
  { key: "minimal", name: "Minimal", color: "#f44336" },
];

const totalLabel = (n: number) => `${n} total`;

function opts(over: Partial<StackedBarOptions> = {}): StackedBarOptions {
  return { chrome, isRtl: false, axisWidth: 150, tickFontSize: 12, totalLabel, ...over };
}

const build = (over: Partial<StackedBarOptions> = {}, rows = ROWS, series = SERIES) =>
  buildStackedBarOption(rows, series, opts(over)) as any;

describe("stackedBarHeight", () => {
  it("never drops below the minimum", () => {
    expect(stackedBarHeight(0, 250, 50)).toBe(250);
    expect(stackedBarHeight(5, 250, 50)).toBe(250);
  });

  it("grows by perRow per bar past the minimum", () => {
    expect(stackedBarHeight(6, 250, 50)).toBe(300);
    expect(stackedBarHeight(3, 160, 70)).toBe(210);
  });
});

describe("stackedBarTooltipHtml", () => {
  const params = [
    { name: "App <Core>", seriesName: "Complete", value: 3, marker: "<i>m1</i>", color: "#4caf50" },
    { name: "App <Core>", seriesName: "Part & <b>", value: 1, marker: "<i>m2</i>", color: "#ff9800" },
  ];

  it("heads with the escaped name and total, then one line per series with its share", () => {
    expect(stackedBarTooltipHtml(params, totalLabel)).toBe(
      '<div style="font-weight:700">App &lt;Core&gt;</div>' +
        '<div style="opacity:.7">4 total</div>' +
        "<div><i>m1</i> Complete: 3 (75%)</div>" +
        "<div><i>m2</i> Part &amp; &lt;b&gt;: 1 (25%)</div>",
    );
  });

  it("escapes the total label too", () => {
    const html = stackedBarTooltipHtml(params, (n) => `<${n}>`);
    expect(html).toContain('<div style="opacity:.7">&lt;4&gt;</div>');
  });

  it("rounds the share to a whole percent", () => {
    const html = stackedBarTooltipHtml(
      [
        { name: "A", seriesName: "x", value: 1, marker: "", color: "" },
        { name: "A", seriesName: "y", value: 2, marker: "", color: "" },
      ],
      totalLabel,
    );
    expect(html).toContain("<div> x: 1 (33%)</div>");
    expect(html).toContain("<div> y: 2 (67%)</div>");
  });

  it("prints 0% for every series when the total is zero", () => {
    const html = stackedBarTooltipHtml(
      [
        { name: "A", seriesName: "x", value: 0, marker: "", color: "" },
        { name: "A", seriesName: "y", value: 0, marker: "", color: "" },
      ],
      totalLabel,
    );
    expect(html).toBe(
      '<div style="font-weight:700">A</div><div style="opacity:.7">0 total</div>' +
        "<div> x: 0 (0%)</div><div> y: 0 (0%)</div>",
    );
  });

  it("accepts a single param object as well as an array", () => {
    expect(stackedBarTooltipHtml(params[0], totalLabel)).toBe(
      '<div style="font-weight:700">App &lt;Core&gt;</div>' +
        '<div style="opacity:.7">3 total</div>' +
        "<div><i>m1</i> Complete: 3 (100%)</div>",
    );
  });

  it("coerces a string value to a number", () => {
    const html = stackedBarTooltipHtml(
      [
        { name: "A", seriesName: "x", value: "2" as unknown as number, marker: "", color: "" },
        { name: "A", seriesName: "y", value: "2" as unknown as number, marker: "", color: "" },
      ],
      totalLabel,
    );
    expect(html).toContain('<div style="opacity:.7">4 total</div>');
    expect(html).toContain("<div> x: 2 (50%)</div>");
  });

  it("is empty with nothing hovered", () => {
    expect(stackedBarTooltipHtml([], totalLabel)).toBe("");
  });
});

describe("buildStackedBarOption", () => {
  it("spreads the shared base and insets the grid above a bottom legend", () => {
    const o = build();
    expect(o.backgroundColor).toBe("transparent");
    expect(o.aria).toEqual({ enabled: true });
    expect(o.grid).toEqual({ left: 8, right: GRID_TRAILING_INSET, top: 5, bottom: 40, containLabel: true });
  });

  it("puts the category axis on the reading side with the first row on top", () => {
    const y = build().yAxis;
    expect(y).toEqual({
      type: "category",
      inverse: true,
      position: "left",
      data: ["App <Core>", "IT Component"],
      axisTick: { show: false },
      axisLine: { lineStyle: { color: "#dddddd" } },
      axisLabel: { color: "#555555", fontSize: 12, width: 150, overflow: "truncate" },
      splitLine: { show: false },
    });
  });

  it("lands axisWidth and tickFontSize on the axes", () => {
    const o = build({ axisWidth: 96, tickFontSize: 11 });
    expect(o.yAxis.axisLabel.width).toBe(96);
    expect(o.yAxis.axisLabel.fontSize).toBe(11);
    expect(o.xAxis.axisLabel).toEqual({ color: "#555555", fontSize: 11 });
  });

  it("draws the value axis with integer ticks and dashed split lines", () => {
    expect(build().xAxis).toEqual({
      type: "value",
      inverse: false,
      minInterval: 1,
      axisLabel: { color: "#555555", fontSize: 12 },
      splitLine: { show: true, lineStyle: { color: "#dddddd", type: "dashed" } },
    });
  });

  it("mirrors both axes and the grid in RTL", () => {
    const o = build({ isRtl: true });
    expect(o.yAxis.position).toBe("right");
    expect(o.yAxis.inverse).toBe(true);
    expect(o.xAxis.inverse).toBe(true);
    expect(o.grid.left).toBe(GRID_TRAILING_INSET);
    expect(o.grid.right).toBe(8);
    expect(o.legend.left).toBe("right");
  });

  it("shows a legend of the series names that does not toggle", () => {
    const legend = build().legend;
    expect(legend.data).toEqual(["Complete", "Partial", "Minimal"]);
    expect(legend.selectedMode).toBe(false);
    expect(legend.bottom).toBe(0);
  });

  it("draws legend names up to 260 px wide, keeping the chrome's colour, size and truncation", () => {
    expect(DATA_QUALITY_LEGEND_LABEL_WIDTH).toBe(260);
    const legend = build().legend;
    expect(legend.textStyle).toEqual({ color: "#111111", fontSize: 12, width: 260, overflow: "truncate" });
    expect(legend.selectedMode).toBe(false);
  });

  it("uses an axis tooltip with a shadow pointer in the hover colour", () => {
    const tip = build().tooltip;
    expect(tip.trigger).toBe("axis");
    expect(tip.axisPointer).toEqual({ type: "shadow", shadowStyle: { color: "#eeeeee" } });
    expect(tip.confine).toBe(true);
  });

  it("formats the tooltip through stackedBarTooltipHtml with the caller's total label", () => {
    const tip = build({ totalLabel: (n) => `T${n}` }).tooltip;
    expect(
      tip.formatter([
        { name: "A", seriesName: "x", value: 1, marker: "", color: "" },
        { name: "A", seriesName: "y", value: 1, marker: "", color: "" },
      ]),
    ).toBe(
      '<div style="font-weight:700">A</div><div style="opacity:.7">T2</div>' +
        "<div> x: 1 (50%)</div><div> y: 1 (50%)</div>",
    );
  });

  it("stacks one clickable bar series per segment, in order, with its colour", () => {
    const series = build().series;
    expect(series).toHaveLength(3);
    series.forEach((s: any, i: number) => {
      expect(s.type).toBe("bar");
      expect(s.name).toBe(SERIES[i].name);
      expect(s.stack).toBe("a");
      expect(s.barMaxWidth).toBe(BAR_MAX_THICKNESS);
      expect(s.barCategoryGap).toBe("30%");
      expect(s.cursor).toBe("pointer");
      expect(s.emphasis).toEqual({ focus: "none" });
      expect(s.itemStyle.color).toBe(SERIES[i].color);
    });
  });

  it("rounds only the last segment, on the trailing end", () => {
    const radii = build().series.map((s: any) => s.itemStyle.borderRadius);
    expect(radii).toEqual([0, 0, [0, 4, 4, 0]]);
  });

  it("rounds the last segment on the left in RTL", () => {
    const radii = build({ isRtl: true }).series.map((s: any) => s.itemStyle.borderRadius);
    expect(radii).toEqual([0, 0, [4, 0, 0, 4]]);
  });

  it("rounds a lone segment", () => {
    const series = build({}, ROWS, [SERIES[0]]).series;
    expect(series[0].itemStyle.borderRadius).toEqual([0, 4, 4, 0]);
  });

  it("gives every datum its value, card type and segment key", () => {
    const series = build().series;
    expect(series[0].data).toEqual([
      { value: 4, type: "Application", segment: "complete" },
      { value: 1, type: "ITComponent", segment: "complete" },
    ]);
    expect(series[1].data).toEqual([
      { value: 3, type: "Application", segment: "partial" },
      { value: 0, type: "ITComponent", segment: "partial" },
    ]);
    expect(series[2].data).toEqual([
      { value: 3, type: "Application", segment: "minimal" },
      { value: 2, type: "ITComponent", segment: "minimal" },
    ]);
  });

  it("builds an empty chart from no rows", () => {
    const o = build({}, []);
    expect(o.yAxis.data).toEqual([]);
    expect(o.series.map((s: any) => s.data)).toEqual([[], [], []]);
  });
});
