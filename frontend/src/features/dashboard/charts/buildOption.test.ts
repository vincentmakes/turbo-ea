import { describe, expect, it } from "vitest";
import { CHART_CATEGORICAL, CHART_SEQUENTIAL, STATUS_COLORS } from "@/theme/tokens";
import type { DashboardChartKind, DashboardQueryRow } from "@/types";
import {
  BAR_MAX_THICKNESS,
  COLUMN_MAX_WIDTH,
  DEFAULT_GAUGE_THRESHOLDS,
  LEGEND_LABEL_WIDTH,
  OTHER_KEY,
  SANKEY_INSET_MAX,
  SANKEY_INSET_MIN,
  VALUE_LABEL_FONT_SIZE,
  bandColor,
  buildOption,
  buildSparkline,
  defaultValueFormatter,
  foldGrid,
  foldModeOf,
  foldRows,
  gaugeBands,
  gaugeScale,
  hasDrawableRows,
  niceMax,
  orderRows,
  sankeyInset,
  valueLabelInset,
  type BuildContext,
} from "./buildOption";
import { buildEChartsChrome } from "@/components/charts/echartsTheme";

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

/** An option tree with every function replaced by a marker, so two builds compare structurally. */
function shape(value: unknown): unknown {
  if (typeof value === "function") return "[fn]";
  if (Array.isArray(value)) return value.map(shape);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, shape(v)]));
  }
  return value;
}

const CELLS: DashboardQueryRow[] = [
  { x: "A", y: "P", value: 4 },
  { x: "A", y: "Q", value: 0 },
  { x: "B", y: "P", value: 2.5 },
  { x: "B", y: "Q", value: 7 },
];
const ALL_KINDS: DashboardChartKind[] = [
  "bar",
  "column",
  "line",
  "pie",
  "donut",
  "gauge",
  "heatmap",
  "treemap",
  "sankey",
  "stacked_column",
];
const rowsOf = (kind: DashboardChartKind): DashboardQueryRow[] =>
  kind === "heatmap" || kind === "stacked_column"
    ? CELLS
    : kind === "sankey"
      ? [{ source: "A", target: "B", value: 2 }]
      : ROWS;

describe("show values", () => {
  it("changes nothing on any kind while it is off", () => {
    for (const kind of ALL_KINDS) {
      expect(shape(opt(kind, rowsOf(kind), { showValues: false })), kind).toEqual(shape(opt(kind, rowsOf(kind))));
    }
  });

  it("changes nothing on a line, pie, donut, gauge or sankey", () => {
    for (const kind of ["line", "pie", "donut", "gauge", "sankey"] as const) {
      expect(shape(opt(kind, rowsOf(kind), { showValues: true })), kind).toEqual(shape(opt(kind, rowsOf(kind))));
    }
  });

  it("prints each bar's figure past its end, through the formatter, with room kept for the longest", () => {
    const fmt = (v: number) => `${v}€`;
    const o = opt("bar", ROWS, { showValues: true, valueFormatter: fmt });
    const label = o.series[0].label;
    expect(label).toMatchObject({ show: true, position: "right", color: "#555555", fontSize: VALUE_LABEL_FONT_SIZE });
    expect(label.formatter({ value: 3 })).toBe("3€");
    expect(label.formatter({})).toBe("0€");
    expect(o.grid.right).toBe(valueLabelInset([3, 0, 5], fmt));
    expect(o.grid.left).toBe(8);
    const rtl = opt("bar", ROWS, { showValues: true, valueFormatter: fmt, isRtl: true });
    expect(rtl.series[0].label.position).toBe("left");
    expect(rtl.grid.left).toBe(valueLabelInset([3, 0, 5], fmt));
    expect(rtl.grid.right).toBe(8);
    // Off, the grid keeps its plain insets.
    expect(opt("bar").grid).toMatchObject({ left: 8, right: 16 });
    expect(opt("bar", ROWS, { isRtl: true }).grid).toMatchObject({ left: 16, right: 8 });
  });

  it("sizes the bar inset from the longest formatted value, never under the plain inset", () => {
    const pct = (v: number) => `${v.toFixed(1)}%`;
    expect(valueLabelInset([], pct)).toBe(16);
    expect(valueLabelInset([3], String)).toBe(16);
    expect(valueLabelInset([42], String)).toBe(Math.ceil((2 * 6.6 * 11) / 12 + 9));
    expect(valueLabelInset([3, 120, 7], pct)).toBe(Math.ceil((6 * 6.6 * 11) / 12 + 9));
    // The formatted text decides, not the number.
    expect(valueLabelInset([1], () => "x".repeat(10))).toBe(Math.ceil((10 * 6.6 * 11) / 12 + 9));
  });

  it("lets a column or a stacked column grow to the cap, so four of them do not look like sticks", () => {
    expect(COLUMN_MAX_WIDTH).toBeGreaterThanOrEqual(64);
    expect(opt("column", ROWS).series[0].barMaxWidth).toBe(COLUMN_MAX_WIDTH);
    expect(opt("stacked_column", CELLS).series[0].barMaxWidth).toBe(COLUMN_MAX_WIDTH);
    expect(BAR_MAX_THICKNESS).toBeGreaterThanOrEqual(32);
  });

  it("prints each column's figure on top", () => {
    const label = opt("column", ROWS, { showValues: true, valueFormatter: (v) => `${v}%` }).series[0].label;
    expect(label).toMatchObject({ show: true, position: "top", fontSize: VALUE_LABEL_FONT_SIZE, color: "#555555" });
    expect(label.formatter({ value: 5 })).toBe("5%");
  });

  it("prints each stacked segment's figure inside it, and nothing on an empty one", () => {
    const o = opt("stacked_column", CELLS, { showValues: true });
    for (const series of o.series) {
      expect(series.label).toMatchObject({
        show: true,
        position: "inside",
        fontSize: VALUE_LABEL_FONT_SIZE,
        color: chrome.surface,
      });
      expect(series.labelLayout).toEqual({ hideOverlap: true });
    }
    const format = o.series[0].label.formatter;
    expect(format({ value: 0 })).toBe("");
    expect(format({})).toBe("");
    expect(format({ value: 2.5 })).toBe("2.5");
    expect(opt("stacked_column", CELLS, { showValues: true, valueFormatter: (v) => `${v}€` }).series[1].label.formatter({ value: 7 })).toBe(
      "7€",
    );
  });

  it("puts a treemap tile's figure on a second, smaller line under its name", () => {
    const label = opt("treemap", ROWS, { showValues: true, valueFormatter: (v) => `${v}%` }).series[0].label;
    expect(label).toMatchObject({ show: true, color: chrome.surface, fontSize: 12, overflow: "truncate" });
    expect(label.formatter({ name: "L:A", value: 3 })).toBe("L:A\n{value|3%}");
    expect(label.formatter({})).toBe("\n{value|0%}");
    expect(label.rich.value).toEqual({ color: chrome.surface, fontSize: VALUE_LABEL_FONT_SIZE, lineHeight: 16 });
    // Off, the tile shows its name only.
    expect(opt("treemap").series[0].label).toEqual({
      show: true,
      color: chrome.surface,
      fontSize: 12,
      overflow: "truncate",
    });
  });

  it("prints each heatmap cell's figure with a surface halo", () => {
    const label = opt("heatmap", CELLS, { showValues: true, valueFormatter: (v) => `${v}€` }).series[0].label;
    expect(label).toMatchObject({
      show: true,
      color: "#111111",
      textBorderColor: chrome.surface,
      textBorderWidth: 2,
      fontSize: VALUE_LABEL_FONT_SIZE,
    });
    expect(label.formatter({ value: [1, 1, 7] })).toBe("7€");
    expect(label.formatter({})).toBe("0€");
    expect(opt("heatmap", CELLS).series[0].label).toEqual({ show: false });
  });
});

describe("shared chrome", () => {
  it("is transparent, accessible and themed on every kind", () => {
    for (const kind of ["bar", "column", "line", "pie", "donut", "gauge", "heatmap", "treemap", "sankey", "stacked_column"] as const) {
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
    expect(s.barMaxWidth).toBe(BAR_MAX_THICKNESS);
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

  it("keeps the wider side inset on the trailing edge, mirrored in RTL", () => {
    for (const kind of ["bar", "column", "line", "heatmap", "stacked_column"] as const) {
      expect(opt(kind).grid).toMatchObject({ left: 8, right: 16, containLabel: true });
      expect(opt(kind, ROWS, { isRtl: true }).grid).toMatchObject({ left: 16, right: 8, containLabel: true });
    }
    expect(opt("bar").grid).toMatchObject({ top: 8, bottom: 8 });
    expect(opt("column").grid).toMatchObject({ top: 16, bottom: 8 });
    expect(opt("heatmap").grid).toMatchObject({ top: 8, bottom: 48 });
    expect(opt("stacked_column").grid).toMatchObject({ top: 16, bottom: 40 });
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

  it("ellipsises long category names under the axis", () => {
    expect(opt("line").xAxis.axisLabel).toMatchObject({ hideOverlap: true, width: 96, overflow: "truncate" });
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

  it("pages a long legend in a bottom band, each name capped and whole on hover", () => {
    const l = opt("pie").legend;
    expect(l.type).toBe("scroll");
    expect(l.orient).toBe("horizontal");
    expect(l.bottom).toBe(0);
    expect(l.textStyle).toEqual({ color: "#111111", fontSize: 12, width: LEGEND_LABEL_WIDTH, overflow: "truncate" });
    expect(LEGEND_LABEL_WIDTH).toBe(120);
    expect(l.tooltip).toEqual({ show: true });
  });

  it("aligns the legend right in RTL", () => {
    const o = opt("pie", ROWS, { isRtl: true });
    expect(o.legend.left).toBe("right");
    expect(o.legend.align).toBe("right");
  });
});

describe("gauge", () => {
  it("shows the first value against the given max, without a needle", () => {
    const o = opt("gauge", [{ key: "total", value: 42 }], { max: 50 });
    const s = o.series[0];
    expect(o.series).toHaveLength(1);
    expect(s.type).toBe("gauge");
    expect(s.max).toBe(50);
    expect(s.radius).toBe("90%");
    expect(s.data).toEqual([{ value: 42, key: "total" }]);
    expect(s.pointer.show).toBe(false);
    expect(s.progress.show).toBe(true);
    expect(s.clockwise).toBe(true);
    expect(s.startAngle).toBe(200);
    expect(s.detail.formatter(42)).toBe("{value|42}");
    expect(s.progress.itemStyle.color).toBe(CHART_CATEGORICAL.light[0]);
    expect(s.detail.rich.value.color).toBe("#111111");
    expect(s.axisLine.lineStyle.color).toEqual([[1, "#dddddd"]]);
  });

  it("rounds the max up to a nice number when none is set, and fills right-to-left in RTL", () => {
    const s = opt("gauge", [{ key: "total", value: 42 }], { isRtl: true }).series[0];
    expect(s.max).toBe(50);
    expect(s.clockwise).toBe(false);
    expect(s.startAngle).toBe(-20);
    expect(opt("gauge", []).series[0].data[0].value).toBe(0);
  });

  it("puts a % measure on a fixed 0–100 scale with the default bands, the value in its band's colour", () => {
    const o = opt("gauge", [{ key: "total", value: 73 }], { unit: "%", max: 500 });
    const [value, ring] = o.series;
    expect(value.max).toBe(100);
    expect(ring.max).toBe(100);
    expect(ring.silent).toBe(true);
    expect(ring.radius).toBe("90%");
    expect(value.radius).toBe("82%");
    expect(ring.axisLine.lineStyle).toEqual({
      width: 4,
      color: [
        [0.5, STATUS_COLORS.error],
        [0.8, STATUS_COLORS.warning],
        [1, STATUS_COLORS.success],
      ],
    });
    expect(value.progress.itemStyle.color).toBe(STATUS_COLORS.warning);
    expect(value.detail.color).toBe("#111111");
    expect(value.detail.rich.value.color).toBe("#111111");
    expect(value.detail.formatter(73)).toBe("{value|73%}");
    expect(o.tooltip.valueFormatter(73)).toBe("73%");
  });

  it("reverses the bands when a rise is bad", () => {
    const o = opt("gauge", [{ key: "total", value: 90 }], { unit: "%", thresholds: [20, 40], goodDirection: "down" });
    expect(o.series[1].axisLine.lineStyle.color).toEqual([
      [0.2, STATUS_COLORS.success],
      [0.4, STATUS_COLORS.warning],
      [1, STATUS_COLORS.error],
    ]);
    expect(o.series[0].progress.itemStyle.color).toBe(STATUS_COLORS.error);
  });

  it("bands a target gauge only when given thresholds, and says what the target is", () => {
    const plain = opt("gauge", [{ key: "total", value: 30 }], { max: 120, targetLabel: "of 120" });
    expect(plain.series).toHaveLength(1);
    expect(plain.series[0].detail.formatter(30)).toBe("{value|30}\n{target|of 120}");
    expect(plain.series[0].detail.rich.target).toEqual({ fontSize: 12, color: "#555555", lineHeight: 16 });
    const banded = opt("gauge", [{ key: "total", value: 100 }], { max: 120, thresholds: [60, 100] });
    expect(banded.series[1].axisLine.lineStyle.color).toEqual([
      [0.5, STATUS_COLORS.error],
      [100 / 120, STATUS_COLORS.warning],
      [1, STATUS_COLORS.success],
    ]);
    // On the good edge: the band above.
    expect(banded.series[0].progress.itemStyle.color).toBe(STATUS_COLORS.success);
  });

  it("never says 'of N' on a % gauge, and lets a formatter carry the unit", () => {
    const s = opt("gauge", [{ key: "total", value: 50 }], {
      unit: "%",
      targetLabel: "of 100",
      valueFormatter: (v) => `${v} pct`,
    }).series[0];
    expect(s.detail.formatter(50)).toBe("{value|50 pct}");
    expect(s.progress.itemStyle.color).toBe(STATUS_COLORS.warning);
  });

  it("scales: 100 for %, else the target, else a nice ceiling", () => {
    expect(gaugeScale(420, { unit: "%", max: 10 })).toBe(100);
    expect(gaugeScale(42, { max: 60 })).toBe(60);
    expect(gaugeScale(42, { max: 0 })).toBe(50);
    expect(gaugeScale(42, {})).toBe(50);
  });

  it("ignores thresholds that are not two ascending numbers within the scale", () => {
    expect(DEFAULT_GAUGE_THRESHOLDS).toEqual([50, 80]);
    expect(gaugeBands(100, {})).toBeNull();
    expect(gaugeBands(100, { unit: "%" })).toHaveLength(3);
    expect(gaugeBands(100, { thresholds: [80, 50] })).toBeNull();
    expect(gaugeBands(100, { thresholds: [50, 50] })).toBeNull();
    expect(gaugeBands(100, { thresholds: [-1, 50] })).toBeNull();
    expect(gaugeBands(100, { thresholds: [50, 101] })).toBeNull();
    expect(gaugeBands(100, { thresholds: [Number.NaN, 50] })).toBeNull();
    expect(gaugeBands(100, { thresholds: [0, 100] })).toEqual([
      [0, STATUS_COLORS.error],
      [100, STATUS_COLORS.warning],
      [100, STATUS_COLORS.success],
    ]);
    expect(gaugeBands(100, { thresholds: [10] as unknown as [number, number] })).toBeNull();
  });

  it("picks the band a value is in, an edge belonging to the band above", () => {
    const bands = gaugeBands(100, { thresholds: [50, 80] })!;
    expect(bandColor(49.9, bands)).toBe(STATUS_COLORS.error);
    expect(bandColor(50, bands)).toBe(STATUS_COLORS.warning);
    expect(bandColor(79, bands)).toBe(STATUS_COLORS.warning);
    expect(bandColor(80, bands)).toBe(STATUS_COLORS.success);
    expect(bandColor(150, bands)).toBe(STATUS_COLORS.success);
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

describe("treemap of cards", () => {
  it("names each tile through the labels — a card's name, not its id — and drills by its key", () => {
    const names: Record<string, string> = { id1: "CRM", id2: "ERP" };
    const o = buildOption(
      "treemap",
      [
        { key: "id1", value: 1200 },
        { key: "id2", value: 800 },
        { key: OTHER_KEY, value: 50 },
      ],
      ctx({ labels: (k) => (k === OTHER_KEY ? "Other" : (names[k] ?? k)), colors: () => "#123456" }),
    ) as any;
    const s = o.series[0];
    expect(s.data.map((d: any) => [d.key, d.name, d.value])).toEqual([
      ["id1", "CRM", 1200],
      ["id2", "ERP", 800],
      [OTHER_KEY, "Other", 50],
    ]);
    expect(s.label.show).toBe(true);
    expect(s.data.every((d: any) => d.itemStyle.color === "#123456")).toBe(true);
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

  it("names and colours each side through its own resolver, and tells the sides apart for a click", () => {
    const o = opt("sankey", FLOWS, {
      labels2: (k) => `T:${k}`,
      colors2: (k, i) => `target-${k}-${i}`,
    });
    const s = o.series[0];
    expect(s.data.map((n: any) => n.itemStyle.color)).toEqual(["#aa0000", "target-B-0", "target-A-1"]);
    expect(s.data.map((n: any) => [n.key, n.side])).toEqual([
      ["A", "source"],
      ["B", "target"],
      ["A", "target"],
    ]);
    expect(s.label.formatter({ name: "t:A" })).toBe("T:A");
    expect(s.label.formatter({ name: "s:A" })).toBe("L:A");
  });

  it("keeps room right of the last column for the longest target name, ellipsising past it", () => {
    const o = opt("sankey", FLOWS, { labels2: (k) => (k === "B" ? "x".repeat(20) : "y") });
    const s = o.series[0];
    const inset = 20 * 6.6 + 12;
    expect(s.right).toBeCloseTo(inset);
    expect(s.left).toBe(8);
    const targets = s.data.filter((n: any) => n.side === "target");
    expect(targets.map((n: any) => n.label)).toEqual([
      { width: inset - 10, overflow: "truncate" },
      { width: inset - 10, overflow: "truncate" },
    ]);
    expect(s.data.find((n: any) => n.side === "source").label).toBeUndefined();
  });

  it("sizes the inset from the label length, within its bounds", () => {
    expect(sankeyInset([])).toBe(SANKEY_INSET_MIN);
    expect(sankeyInset(["a"])).toBe(SANKEY_INSET_MIN);
    expect(sankeyInset(["ab"])).toBeCloseTo(2 * 6.6 + 12);
    expect(sankeyInset(["abc", "abcdefghij"])).toBeCloseTo(10 * 6.6 + 12);
    expect(sankeyInset(["x".repeat(26)])).toBe(SANKEY_INSET_MAX);
    expect(sankeyInset(["x".repeat(25)])).toBeCloseTo(25 * 6.6 + 12);
    expect(sankeyInset(["x".repeat(24)])).toBeCloseTo(24 * 6.6 + 12);
    expect(SANKEY_INSET_MIN).toBe(24);
    expect(SANKEY_INSET_MAX).toBe(180);
  });

  it("points the tooltip arrow the reading way in RTL", () => {
    const o = opt("sankey", FLOWS, { isRtl: true });
    expect(o.tooltip.formatter({ dataType: "edge", value: 2, data: { source: "s:A", target: "t:B" } })).toBe(
      "L:A ← L:B: 2",
    );
  });
});

describe("stacked columns", () => {
  const CELLS: DashboardQueryRow[] = [
    { x: "A", y: "active", value: 2 },
    { x: "A", y: "plan", value: 1 },
    { x: "C", y: "active", value: 4 },
  ];
  const stacked = (c: Partial<BuildContext> = {}) =>
    opt("stacked_column", CELLS, { labels2: (k) => `Y:${k}`, colors2: (k) => `c2-${k}`, ...c });

  it("draws one stacked series per second-dimension key over the first dimension's keys, in row order", () => {
    const o = stacked();
    expect(o.xAxis.data).toEqual(["L:A", "L:C"]);
    expect(o.series).toHaveLength(2);
    expect(o.series.map((x: any) => x.name)).toEqual(["Y:active", "Y:plan"]);
    expect(o.series.every((x: any) => x.stack === "total" && x.type === "bar")).toBe(true);
    expect(o.series[0].data.map((d: any) => d.value)).toEqual([2, 4]);
    // A missing cell is a zero, not a gap.
    expect(o.series[1].data.map((d: any) => d.value)).toEqual([1, 0]);
    expect(o.series[0].data[1]).toMatchObject({ key: "C", key2: "active" });
    expect(o.series.map((x: any) => x.itemStyle.color)).toEqual(["c2-active", "c2-plan"]);
    // Only the top segment gets the rounded data end.
    expect(o.series[0].itemStyle.borderRadius).toBe(0);
    expect(o.series[1].itemStyle.borderRadius).toEqual([4, 4, 0, 0]);
  });

  it("carries a legend, since colour names the series", () => {
    const o = stacked();
    expect(o.legend.data).toEqual(["Y:active", "Y:plan"]);
    expect(o.tooltip.trigger).toBe("axis");
  });

  it("mirrors in RTL and falls back to the first resolver", () => {
    const o = opt("stacked_column", CELLS, { isRtl: true });
    expect(o.xAxis.inverse).toBe(true);
    expect(o.yAxis.position).toBe("right");
    expect(o.series[0].name).toBe("L:active");
    expect(o.series[0].itemStyle.color).toBe("slot0");
  });
});

describe("foldGrid", () => {
  const GRID = [
    { x: "a", y: "p", value: 1 },
    { x: "b", y: "p", value: 5 },
    { x: "b", y: "q", value: 1 },
    { x: "c", y: "p", value: 3 },
    { x: "d", y: "q", value: 2 },
  ];

  it("folds the x categories past max into Other, per second key, keeping the largest", () => {
    expect(foldGrid(GRID, 3)).toEqual([
      { x: "b", y: "p", value: 5 },
      { x: "b", y: "q", value: 1 },
      { x: "c", y: "p", value: 3 },
      { x: OTHER_KEY, y: "p", value: 1 },
      { x: OTHER_KEY, y: "q", value: 2 },
    ]);
  });

  it("leaves a grid within max alone and does not mutate its input", () => {
    const copy = structuredClone(GRID);
    expect(foldGrid(GRID, 4)).toBe(GRID);
    expect(foldGrid(GRID)).toBe(GRID);
    expect(foldGrid(GRID, 0)).toBe(GRID);
    foldGrid(GRID, 2);
    expect(GRID).toEqual(copy);
  });

  it("keeps the largest columns whole and drops the rest for averages", () => {
    expect(foldGrid(GRID, 2, "drop")).toEqual([
      { x: "b", y: "p", value: 5 },
      { x: "b", y: "q", value: 1 },
      { x: "c", y: "p", value: 3 },
    ]);
  });

  it("names the folded column Other through the labels", () => {
    const o = opt("stacked_column", foldGrid(GRID, 2), { labels: (k) => (k === OTHER_KEY ? "Other" : k) });
    expect(o.xAxis.data).toEqual(["b", "Other"]);
  });
});

describe("foldRows", () => {
  it("keeps the order and folds the tail, an already-folded row included", () => {
    const rows = [
      { key: "x", value: 1 },
      { key: OTHER_KEY, value: 4 },
      { key: "y", value: 9 },
      { key: "z", value: 2 },
    ];
    expect(foldRows(rows, 3)).toEqual([
      { key: "x", value: 1 },
      { key: OTHER_KEY, value: 15 },
    ]);
    expect(foldRows(rows, 4)).toBe(rows);
    expect(foldRows(rows)).toBe(rows);
  });

  it("drops the tail of averages and shares instead of adding them up", () => {
    const rows = [
      { key: "x", value: 1 },
      { key: "y", value: 9 },
      { key: OTHER_KEY, value: 4 },
      { key: "z", value: 2 },
    ];
    expect(foldRows(rows, 2, "drop")).toEqual([
      { key: "x", value: 1 },
      { key: "y", value: 9 },
    ]);
    expect(foldModeOf("avg")).toBe("drop");
    expect(foldModeOf("share")).toBe("drop");
    expect(foldModeOf("sum")).toBe("sum");
    expect(foldModeOf(undefined)).toBe("sum");
  });

  it("never folds the no-related-card row of a related grouping", () => {
    const rows = [
      { key: "none", value: 1 },
      { key: "c1", value: 9 },
      { key: "c2", value: 5 },
      { key: "c3", value: 2 },
    ];
    expect(orderRows("related:r", rows, 3)).toEqual([
      { key: "c1", value: 9 },
      { key: OTHER_KEY, value: 7 },
      { key: "none", value: 1 },
    ]);
    // Other dimensions fold it like any key.
    expect(orderRows("type", rows, 2).map((r) => r.key)).toEqual(["c1", OTHER_KEY]);
  });
});

describe("sparkline", () => {
  const POINTS = [
    { date: "2026-10-01", value: 3 },
    { date: "2026-10-02", value: 5 },
  ];

  it("is one line with a faint area and nothing else to read", () => {
    const o = buildSparkline(POINTS, { theme: chrome, isRtl: false }) as any;
    // A line needs a cartesian grid; its axes exist only to carry it and are hidden.
    expect(o.xAxis.show).toBe(false);
    expect(o.yAxis.show).toBe(false);
    expect(o.legend).toBeUndefined();
    expect(o.tooltip).toBeUndefined();
    expect(o.series).toHaveLength(1);
    expect(o.series[0]).toMatchObject({ type: "line", symbol: "none", data: [3, 5] });
    expect(o.series[0].lineStyle.color).toBe(CHART_CATEGORICAL.light[0]);
    expect(o.series[0].areaStyle.opacity).toBeLessThan(0.3);
    expect(o.xAxis.data).toEqual(["2026-10-01", "2026-10-02"]);
  });

  it("runs right to left in RTL and takes a series colour", () => {
    const o = buildSparkline(POINTS, { theme: chrome, isRtl: true, seriesColor: "#123456" }) as any;
    expect(o.xAxis.inverse).toBe(true);
    expect(o.series[0].lineStyle.color).toBe("#123456");
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
    expect(hasDrawableRows("stacked_column", [{ x: "a", y: "b", value: 0 }])).toBe(false);
    expect(hasDrawableRows("stacked_column", [{ x: "a", y: "b", value: 2 }])).toBe(true);
    expect(hasDrawableRows("stacked_column", [{ key: "a", value: 2 }])).toBe(false);
  });
});

describe("orderRows — new dimensions", () => {
  it("shows the three EOL buckets and both stakeholder answers in a fixed order, zeros included", () => {
    expect(orderRows("eol_coverage", [{ key: "missing", value: 4 }]).map((r) => r.key)).toEqual([
      "linked",
      "manual",
      "missing",
    ]);
    expect(orderRows("stakeholders", [{ key: "false", value: 4 }])).toEqual([
      { key: "true", value: 0 },
      { key: "false", value: 4 },
    ]);
  });

  it("runs lifecycle months oldest first", () => {
    expect(
      orderRows("phase_month:active", [
        { key: "2026-12", value: 1 },
        { key: "2026-01", value: 9 },
      ]).map((r) => r.key),
    ).toEqual(["2026-01", "2026-12"]);
  });

  it("keeps a row the server folded last", () => {
    expect(
      orderRows("related:r", [
        { key: OTHER_KEY, value: 50 },
        { key: "c1", value: 3 },
        { key: "c2", value: 7 },
      ]).map((r) => r.key),
    ).toEqual(["c2", "c1", OTHER_KEY]);
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
