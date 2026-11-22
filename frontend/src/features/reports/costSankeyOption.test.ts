import { describe, expect, it } from "vitest";
import { buildEChartsChrome } from "@/components/charts/echartsTheme";
import { STATUS_COLORS } from "@/theme/tokens";
import {
  buildCostSankeyOption,
  chartSankeyNodeHeight,
  costSankeyNodeColor,
  shortenSankeyLabel,
  type CostSankeyLinkIn,
  type CostSankeyNodeIn,
} from "./costSankeyOption";

/* eslint-disable @typescript-eslint/no-explicit-any -- option trees are plain JSON here */

const chrome = buildEChartsChrome({
  mode: "light",
  text: { primary: "#111111", secondary: "#555555" },
  divider: "#dddddd",
  background: { paper: "#ffffff" },
  action: { hover: "#eeeeee" },
});

const NODES: CostSankeyNodeIn[] = [
  { id: "item:lic", name: "Licences", type: "CostItem" },
  { id: "group:EMEA", name: "EMEA", type: "Group" },
  { id: "crm", name: "CRM", type: "Application" },
];
const LINKS: CostSankeyLinkIn[] = [
  { source: 0, target: 1, value: 100 },
  { source: 1, target: 2, value: 100 },
];

const build = (nodes = NODES, links = LINKS, isRtl = false) =>
  buildCostSankeyOption(nodes, links, { chrome, isRtl, format: (v) => `$${v}` }) as any;

describe("costSankeyNodeColor", () => {
  it("colours a cost item, a group and a card differently", () => {
    const colours = new Set(["CostItem", "Group", "Application"].map(costSankeyNodeColor));
    expect(colours.size).toBe(3);
  });

  it("falls back to one colour for a card type it does not know", () => {
    expect(costSankeyNodeColor("NoSuchType")).toBe(costSankeyNodeColor("AlsoUnknown"));
  });
});

describe("shortenSankeyLabel", () => {
  it("keeps a name of 24 characters whole and ellipsises a longer one to 24", () => {
    const whole = "a".repeat(24);
    expect(shortenSankeyLabel(whole)).toBe(whole);
    expect(shortenSankeyLabel(`${whole}b`)).toBe(`${"a".repeat(23)}…`);
  });
});

describe("buildCostSankeyOption", () => {
  it("shows a card logo or type glyph in its tooltip", () => {
    const card = { id: "crm", name: "CRM", type: "Application", typeLabel: "Application", typeIcon: "apps", logo_updated_at: "2026-01-01T00:00:00Z" };
    expect(build([card], []).tooltip.formatter({ dataType: "node", name: "crm", value: 1 })).toContain("/api/v1/cards/crm/logo?v=");
    expect(build([{ ...card, logo_updated_at: null }], []).tooltip.formatter({ dataType: "node", name: "crm", value: 1 })).toContain("apps");
    const series = build([card], []).series[0];
    expect(series.data[0].label.rich.cardIdentity.backgroundColor.image).toContain("/api/v1/cards/crm/logo?v=");
    expect(series.label.formatter({ name: "crm" })).toContain("{cardIcon|apps}");
  });
  it("names each node by its id and links them by id, in the flow's order", () => {
    const s = build().series[0];
    expect(s.type).toBe("sankey");
    expect(s.data.map((d: any) => d.name)).toEqual(["item:lic", "group:EMEA", "crm"]);
    expect(s.links).toEqual([
      { source: "item:lic", target: "group:EMEA", value: 100 },
      { source: "group:EMEA", target: "crm", value: 100 },
    ]);
  });

  it("prints a node's own name, shortened, and not its id", () => {
    const s = build([{ id: "x", name: "N".repeat(30), type: "Application" }], []).series[0];
    expect(s.label.formatter({ name: "x" })).toBe(`${"N".repeat(23)}…`);
  });

  it("colours each node by its kind", () => {
    const s = build().series[0];
    expect(s.data.map((d: any) => d.itemStyle.color)).toEqual(NODES.map((n) => costSankeyNodeColor(n.type)));
  });

  it("keeps room right of the last column for its labels", () => {
    const long = build(NODES.map((n) => (n.id === "crm" ? { ...n, name: "A Very Long Application" } : n)));
    expect(long.series[0].right).toBeGreaterThan(build().series[0].right);
  });

  it("explains a flow as 'from -> to: cost' and a node as 'name: cost', escaped", () => {
    const tip = build([{ ...NODES[0], name: "<b>Lic</b>" }, NODES[1], NODES[2]]).tooltip.formatter;
    expect(tip({ dataType: "edge", value: 100, data: { source: "item:lic", target: "group:EMEA" } })).toBe(
      "&lt;b&gt;Lic&lt;/b&gt; → EMEA: $100",
    );
    expect(tip({ dataType: "node", name: "crm", value: 100 })).toBe("CRM: $100");
  });

  it("points the arrow the other way in a right-to-left locale", () => {
    const tip = build(NODES, LINKS, true).tooltip.formatter;
    expect(tip({ dataType: "edge", value: 1, data: { source: "item:lic", target: "group:EMEA" } })).toContain("←");
  });
});

describe("cost report colours and type", () => {
  it("lets a node's own colour win over the kind colour", () => {
    const nodes: CostSankeyNodeIn[] = [
      { id: "group:G", name: "G", type: "Group", color: "#123456" },
      { id: "crm", name: "CRM", type: "Application", color: "#654321" },
    ];
    expect(build(nodes, []).series[0].data.map((d: any) => d.itemStyle.color)).toEqual(["#123456", "#654321"]);
  });

  it("draws cost-item nodes in neutral grey", () => {
    expect(costSankeyNodeColor("CostItem")).toBe(STATUS_COLORS.neutral);
  });

  it("takes each flow's colour from its source", () => {
    expect(build().series[0].lineStyle).toMatchObject({ color: "source", opacity: 0.45 });
  });

  it("appends the type to a card's label and names it in the tooltip", () => {
    const nodes: CostSankeyNodeIn[] = [
      { id: "crm", name: "CRM", type: "Application", typeLabel: "Application" },
      { id: "item:lic", name: "Licences", type: "CostItem" },
    ];
    const o = build(nodes, []);
    expect(o.series[0].label.formatter({ name: "crm" })).toBe("CRM · Application");
    expect(o.series[0].label.formatter({ name: "item:lic" })).toBe("Licences");
    expect(o.tooltip.formatter({ dataType: "node", name: "crm", value: 1 })).toBe("CRM · Application: $1");
  });
});


describe("Sankey node badge fit", () => {
  it("hides a badge on a thin node but retains it in the tooltip", () => {
    const card = { id: "crm", name: "CRM", type: "Application", typeIcon: "apps" };
    const option = buildCostSankeyOption([card], [], { chrome, isRtl: false, format: (v) => `$${v}`, nodeHeight: () => 8 } as any) as any;
    expect(option.series[0].label.formatter({ name: "crm", dataIndex: 0 })).toBe("CRM");
    expect(option.tooltip.formatter({ dataType: "node", name: "crm", value: 1 })).toContain("apps");
    const tall = buildCostSankeyOption([card], [], { chrome, isRtl: false, format: (v) => `$${v}`, nodeHeight: () => 30 } as any) as any;
    expect(tall.series[0].label.formatter({ name: "crm", dataIndex: 0 })).toContain("{cardIdentity|apps}");
  });
});


describe("chartSankeyNodeHeight", () => {
  it("returns undefined when the chart or layout is unavailable", () => {
    expect(chartSankeyNodeHeight(null, 0)).toBeUndefined();
    expect(chartSankeyNodeHeight({}, 0)).toBeUndefined();
    expect(chartSankeyNodeHeight({ getModel: () => { throw new Error("disposed"); } }, 0)).toBeUndefined();
    expect(chartSankeyNodeHeight({ getModel: () => ({ getSeriesByIndex: () => ({ getData: () => ({ getItemLayout: () => ({ dy: "10" }) }) }) }) }, 0)).toBeUndefined();
  });
});


describe("Sankey identity style scaling", () => {
  it("keeps both series and per-node rich styles bounded", () => {
    const nodes = Array.from({ length: 30 }, (_, i) => ({ id: `c${i}`, name: `Card ${i}`, type: "Application", typeIcon: "apps" }));
    const series = build(nodes, []).series[0];
    expect(Object.keys(series.label.rich).length).toBeLessThanOrEqual(2);
    expect(Math.max(...series.data.map((d: any) => Object.keys(d.label.rich).length))).toBe(1);
    expect(series.data[0].label.rich.cardIdentity).toBeDefined();
  });
});
