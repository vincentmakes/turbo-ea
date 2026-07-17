import { describe, it, expect } from "vitest";
import {
  buildCardCellData,
  applyCardTypeIcons,
  buildLdvDiagramXml,
  rollUpInto,
  childEscapedParentBounds,
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

describe("buildCardCellData — contrast-aware font color", () => {
  it("uses white text on a dark type color", () => {
    const { style } = buildCardCellData(base); // #0f7eb5
    expect(style).toContain("fontColor=#ffffff");
  });

  it("uses black text on a pale type color (e.g. ArchiMate yellow)", () => {
    const { style } = buildCardCellData({ ...base, color: "#FFFFB5" });
    expect(style).toContain("fontColor=#000000");
    expect(style).not.toContain("fontColor=#ffffff");
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

/* ---------------------------------------------------------------------- */
/*  rollUpInto — re-parent existing cells vs insert fresh ones             */
/* ---------------------------------------------------------------------- */

type Geo = { x: number; y: number; width: number; height: number };
type AttrBag = { getAttribute: (k: string) => string | null; setAttribute: (k: string, v: string) => void; removeAttribute: (k: string) => void };
interface RUCell {
  id: string;
  value: AttrBag | null;
  geometry: Geo;
  parent: RUCell | null;
  children: RUCell[];
  style?: string;
}

function attrBag(init: Record<string, string> = {}): AttrBag {
  const a: Record<string, string> = { ...init };
  return {
    getAttribute: (k) => (k in a ? a[k] : null),
    setAttribute: (k, v) => {
      a[k] = v;
    },
    removeAttribute: (k) => {
      delete a[k];
    },
  };
}

function ruCell(id: string, geo: Geo, attrs: Record<string, string> = {}): RUCell {
  return { id, value: attrBag(attrs), geometry: geo, parent: null, children: [] };
}

/** Rich fake mxGraph sufficient to exercise rollUpInto without DrawIO. */
function rollUpFrame(initial: RUCell[]) {
  const cells: Record<string, RUCell> = {};
  const root: RUCell = { id: "__root", value: null, geometry: { x: 0, y: 0, width: 0, height: 0 }, parent: null, children: [] };
  cells.__root = root;
  for (const c of initial) {
    // Top-level cells start parented to the default parent.
    if (!c.parent) {
      c.parent = root;
      root.children.push(c);
    }
    cells[c.id] = c;
  }
  const model = {
    cells,
    beginUpdate() {},
    endUpdate() {},
    getCell: (id: string) => cells[id] ?? null,
    add: (parent: RUCell, child: RUCell) => {
      if (child.parent) child.parent.children = child.parent.children.filter((k) => k !== child);
      child.parent = parent;
      parent.children.push(child);
      return child;
    },
  };
  const graph = {
    getModel: () => model,
    getDefaultParent: () => root,
    getCellGeometry: (c: RUCell) => c.geometry,
    resizeCell: (c: RUCell, r: Geo) => {
      c.geometry = { x: r.x, y: r.y, width: r.width, height: r.height };
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    insertVertex: (parent: RUCell, id: string, obj: any, x: number, y: number, w: number, h: number, style: string) => {
      const cell: RUCell = { id, value: obj, geometry: { x, y, width: w, height: h }, parent, children: [], style };
      cells[id] = cell;
      parent.children.push(cell);
      return cell;
    },
  };
  const contentWindow = {
    __turboGraph: graph,
    mxUtils: { createXmlDocument: () => ({ createElement: () => attrBag() }) },
    mxRectangle: class {
      x: number;
      y: number;
      width: number;
      height: number;
      constructor(x: number, y: number, w: number, h: number) {
        this.x = x;
        this.y = y;
        this.width = w;
        this.height = h;
      }
    },
  };
  const iframe = { contentWindow } as unknown as HTMLIFrameElement;
  return { cells, iframe };
}

const RU_PARENT = { id: "pppppppp-0000", name: "Parent Org", type: "Organization", color: "#2889ff" };
const RU_GEO: Geo = { x: 100, y: 100, width: 180, height: 50 };

describe("rollUpInto — re-parent existing vs insert new", () => {
  it("re-parents existing on-canvas siblings without duplicating or stamping them", () => {
    const cur = ruCell("cur", RU_GEO, { cardId: "cur-card", cardType: "Application" });
    const sib = ruCell("sib-existing", { x: 400, y: 100, width: 180, height: 50 }, { cardId: "sib-card", cardType: "Application" });
    const { cells, iframe } = rollUpFrame([cur, sib]);

    const result = rollUpInto(iframe, "cur", RU_PARENT, [{ cellId: "sib-existing", card: { id: "sib-card", name: "Sibling", type: "Application", color: "#0f7eb5" } }]);

    expect(result).not.toBeNull();
    // Nothing is reported as freshly inserted — the sibling already existed.
    expect(result!.insertedSiblings).toEqual([]);
    // No new ruc-* cell was created.
    expect(Object.keys(cells).some((k) => k.startsWith("ruc-"))).toBe(false);
    const container = cells[result!.parentCellId];
    expect(container).toBeDefined();
    // Both the current card and the existing sibling are now inside the container.
    expect(cur.parent).toBe(container);
    expect(sib.parent).toBe(container);
    // Re-parented cells are NOT marked as roll-up children (mirrors the current card).
    expect(sib.value!.getAttribute("rollUpChild")).toBeNull();
    expect(cur.value!.getAttribute("rollUpChild")).toBeNull();
  });

  it("inserts a fresh cell for a sibling not yet on the canvas, stamped rollUpChild", () => {
    const cur = ruCell("cur", RU_GEO, { cardId: "cur-card", cardType: "Application" });
    const { cells, iframe } = rollUpFrame([cur]);

    const result = rollUpInto(iframe, "cur", RU_PARENT, [{ cellId: null, card: { id: "new-card", name: "Fresh", type: "Application", color: "#0f7eb5" } }]);

    expect(result).not.toBeNull();
    expect(result!.insertedSiblings).toHaveLength(1);
    const { cellId, cardId } = result!.insertedSiblings[0];
    expect(cellId.startsWith("ruc-")).toBe(true);
    expect(cardId).toBe("new-card");
    const fresh = cells[cellId];
    expect(fresh.value!.getAttribute("rollUpChild")).toBe("1");
    expect(fresh.parent).toBe(cells[result!.parentCellId]);
  });

  it("partitions a mixed batch — re-parent existing, insert only the fresh one", () => {
    const cur = ruCell("cur", RU_GEO, { cardId: "cur-card", cardType: "Application" });
    const sib = ruCell("sib-existing", { x: 400, y: 100, width: 180, height: 50 }, { cardId: "a", cardType: "Application" });
    const { cells, iframe } = rollUpFrame([cur, sib]);

    const result = rollUpInto(iframe, "cur", RU_PARENT, [
      { cellId: "sib-existing", card: { id: "a", name: "A", type: "Application", color: "#0f7eb5" } },
      { cellId: null, card: { id: "b", name: "B", type: "Application", color: "#0f7eb5" } },
    ]);

    expect(result!.insertedSiblings).toHaveLength(1);
    expect(result!.insertedSiblings[0].cardId).toBe("b");
    const container = cells[result!.parentCellId];
    expect(sib.parent).toBe(container); // existing moved in
  });

  it("wraps only the current card when no siblings are supplied (parent only)", () => {
    const cur = ruCell("cur", RU_GEO, { cardId: "cur-card", cardType: "Application" });
    const { cells, iframe } = rollUpFrame([cur]);

    const result = rollUpInto(iframe, "cur", RU_PARENT, []);

    expect(result).not.toBeNull();
    expect(result!.insertedSiblings).toEqual([]);
    const container = cells[result!.parentCellId];
    expect(cur.parent).toBe(container);
    // count = 1 (current card only) → single column/row container.
    expect(container.geometry.width).toBe(204); // 1*180 + 0 + 2*12
    expect(container.geometry.height).toBe(102); // 28 + 12 + 50 + 12
  });
});

describe("childEscapedParentBounds — collapse guard", () => {
  const parent = { x: 0, y: 0, width: 204, height: 300 };

  it("returns false for a child fully inside the parent", () => {
    const child = { x: 12, y: 40, width: 180, height: 50 };
    expect(childEscapedParentBounds(child, parent, false)).toBe(false);
  });

  it("returns true for a child escaping the bottom edge (real drag-out)", () => {
    const child = { x: 12, y: 280, width: 180, height: 50 }; // 280 + 50 > 300
    expect(childEscapedParentBounds(child, parent, false)).toBe(true);
  });

  it("returns true for a child escaping the right edge", () => {
    const child = { x: 40, y: 40, width: 180, height: 50 }; // 40 + 180 > 204
    expect(childEscapedParentBounds(child, parent, false)).toBe(true);
  });

  it("returns false when the parent is collapsed, even if bounds escape", () => {
    // Folded swimlane: parent bounds shrank to header height; the child keeps
    // its expanded-layout geometry so it looks escaped — must NOT detach.
    const collapsedParent = { x: 0, y: 0, width: 204, height: 28 };
    const child = { x: 12, y: 40, width: 180, height: 50 };
    expect(childEscapedParentBounds(child, collapsedParent, false)).toBe(true); // sanity: escapes when treated as expanded
    expect(childEscapedParentBounds(child, collapsedParent, true)).toBe(false); // guard: collapsed → no detach
  });
});
