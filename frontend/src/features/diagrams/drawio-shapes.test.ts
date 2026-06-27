import { describe, it, expect } from "vitest";
import {
  buildCardCellData,
  applyCardTypeIcons,
  buildLdvDiagramXml,
  type DiagramCardInput,
  type DiagramRelInput,
  type DiagramLayerInput,
} from "./drawio-shapes";
import { ICON_PATHS } from "./iconPaths";

/** Minimal fake mxGraph model so applyCardTypeIcons can run without DrawIO. */
type FakeCell = {
  _style: string;
  edge?: boolean;
  value?: { getAttribute: (k: string) => string | null };
};
function fakeFrame(cells: Record<string, FakeCell>) {
  const model = {
    cells,
    beginUpdate() {},
    endUpdate() {},
    getStyle: (c: FakeCell) => c._style,
    setStyle: (c: FakeCell, s: string) => {
      c._style = s;
    },
  };
  const graph = { getModel: () => model };
  return { contentWindow: { __turboGraph: graph } } as unknown as HTMLIFrameElement;
}
function cardCell(cardType: string | null, style: string, edge = false): FakeCell {
  return {
    _style: style,
    edge,
    value: { getAttribute: (k: string) => (k === "cardType" ? cardType : null) },
  };
}

const base = { cardId: "abcdef12-3456", cardType: "Application", name: "NexaCore", color: "#0f7eb5", x: 0, y: 0 };

describe("buildCardCellData — card-type icon", () => {
  it("bakes a corner icon into the shape style for a known icon", () => {
    const { style } = buildCardCellData({ ...base, icon: "apps" });
    expect(style).toContain("shape=label");
    expect(style).toContain("imageAlign=left");
    expect(style).toContain("imageVerticalAlign=top");
    // Reserve a left gutter so the label never overlaps the corner glyph.
    expect(style).toContain("spacingLeft=24");
    const imageToken = style.split(";").find((p) => p.startsWith("image="));
    expect(imageToken).toBeDefined();
    expect(imageToken).toMatch(/^image=data:image\/svg\+xml,/);
  });

  it("encodes the SVG so the image token has no raw ';' (mxGraph-safe)", () => {
    const { style } = buildCardCellData({ ...base, icon: "database" });
    const imageToken = style.split(";").find((p) => p.startsWith("image="))!;
    // encodeURIComponent escapes ';' and '=', so the token is a single,
    // intact style entry — splitting on ';' must not fragment it.
    expect(imageToken).not.toContain("<");
    expect(decodeURIComponent(imageToken.slice("image=".length))).toContain("<svg");
  });

  it("falls back to a plain rounded rect when the icon is unknown", () => {
    const { style } = buildCardCellData({ ...base, icon: "not_a_real_icon_xyz" });
    expect(style).not.toContain("shape=label");
    expect(style).not.toContain("image=");
    expect(style).toContain("rounded=1");
  });

  it("falls back to a plain rounded rect when no icon is given", () => {
    const { style } = buildCardCellData(base);
    expect(style).not.toContain("shape=label");
  });

  it("survives the view-recolour split/concat round-trip intact", () => {
    const { style } = buildCardCellData({ ...base, icon: "apps" });
    // Mirror applyViewToGraph / resetViewColors: drop fill/stroke, re-add.
    const next = style
      .split(";")
      .filter(Boolean)
      .filter((p) => !p.startsWith("fillColor=") && !p.startsWith("strokeColor="))
      .concat(["fillColor=#ff0000", "strokeColor=#aa0000"])
      .join(";");
    expect(next).toContain("shape=label");
    expect(next.split(";").find((p) => p.startsWith("image="))).toMatch(/data:image\/svg\+xml/);
  });
});

describe("applyCardTypeIcons — upgrade existing cards", () => {
  const PLAIN = "rounded=1;whiteSpace=wrap;html=1;fillColor=#0f7eb5;fontColor=#ffffff;strokeColor=#0a5a82;fontSize=12";
  const iconByType = new Map([["Application", "apps"]]);

  it("adds the icon to a plain card cell", () => {
    const cells = { c1: cardCell("Application", PLAIN) };
    const n = applyCardTypeIcons(fakeFrame(cells), iconByType);
    expect(n).toBe(1);
    expect(cells.c1._style).toContain("shape=label");
    expect(cells.c1._style).toContain("image=data:image/svg+xml,");
    // Preserves the original fill/font tokens.
    expect(cells.c1._style).toContain("fillColor=#0f7eb5");
  });

  it("skips swimlane containers and edges", () => {
    const swim = "shape=swimlane;startSize=28;fillColor=#0f7eb5";
    const cells = {
      lane: cardCell("Application", swim),
      edge: cardCell("Application", "edgeStyle=entityRelationEdgeStyle", true),
    };
    const n = applyCardTypeIcons(fakeFrame(cells), iconByType);
    expect(n).toBe(0);
    expect(cells.lane._style).toBe(swim);
  });

  it("is idempotent — no duplicate icon tokens on re-apply", () => {
    const cells = { c1: cardCell("Application", PLAIN) };
    const frame = fakeFrame(cells);
    applyCardTypeIcons(frame, iconByType);
    const after1 = cells.c1._style;
    const n2 = applyCardTypeIcons(frame, iconByType);
    expect(n2).toBe(0); // unchanged → not counted
    expect(cells.c1._style).toBe(after1);
    expect(cells.c1._style.match(/shape=label/g)?.length).toBe(1);
    expect(cells.c1._style.match(/image=/g)?.length).toBe(1);
  });

  it("leaves a card whose type has no bundled icon as a plain rectangle", () => {
    const cells = { c1: cardCell("CustomNoIcon", PLAIN) };
    const n = applyCardTypeIcons(fakeFrame(cells), new Map());
    expect(n).toBe(0);
    expect(cells.c1._style).not.toContain("shape=label");
  });
});

describe("ICON_PATHS coverage", () => {
  it("covers the built-in card-type default icons", () => {
    const defaults = [
      "flag", "layers", "rocket_launch", "corporate_fare", "account_tree",
      "swap_horiz", "route", "apps", "sync_alt", "database", "memory",
      "category", "storefront",
    ];
    for (const name of defaults) {
      expect(ICON_PATHS[name]?.d, `missing path for ${name}`).toBeTruthy();
      expect(ICON_PATHS[name]?.vb).toBeTruthy();
    }
  });
});

describe("buildLdvDiagramXml", () => {
  const cards: DiagramCardInput[] = [
    {
      cardId: "11111111-1111-1111-1111-111111111111",
      cardType: "Application",
      name: "NexaCore ERP",
      color: "#0f7eb5",
      icon: "apps",
      x: 100,
      y: 50,
      w: 200,
      h: 72,
    },
    {
      cardId: "22222222-2222-2222-2222-222222222222",
      cardType: "DataObject",
      name: 'Orders & "stuff" <x>',
      color: "#774fcc",
      x: 400,
      y: 50,
      w: 200,
      h: 72,
    },
  ];
  const rels: DiagramRelInput[] = [
    {
      sourceCardId: "11111111-1111-1111-1111-111111111111",
      targetCardId: "22222222-2222-2222-2222-222222222222",
      relationType: "relAppToData",
      label: "reads",
      color: "#8a93a3",
    },
  ];
  const layers: DiagramLayerInput[] = [
    { label: "Application & Data", color: "#0f7eb5", x: 0, y: 0, w: 800, h: 200 },
  ];

  it("wraps cards in <object> with cardId/cardType so they stay linked to inventory", () => {
    const xml = buildLdvDiagramXml(cards, rels, layers);
    expect(xml.startsWith("<mxGraphModel")).toBe(true);
    expect(xml).toContain('cardId="11111111-1111-1111-1111-111111111111"');
    expect(xml).toContain('cardType="Application"');
    expect(xml).toContain('cardType="DataObject"');
    // geometry uses the supplied LDV node size/position
    expect(xml).toContain('x="100" y="50" width="200" height="72"');
  });

  it("round-trips card ids through the backend's card-ref regex", () => {
    const xml = buildLdvDiagramXml(cards, rels, layers);
    const re = /cardId="([0-9a-fA-F-]{36})"/g;
    const found = [...xml.matchAll(re)].map((m) => m[1]);
    expect(found).toEqual([
      "11111111-1111-1111-1111-111111111111",
      "22222222-2222-2222-2222-222222222222",
    ]);
  });

  it("emits relation edges with relationType but never marks them pending", () => {
    const xml = buildLdvDiagramXml(cards, rels, layers);
    expect(xml).toContain('relationType="relAppToData"');
    expect(xml).toContain('edge="1"');
    // Display-only: no pending flag and no relationId → editor won't re-create it
    expect(xml).not.toContain('pending="1"');
    expect(xml).not.toContain("relationId=");
  });

  it("renders layer boxes that carry no cardId (ignored by ref extraction)", () => {
    const xml = buildLdvDiagramXml(cards, rels, layers);
    expect(xml).toContain('id="layer-0"');
    expect(xml).toContain("Application &amp; Data"); // label escaped
    // exactly two cardId occurrences — layers must not add any
    expect(xml.match(/cardId=/g)?.length).toBe(2);
  });

  it("escapes XML-significant characters in labels", () => {
    const xml = buildLdvDiagramXml(cards, rels, layers);
    expect(xml).toContain("Orders &amp; &quot;stuff&quot; &lt;x&gt;");
    expect(xml).not.toContain('Orders & "stuff" <x>');
  });

  it("drops edges whose endpoints are not on the diagram", () => {
    const orphanRel: DiagramRelInput[] = [
      {
        sourceCardId: "11111111-1111-1111-1111-111111111111",
        targetCardId: "99999999-9999-9999-9999-999999999999",
        relationType: "relAppToData",
        label: "reads",
        color: "#8a93a3",
      },
    ];
    const xml = buildLdvDiagramXml(cards, orphanRel, layers);
    expect(xml).not.toContain('edge="1"');
  });

  it("omits the relationType attribute for synthetic (typeless) edges", () => {
    const hierRel: DiagramRelInput[] = [
      {
        sourceCardId: "11111111-1111-1111-1111-111111111111",
        targetCardId: "22222222-2222-2222-2222-222222222222",
        relationType: "",
        label: "contains",
        color: "#8a93a3",
      },
    ];
    const xml = buildLdvDiagramXml(cards, hierRel, layers);
    expect(xml).toContain('edge="1"');
    expect(xml).not.toContain("relationType=");
  });
});
