import { describe, it, expect } from "vitest";
import {
  buildCardCellData,
  applyCardTypeIcons,
  buildLdvDiagramXml,
  rollUpInto,
  expandCardGroup,
  childEscapedParentBounds,
  applyViewToGraph,
  resetViewColors,
  captureGroupChildLayout,
  setRelationLabelsHidden,
  stampEdgeAsRelation,
  markEdgeSynced,
  relationEdgeStyle,
  RELATION_EDGE_COLOR,
  readFlowDirection,
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

// ---------------------------------------------------------------------------
// View colours vs. manual formatting (discussion #905)
// ---------------------------------------------------------------------------

/** Fake model that also serves geometry, for the view + layout helpers. */
type ViewCell = {
  _style: string;
  edge?: boolean;
  _geo?: { x: number; y: number; width: number; height: number };
  _attrs: Record<string, string | null>;
};
function viewFrame(cells: Record<string, ViewCell>) {
  const model = {
    cells,
    beginUpdate() {},
    endUpdate() {},
    getStyle: (c: ViewCell) => c._style,
    setStyle: (c: ViewCell, s: string) => {
      c._style = s;
    },
    // Needed by the edge-style builders (stampEdgeAsRelation / markEdgeSynced),
    // which look their target up by cell id and replace its user object.
    getCell: (id: string) => cells[id],
    setValue: (c: ViewCell, v: unknown) => {
      (c as unknown as { value: unknown }).value = v;
    },
  };
  const graph = {
    getModel: () => model,
    getCellGeometry: (c: ViewCell) => c._geo ?? null,
    setCellStyles: () => {},
  };
  return {
    contentWindow: {
      __turboGraph: graph,
      mxUtils: {
        createXmlDocument: () => document.implementation.createDocument(null, null, null),
      },
    },
  } as unknown as HTMLIFrameElement;
}
function viewCell(
  attrs: Record<string, string | null>,
  style: string,
  extra: Partial<ViewCell> = {},
): ViewCell {
  return {
    _style: style,
    _attrs: attrs,
    value: { getAttribute: (k: string) => attrs[k] ?? null },
    ...extra,
  } as unknown as ViewCell;
}
function stylePart(style: string, key: string): string | undefined {
  return style
    .split(";")
    .find((p) => p.startsWith(`${key}=`))
    ?.slice(key.length + 1);
}

describe("applyViewToGraph / resetViewColors — manual fills survive", () => {
  const TYPE_COLORS = new Map([["Application", "#0f7eb5"]]);

  it("stamps the pre-view fill so the view can be undone", () => {
    const cell = viewCell(
      { cardId: "c1", cardType: "Application" },
      "rounded=1;fillColor=#0f7eb5;strokeColor=#0b5f88",
    );
    const frame = viewFrame({ a: cell });

    applyViewToGraph(frame, new Map([["c1", "#ff0000"]]), "#cbd5e1");

    expect(stylePart(cell._style, "fillColor")).toBe("#ff0000");
    expect(stylePart(cell._style, "turboBaseFill")).toBe("#0f7eb5");
    expect(stylePart(cell._style, "turboBaseStroke")).toBe("#0b5f88");
  });

  it("does not overwrite the stamp when a second view is applied", () => {
    const cell = viewCell(
      { cardId: "c1", cardType: "Application" },
      "fillColor=#abcdef;strokeColor=#123456",
    );
    const frame = viewFrame({ a: cell });

    applyViewToGraph(frame, new Map([["c1", "#ff0000"]]), "#cbd5e1");
    applyViewToGraph(frame, new Map([["c1", "#00ff00"]]), "#cbd5e1");

    // Still the ORIGINAL colour, not the first view's colour.
    expect(stylePart(cell._style, "turboBaseFill")).toBe("#abcdef");
    expect(stylePart(cell._style, "fillColor")).toBe("#00ff00");
  });

  it("restores the stamped colour and clears the stamp on reset", () => {
    const cell = viewCell(
      { cardId: "c1", cardType: "Application" },
      "fillColor=#0f7eb5;strokeColor=#0b5f88",
    );
    const frame = viewFrame({ a: cell });

    applyViewToGraph(frame, new Map([["c1", "#ff0000"]]), "#cbd5e1");
    const touched = resetViewColors(frame, TYPE_COLORS, "#999");

    expect(touched).toBe(1);
    expect(stylePart(cell._style, "fillColor")).toBe("#0f7eb5");
    expect(stylePart(cell._style, "strokeColor")).toBe("#0b5f88");
    expect(stylePart(cell._style, "turboBaseFill")).toBeUndefined();
    expect(stylePart(cell._style, "turboBaseStroke")).toBeUndefined();
  });

  it("REGRESSION #905: leaves a hand-picked fill alone on reset", () => {
    // The user set this card to pink by hand. No view ever claimed it, so it
    // carries no stamp — reset (which runs on every save) must not touch it.
    const cell = viewCell(
      { cardId: "c1", cardType: "Application" },
      "rounded=1;fillColor=#ff69b4;strokeColor=#c71585",
    );
    const frame = viewFrame({ a: cell });

    const touched = resetViewColors(frame, TYPE_COLORS, "#999");

    expect(touched).toBe(0);
    expect(cell._style).toBe("rounded=1;fillColor=#ff69b4;strokeColor=#c71585");
  });

  it("restores a manual fill applied BEFORE a view was switched on", () => {
    const cell = viewCell({ cardId: "c1", cardType: "Application" }, "fillColor=#ff69b4");
    const frame = viewFrame({ a: cell });

    applyViewToGraph(frame, new Map([["c1", "#ff0000"]]), "#cbd5e1");
    resetViewColors(frame, TYPE_COLORS, "#999");

    expect(stylePart(cell._style, "fillColor")).toBe("#ff69b4");
  });

  it("falls back to the card-type colour when the cell had no explicit fill", () => {
    const cell = viewCell({ cardId: "c1", cardType: "Application" }, "rounded=1");
    const frame = viewFrame({ a: cell });

    applyViewToGraph(frame, new Map([["c1", "#ff0000"]]), "#cbd5e1");
    resetViewColors(frame, TYPE_COLORS, "#999");

    expect(stylePart(cell._style, "fillColor")).toBe("#0f7eb5");
  });

  it("ignores edges and pending cells", () => {
    const edge = viewCell({ cardId: "c1" }, "strokeColor=#000", { edge: true });
    const pending = viewCell({ cardId: "pending-xyz" }, "fillColor=#eee");
    const frame = viewFrame({ e: edge, p: pending });

    expect(applyViewToGraph(frame, new Map([["c1", "#ff0000"]]), "#cbd5e1")).toBe(0);
    expect(edge._style).toBe("strokeColor=#000");
    expect(pending._style).toBe("fillColor=#eee");
  });
});

describe("captureGroupChildLayout — collapse preserves arrangement", () => {
  it("captures geometry + style for that parent's children only", () => {
    const mine = viewCell(
      { cardId: "child-1", parentGroupCell: "parent-1" },
      "fillColor=#111",
      { _geo: { x: 10, y: 20, width: 180, height: 50 } },
    );
    const other = viewCell(
      { cardId: "child-2", parentGroupCell: "parent-2" },
      "fillColor=#222",
      { _geo: { x: 0, y: 0, width: 10, height: 10 } },
    );
    const loose = viewCell({ cardId: "child-3" }, "fillColor=#333", {
      _geo: { x: 1, y: 1, width: 2, height: 2 },
    });
    const frame = viewFrame({ a: mine, b: other, c: loose });

    const layout = captureGroupChildLayout(frame, "parent-1");

    expect([...layout.keys()]).toEqual(["child-1"]);
    expect(layout.get("child-1")).toEqual({
      x: 10,
      y: 20,
      width: 180,
      height: 50,
      style: "fillColor=#111",
    });
  });

  it("skips edges and cells without geometry", () => {
    const edge = viewCell({ cardId: "c1", parentGroupCell: "p" }, "s", { edge: true });
    const noGeo = viewCell({ cardId: "c2", parentGroupCell: "p" }, "s");
    const frame = viewFrame({ e: edge, n: noGeo });

    expect(captureGroupChildLayout(frame, "p").size).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Relation-label visibility toggle
// ---------------------------------------------------------------------------

function edgeCell(
  attrs: Record<string, string | null>,
  style: string,
): ViewCell {
  return viewCell(attrs, style, { edge: true });
}

describe("setRelationLabelsHidden", () => {
  const REL_STYLE = "edgeStyle=entityRelationEdgeStyle;strokeColor=#666;fontSize=10";

  it("hides the verb without touching the label value", () => {
    // The label must survive: the sync side-table still needs the relation, and
    // showing the labels again has to bring the original text back.
    const edge = edgeCell({ relationType: "app_to_itc", label: "provides" }, REL_STYLE);
    const frame = viewFrame({ e: edge });

    expect(setRelationLabelsHidden(frame, true)).toBe(1);

    expect(edge._style.split(";")).toContain("noLabel=1");
    expect(edge._attrs.label).toBe("provides");
  });

  it("round-trips cleanly back to the original style", () => {
    const edge = edgeCell({ relationType: "app_to_itc" }, REL_STYLE);
    const frame = viewFrame({ e: edge });

    setRelationLabelsHidden(frame, true);
    setRelationLabelsHidden(frame, false);

    expect(edge._style).toBe(REL_STYLE);
  });

  it("is idempotent and reports nothing changed on a repeat call", () => {
    const edge = edgeCell({ relationType: "app_to_itc" }, REL_STYLE);
    const frame = viewFrame({ e: edge });

    expect(setRelationLabelsHidden(frame, true)).toBe(1);
    expect(setRelationLabelsHidden(frame, true)).toBe(0);
    // No duplicate style part on the repeat.
    expect(edge._style.split(";").filter((p) => p === "noLabel=1")).toHaveLength(1);
  });

  it("leaves a hand-labelled annotation edge alone", () => {
    // An edge the architect drew and labelled themselves is theirs, not ours —
    // only Turbo EA relation edges carry a relationType.
    const annotation = edgeCell({ label: "see ADR-12" }, "endArrow=block");
    const frame = viewFrame({ a: annotation });

    expect(setRelationLabelsHidden(frame, true)).toBe(0);
    expect(annotation._style).toBe("endArrow=block");
  });

  it("leaves card cells alone", () => {
    const card = viewCell({ cardId: "c1", cardType: "Application" }, "fillColor=#0f7eb5");
    const frame = viewFrame({ c: card });

    expect(setRelationLabelsHidden(frame, true)).toBe(0);
    expect(card._style).toBe("fillColor=#0f7eb5");
  });

  it("applies across every relation edge on the canvas", () => {
    const a = edgeCell({ relationType: "app_to_itc" }, REL_STYLE);
    const b = edgeCell({ relationType: "org_to_app" }, REL_STYLE);
    const frame = viewFrame({ a, b });

    expect(setRelationLabelsHidden(frame, true)).toBe(2);
    expect(a._style).toContain("noLabel=1");
    expect(b._style).toContain("noLabel=1");
  });
});

describe("edge style builders honour the label setting", () => {
  it("stampEdgeAsRelation hides a newly drawn edge's verb when set", () => {
    // Regression guard: both builders rebuild the style from scratch, so an
    // edge drawn while labels are hidden would otherwise pop back visible.
    const edge = edgeCell({}, "");
    const frame = viewFrame({ e: edge });

    stampEdgeAsRelation(frame, "e", "app_to_itc", "provides", false, false, true);
    expect(edge._style.split(";")).toContain("noLabel=1");
  });

  it("stampEdgeAsRelation leaves the verb visible by default", () => {
    const edge = edgeCell({}, "");
    const frame = viewFrame({ e: edge });

    stampEdgeAsRelation(frame, "e", "app_to_itc", "provides", false, false);
    expect(edge._style.split(";")).not.toContain("noLabel=1");
  });

  it("markEdgeSynced carries the setting across the pending → synced switch", () => {
    const edge = edgeCell(
      { relationType: "app_to_itc" },
      "edgeStyle=entityRelationEdgeStyle;noLabel=1",
    );
    const frame = viewFrame({ e: edge });

    markEdgeSynced(frame, "e", false, "rel-1", true);
    expect(edge._style.split(";")).toContain("noLabel=1");
  });
});

/* ---------------------------------------------------------------------- */
/*  relationEdgeStyle — the one renderer for relation edges (#905)          */
/* ---------------------------------------------------------------------- */

describe("relationEdgeStyle", () => {
  it("draws every relation in the same neutral colour", () => {
    // The reporter saw the same relation rendered two ways depending on how
    // it reached the canvas. One builder, one colour.
    expect(stylePart(relationEdgeStyle(), "strokeColor")).toBe(RELATION_EDGE_COLOR);
    expect(stylePart(relationEdgeStyle({ incoming: true }), "strokeColor")).toBe(
      RELATION_EDGE_COLOR,
    );
    expect(stylePart(relationEdgeStyle({ pending: true }), "strokeColor")).toBe(
      RELATION_EDGE_COLOR,
    );
  });

  it("puts the arrowhead on the end for an outgoing relation", () => {
    const parts = relationEdgeStyle().split(";");
    expect(parts).toContain("endArrow=block");
    expect(parts).toContain("startArrow=none");
  });

  it("moves the arrowhead to the start for an incoming relation", () => {
    // The mxGraph endpoints stay put (expand/collapse and the sync
    // side-table key off them) — only the arrowhead swaps ends.
    const parts = relationEdgeStyle({ incoming: true }).split(";");
    expect(parts).toContain("startArrow=block");
    expect(parts).toContain("endArrow=none");
  });

  it("dashes a relation that has not been pushed to the inventory yet", () => {
    expect(relationEdgeStyle({ pending: true }).split(";")).toContain("dashed=1");
    expect(relationEdgeStyle().split(";")).not.toContain("dashed=1");
  });

  it("honours the hide-labels setting", () => {
    expect(relationEdgeStyle({ hideLabel: true }).split(";")).toContain("noLabel=1");
    expect(relationEdgeStyle().split(";")).not.toContain("noLabel=1");
  });
});

describe("edge builders all delegate to relationEdgeStyle", () => {
  it("stampEdgeAsRelation renders exactly what relationEdgeStyle says", () => {
    const edge = edgeCell({}, "");
    const frame = viewFrame({ e: edge });

    stampEdgeAsRelation(frame, "e", "app_to_itc", "provides", true, true);
    expect(edge._style).toBe(relationEdgeStyle({ incoming: true, pending: true }));
  });

  it("stampEdgeAsRelation records a reversed pick so sync can swap the ids", () => {
    // Without this the relation is POSTed source -> target even though the
    // user picked the reverse direction. Note the verb is still the FORWARD
    // one: reversing moves the arrowhead, not the sentence — the arrow always
    // points at the relation's target, so it still reads source-verb-target.
    const edge = edgeCell({}, "");
    const frame = viewFrame({ e: edge });

    stampEdgeAsRelation(frame, "e", "app_to_itc", "uses", true, true);
    expect(edge.value.getAttribute("reversed")).toBe("1");
    expect(edge.value.getAttribute("label")).toBe("uses");
  });

  it("stampEdgeAsRelation leaves an as-drawn relation unflagged", () => {
    const edge = edgeCell({}, "");
    const frame = viewFrame({ e: edge });

    stampEdgeAsRelation(frame, "e", "app_to_itc", "provides", false, true);
    expect(edge.value.getAttribute("reversed")).toBeNull();
  });

  it("markEdgeSynced only drops the dashes", () => {
    const edge = edgeCell({ relationType: "app_to_itc" }, relationEdgeStyle({ pending: true }));
    const frame = viewFrame({ e: edge });

    markEdgeSynced(frame, "e", false, "rel-1");
    expect(edge._style).toBe(relationEdgeStyle());
  });

  it("markEdgeSynced keeps the arrowhead on the reversed end", () => {
    const edge = edgeCell(
      { relationType: "app_to_itc" },
      relationEdgeStyle({ incoming: true, pending: true }),
    );
    const frame = viewFrame({ e: edge });

    markEdgeSynced(frame, "e", true, "rel-1");
    expect(edge._style).toBe(relationEdgeStyle({ incoming: true }));
  });
});

/* ---------------------------------------------------------------------- */
/*  flowDirection arrowheads — provider vs consumer on an edge (#905)      */
/* ---------------------------------------------------------------------- */

describe("relationEdgeStyle honours a relation's flowDirection", () => {
  const arrows = (style: string) => {
    const parts = style.split(";");
    return {
      start: parts.includes("startArrow=block"),
      end: parts.includes("endArrow=block"),
    };
  };

  it("points at the target when data flows source → target", () => {
    // The reporter's case: an Application that *provides* an Interface.
    expect(arrows(relationEdgeStyle({ flow: "forward" }))).toEqual({
      start: false,
      end: true,
    });
  });

  it("points back at the source when data flows target → source", () => {
    // An Application that *consumes* the Interface — the whole point is that
    // this must look different from the provider link above.
    expect(arrows(relationEdgeStyle({ flow: "reverse" }))).toEqual({
      start: true,
      end: false,
    });
  });

  it("arrows both ends when the flow is bidirectional", () => {
    expect(arrows(relationEdgeStyle({ flow: "bidirectional" }))).toEqual({
      start: true,
      end: true,
    });
  });

  it("re-orients the flow onto an edge drawn the other way round", () => {
    // flowDirection is stored on the RELATION's source → target axis. When the
    // edge was drawn against that axis the arrowhead has to swap ends, or a
    // provider and a consumer would render identically.
    expect(arrows(relationEdgeStyle({ flow: "forward", incoming: true }))).toEqual({
      start: true,
      end: false,
    });
    expect(arrows(relationEdgeStyle({ flow: "reverse", incoming: true }))).toEqual({
      start: false,
      end: true,
    });
    // Bidirectional is symmetric, so re-orienting is a no-op.
    expect(arrows(relationEdgeStyle({ flow: "bidirectional", incoming: true }))).toEqual({
      start: true,
      end: true,
    });
  });

  it("leaves every relation without a flow exactly as it was", () => {
    // Regression guard: only relation types that declare the attribute change.
    expect(relationEdgeStyle({ flow: undefined })).toBe(relationEdgeStyle());
    expect(relationEdgeStyle({ flow: undefined, incoming: true })).toBe(
      relationEdgeStyle({ incoming: true }),
    );
    expect(relationEdgeStyle({ flow: undefined, pending: true, hideLabel: true })).toBe(
      relationEdgeStyle({ pending: true, hideLabel: true }),
    );
  });

  it("still dashes and hides labels when a flow is set", () => {
    const style = relationEdgeStyle({ flow: "reverse", pending: true, hideLabel: true });
    expect(style.split(";")).toContain("dashed=1");
    expect(style.split(";")).toContain("noLabel=1");
  });
});

describe("readFlowDirection", () => {
  it("accepts the three stored values", () => {
    expect(readFlowDirection("forward")).toBe("forward");
    expect(readFlowDirection("reverse")).toBe("reverse");
    expect(readFlowDirection("bidirectional")).toBe("bidirectional");
  });

  it("returns undefined for anything else, so the edge falls back", () => {
    // Covers the unset attribute, a legacy edge with no stamp, and junk.
    for (const v of [null, undefined, "", "sideways", 1, {}]) {
      expect(readFlowDirection(v)).toBeUndefined();
    }
  });
});

describe("flowDirection survives the pending → synced switch", () => {
  it("stampEdgeAsRelation stamps it and markEdgeSynced reads it back", () => {
    // markEdgeSynced deliberately takes no flow argument — it reads what the
    // stamp left, so the two paths cannot disagree.
    const edge = edgeCell({}, "");
    const frame = viewFrame({ e: edge });

    stampEdgeAsRelation(frame, "e", "relAppToInterface", "provides / consumes", false, true, false, "reverse");
    expect(edge.value.getAttribute("flowDirection")).toBe("reverse");
    expect(edge._style).toBe(relationEdgeStyle({ flow: "reverse", pending: true }));

    markEdgeSynced(frame, "e", false, "rel-1");
    expect(edge._style).toBe(relationEdgeStyle({ flow: "reverse" }));
  });

  it("leaves an edge with no flow unstamped", () => {
    const edge = edgeCell({}, "");
    const frame = viewFrame({ e: edge });

    stampEdgeAsRelation(frame, "e", "relOrgToApp", "uses", false, true);
    expect(edge.value.getAttribute("flowDirection")).toBeNull();
    expect(edge._style).toBe(relationEdgeStyle({ pending: true }));
  });
});

/* ---------------------------------------------------------------------- */
/*  expandCardGroup — the edges the + / Expand menu inserts (#905)          */
/* ---------------------------------------------------------------------- */

/** Fake mxGraph with just enough surface for expandCardGroup's edge output. */
function expandFrame() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const cells: Record<string, any> = {};
  const root = { id: "__root" };
  const parent = {
    id: "parent-cell",
    value: attrBag({ cardId: "org-1", cardType: "Organization", label: "Nexatech" }),
  };
  cells["parent-cell"] = parent;
  const model = {
    cells,
    beginUpdate() {},
    endUpdate() {},
    getCell: (id: string) => cells[id] ?? null,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    setValue: (cell: any, v: unknown) => {
      cell.value = v;
    },
  };
  const graph = {
    getModel: () => model,
    getDefaultParent: () => root,
    getCellGeometry: () => ({ x: 0, y: 0, width: 180, height: 50 }),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    insertVertex: (_p: any, id: string, obj: any, _x: number, _y: number, _w: number, _h: number, style: string) => {
      const cell = { id, value: obj, style };
      cells[id] = cell;
      return cell;
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    insertEdge: (_p: any, id: string, _v: unknown, _s: any, _t: any, style: string) => {
      const cell = { id, value: null, style, edge: true };
      cells[id] = cell;
      return cell;
    },
  };
  const iframe = {
    contentWindow: {
      __turboGraph: graph,
      mxUtils: { createXmlDocument: () => ({ createElement: () => attrBag() }) },
    },
  } as unknown as HTMLIFrameElement;
  return { iframe, cells };
}

/** One neighbour of the expanded card, related by `relOrgToApp` ("uses"). */
const expandChild = (incoming: boolean) => ({
  id: "app-1",
  name: "Copilot",
  type: "Application",
  color: "#0f7eb5",
  relationType: "relOrgToApp",
  relationId: "rel-1",
  relationLabel: "uses",
  incoming,
});

describe("expandCardGroup edges", () => {
  it("reads the same verb whichever end of the relation you expanded from", () => {
    // The reported case. Expanding the Organization shows "Nexatech uses
    // Copilot"; expanding the Application must NOT flip the verb to "is used
    // by", because the arrowhead still points at the Application, so the
    // sentence along the arrow is unchanged.
    const outgoing = expandFrame();
    expandCardGroup(outgoing.iframe, "parent-cell", [expandChild(false)]);
    const incoming = expandFrame();
    expandCardGroup(incoming.iframe, "parent-cell", [expandChild(true)]);

    const labelOf = (f: ReturnType<typeof expandFrame>) => {
      const edge = Object.values(f.cells).find((c) => c.edge);
      return edge.value.getAttribute("label");
    };
    expect(labelOf(outgoing)).toBe("uses");
    expect(labelOf(incoming)).toBe("uses");
  });

  it("puts the arrowhead on opposite ends for the two directions", () => {
    // The verb stays put; the arrow is what carries the direction.
    const outgoing = expandFrame();
    expandCardGroup(outgoing.iframe, "parent-cell", [expandChild(false)]);
    const incoming = expandFrame();
    expandCardGroup(incoming.iframe, "parent-cell", [expandChild(true)]);

    const styleOf = (f: ReturnType<typeof expandFrame>) =>
      Object.values(f.cells).find((c) => c.edge).style.split(";");
    expect(styleOf(outgoing)).toContain("endArrow=block");
    expect(styleOf(outgoing)).toContain("startArrow=none");
    expect(styleOf(incoming)).toContain("startArrow=block");
    expect(styleOf(incoming)).toContain("endArrow=none");
  });

  it("stamps the relation id and type so canvas deletes reach the backend", () => {
    const f = expandFrame();
    const inserted = expandCardGroup(f.iframe, "parent-cell", [expandChild(false)]);

    const edge = Object.values(f.cells).find((c) => c.edge);
    expect(edge.value.getAttribute("relationId")).toBe("rel-1");
    expect(edge.value.getAttribute("relationType")).toBe("relOrgToApp");
    expect(inserted[0].relationId).toBe("rel-1");
    expect(inserted[0].relationLabel).toBe("uses");
  });

  it("hides the verb on expansion edges when the diagram hides labels", () => {
    const f = expandFrame();
    expandCardGroup(f.iframe, "parent-cell", [expandChild(false)], true);

    const edge = Object.values(f.cells).find((c) => c.edge);
    expect(edge.style.split(";")).toContain("noLabel=1");
  });
});
