import { describe, it, expect } from "vitest";
import type { EChartsChrome } from "@/components/charts/echartsTheme";
import { pairBarsOption, type PairGroup } from "./pairBarsOption";

const chrome = {
  mode: "light",
  fontFamily: "x",
  textPrimary: "black",
  textSecondary: "gray",
  divider: "silver",
  hover: "white",
  tooltipBackground: "white",
} as unknown as EChartsChrome;

const users: PairGroup = {
  metric: "users",
  label: "Users",
  pairs: [
    { key: "users:prod", label: "Prod", licensed: 100, actual: 80, color: "hue-a", status: "Compliant" },
    { key: "users:dev", label: "Dev <b>", licensed: 10, actual: null, color: "hue-b", status: "No data" },
    { key: "users:qa", label: "QA", licensed: 5, actual: 9, color: "hue-c", status: "Over" },
    { key: "users:none", label: "None", licensed: 0, actual: null, color: "hue-d", status: "No data" },
  ],
};
const installs: PairGroup = {
  metric: "installations",
  label: "Installations",
  pairs: [{ key: "installations:prod", label: "Prod", licensed: 20, actual: 10, color: "hue-a", status: "Compliant" }],
};

/* eslint-disable @typescript-eslint/no-explicit-any -- an option tree is plain JSON a test digs into */
const build = (groups: PairGroup[], selectedKey: string | null = null, rtl = false): any =>
  pairBarsOption(groups, {
    selectedKey,
    chrome,
    isRtl: rtl,
    licensedLabel: "Licensed",
    actualLabel: "Actual",
    noDataLabel: "No data",
  });

describe("pairBarsOption", () => {
  it("draws two overlapped series per group, licensed wide behind and actual narrow in front", () => {
    const o = build([users]);
    expect(o.series.map((s: any) => s.name)).toEqual(["Licensed", "Actual"]);
    const [lic, act] = o.series;
    expect(lic.barGap).toBe("-100%");
    expect(act.barGap).toBe("-100%");
    expect(lic.barWidth).toBeGreaterThan(act.barWidth);
    expect(act.z).toBeGreaterThan(lic.z ?? 0);
    expect(o.yAxis[0].data).toEqual(["Prod", "Dev <b>", "QA", "None"]);
    expect(lic.data.map((d: any) => d.value)).toEqual([100, 10, 5, 0]);
  });

  it("never draws a missing actual as a zero bar", () => {
    const act = build([users]).series[1];
    expect(act.data.map((d: any) => d.value)).toEqual([80, null, 9, null]);
  });

  it("gives each group its own grid and axes", () => {
    const o = build([users, installs]);
    expect(o.series).toHaveLength(4);
    expect(o.grid).toHaveLength(2);
    expect(o.series.map((s: any) => s.xAxisIndex)).toEqual([0, 0, 1, 1]);
    expect(o.series.map((s: any) => s.yAxisIndex)).toEqual([0, 0, 1, 1]);
    expect(o.grid[1].top).toBeGreaterThan(o.grid[0].top + o.grid[0].height);
  });

  it("dims the pairs that are not selected, and nothing when none is", () => {
    const opacity = (o: any, s: number) => o.series[s].data.map((d: any) => d.itemStyle.opacity);
    const none = build([users]);
    expect(opacity(none, 0)).toEqual([0.35, 0.35, 0.35, 0.35]);
    expect(opacity(none, 1)[0]).toBe(1);
    const sel = build([users], "users:prod");
    expect(opacity(sel, 1)[0]).toBe(1);
    expect(opacity(sel, 1)[2]).toBe(0.35);
    expect(opacity(sel, 0)[0]).toBe(0.35);
    expect(opacity(sel, 0)[1]).toBeLessThan(0.35);
  });

  it("prints the consumption at the end of the longer bar", () => {
    const o = build([users]);
    const text = (s: number, i: number) => {
      const l = o.series[s].data[i].label;
      return l?.show ? l.formatter() : null;
    };
    expect(text(1, 0)).toBeNull(); // licensed 100 > actual 80: the text is on the licensed bar
    expect(text(0, 0)).toBe("80 / 100");
    expect(text(1, 2)).toBe("9 / 5"); // actual past licensed: the text rides the actual bar
    expect(text(0, 1)).toBe("10"); // no actual: licensed only
    expect(text(0, 3)).toBe("No data");
  });

  it("mirrors in RTL and appends the tooltip to the body", () => {
    const o = build([users], null, true);
    expect(o.xAxis[0].inverse).toBe(true);
    expect(o.series[0].data[0].label.position).toBe("left");
    expect(o.tooltip.appendTo).toBe("body");
  });

  it("escapes every label in the tooltip", () => {
    const o = build([users]);
    const html: string = o.tooltip.formatter({ seriesIndex: 0, dataIndex: 1 });
    expect(html).toContain("Dev &lt;b&gt;");
    expect(html).not.toContain("Dev <b>");
    expect(html).toContain("Users");
    expect(html).toContain("No data");
    expect(html).toContain("Licensed");
  });
});
