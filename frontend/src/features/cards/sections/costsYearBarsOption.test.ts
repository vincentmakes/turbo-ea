import { describe, it, expect } from "vitest";
import { valueLabelInset } from "@/components/charts/chrome";
import { buildCostsYearBarsOption, type CostYearBar } from "./costsYearBarsOption";
import type { EChartsChrome } from "@/components/charts/echartsTheme";

const chrome = {
  fontFamily: "x",
  textPrimary: "#000",
  textSecondary: "#111",
  divider: "#222",
  hover: "#333",
  tooltipBackground: "#fff",
} as unknown as EChartsChrome;

const bars: CostYearBar[] = [
  {
    fiscalYear: 2027,
    label: "FY27",
    confirmed: true,
    segments: [{ key: "lic", label: "Licences", amount: 10, color: "hue-a" }],
    total: 10,
  },
  {
    fiscalYear: 2026,
    label: "FY26",
    confirmed: false,
    segments: [
      { key: "lic", label: "Licences", amount: 30, color: "hue-a" },
      { key: "sup", label: "Support", amount: 20, color: "hue-b" },
    ],
    total: 50,
  },
  { fiscalYear: 2025, label: "FY25", confirmed: true, segments: [], total: 0 },
];

interface Datum {
  value: number;
  itemStyle?: { opacity: number; borderRadius?: number[] };
  label?: { formatter: () => string; position: string; fontWeight: number | string };
}
interface Out {
  yAxis: { data: string[]; inverse: boolean; position: string; axisLabel: { formatter: (v: string, i: number) => string } };
  xAxis: { inverse: boolean };
  grid: { left: number; right: number };
  tooltip: { confine: boolean; appendTo: string };
  series: {
    name: string;
    data: Datum[];
    itemStyle?: { color: string };
    markArea?: { silent: boolean; itemStyle: { color: string }; data: { yAxis: number }[][] };
  }[];
}
const build = (selectedFy: number, isRtl = false, list = bars) =>
  buildCostsYearBarsOption(list, selectedFy, {
    chrome,
    isRtl,
    format: (v) => `${v} €`,
    tintColor: "tint",
  }) as unknown as Out;

const totalSeries = (o: Out) => o.series[o.series.length - 1];

describe("buildCostsYearBarsOption", () => {
  it("one category per bar in the given order, short label", () => {
    expect(build(2026).yAxis.data).toEqual(["FY27", "FY26", "FY25"]);
  });

  it("segments carry each year's items and colours", () => {
    const o = build(2026);
    expect(o.series.slice(0, -1).map((s) => s.name)).toEqual(["Licences", "Support"]);
    expect(o.series.slice(0, -1).map((s) => s.data.map((d) => d.value))).toEqual([
      [10, 30, 0],
      [0, 20, 0],
    ]);
    expect(o.series[0].itemStyle?.color).toBe("hue-a");
    expect(o.series[1].itemStyle?.color).toBe("hue-b");
  });

  it("a year with no items is an empty row with its label and a 0 total", () => {
    const o = build(2025);
    expect(o.yAxis.data[2]).toBe("FY25");
    expect(o.series.slice(0, -1).every((s) => s.data[2].value === 0)).toBe(true);
    expect(totalSeries(o).data[2].label?.formatter()).toBe("0 €");
  });

  it("the selected year is full opacity and the others 0.45", () => {
    const o = build(2027);
    expect(o.series[0].data.map((d) => d.itemStyle?.opacity)).toEqual([1, 0.45, 0.45]);
  });

  it("an unconfirmed selected year is 0.55 and an unconfirmed other year stays 0.45", () => {
    expect(build(2026).series[0].data.map((d) => d.itemStyle?.opacity)).toEqual([0.45, 0.55, 0.45]);
    expect(build(2027).series[0].data[1].itemStyle?.opacity).toBe(0.45);
  });

  it("the tint exists only for the selected year and follows a change", () => {
    const area = (fy: number) => totalSeries(build(fy)).markArea;
    expect(area(2026)?.silent).toBe(true);
    expect(area(2026)?.itemStyle.color).toBe("tint");
    expect(area(2026)?.data).toEqual([[{ yAxis: 1 }, { yAxis: 1 }]]);
    expect(area(2027)?.data).toEqual([[{ yAxis: 0 }, { yAxis: 0 }]]);
    expect(area(1999)?.data).toEqual([]);
  });

  it("the first bar is on top (yAxis.inverse) and an empty year's total label reads the formatted 0", () => {
    const o = build(2026);
    expect(o.yAxis.inverse).toBe(true);
    const labels = totalSeries(o).data.map((d) => d.label?.formatter());
    expect(labels).toEqual(["10 €", "50 €", "0 €"]);
    expect(totalSeries(o).data[0].label?.position).toBe("right");
  });

  it("the selected label is bold through the axis label rich style", () => {
    const f = build(2026).yAxis.axisLabel.formatter;
    expect(f("FY26", 1)).toBe("{sel|FY26}");
    expect(f("FY27", 0)).toBe("FY27");
  });

  it("rounds only the outer ends of the non-zero segments, mirrored in RTL", () => {
    const radius = (o: Out, s: number, d: number) => o.series[s].data[d].itemStyle?.borderRadius;
    const ltr = build(2026);
    expect(radius(ltr, 0, 0)).toEqual([4, 4, 4, 4]);
    expect(radius(ltr, 0, 1)).toEqual([4, 0, 0, 4]);
    expect(radius(ltr, 1, 1)).toEqual([0, 4, 4, 0]);
    const rtl = build(2026, true);
    expect(radius(rtl, 0, 1)).toEqual([0, 4, 4, 0]);
    expect(radius(rtl, 1, 1)).toEqual([4, 0, 0, 4]);
  });

  it("tooltip.confine is false and tooltip.appendTo is body", () => {
    const o = build(2026);
    expect(o.tooltip.confine).toBe(false);
    expect(o.tooltip.appendTo).toBe("body");
  });

  it("RTL inverts the value axis", () => {
    expect(build(2026, true).xAxis.inverse).toBe(true);
    expect(build(2026, false).xAxis.inverse).toBe(false);
  });

  it("RTL puts the category axis on the right", () => {
    expect(build(2026, true).yAxis.position).toBe("right");
    expect(build(2026, false).yAxis.position).toBe("left");
  });

  it("keeps room for the totals on the trailing side", () => {
    const inset = valueLabelInset([10, 50, 0], (v) => `${v} €`);
    const ltr = build(2026);
    expect(ltr.grid.right).toBe(inset);
    expect(ltr.grid.left).toBe(8);
    const rtl = build(2026, true);
    expect(rtl.grid.left).toBe(inset);
    expect(rtl.grid.right).toBe(8);
  });

  it("the selected total is semi-bold, the others normal", () => {
    expect(totalSeries(build(2026)).data.map((d) => d.label?.fontWeight)).toEqual(["normal", 600, "normal"]);
  });

  it("the total label sits on the left in RTL", () => {
    expect(totalSeries(build(2026, true)).data[0].label?.position).toBe("left");
  });

  it("a zero segment has no border radius", () => {
    expect(build(2026).series[1].data[0].itemStyle?.borderRadius).toBeUndefined();
  });

  it("a selected year missing from the bars fades all, bolds nothing, tints nothing", () => {
    const o = build(1999);
    expect(o.series[0].data.map((d) => d.itemStyle?.opacity)).toEqual([0.45, 0.45, 0.45]);
    expect(o.yAxis.axisLabel.formatter("FY26", 1)).toBe("FY26");
    expect(totalSeries(o).markArea?.data).toEqual([]);
  });

  it("no bars gives an empty chart without throwing", () => {
    const o = build(2026, false, []);
    expect(o.yAxis.data).toEqual([]);
    expect(o.series).toHaveLength(1);
    expect(totalSeries(o).data).toEqual([]);
  });
});
