import { describe, it, expect } from "vitest";
import { buildLicensingBarOption, type LicensingBarSegment } from "./licensingBarOption";
import type { EChartsChrome } from "@/components/charts/echartsTheme";

const chrome = {
  fontFamily: "x",
  textPrimary: "#000",
  textSecondary: "#111",
  divider: "#222",
  hover: "#333",
  tooltipBackground: "#fff",
} as unknown as EChartsChrome;

const segs: LicensingBarSegment[] = [
  { key: "prod", label: "Prod", licensed: 100, actual: 80, color: "hue-a" },
  { key: "dev", label: "Dev", licensed: 0, actual: 5, color: "hue-b" },
  { key: "qa", label: "QA", licensed: 40, actual: null, color: "hue-c" },
];

type Datum = number | { value: number; itemStyle?: { opacity: number } };
const opt = (isRtl = false) =>
  buildLicensingBarOption(segs, {
    chrome,
    isRtl,
    licensedLabel: "Licensed",
    actualLabel: "Actual",
  }) as unknown as {
    yAxis: { data: string[] };
    xAxis: { inverse: boolean };
    series: { name: string; stack: string; data: Datum[]; itemStyle: { color: string } }[];
  };

const value = (d: Datum) => (typeof d === "number" ? d : d.value);

describe("buildLicensingBarOption", () => {
  it("two rows, licensed faded, zero-licensed type kept, null actual as 0", () => {
    const o = opt();
    expect(o.yAxis.data).toEqual(["Licensed", "Actual"]);
    expect(o.series.map((s) => s.name)).toEqual(["Prod", "Dev", "QA"]);
    expect(o.series.map((s) => s.data.map(value))).toEqual([
      [100, 80],
      [0, 5],
      [40, 0],
    ]);
    const licensed = o.series[0].data[0] as { itemStyle: { opacity: number } };
    expect(licensed.itemStyle.opacity).toBe(0.35);
    expect(o.series[0].itemStyle.color).toBe("hue-a");
    expect(new Set(o.series.map((s) => s.stack)).size).toBe(1);
  });

  it("its tooltip is not confined and is appended to body", () => {
    const t = (opt() as unknown as { tooltip: { confine: boolean; appendTo: string } }).tooltip;
    expect(t.confine).toBe(false);
    expect(t.appendTo).toBe("body");
  });

  it("mirrors in RTL", () => {
    expect(opt(true).xAxis.inverse).toBe(true);
    expect(opt(false).xAxis.inverse).toBe(false);
  });
});
