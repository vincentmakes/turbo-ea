/**
 * Render guard for the Cost treemap's tile labels: real ECharts (SVG
 * renderer) lays a long tail of tiles out, and the label formatter reads each
 * tile's rectangle back from the live chart through `chartTileRect` — the
 * same internal path (`getModel().getSeriesByIndex(0).getData()
 * .getItemLayout(i)`) the Cost report uses. This pins that the path still
 * answers on the installed ECharts, inside the render pass, with the tile's
 * real width and height; and that no tile prints a cost ECharts had to cut
 * ("$95,…").
 *
 * jsdom has no canvas to measure text, so ECharts is given the estimate the
 * dashboard render guard uses (6.6 px per character at 12 px).
 */
import { afterEach, describe, expect, it } from "vitest";
import * as echarts from "echarts/core";
import { TreemapChart } from "echarts/charts";
import { AriaComponent, TooltipComponent } from "echarts/components";
import { SVGRenderer } from "echarts/renderers";
import { buildEChartsChrome } from "@/components/charts/echartsTheme";
import {
  buildCostTreemapOption,
  chartTileRect,
  tileLabelTier,
  type CostTreemapItem,
  type TileLabelParams,
} from "./costTreemapOption";

echarts.use([TreemapChart, TooltipComponent, AriaComponent, SVGRenderer]);

/** Average glyph width at 12 px — the chart builders' estimate too. */
const CHAR_WIDTH_12 = 6.6;

echarts.setPlatformAPI({
  measureText: (text: string, font?: string) => {
    const size = Number(/(\d+(?:\.\d+)?)px/.exec(font ?? "")?.[1] ?? 12);
    return { width: (text.length * CHAR_WIDTH_12 * size) / 12 } as TextMetrics;
  },
});

const chrome = buildEChartsChrome({
  mode: "light",
  text: { primary: "#111111", secondary: "#555555" },
  divider: "#dddddd",
  background: { paper: "#ffffff" },
  action: { hover: "#eeeeee" },
});

const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const format = (v: number) => usd.format(v);

/** A long tail: a few large cards, then ever smaller ones. */
const ITEMS: CostTreemapItem[] = Array.from({ length: 45 }, (_, i) => ({
  id: `c${i}`,
  name: `Application ${i}`,
  cost: Math.round(1_200_000 / (1 + i * 1.7)),
  index: i,
}));

let chart: echarts.ECharts | null = null;
afterEach(() => {
  chart?.dispose();
  chart = null;
  document.body.innerHTML = "";
});

describe("Cost treemap tile labels on real ECharts", () => {
  it("reads each tile's laid-out rectangle while rendering and never prints a cut cost", () => {
    const div = document.createElement("div");
    document.body.appendChild(div);
    const live = echarts.init(div, null, { renderer: "svg", width: 1180, height: 450 });
    chart = live;

    const rects = new Map<number, { width: number; height: number } | undefined>();
    const printed = new Map<string, string>();
    const option = buildCostTreemapOption(ITEMS, {
      chrome,
      isRtl: false,
      format,
      panelTotal: ITEMS.reduce((s, d) => s + d.cost, 0),
      percentOfTotal: (pct) => `${pct}%`,
      clickable: true,
      tileRect: (i) => {
        const r = chartTileRect(live, i);
        rects.set(i, r);
        return r;
      },
    }) as { series: { label: { formatter: (p: TileLabelParams) => string } }[] };
    // Record what each tile was given, through the option's own formatter.
    const formatter = option.series[0].label.formatter;
    option.series[0].label.formatter = (p) => {
      const text = formatter(p);
      printed.set(p.name ?? "", text);
      return text;
    };
    live.setOption({ ...option, animation: false });

    // The formatter ran inside the render, and every rectangle it asked for
    // was there: real numbers, inside the canvas.
    expect(rects.size).toBeGreaterThan(20);
    for (const r of rects.values()) {
      expect(r).toBeDefined();
      expect(r!.width).toBeGreaterThan(0);
      expect(r!.width).toBeLessThanOrEqual(1180);
      expect(r!.height).toBeGreaterThan(0);
      expect(r!.height).toBeLessThanOrEqual(450);
    }

    // The long tail spans all three tiers.
    const tiers = [...rects.values()].map((r) => tileLabelTier(r!.width, r!.height));
    const texts = [...printed.values()];
    expect(tiers).toContain("full");
    expect(tiers).toContain("name");
    expect(tiers).toContain("none");
    expect(texts.filter((t) => t === "").length).toBeGreaterThan(0);
    expect(texts.filter((t) => t !== "" && !t.includes("{value|")).length).toBeGreaterThan(0);
    expect(printed.get("Application 0")).toBe(`Application 0\n{value|${format(ITEMS[0].cost)}}`);

    // What ECharts drew: every cost it printed is whole.
    const svg = live.renderToSVGString();
    const drawn = Array.from(svg.matchAll(/<text[^>]*>([^<]*)<\/text>/g), (m) => m[1]);
    const costs = drawn.filter((t) => t.includes("$"));
    expect(costs.length).toBeGreaterThan(0);
    const whole = new Set(ITEMS.map((d) => format(d.cost)));
    for (const c of costs) {
      expect(c, c).toMatch(/^\$[\d,]+$/);
      expect(whole.has(c), c).toBe(true);
    }
    // And as many as the formatter asked for: none was dropped for want of room.
    expect(costs).toHaveLength(texts.filter((t) => t.includes("{value|")).length);
  });
});
