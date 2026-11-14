import { describe, it, expect } from "vitest";
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
  label?: { formatter: () => string; position: string };
}
interface Out {
  yAxis: { data: string[]; inverse: boolean; axisLabel: { formatter: (v: string, i: number) => string } };
  xAxis: { inverse: boolean };
  tooltip: { confine: boolean; appendTo: string };
  series: {
    name: string;
    data: Datum[];
    itemStyle?: { color: string };
    markArea?: { silent: boolean; itemStyle: { color: string }; data: { yAxis: string }[][] };
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
    expect(area(2026)?.data).toEqual([[{ yAxis: "FY26" }, { yAxis: "FY26" }]]);
    expect(area(2027)?.data).toEqual([[{ yAxis: "FY27" }, { yAxis: "FY27" }]]);
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
});
