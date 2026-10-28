import { describe, expect, it } from "vitest";
import { CHART_CATEGORICAL, CHART_SEQUENTIAL } from "@/theme/tokens";
import type { DashboardChartKind, DashboardQueryRow } from "@/types";
import {
  OTHER_KEY,
  buildOption,
  defaultValueFormatter,
  hasDrawableRows,
  niceMax,
  orderRows,
  type BuildContext,
} from "./buildOption";
import { buildEChartsChrome } from "./echartsTheme";

/* eslint-disable @typescript-eslint/no-explicit-any -- option trees are plain JSON here */

const chrome = buildEChartsChrome({
  mode: "light",
  text: { primary: "#111111", secondary: "#555555" },
  divider: "#dddddd",
  background: { paper: "#ffffff" },
  action: { hover: "#eeeeee" },
});

const COLORS: Record<string, string> = { A: "#aa0000", B: "#00bb00", C: "#0000cc" };

function ctx(over: Partial<BuildContext> = {}): BuildContext {
  return {
    labels: (k) => `L:${k}`,
    colors: (k, i) => COLORS[k] ?? `slot${i}`,
    theme: chrome,
    isRtl: false,
    ...over,
  };
}

const ROWS: DashboardQueryRow[] = [
  { key: "A", value: 3 },
  { key: "B", value: 0 },
  { key: "C", value: 5 },
];

const opt = (kind: DashboardChartKind, rows: DashboardQueryRow[] = ROWS, c: Partial<BuildContext> = {}) =>
  buildOption(kind, rows, ctx(c)) as any;

describe("shared chrome", () => {
  it("is transparent, accessible and themed on every kind", () => {
    for (const kind of ["bar", "column", "line", "pie", "donut", "gauge", "heatmap", "treemap", "sankey"] as const) {
      const o = opt(kind);
      expect(o.backgroundColor).toBe("transparent");
      expect(o.aria).toEqual({ enabled: true });
      expect(o.textStyle.color).toBe("#555555");
      expect(o.tooltip.backgroundColor).toBe("#ffffff");
      expect(o.tooltip.borderColor).toBe("#dddddd");
      expect(o.tooltip.textStyle.color).toBe("#111111");
      expect(o.tooltip.extraCssText).toBe("");
    }
  });

  it("writes the tooltip right-to-left in RTL", () => {
    expect(opt("bar", ROWS, { isRtl: true }).tooltip.extraCssText).toContain("direction: rtl");
  });

  it("formats tooltip values with the given formatter, or the default", () => {
    expect(opt("bar").tooltip.valueFormatter(2.345)).toBe("2.3");
    expect(opt("bar", ROWS, { valueFormatter: (v) => `${v}€` }).tooltip.valueFormatter(4)).toBe("4€");
  });
});

describe("bar (horizontal)", () => {
  it("puts categories down the y axis with entity colours and rounded data ends", () => {
    const o = opt("bar");
    expect(o.yAxis.type).toBe("category");
    expect(o.yAxis.inverse).toBe(true);
    expect(o.yAxis.position).toBe("left");
    expect(o.yAxis.data).toEqual(["L:A", "L:B", "L:C"]);
    expect(o.xAxis.type).toBe("value");
    expect(o.xAxis.inverse).toBe(false);
    expect(o.xAxis.minInterval).toBe(1);
    const s = o.series[0];
    expect(s.type).toBe("bar");
    expect(s.barMaxWidth).toBe(24);
    expect(s.data.map((d: any) => d.value)).toEqual([3, 0, 5]);
    expect(s.data.map((d: any) => d.key)).toEqual(["A", "B", "C"]);
    expect(s.data.map((d: any) => d.itemStyle.color)).toEqual(["#aa0000", "#00bb00", "#0000cc"]);
    expect(s.data[0].itemStyle.borderRadius).toEqual([0, 4, 4, 0]);
    expect(s.cursor).toBe("default");
    expect(o.legend).toBeUndefined();
  });

  it("mirrors in RTL", () => {
    const o = opt("bar", ROWS, { isRtl: true });
    expect(o.xAxis.inverse).toBe(true);
    expect(o.yAxis.position).toBe("right");
    expect(o.series[0].data[0].itemStyle.borderRadius).toEqual([4, 0, 0, 4]);
  });

  it("draws a dimension without colours of its own in one hue", () => {
    const o = opt("bar", ROWS, { colorByCategory: false, seriesColor: "#123456" });
    expect(o.series[0].data.map((d: any) => d.itemStyle.color)).toEqual(["#123456", "#123456", "#123456"]);
    const d = opt("column", ROWS, { colorByCategory: false });
    expect(d.series[0].data[1].itemStyle.color).toBe(CHART_CATEGORICAL.light[0]);
  });

  it("uses the pointer cursor and series name it is given", () => {
    const s = opt("bar", ROWS, { cursor: "pointer", seriesName: "Cards" }).series[0];
    expect(s.cursor).toBe("pointer");
    expect(s.name).toBe("Cards");
  });
});

describe("column (vertical)", () => {
  it("puts categories along the x axis, rounded at the top", () => {
    const o = opt("column");
    expect(o.xAxis.type).toBe("category");
    expect(o.xAxis.data).toEqual(["L:A", "L:B", "L:C"]);
    expect(o.yAxis.type).toBe("value");
    expect(o.yAxis.position).toBe("left");
    expect(o.series[0].data[2].itemStyle).toEqual({ color: "#0000cc", borderRadius: [4, 4, 0, 0] });
  });

  it("mirrors in RTL", () => {
    const o = opt("column", ROWS, { isRtl: true });
    expect(o.xAxis.inverse).toBe(true);
    expect(o.yAxis.position).toBe("right");
  });
});

describe("line", () => {
  it("draws one 2px series in the first hue, no area, no labels", () => {
    const o = opt("line", ROWS, { seriesColor: "#2a78d6" });
    const s = o.series[0];
    expect(s.type).toBe("line");
    expect(s.lineStyle).toEqual({ width: 2, color: "#2a78d6" });
    expect(s.symbolSize).toBe(8);
    expect(s.showSymbol).toBe(true);
    expect(s.areaStyle).toBeUndefined();
    expect(s.label).toBeUndefined();
    expect(s.data).toEqual([
      { value: 3, key: "A" },
      { value: 0, key: "B" },
      { value: 5, key: "C" },
    ]);
    expect(o.xAxis.boundaryGap).toBe(false);
    expect(o.tooltip.trigger).toBe("axis");
  });

  it("hides markers on a dense series and mirrors in RTL", () => {
    const dense = Array.from({ length: 30 }, (_, i) => ({ key: `k${i}`, value: i }));
    expect(opt("line", dense).series[0].showSymbol).toBe(false);
    const o = opt("line", ROWS, { isRtl: true });
    expect(o.xAxis.inverse).toBe(true);
    expect(o.yAxis.position).toBe("right");
  });
});

describe("pie and donut", () => {
  it("drops empty slices, labels values and shows a legend", () => {
    const o = opt("donut");
    const s = o.series[0];
    expect(s.type).toBe("pie");
    expect(s.radius).toEqual(["38%", "62%"]);
    expect(s.padAngle).toBe(2);
    expect(s.data.map((d: any) => d.key)).toEqual(["A", "C"]);
    expect(s.data.map((d: any) => d.name)).toEqual(["L:A", "L:C"]);
    expect(s.data.map((d: any) => d.itemStyle.color)).toEqual(["#aa0000", "#0000cc"]);
    expect(s.label.show).toBe(true);
    expect(s.label.formatter({ value: 5 })).toBe("5");
    expect(s.labelLine.show).toBe(false);
    expect(s.itemStyle.borderColor).toBe("#ffffff");
    expect(o.legend.data).toEqual(["L:A", "L:C"]);
    expect(o.legend.left).toBe("left");
  });

  it("fills to the centre for a pie", () => {
    const s = opt("pie").series[0];
    expect(s.radius).toEqual([0, "62%"]);
    expect(s.padAngle).toBe(0);
  });

  it("aligns the legend right in RTL", () => {
    const o = opt("pie", ROWS, { isRtl: true });
    expect(o.legend.left).toBe("right");
    expect(o.legend.align).toBe("right");
  });
});

describe("gauge", () => {
  it("shows the first value against the given max, without a needle", () => {
    const s = opt("gauge", [{ key: "total", value: 42 }], { max: 50 }).series[0];
    expect(s.type).toBe("gauge");
    expect(s.max).toBe(50);
    expect(s.data).toEqual([{ value: 42, key: "total" }]);
    expect(s.pointer.show).toBe(false);
    expect(s.progress.show).toBe(true);
    expect(s.clockwise).toBe(true);
    expect(s.startAngle).toBe(200);
    expect(s.detail.formatter(42)).toBe("42");
    expect(s.progress.itemStyle.color).toBe(CHART_CATEGORICAL.light[0]);
  });

  it("rounds the max up to a nice number when none is set, and fills right-to-left in RTL", () => {
    const s = opt("gauge", [{ key: "total", value: 42 }], { isRtl: true }).series[0];
    expect(s.max).toBe(50);
    expect(s.clockwise).toBe(false);
    expect(s.startAngle).toBe(-20);
    expect(opt("gauge", []).series[0].data[0].value).toBe(0);
  });
});

describe("heatmap", () => {
  const CELLS: DashboardQueryRow[] = [
    { x: "A", y: "p", value: 1 },
    { x: "B", y: "p", value: 4 },
    { x: "A", y: "q", value: 2 },
  ];

  it("indexes cells on two category axes with a sequential ramp", () => {
    const o = opt("heatmap", CELLS, { labels2: (k) => `Y:${k}` });
    expect(o.xAxis.data).toEqual(["L:A", "L:B"]);
    expect(o.yAxis.data).toEqual(["Y:p", "Y:q"]);
    expect(o.series[0].data).toEqual([
      [0, 0, 1],
      [1, 0, 4],
      [0, 1, 2],
    ]);
    expect(o.series[0].label.show).toBe(false);
    expect(o.visualMap.max).toBe(4);
    expect(o.visualMap.inRange.color).toEqual([...CHART_SEQUENTIAL.light]);
    expect(o.tooltip.formatter({ value: [1, 0, 4] })).toBe("L:B · Y:p: 4");
  });

  it("keeps a usable scale with no cells", () => {
    const o = opt("heatmap", []);
    expect(o.visualMap.max).toBe(1);
    expect(o.series[0].data).toEqual([]);
  });
});

describe("treemap", () => {
  it("tiles the non-empty categories in their colours", () => {
    const s = opt("treemap").series[0];
    expect(s.type).toBe("treemap");
    expect(s.data).toEqual([
      { value: 3, key: "A", name: "L:A", itemStyle: { color: "#aa0000" } },
      { value: 5, key: "C", name: "L:C", itemStyle: { color: "#0000cc" } },
    ]);
    expect(s.breadcrumb.show).toBe(false);
    expect(s.roam).toBe(false);
  });
});

describe("sankey", () => {
  const FLOWS: DashboardQueryRow[] = [
    { source: "A", target: "B", value: 2 },
    { source: "A", target: "A", value: 1 },
    { source: "C", target: "B", value: 0 },
  ];

  it("keeps sources and targets apart so a self-relation does not loop", () => {
    const o = opt("sankey", FLOWS);
    const s = o.series[0];
    expect(s.data.map((n: any) => n.name)).toEqual(["s:A", "t:B", "t:A"]);
    expect(s.data.map((n: any) => n.itemStyle.color)).toEqual(["#aa0000", "#00bb00", "#aa0000"]);
    expect(s.links).toEqual([
      { source: "s:A", target: "t:B", value: 2 },
      { source: "s:A", target: "t:A", value: 1 },
    ]);
    expect(s.label.formatter({ name: "t:B" })).toBe("L:B");
    expect(o.tooltip.formatter({ dataType: "edge", value: 2, data: { source: "s:A", target: "t:B" } })).toBe(
      "L:A → L:B: 2",
    );
    expect(o.tooltip.formatter({ dataType: "node", name: "s:A", value: 3 })).toBe("L:A: 3");
  });

  it("points the tooltip arrow the reading way in RTL", () => {
    const o = opt("sankey", FLOWS, { isRtl: true });
    expect(o.tooltip.formatter({ dataType: "edge", value: 2, data: { source: "s:A", target: "t:B" } })).toBe(
      "L:A ← L:B: 2",
    );
  });
});

describe("empty rows", () => {
  it("builds an empty but valid option for every kind", () => {
    for (const kind of ["bar", "column", "line", "pie", "donut", "treemap", "sankey"] as const) {
      const o = opt(kind, []);
      expect(o.series).toHaveLength(1);
      expect(o.series[0].data).toEqual([]);
    }
  });
});

describe("hasDrawableRows", () => {
  it("knows what each kind needs", () => {
    expect(hasDrawableRows("bar", [])).toBe(false);
    expect(hasDrawableRows("column", [{ key: "a", value: 0 }])).toBe(true);
    expect(hasDrawableRows("pie", [{ key: "a", value: 0 }])).toBe(false);
    expect(hasDrawableRows("donut", [{ key: "a", value: 1 }])).toBe(true);
    expect(hasDrawableRows("treemap", [{ key: "a", value: 0 }])).toBe(false);
    expect(hasDrawableRows("gauge", [])).toBe(true);
    expect(hasDrawableRows("heatmap", [])).toBe(false);
    expect(hasDrawableRows("heatmap", [{ x: "a", y: "b", value: 0 }])).toBe(true);
    expect(hasDrawableRows("sankey", [{ source: "a", target: "b", value: 0 }])).toBe(false);
    expect(hasDrawableRows("sankey", [{ source: "a", target: "b", value: 1 }])).toBe(true);
  });
});

describe("orderRows", () => {
  it("shows every lifecycle phase in life order, zeros included", () => {
    expect(orderRows("lifecycle_phase", [{ key: "active", value: 4 }, { key: "plan", value: 1 }])).toEqual([
      { key: "plan", value: 1 },
      { key: "phaseIn", value: 0 },
      { key: "active", value: 4 },
      { key: "phaseOut", value: 0 },
      { key: "endOfLife", value: 0 },
      { key: "none", value: 0 },
    ]);
  });

  it("shows the four completion buckets in order", () => {
    expect(orderRows("data_quality_bucket", [{ key: "75-100", value: 2 }]).map((r) => r.key)).toEqual([
      "0-25",
      "25-50",
      "50-75",
      "75-100",
    ]);
  });

  it("orders approval statuses by workflow without inventing missing ones", () => {
    expect(
      orderRows("approval_status", [
        { key: "REJECTED", value: 1 },
        { key: "CUSTOM", value: 9 },
        { key: "DRAFT", value: 2 },
      ]).map((r) => r.key),
    ).toEqual(["DRAFT", "REJECTED", "CUSTOM"]);
  });

  it("runs months oldest first", () => {
    expect(
      orderRows("created_month", [
        { key: "2026-03", value: 1 },
        { key: "2025-12", value: 1 },
        { key: "2026-01", value: 1 },
      ]).map((r) => r.key),
    ).toEqual(["2025-12", "2026-01", "2026-03"]);
    expect(
      orderRows("date", [
        { key: "2026-10-02", value: 1 },
        { key: "2026-10-01", value: 9 },
      ]).map((r) => r.key),
    ).toEqual(["2026-10-01", "2026-10-02"]);
  });

  it("runs nominal dimensions largest first, ties by key", () => {
    expect(
      orderRows("type", [
        { key: "b", value: 2 },
        { key: "a", value: 2 },
        { key: "c", value: 5 },
      ]).map((r) => r.key),
    ).toEqual(["c", "a", "b"]);
  });

  it("folds the tail into Other past max", () => {
    const rows = [5, 4, 3, 2, 1].map((v, i) => ({ key: `k${i}`, value: v }));
    expect(orderRows("type", rows, 3)).toEqual([
      { key: "k0", value: 5 },
      { key: "k1", value: 4 },
      { key: OTHER_KEY, value: 6 },
    ]);
    expect(orderRows("type", rows, 5)).toHaveLength(5);
    expect(orderRows("type", rows, 0)).toHaveLength(5);
  });
});

describe("helpers", () => {
  it("niceMax rounds up to 1, 2, 2.5, 5 or 10 times a power of ten", () => {
    expect(niceMax(0)).toBe(1);
    expect(niceMax(-3)).toBe(1);
    expect(niceMax(7)).toBe(10);
    expect(niceMax(42)).toBe(50);
    expect(niceMax(120)).toBe(200);
    expect(niceMax(240)).toBe(250);
    expect(niceMax(100)).toBe(100);
  });

  it("defaultValueFormatter prints integers bare and others to one decimal", () => {
    expect(defaultValueFormatter(3)).toBe("3");
    expect(defaultValueFormatter(3.14159)).toBe("3.1");
    expect(defaultValueFormatter(Number.NaN)).toBe("0");
  });

  it("the chrome takes the mode's categorical hues in fixed order", () => {
    expect(chrome.categorical).toBe(CHART_CATEGORICAL.light);
  });
});
