import { describe, expect, it, vi } from "vitest";
import { buildEChartsChrome } from "@/components/charts/echartsTheme";
import { CHART_LABEL_ON_DARK, CHART_LABEL_ON_DARK_MUTED, COST_TREEMAP_COLORS } from "@/theme/tokens";
import {
  TREEMAP_NAME_MIN_AREA,
  TREEMAP_VALUE_MIN_AREA,
  buildCostTreemapOption,
  costTooltipHtml,
  tileLabelTier,
  tileLabelTiers,
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

describe("tileLabelTier", () => {
  it("keeps the old Recharts rules as areas: a name from ≈ 55 × 40, a cost from ≈ 80 × 50", () => {
    expect(TREEMAP_NAME_MIN_AREA).toBe(2200);
    expect(TREEMAP_VALUE_MIN_AREA).toBe(4000);
  });

  it("prints nothing below the name threshold", () => {
    expect(tileLabelTier(0)).toBe("none");
    expect(tileLabelTier(528)).toBe("none");
    expect(tileLabelTier(2199.99)).toBe("none");
  });

  it("prints the name alone from the name threshold up to just below the cost threshold", () => {
    expect(tileLabelTier(2200)).toBe("name");
    expect(tileLabelTier(3165)).toBe("name");
    expect(tileLabelTier(3999.99)).toBe("name");
  });

  it("prints the name and the cost from the cost threshold up", () => {
    expect(tileLabelTier(4000)).toBe("full");
    expect(tileLabelTier(527_000)).toBe("full");
  });
});

describe("tileLabelTiers", () => {
  const items: CostTreemapItem[] = [
    { id: "a", name: "A", cost: 900, index: 0 },
    { id: "z", name: "Zero", cost: 0, index: 1 },
    { id: "b", name: "B", cost: 60, index: 2 },
    { id: "n", name: "Negative", cost: -500, index: 3 },
    { id: "c", name: "C", cost: 40, index: 4 },
  ];

  it("tiers the drawn tiles by their share of the drawn total, in order", () => {
    // 900 / 60 / 40 of 1000 on 50 000 px²: 45 000, 3 000 and 2 000.
    expect(tileLabelTiers(items, 50_000)).toEqual(["full", "name", "none"]);
  });

  it("is undefined while the chart is unmeasured", () => {
    expect(tileLabelTiers(items, undefined)).toBeUndefined();
    expect(tileLabelTiers(items, 0)).toBeUndefined();
    expect(tileLabelTiers(items, -1)).toBeUndefined();
    expect(tileLabelTiers(items, Number.NaN)).toBeUndefined();
  });

  it("gives every tile its full label on an unbounded area", () => {
    expect(tileLabelTiers(items, Number.POSITIVE_INFINITY)).toEqual(["full", "full", "full"]);
  });

  it("has no tiers for a panel with no tiles", () => {
    expect(tileLabelTiers([], 50_000)).toEqual([]);
  });
});

describe("buildCostTreemapOption tile labels", () => {
  // Shares of 1000: 900 / 60 / 40 → 45 000, 3 000 and 2 000 px² of 50 000.
  const MIXED: CostTreemapItem[] = [
    { id: "big", name: "Big", cost: 900, index: 0 },
    { id: "mid", name: "Mid", cost: 60, index: 1 },
    { id: "tiny", name: "Tiny", cost: 40, index: 2 },
  ];
  const labelsOf = (option: any) =>
    seriesOf(option).data.map((d: any) => ("label" in d ? d.label : "series"));

  it("gives each tile the label its share of the chart's area affords", () => {
    expect(labelsOf(build(MIXED, { areaPx: 50_000 }))).toEqual([
      "series",
      { formatter: "{b}" },
      { show: false },
    ]);
  });

  it("names a mid-sized tile through a string formatter that replaces the name-and-cost one", () => {
    const series = seriesOf(build(MIXED, { areaPx: 50_000 }));
    // The series label still prints both lines for the tiles that keep it.
    expect(series.label.formatter({ name: "Big", value: 900 })).toBe("Big\n{value|$900}");
    expect(series.data[1]).toEqual({
      name: "Mid",
      value: 60,
      id: "mid",
      index: 1,
      itemStyle: { color: COST_TREEMAP_COLORS[1] },
      label: { formatter: "{b}" },
    });
  });

  it("sizes the tiers by the chart's area: a larger chart labels more tiles in full", () => {
    // 200 000 px²: 180 000, 12 000 and 8 000 — all full.
    expect(labelsOf(build(MIXED, { areaPx: 200_000 }))).toEqual(["series", "series", "series"]);
    // 5 000 px²: 4 500, 300 and 200.
    expect(labelsOf(build(MIXED, { areaPx: 5_000 }))).toEqual(["series", { show: false }, { show: false }]);
    // 4 000 px²: 3 600 — the largest tile keeps only its name.
    expect(labelsOf(build(MIXED, { areaPx: 4_000 }))).toEqual([
      { formatter: "{b}" },
      { show: false },
      { show: false },
    ]);
  });

  it("reads each tile's share against the drawn tiles' total, ignoring the dropped ones", () => {
    const withDropped: CostTreemapItem[] = [
      ...MIXED,
      { id: "zero", name: "Zero", cost: 0, index: 3 },
      // Counted, it would halve the total and lift the tiny tile to a name.
      { id: "neg", name: "Negative", cost: -500, index: 4 },
    ];
    expect(labelsOf(build(withDropped, { areaPx: 50_000 }))).toEqual([
      "series",
      { formatter: "{b}" },
      { show: false },
    ]);
  });

  it("is not thrown by the panel total it was handed: the share is of the tiles drawn", () => {
    expect(labelsOf(build(MIXED, { areaPx: 50_000, panelTotal: 1_000_000 }))).toEqual([
      "series",
      { formatter: "{b}" },
      { show: false },
    ]);
  });

  it("leaves every tile on the series label until the chart has been measured", () => {
    for (const areaPx of [undefined, 0, -50_000, Number.NaN, Number.POSITIVE_INFINITY]) {
      const data = seriesOf(build(MIXED, { areaPx })).data;
      expect(data.map((d: any) => Object.keys(d)), String(areaPx)).toEqual([
        ["name", "value", "id", "index", "itemStyle"],
        ["name", "value", "id", "index", "itemStyle"],
        ["name", "value", "id", "index", "itemStyle"],
      ]);
    }
  });

  it("labels a lone tile in full: it fills the chart", () => {
    expect(labelsOf(build([{ id: "a", name: "A", cost: 1, index: 0 }], { areaPx: 4_000 }))).toEqual(["series"]);
    expect(labelsOf(build([{ id: "a", name: "A", cost: 1, index: 0 }], { areaPx: 3_999 }))).toEqual([
      { formatter: "{b}" },
    ]);
  });
});
