import { describe, it, expect } from "vitest";
import type { EChartsChrome } from "@/components/charts/echartsTheme";
import { pairBarsOption, pairConsumption, type PairBar, type PairGroup } from "./pairBarsOption";

const chrome = {
  mode: "light",
  fontFamily: "x",
  textPrimary: "black",
  textSecondary: "gray",
  divider: "silver",
  hover: "white",
  tooltipBackground: "white",
} as unknown as EChartsChrome;

const bar = (over: Partial<PairBar> & Pick<PairBar, "key" | "label">): PairBar => ({
  licensed: 0,
  actual: null,
  color: "hue",
  status: "No data",
  statusColor: "grey-status",
  pct: "",
  ...over,
});
const users: PairGroup = {
  metric: "users",
  label: "Users",
  status: "Over-licensed",
  statusColor: "red-status",
  pairs: [
    bar({ key: "users:prod", label: "Prod", licensed: 100, actual: 80, color: "hue-a", status: "Compliant", statusColor: "green-status", pct: "80 %" }),
    bar({ key: "users:dev", label: "Dev <b>", licensed: 10, color: "hue-b" }),
    bar({ key: "users:qa", label: "QA", licensed: 5, actual: 9, color: "hue-c", status: "Over", statusColor: "red-status", pct: "180 %" }),
    bar({ key: "users:none", label: "None", color: "hue-d" }),
    bar({ key: "users:free", label: "Free", actual: 3, status: "Over", statusColor: "red-status", pct: "no license" }),
  ],
};
const installs: PairGroup = {
  metric: "installations",
  label: "Installations",
  status: "Compliant",
  statusColor: "green-status",
  pairs: [bar({ key: "installations:prod", label: "Prod", licensed: 20, actual: 10, status: "Compliant" })],
};

/* eslint-disable @typescript-eslint/no-explicit-any -- an option tree is plain JSON a test digs into */
const opts = (over: Record<string, unknown> = {}) => ({
  selectedKey: null,
  chrome,
  isRtl: false,
  forecast: false,
  confirmed: true,
  licensedLabel: "Licensed",
  actualLabel: "Actual",
  noDataLabel: "No data",
  ...over,
});
const build = (groups: PairGroup[], over: Record<string, unknown> = {}): any =>
  pairBarsOption(groups, opts(over));

describe("pairBarsOption", () => {
  it("draws two overlapped series per group, licensed wide behind and actual narrow in front", () => {
    const o = build([users]);
    expect(o.series.map((s: any) => s.name)).toEqual(["Licensed", "Actual"]);
    const [lic, act] = o.series;
    expect(lic.barGap).toBe("-100%");
    expect(act.barGap).toBe("-100%");
    expect(lic.barWidth).toBeGreaterThan(act.barWidth);
    expect(act.z).toBeGreaterThan(lic.z ?? 0);
    expect(o.yAxis[0].data).toEqual(["Prod", "Dev <b>", "QA", "None", "Free"]);
    expect(lic.data.map((d: any) => d.value)).toEqual([100, 10, 5, 0, 0]);
  });

  it("never draws a missing actual as a zero bar", () => {
    const act = build([users]).series[1];
    expect(act.data.map((d: any) => d.value)).toEqual([80, null, 9, null, 3]);
  });

  it("gives each group its own grid and axes", () => {
    const o = build([users, installs]);
    expect(o.series).toHaveLength(4);
    expect(o.grid).toHaveLength(2);
    expect(o.series.map((s: any) => s.xAxisIndex)).toEqual([0, 0, 1, 1]);
    expect(o.series.map((s: any) => s.yAxisIndex)).toEqual([0, 0, 1, 1]);
    expect(o.grid[1].top).toBeGreaterThan(o.grid[0].top + o.grid[0].height);
  });

  it("uses the shared axis label style on the category axis", () => {
    const label = build([users]).yAxis[0].axisLabel;
    expect(label).toMatchObject({ color: "gray", fontSize: 12, interval: 0 });
  });

  it("dims the pairs that are not selected, and nothing when none is", () => {
    const opacity = (o: any, s: number) => o.series[s].data.map((d: any) => d.itemStyle.opacity);
    const none = build([users]);
    expect(opacity(none, 0).slice(0, 4)).toEqual([0.35, 0.35, 0.35, 0.35]);
    expect(opacity(none, 1)[0]).toBe(1);
    const sel = build([users], { selectedKey: "users:prod" });
    expect(opacity(sel, 1)[0]).toBe(1);
    expect(opacity(sel, 1)[2]).toBe(0.35);
    expect(opacity(sel, 0)[0]).toBe(0.35);
    expect(opacity(sel, 0)[1]).toBeLessThan(0.35);
  });

  it("fades an unconfirmed year, and the dimming of a pair still wins", () => {
    const opacity = (o: any, s: number) => o.series[s].data.map((d: any) => d.itemStyle.opacity);
    const unconfirmed = build([users], { confirmed: false });
    expect(opacity(unconfirmed, 0)[0]).toBeLessThan(0.35);
    expect(opacity(unconfirmed, 1)[0]).toBeLessThan(1);
    const both = build([users], { confirmed: false, selectedKey: "users:prod" });
    expect(opacity(both, 0)[1]).toBeLessThanOrEqual(opacity(both, 0)[0]);
    expect(opacity(both, 1)[1]).toBeLessThanOrEqual(opacity(unconfirmed, 1)[1]);
  });

  it("prints the consumption, its percentage and the status colour at the end of the longer bar", () => {
    const o = build([users]);
    const label = (s: number, i: number) => {
      const l = o.series[s].data[i].label;
      return l?.show ? { text: l.formatter(), color: l.color } : null;
    };
    expect(label(1, 0)).toBeNull(); // licensed 100 > actual 80: the text is on the licensed bar
    expect(label(0, 0)).toEqual({ text: "80 / 100 (80 %)", color: "green-status" });
    expect(label(1, 2)).toEqual({ text: "9 / 5 (180 %)", color: "red-status" }); // actual past licensed
    expect(label(0, 1)).toEqual({ text: "— / 10", color: "grey-status" }); // licensed, no actual yet
    expect(label(0, 3)?.text).toBe("No data");
    expect(label(1, 4)?.text).toBe("3 / 0 (no license)");
  });

  it("the Forecast year prints the licensed count alone, in the neutral colour", () => {
    const o = build([users], { forecast: true });
    const l = o.series[0].data[1].label;
    expect(l.formatter()).toBe("10");
    expect(l.color).toBe("gray");
    expect(pairConsumption(users.pairs[0], opts({ forecast: true }))).toBe("100");
  });

  it("mirrors in RTL and appends the tooltip to the body", () => {
    const o = build([users], { isRtl: true });
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
