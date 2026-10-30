import { describe, expect, it, vi } from "vitest";
import { buildEChartsChrome } from "@/components/charts/echartsTheme";
import { CHART_LABEL_ON_DARK, CHART_LABEL_ON_DARK_MUTED, COST_TREEMAP_COLORS } from "@/theme/tokens";
import {
  buildCostTreemapOption,
  costTooltipHtml,
  treemapColor,
  type CostTreemapItem,
  type CostTreemapOptions,
} from "./costTreemapOption";

/* eslint-disable @typescript-eslint/no-explicit-any -- option trees are plain JSON here */

const chrome = buildEChartsChrome({
  mode: "light",
  text: { primary: "#111111", secondary: "#555555" },
  divider: "#dddddd",
  background: { paper: "#ffffff" },
  action: { hover: "#eeeeee" },
});

function opts(over: Partial<CostTreemapOptions> = {}): CostTreemapOptions {
  return {
    chrome,
    isRtl: false,
    format: (v) => `$${v}`,
    panelTotal: 700,
    percentOfTotal: (pct) => `${pct}% of total`,
    clickable: false,
    ...over,
  };
}

const ITEMS: CostTreemapItem[] = [
  { id: "erp", name: "ERP", cost: 500, index: 0 },
  { id: "crm", name: "CRM", cost: 100, index: 1 },
  { name: "Unlinked", cost: 100, index: 2 },
];

const build = (items: CostTreemapItem[] = ITEMS, over: Partial<CostTreemapOptions> = {}) =>
  buildCostTreemapOption(items, opts(over)) as any;
const seriesOf = (option: any) => option.series[0];

describe("treemapColor", () => {
  it("runs through the ten-blue token ramp, darkest first, and wraps by position", () => {
    expect(COST_TREEMAP_COLORS).toHaveLength(10);
    COST_TREEMAP_COLORS.forEach((c, i) => expect(treemapColor(i)).toBe(c));
    expect(treemapColor(0)).toBe(COST_TREEMAP_COLORS[0]);
    expect(treemapColor(8)).toBe(COST_TREEMAP_COLORS[8]);
    expect(treemapColor(10)).toBe(COST_TREEMAP_COLORS[0]);
    expect(treemapColor(11)).toBe(COST_TREEMAP_COLORS[1]);
    expect(treemapColor(19)).toBe(COST_TREEMAP_COLORS[9]);
    expect(treemapColor(20)).toBe(COST_TREEMAP_COLORS[0]);
  });
});

describe("costTooltipHtml", () => {
  it("names the card, prices it and gives its share of the panel total to one decimal", () => {
    expect(costTooltipHtml({ name: "ERP", cost: 500 }, opts())).toBe(
      '<div style="font-weight:700">ERP</div>' +
        '<div style="font-size:12px">$500</div>' +
        '<div style="font-size:12px;opacity:.7">71.4% of total</div>',
    );
  });

  it("hands the share line the percentage of the panel's own total", () => {
    const percentOfTotal = vi.fn((pct: string) => `share ${pct}`);
    costTooltipHtml({ name: "A", cost: 1 }, opts({ panelTotal: 8, percentOfTotal }));
    expect(percentOfTotal).toHaveBeenCalledWith("12.5");
  });

  it("prices a zero-cost datum, should ECharts ever hand one over", () => {
    expect(costTooltipHtml({ name: "Zero", cost: 0 }, opts())).toBe(
      '<div style="font-weight:700">Zero</div>' +
        '<div style="font-size:12px">$0</div>' +
        '<div style="font-size:12px;opacity:.7">0.0% of total</div>',
    );
  });

  it("leaves the share out when the panel totals nothing", () => {
    const percentOfTotal = vi.fn((pct: string) => pct);
    expect(costTooltipHtml({ name: "Zero", cost: 0 }, opts({ panelTotal: 0, percentOfTotal }))).toBe(
      '<div style="font-weight:700">Zero</div><div style="font-size:12px">$0</div>',
    );
    expect(percentOfTotal).not.toHaveBeenCalled();
  });

  it("escapes the name, the price and the share", () => {
    const html = costTooltipHtml(
      { name: "<b>Bold</b> & co", cost: 5 },
      opts({ format: () => "<i>5</i>", percentOfTotal: () => "<u>x</u>" }),
    );
    expect(html).toContain("&lt;b&gt;Bold&lt;/b&gt; &amp; co");
    expect(html).toContain("&lt;i&gt;5&lt;/i&gt;");
    expect(html).toContain("&lt;u&gt;x&lt;/u&gt;");
    expect(html).not.toContain("<b>");
    expect(html).not.toContain("<i>");
    expect(html).not.toContain("<u>");
  });
});

describe("buildCostTreemapOption", () => {
  it("keeps the chrome's root: transparent, aria on, a 300 ms animation, the theme font", () => {
    const option = build();
    expect(option.backgroundColor).toBe("transparent");
    expect(option.aria).toEqual({ enabled: true });
    expect(option.animationDuration).toBe(300);
    expect(option.textStyle).toEqual({ fontFamily: chrome.fontFamily, color: "#555555" });
  });

  it("draws one tile per card, in the order given, coloured by position and carrying its id", () => {
    const series = seriesOf(build());
    expect(series.data).toEqual([
      { name: "ERP", value: 500, id: "erp", index: 0, itemStyle: { color: COST_TREEMAP_COLORS[0] } },
      { name: "CRM", value: 100, id: "crm", index: 1, itemStyle: { color: COST_TREEMAP_COLORS[1] } },
      { name: "Unlinked", value: 100, id: undefined, index: 2, itemStyle: { color: COST_TREEMAP_COLORS[2] } },
    ]);
  });

  it("colours a tile by its index, not its place in the list", () => {
    const series = seriesOf(build([{ id: "x", name: "X", cost: 1, index: 10 }]));
    expect(series.data[0].itemStyle.color).toBe(COST_TREEMAP_COLORS[0]);
    expect(seriesOf(build([{ id: "x", name: "X", cost: 1, index: 8 }])).data[0].itemStyle.color).toBe(
      COST_TREEMAP_COLORS[8],
    );
  });

  it("is a still, single-level treemap filling the chart, leaving clicks to the page", () => {
    const series = seriesOf(build());
    expect(build().series).toHaveLength(1);
    expect(series).toMatchObject({
      type: "treemap",
      roam: false,
      nodeClick: false,
      breadcrumb: { show: false },
      left: 0,
      top: 0,
      width: "100%",
      height: "100%",
      visibleMin: 4,
    });
  });

  it("separates tiles with a rounded 2 px border in the paper colour", () => {
    expect(seriesOf(build()).itemStyle).toEqual({
      borderColor: chrome.surface,
      borderWidth: 2,
      gapWidth: 2,
      borderRadius: 3,
    });
  });

  it("takes the tile gaps from the paper in dark mode too, not a fixed white", () => {
    const dark = buildEChartsChrome({
      mode: "dark",
      text: { primary: "#eeeeee", secondary: "#aaaaaa" },
      divider: "#333333",
      background: { paper: "#1e1e1e" },
      action: { hover: "#2a2a2a" },
    });
    expect(dark.surface).toBe("#1e1e1e");
    expect(seriesOf(build(ITEMS, { chrome: dark })).itemStyle.borderColor).toBe("#1e1e1e");
    // The tile labels stay white on the blue fills in either mode.
    expect(seriesOf(build(ITEMS, { chrome: dark })).label.color).toBe(CHART_LABEL_ON_DARK);
  });

  it("shows the pointer only when a click drills somewhere", () => {
    expect(seriesOf(build(ITEMS, { clickable: true })).cursor).toBe("pointer");
    expect(seriesOf(build(ITEMS, { clickable: false })).cursor).toBe("default");
  });

  it("labels a tile with its name in white 11 px semibold and its cost below in 10 px", () => {
    const label = seriesOf(build()).label;
    expect(label).toMatchObject({
      show: true,
      color: CHART_LABEL_ON_DARK,
      fontSize: 11,
      fontWeight: 600,
      // ECharts truncates a name that does not fit its tile.
      overflow: "truncate",
      position: "insideTopLeft",
      align: "left",
      padding: [6, 6],
    });
    expect(label.rich.value).toEqual({ color: CHART_LABEL_ON_DARK_MUTED, fontSize: 10, lineHeight: 16 });
  });

  it("prints the tile's cost through the report's currency formatter", () => {
    const label = seriesOf(build(ITEMS, { format: (v) => `CHF ${v * 2}` })).label;
    expect(label.formatter({ name: "ERP", value: 500 })).toBe("ERP\n{value|CHF 1000}");
  });

  it("anchors the labels at the top-right corner in a right-to-left locale", () => {
    const label = seriesOf(build(ITEMS, { isRtl: true })).label;
    expect(label.position).toBe("insideTopRight");
    expect(label.align).toBe("right");
    expect(build(ITEMS, { isRtl: true }).tooltip.extraCssText).toBe("direction: rtl; text-align: right;");
    expect(build().tooltip.extraCssText).toBe("");
  });

  it("names the hovered tile in an item tooltip on the chart's surface", () => {
    const tooltip = build().tooltip;
    expect(tooltip.trigger).toBe("item");
    expect(tooltip.confine).toBe(true);
    expect(tooltip.backgroundColor).toBe("#ffffff");
    expect(tooltip.formatter({ data: seriesOf(build()).data[0] })).toBe(
      costTooltipHtml({ name: "ERP", cost: 500 }, opts()),
    );
    expect(tooltip.formatter({ data: seriesOf(build()).data[0] })).toContain("71.4% of total");
  });

  it("reads each tooltip's share against the panel total it was built with", () => {
    const tooltip = build(ITEMS, { panelTotal: 1000 }).tooltip;
    expect(tooltip.formatter({ data: { name: "ERP", value: 500 } })).toContain("50.0% of total");
    expect(build(ITEMS, { panelTotal: 0 }).tooltip.formatter({ data: { name: "ERP", value: 500 } })).not.toContain(
      "of total",
    );
  });

  it("shows an empty tooltip, never an error, for a hover with no datum", () => {
    const tooltip = build().tooltip;
    expect(tooltip.formatter({})).toBe("");
    expect(tooltip.formatter(undefined)).toBe("");
  });

  it("drops cards that cost nothing or less, keeping the rest in order", () => {
    const series = seriesOf(
      build([
        { id: "a", name: "A", cost: 300, index: 0 },
        { id: "z", name: "Zero", cost: 0, index: 1 },
        { id: "b", name: "B", cost: 0.5, index: 2 },
        { id: "n", name: "Negative", cost: -40, index: 3 },
        { id: "c", name: "C", cost: 10, index: 4 },
      ]),
    );
    expect(series.data.map((d: any) => [d.name, d.value, d.index])).toEqual([
      ["A", 300, 0],
      ["B", 0.5, 2],
      ["C", 10, 4],
    ]);
    // A kept tile keeps the colour of its rank, not of its place after the drop.
    expect(series.data[1].itemStyle.color).toBe(COST_TREEMAP_COLORS[2]);
    expect(seriesOf(build([{ id: "z", name: "Zero", cost: 0, index: 0 }])).data).toEqual([]);
  });

  it("draws an empty panel as a treemap with no tiles", () => {
    expect(seriesOf(build([])).data).toEqual([]);
  });
});
