import { describe, expect, it, vi } from "vitest";
import { buildEChartsChrome } from "@/components/charts/echartsTheme";
import {
  CHART_CATEGORICAL,
  CHART_LABEL_ON_DARK,
  CHART_LABEL_ON_DARK_MUTED,
  CHART_LABEL_ON_LIGHT,
  COST_DELTA_DOWN,
  COST_DELTA_DOWN_ON_LIGHT,
  COST_DELTA_UP,
  COST_DELTA_UP_ON_LIGHT,
} from "@/theme/tokens";
import {
  TILE_NAME_MIN,
  TILE_VALUE_MIN,
  buildCostTreemapOption,
  chartTileRect,
  costTooltipHtml,
  deltaBadge,
  tileLabelFormatter,
  tileLabelTier,
  type CostTreemapGroup,
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

const P = CHART_CATEGORICAL.light;

const ITEMS: CostTreemapItem[] = [
  { id: "erp", name: "ERP", cost: 500, index: 0, color: P[0] },
  { id: "crm", name: "CRM", cost: 100, index: 1, color: P[1] },
  { name: "Unlinked", cost: 100, index: 2, color: P[2] },
];

const build = (items: CostTreemapItem[] = ITEMS, over: Partial<CostTreemapOptions> = {}) =>
  buildCostTreemapOption(items, opts(over)) as any;
const seriesOf = (option: any) => option.series[0];

describe("costTooltipHtml", () => {
  it("shows card identity in the tooltip even when a tile is too small for its label", () => {
    const item = { id: "erp", name: "ERP", cost: 1, index: 0, color: P[0], typeLabel: "Application", typeIcon: "apps", logo_updated_at: "2026-01-01T00:00:00Z" };
    const option = build([item], { tileRect: () => ({ width: 1, height: 1 }) });
    const html = option.tooltip.formatter({ data: seriesOf(option).data[0] });
    expect(html).toContain("/api/v1/cards/erp/logo?v=");
    expect(html).toContain("Application");
    const fallback = build([{ ...item, logo_updated_at: null }]);
    expect(fallback.tooltip.formatter({ data: seriesOf(fallback).data[0] })).toContain("apps");
    const large = build([item]);
    const datum = seriesOf(large).data[0];
    expect(datum.label.rich.cardIdentity.backgroundColor.image).toContain("/api/v1/cards/erp/logo?v=");
    expect(seriesOf(large).label.formatter({ name: "ERP", value: 1, data: datum })).toContain("{cardIcon|apps}");
  });
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
      { name: "ERP", value: 500, id: "erp", index: 0, itemStyle: { color: P[0] } },
      { name: "CRM", value: 100, id: "crm", index: 1, itemStyle: { color: P[1] } },
      { name: "Unlinked", value: 100, id: undefined, index: 2, itemStyle: { color: P[2] } },
    ]);
  });

  it("fills a tile with the colour it is given", () => {
    const series = seriesOf(build([{ id: "x", name: "X", cost: 1, index: 10, color: P[2] }]));
    expect(series.data[0].itemStyle.color).toBe(P[2]);
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
        { id: "a", name: "A", cost: 300, index: 0, color: P[0] },
        { id: "z", name: "Zero", cost: 0, index: 1, color: P[1] },
        { id: "b", name: "B", cost: 0.5, index: 2, color: P[2] },
        { id: "n", name: "Negative", cost: -40, index: 3, color: P[3] },
        { id: "c", name: "C", cost: 10, index: 4, color: P[4] },
      ]),
    );
    expect(series.data.map((d: any) => [d.name, d.value, d.index])).toEqual([
      ["A", 300, 0],
      ["B", 0.5, 2],
      ["C", 10, 4],
    ]);
    // A kept tile keeps the colour of its rank, not of its place after the drop.
    expect(series.data[1].itemStyle.color).toBe(P[2]);
    expect(seriesOf(build([{ id: "z", name: "Zero", cost: 0, index: 0, color: P[0] }])).data).toEqual([]);
  });

  it("draws an empty panel as a treemap with no tiles", () => {
    expect(seriesOf(build([])).data).toEqual([]);
  });
});

describe("tileLabelTier", () => {
  it("keeps the treemap's long-standing thresholds: a name above 50 × 30 px, a cost above 70 × 45 px", () => {
    expect(TILE_NAME_MIN).toEqual({ width: 50, height: 30 });
    expect(TILE_VALUE_MIN).toEqual({ width: 70, height: 45 });
  });

  it("prints nothing on a tile no wider than 50 px or no taller than 30 px", () => {
    expect(tileLabelTier(0, 0)).toBe("none");
    expect(tileLabelTier(50, 30)).toBe("none");
    expect(tileLabelTier(50, 31)).toBe("none");
    expect(tileLabelTier(51, 30)).toBe("none");
  });

  it("prints the name alone from just past 50 × 30 up to 70 × 45", () => {
    expect(tileLabelTier(51, 31)).toBe("name");
    expect(tileLabelTier(70, 45)).toBe("name");
    expect(tileLabelTier(70, 46)).toBe("name");
    expect(tileLabelTier(71, 45)).toBe("name");
  });

  it("prints the name and the cost once wider than 70 and taller than 45", () => {
    expect(tileLabelTier(71, 46)).toBe("full");
    expect(tileLabelTier(1180, 450)).toBe("full");
  });

  it("reads width and height each on its own, not their product", () => {
    // Wide but short: room for a long line, not for one under it.
    expect(tileLabelTier(1000, 31)).toBe("name");
    expect(tileLabelTier(1000, 30)).toBe("none");
    // Tall but narrow: the tile that printed "$95,…" under the area rule.
    expect(tileLabelTier(70, 400)).toBe("name");
    expect(tileLabelTier(50, 400)).toBe("none");
  });
});

describe("tileLabelFormatter", () => {
  const format = (v: number) => `$${v.toLocaleString("en-US")}`;
  const RECTS: Record<number, { width: number; height: number }> = {
    1: { width: 300, height: 100 },
    2: { width: 60, height: 35 },
    3: { width: 48, height: 28 },
  };
  const tileRect = vi.fn((i: number) => RECTS[i]);

  it("prints name and cost, the name alone, or nothing, by the tile's rectangle", () => {
    const f = tileLabelFormatter({ format, tileRect });
    expect(f({ dataIndex: 1, name: "ERP", value: 95_000 })).toBe("ERP\n{value|$95,000}");
    expect(f({ dataIndex: 2, name: "CRM", value: 4_000 })).toBe("CRM");
    expect(f({ dataIndex: 3, name: "Tiny", value: 1_000 })).toBe("");
    expect(tileRect.mock.calls.map((c) => c[0])).toEqual([1, 2, 3]);
  });

  it("prints name and cost while there is no chart to ask", () => {
    const f = tileLabelFormatter({ format });
    expect(f({ dataIndex: 3, name: "Tiny", value: 1_000 })).toBe("Tiny\n{value|$1,000}");
  });

  it("prints name and cost for a tile the chart has no rectangle for", () => {
    const f = tileLabelFormatter({ format, tileRect: () => undefined });
    expect(f({ dataIndex: 7, name: "Lost", value: 12 })).toBe("Lost\n{value|$12}");
  });

  it("asks for index -1 when ECharts hands no dataIndex", () => {
    const asked = vi.fn((_i: number) => undefined);
    const f = tileLabelFormatter({ format, tileRect: asked });
    expect(f({ name: "X", value: 3 })).toBe("X\n{value|$3}");
    expect(asked).toHaveBeenCalledWith(-1);
  });

  it("prints an empty name and a zero cost for params without them", () => {
    const f = tileLabelFormatter({ format, tileRect: () => ({ width: 60, height: 35 }) });
    expect(f({ dataIndex: 0 })).toBe("");
    expect(tileLabelFormatter({ format })({ dataIndex: 0 })).toBe("\n{value|$0}");
    expect(tileLabelFormatter({ format })({ dataIndex: 0, name: "N", value: "12" })).toBe("N\n{value|$12}");
  });
});

describe("buildCostTreemapOption tile labels", () => {
  it("labels every tile through the rectangle formatter, never per datum", () => {
    const rects = [
      { width: 300, height: 100 },
      { width: 60, height: 35 },
      { width: 48, height: 28 },
    ];
    const series = seriesOf(build(ITEMS, { tileRect: (i) => rects[i] }));
    expect(series.data.every((d: any) => !("label" in d))).toBe(true);
    expect(series.label.formatter({ dataIndex: 0, name: "ERP", value: 500 })).toBe("ERP\n{value|$500}");
    expect(series.label.formatter({ dataIndex: 1, name: "CRM", value: 100 })).toBe("CRM");
    expect(series.label.formatter({ dataIndex: 2, name: "Unlinked", value: 100 })).toBe("");
  });

  it("keeps the chrome's tile label styling under its own formatter", () => {
    const label = seriesOf(build(ITEMS, { tileRect: () => ({ width: 1, height: 1 }) })).label;
    expect(label).toMatchObject({ show: true, overflow: "truncate", fontSize: 11, fontWeight: 600 });
    expect(label.rich.value).toEqual({ color: CHART_LABEL_ON_DARK_MUTED, fontSize: 10, lineHeight: 16 });
    expect(label.formatter({ dataIndex: 0, name: "ERP", value: 500 })).toBe("");
  });
});

describe("chartTileRect", () => {
  /** A chart whose series data lays tile `i` out as `layouts[i]`. */
  function chartWith(layouts: Record<number, unknown>) {
    const getItemLayout = vi.fn((i: number) => layouts[i]);
    const getSeriesByIndex = vi.fn(() => ({ getData: () => ({ getItemLayout }) }));
    return { chart: { getModel: () => ({ getSeriesByIndex }) }, getItemLayout, getSeriesByIndex };
  }

  it("reads the tile's width and height from the first series' item layout", () => {
    const { chart, getItemLayout, getSeriesByIndex } = chartWith({
      4: { x: 10, y: 20, width: 60, height: 35, area: 2100 },
    });
    expect(chartTileRect(chart, 4)).toEqual({ width: 60, height: 35 });
    expect(getSeriesByIndex).toHaveBeenCalledWith(0);
    expect(getItemLayout).toHaveBeenCalledWith(4);
  });

  it("is undefined without a chart, a model, a series or a layout", () => {
    expect(chartTileRect(null, 0)).toBeUndefined();
    expect(chartTileRect(undefined, 0)).toBeUndefined();
    expect(chartTileRect({ getModel: () => null }, 0)).toBeUndefined();
    expect(chartTileRect({ getModel: () => ({ getSeriesByIndex: () => undefined }) }, 0)).toBeUndefined();
    expect(chartTileRect(chartWith({}).chart, 0)).toBeUndefined();
    expect(chartTileRect(chartWith({ 0: null }).chart, 0)).toBeUndefined();
  });

  it("is undefined for a layout without a numeric width and height", () => {
    expect(chartTileRect(chartWith({ 0: { width: "60", height: 35 } }).chart, 0)).toBeUndefined();
    expect(chartTileRect(chartWith({ 0: { width: 60 } }).chart, 0)).toBeUndefined();
    expect(chartTileRect(chartWith({ 0: { height: 35 } }).chart, 0)).toBeUndefined();
    expect(chartTileRect(chartWith({ 0: { width: 0, height: 0 } }).chart, 0)).toEqual({ width: 0, height: 0 });
  });

  it("is undefined, not a crash, when ECharts' internals throw or are missing", () => {
    expect(
      chartTileRect(
        {
          getModel: () => {
            throw new Error("disposed");
          },
        },
        0,
      ),
    ).toBeUndefined();
    expect(chartTileRect({}, 0)).toBeUndefined();
  });
});

describe("deltaBadge", () => {
  it("says nothing when no year is picked", () => {
    expect(deltaBadge(undefined, "new")).toBe("");
  });

  it("marks a rise with an up arrow and a signed percentage, rounded", () => {
    expect(deltaBadge(0.204, "new")).toBe("{up|▲ +20%}");
    expect(deltaBadge(0, "new")).toBe("{up|▲ +0%}");
  });

  it("marks a fall with a down arrow and the minus sign of the percentage", () => {
    expect(deltaBadge(-0.126, "new")).toBe("{down|▼ -13%}");
  });

  it("calls a card with no current-year cost to diff against new", () => {
    expect(deltaBadge(null, "new")).toBe("{up|▲ new}");
  });
});

describe("the change badge on a tile", () => {
  const withDelta: CostTreemapItem[] = [
    { id: "erp", name: "ERP", cost: 500, index: 0, color: P[0], deltaPct: 0.2 },
    { id: "old", name: "Old", cost: 100, index: 1, color: P[1], deltaPct: null },
    { id: "crm", name: "CRM", cost: 100, index: 2, color: P[2] },
  ];

  it("prints after the cost on a tile that fits the cost, with the datum's change", () => {
    const s = seriesOf(build(withDelta, { deltaNew: "new" }));
    const [erp, old, crm] = s.data;
    expect(s.label.formatter({ name: "ERP", value: 500, data: erp })).toBe("ERP\n{value|$500} {up|▲ +20%}");
    expect(s.label.formatter({ name: "Old", value: 100, data: old })).toBe("Old\n{value|$100} {up|▲ new}");
    expect(s.label.formatter({ name: "CRM", value: 100, data: crm })).toBe("CRM\n{value|$100}");
  });

  it("is left off a tile that only fits its name", () => {
    const s = seriesOf(build(withDelta, { tileRect: () => ({ width: 60, height: 35 }), deltaNew: "new" }));
    expect(s.label.formatter({ dataIndex: 0, name: "ERP", value: 500, data: s.data[0] })).toBe("ERP");
  });

  it("is coloured by a rise or a fall", () => {
    const rich = seriesOf(build(withDelta)).label.rich;
    expect(rich.up).toMatchObject({ color: COST_DELTA_UP });
    expect(rich.down).toMatchObject({ color: COST_DELTA_DOWN });
  });
});

describe("grouped treemap", () => {
  const groups: CostTreemapGroup[] = [
    {
      key: "gold",
      name: "Gold",
      cost: 15,
      index: 0,
      color: P[0],
      items: [
        { id: "a", name: "Alpha", cost: 10, index: 0, color: P[0] },
        { id: "b", name: "Beta", cost: 5, index: 0, color: P[0] },
      ],
    },
    { key: "silver", name: "Silver", cost: 3, index: 1, color: P[1], items: [{ id: "c", name: "Gamma", cost: 3, index: 1, color: P[1] }] },
    { key: "empty", name: "Empty", cost: 0, index: 2, color: P[2], items: [{ id: "z", name: "Zero", cost: 0, index: 2, color: P[2] }] },
  ];
  const grouped = () => seriesOf(build([], { groups }));

  it("frames each group around its cards, in the group's colour, and skips a group with no tile", () => {
    const data = grouped().data;
    expect(data.map((g: any) => [g.name, g.value, g.children.length])).toEqual([
      ["Gold", 15, 2],
      ["Silver", 3, 1],
    ]);
    expect(data[0].itemStyle).toMatchObject({ color: P[0], borderWidth: 4 });
    expect(data[1].children[0].itemStyle.color).toBe(P[1]);
  });

  it("titles each group in a strip over its frame, and only when grouped", () => {
    expect(grouped().upperLabel).toMatchObject({ show: true, color: CHART_LABEL_ON_DARK });
    expect(seriesOf(build()).upperLabel).toBeUndefined();
  });

  it("names the group in the tooltip of a card", () => {
    const tip = build([], { groups }).tooltip.formatter;
    const card = grouped().data[0].children[0];
    expect(tip({ data: card })).toContain("Gold");
    expect(tip({ data: card })).toContain("$10");
  });

  it("leaves the group line out of a card's tooltip when the report is not grouped", () => {
    const html = costTooltipHtml({ name: "ERP", cost: 500 }, opts());
    expect(html).not.toContain("opacity:.7\">Gold");
    expect(costTooltipHtml({ name: "ERP", cost: 500, group: "Gold" }, opts())).toContain("Gold");
  });
});

describe("cost report colours and type line", () => {
  const LIGHT = "#d9d7cf";
  const DARK = "#2a78d6";

  it("uses the colour an item carries instead of the blue ramp", () => {
    const s = seriesOf(build([{ id: "a", name: "A", cost: 5, index: 0, color: DARK }]));
    expect(s.data[0].itemStyle.color).toBe(DARK);
  });

  it("gives a group frame its raw key and its own colour", () => {
    const groups: CostTreemapGroup[] = [
      {
        key: "k1",
        name: "Gold",
        cost: 5,
        index: 0,
        color: DARK,
        items: [{ id: "a", name: "A", cost: 5, index: 0, color: DARK }],
      },
    ];
    const frame = seriesOf(build([], { groups })).data[0];
    expect(frame.key).toBe("k1");
    expect(frame.itemStyle.color).toBe(DARK);
  });

  it("switches a light tile's label and badges to dark ink and leaves a dark tile on the series label", () => {
    const s = seriesOf(
      build([
        { id: "l", name: "L", cost: 5, index: 0, color: LIGHT },
        { id: "d", name: "D", cost: 5, index: 1, color: DARK },
      ]),
    );
    const [light, dark] = s.data;
    expect(light.label.color).toBe(CHART_LABEL_ON_LIGHT);
    expect(light.label.rich.up.color).toBe(COST_DELTA_UP_ON_LIGHT);
    expect(light.label.rich.down.color).toBe(COST_DELTA_DOWN_ON_LIGHT);
    expect("label" in light && "formatter" in light.label).toBe(false);
    expect("label" in dark).toBe(false);
  });

  it("colours a light group's strip title with dark ink", () => {
    const groups: CostTreemapGroup[] = [
      {
        key: "k",
        name: "G",
        cost: 5,
        index: 0,
        color: LIGHT,
        items: [{ id: "a", name: "A", cost: 5, index: 0, color: LIGHT }],
      },
    ];
    expect(seriesOf(build([], { groups })).data[0].upperLabel.color).toBe(CHART_LABEL_ON_LIGHT);
  });

  it("prints the type on the second line of a full tile only", () => {
    const items: CostTreemapItem[] = [{ id: "a", name: "ERP", cost: 500, index: 0, color: P[0], typeLabel: "Application" }];
    const full = seriesOf(build(items, { tileRect: () => ({ width: 300, height: 100 }) }));
    expect(full.label.formatter({ dataIndex: 0, name: "ERP", value: 500, data: full.data[0] })).toBe(
      "ERP\n{type|Application}\n{value|$500}",
    );
    const nameOnly = seriesOf(build(items, { tileRect: () => ({ width: 60, height: 35 }) }));
    expect(nameOnly.label.formatter({ dataIndex: 0, name: "ERP", value: 500, data: nameOnly.data[0] })).toBe("ERP");
  });

  it("names the type in the tooltip", () => {
    expect(costTooltipHtml({ name: "ERP", cost: 5, typeLabel: "Application" }, opts())).toContain("Application");
  });
});


describe("identity regression fixes", () => {
  it("keeps light tile rich styles bounded as identity count grows", () => {
    const items = Array.from({ length: 30 }, (_, i) => ({ id: `c${i}`, name: `Card ${i}`, cost: 1, index: i, color: "#ffffff", typeIcon: "apps" }));
    const series = seriesOf(build(items));
    expect(Object.keys(series.label.rich).length).toBeLessThanOrEqual(7);
    expect(Math.max(...series.data.map((d: any) => Object.keys(d.label.rich).length))).toBeLessThanOrEqual(5);
    expect(series.data[0].label.rich.cardIdentity).toBeDefined();
  });

  it("uses an opaque image surface with a fallback glyph when the logo cannot load", () => {
    const html = costTooltipHtml({ id: "erp", name: "ERP", cost: 1, typeIcon: "apps", logo_updated_at: "2026-01-01" }, opts());
    const div = document.createElement("div");
    div.innerHTML = html;
    const image = div.querySelector("img");
    expect(image?.getAttribute("src")).toContain("/api/v1/cards/erp/logo?v=");
    expect(image?.getAttribute("style")).toContain("background:Canvas");
    expect(image?.getAttribute("alt")).toBe("apps");
    expect(html).not.toMatch(/\son\w+=/i);
  });
});
