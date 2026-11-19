import { describe, it, expect } from "vitest";
import type { EChartsChrome } from "@/components/charts/echartsTheme";
import { pairHistoryOption } from "./pairHistoryOption";

const chrome = {
  mode: "light",
  fontFamily: "x",
  textPrimary: "black",
  textSecondary: "gray",
  divider: "silver",
  hover: "white",
  tooltipBackground: "white",
} as unknown as EChartsChrome;

const rows = [
  { year: "FY25", licensed: 90, actual: 70, forecast: false },
  { year: "FY26", licensed: 100, actual: null, forecast: false },
  { year: "FY27", licensed: 100, actual: 55, forecast: true },
  { year: "FY28", licensed: null, actual: null, forecast: false },
];
/* eslint-disable @typescript-eslint/no-explicit-any -- an option tree is plain JSON a test digs into */
const build = (rtl = false): any =>
  pairHistoryOption(rows, {
    chrome,
    isRtl: rtl,
    color: "hue-a",
    licensedLabel: "Licensed",
    actualLabel: "Actual",
    forecastLabel: "Forecast",
  });

describe("pairHistoryOption", () => {
  it("one column group per year, licensed wide behind and actual narrow in front", () => {
    const o = build();
    expect(o.xAxis.data).toEqual(["FY25", "FY26", "FY27 (Forecast)", "FY28"]);
    const [lic, act] = o.series;
    expect([lic.name, act.name]).toEqual(["Licensed", "Actual"]);
    expect(lic.data).toEqual([90, 100, 100, null]);
    expect(lic.barGap).toBe("-100%");
    expect(lic.barWidth).toBeGreaterThan(act.barWidth);
  });

  it("leaves the Forecast actual and an empty actual out instead of drawing a zero", () => {
    expect(build().series[1].data).toEqual([70, null, null, null]);
  });

  it("colours both series with the pair's hue and appends the tooltip to the body", () => {
    const o = build();
    expect(o.series[0].itemStyle.color).toBe("hue-a");
    expect(o.series[1].itemStyle.color).toBe("hue-a");
    expect(o.tooltip.appendTo).toBe("body");
  });

  it("leaves a year without a cell empty: no licensed bar either, never a zero", () => {
    expect(build().series[0].data[3]).toBeNull();
  });

  it("names the two series in a legend that is a key, not a filter", () => {
    const o = build();
    expect(o.legend.data).toEqual(["Licensed", "Actual"]);
    expect(o.legend.selectedMode).toBe(false);
  });

  it("mirrors the year axis in RTL", () => {
    expect(build(true).xAxis.inverse).toBe(true);
  });
});
