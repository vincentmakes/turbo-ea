/**
 * The graph-mutating helpers of `drawio-shapes.ts`, run against the kit's
 * fake DrawIO iframe (`@/test/mxGraphFake`). The pure style / label / XML
 * helpers live in `drawio-shapes.test.ts`; this file covers what reads and
 * writes the live mxGraph model — insertion, sync state, overlays, groups,
 * scans, and the lifecycle listeners.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  MX_EVENT,
  attrBag,
  cardCell,
  containerCell,
  edgeCell,
  fakeIframe,
  plainCell,
  styleTokens,
  type FakeCell,
  type FakeIframe,
} from "@/test/mxGraphFake";

import {
  CARD_DETAIL_LINE_H,
  CARD_FREE_DETAIL_ROWS,
  CONTAINER_HEADER_H,
  addChevronOverlay,
  addExpandOverlay,
  addResyncOverlay,
  attachCardLabelEditListener,
  attachCardResizeListener,
  attachCellLifecycleListeners,
  attachParentChangeListener,
  buildCardCellData,
  classifyCell,
  collapseCardGroup,
  collectExistingCardCellIds,
  collectExistingEdgeRelations,
  collectLiveCellIds,
  collectLiveEdgeCellIds,
  composeCardLabel,
  containerHeaderHeight,
  convertShapeToPendingCard,
  describeEdgeEndpoints,
  detailRowsHeight,
  expandCardGroupAt,
  extractCardCellIdsFromXml,
  extractCardIds,
  extractEdgeRelationsFromXml,
  findExistingCardCellId,
  getCellLabel,
  getGroupChildCardIds,
  getGroupChildRelationIds,
  getNestedCardIds,
  getVisibleCenter,
  insertCardIntoGraph,
  insertPendingCard,
  isContainerCell,
  isInsideContainer,
  isSwimlaneStyle,
  markCellSynced,
  refreshCardOverlays,
  relinkCell,
  removeDiagramCell,
  removeEdgeCellsByIds,
  restoreRemovedEdge,
  revertParentChange,
  scanForDuplicateCells,
  updateCellLabel,
  type ParentChangeEvent,
  type RemovedRelationTombstone,
} from "./drawio-shapes";

/** An iframe with no DrawIO behind it: every helper must answer its empty value. */
const NO_GRAPH = { contentWindow: {} } as unknown as HTMLIFrameElement;
const NO_WINDOW = {} as unknown as HTMLIFrameElement;

const app = (id: string, cardId: string, name: string, extra: Record<string, string> = {}) =>
  cardCell(id, { cardId, cardType: "Application", name, attrs: extra });

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

/* ---------------------------------------------------------------------- */
/*  Pure helpers                                                            */
/* ---------------------------------------------------------------------- */

describe("pure sizing helpers", () => {
  it("detailRowsHeight charges nothing for the free rows and one line per row past them", () => {
    expect(detailRowsHeight(0)).toBe(0);
    expect(detailRowsHeight(CARD_FREE_DETAIL_ROWS)).toBe(0);
    expect(detailRowsHeight(CARD_FREE_DETAIL_ROWS + 1)).toBe(CARD_DETAIL_LINE_H);
    expect(detailRowsHeight(CARD_FREE_DETAIL_ROWS + 3)).toBe(3 * CARD_DETAIL_LINE_H);
  });

  it("containerHeaderHeight has no free allowance", () => {
    expect(containerHeaderHeight(0)).toBe(CONTAINER_HEADER_H);
    expect(containerHeaderHeight(2)).toBe(CONTAINER_HEADER_H + 2 * CARD_DETAIL_LINE_H);
  });

  it("isSwimlaneStyle reads the shape token and tolerates non-strings", () => {
    expect(isSwimlaneStyle("shape=swimlane;startSize=28")).toBe(true);
    expect(isSwimlaneStyle("rounded=1;html=1")).toBe(false);
    expect(isSwimlaneStyle(undefined)).toBe(false);
    expect(isSwimlaneStyle(null)).toBe(false);
  });
});

describe("XML scans", () => {
  const XML = `<mxGraphModel><root>
    <mxCell id="0"/><mxCell id="1" parent="0"/>
    <object label="A" cardId="id-a" cardType="Application" id="va"><mxCell id="va" vertex="1" parent="1"/></object>
    <object label="B" cardId="id-b" cardType="Application"><mxCell id="vb" vertex="1" parent="1"/></object>
    <object label="A again" cardId="id-a"><mxCell id="va2" vertex="1" parent="1"/></object>
    <object label="uses" relationId="rel-1" relationType="relAppToITC" cardId="stray"><mxCell id="e1" edge="1" source="va" target="vb" parent="1"/></object>
    <object label="" relationId="rel-2"><mxCell id="e2" edge="1" parent="1"/></object>
    <object relationId="rel-3"><mxCell id="e3" vertex="1" parent="1"/></object>
    <object cardId="no-inner"/>
    <object relationId="no-id"><mxCell edge="1"/></object>
  </root></mxGraphModel>`;

  it("extractCardIds dedupes the cardId attributes in document order", () => {
    expect(extractCardIds(XML)).toEqual(["id-a", "id-b", "stray", "no-inner"]);
    expect(extractCardIds("")).toEqual([]);
  });

  it("extractCardCellIdsFromXml returns vertex cell ids only, skipping edges and objects without a cell", () => {
    expect(extractCardCellIdsFromXml(XML)).toEqual(["va", "vb", "va2"]);
  });

  it("extractEdgeRelationsFromXml reads relation edges with their verb, skipping vertices and id-less cells", () => {
    expect(extractEdgeRelationsFromXml(XML)).toEqual([
      { edgeCellId: "e1", relationId: "rel-1", relationType: "relAppToITC", relationLabel: "uses" },
      { edgeCellId: "e2", relationId: "rel-2", relationType: "", relationLabel: "" },
    ]);
  });

  it("both XML scans answer an empty list for unparsable input", () => {
    const spy = vi.spyOn(DOMParser.prototype, "parseFromString").mockImplementation(() => {
      throw new Error("boom");
    });
    expect(extractCardCellIdsFromXml("<")).toEqual([]);
    expect(extractEdgeRelationsFromXml("<")).toEqual([]);
    spy.mockRestore();
  });
});

/* ---------------------------------------------------------------------- */
/*  Insertion and sync state                                               */
/* ---------------------------------------------------------------------- */

describe("insertCardIntoGraph", () => {
  const data = () =>
    buildCardCellData({
      cardId: "id-1",
      cardType: "Application",
      name: "ERP <Core>",
      color: "#0f7eb5",
      x: 10,
      y: 20,
      detailLines: [{ label: "Owner", value: "Alice" }],
    });

  it("inserts a vertex whose user object is an XML element carrying the card attributes", () => {
    const f = fakeIframe();
    const d = data();
    expect(insertCardIntoGraph(f.iframe, d)).toBe(true);
    const cell = f.model.getCell(d.cellId)!;
    expect(cell.parent).toBe(f.defaultParent);
    expect(cell.geometry).toMatchObject({ x: 10, y: 20, width: d.width, height: d.height });
    expect(cell.style).toBe(d.style);
    expect(cell.value.getAttribute("cardId")).toBe("id-1");
    expect(cell.value.getAttribute("cardType")).toBe("Application");
    expect(cell.value.getAttribute("cardName")).toBe("ERP <Core>");
    expect(cell.value.getAttribute("label")).toBe(composeCardLabel("ERP <Core>", d.detailLines));
    expect(cell.value.ownerDocument).not.toBe(document);
    expect(f.model.updateLevel).toBe(0);
  });

  it("closes the transaction and reports false when the insert throws", () => {
    const f = fakeIframe();
    vi.spyOn(f.graph, "insertVertex").mockImplementation(() => {
      throw new Error("no canvas");
    });
    expect(insertCardIntoGraph(f.iframe, data())).toBe(false);
    expect(f.model.updateLevel).toBe(0);
  });

  it("reports false without a window or a graph", () => {
    expect(insertCardIntoGraph(NO_WINDOW, data())).toBe(false);
    expect(insertCardIntoGraph(NO_GRAPH, data())).toBe(false);
  });
});

describe("getVisibleCenter", () => {
  it("maps the scrolled viewport centre back into graph coordinates", () => {
    const f = fakeIframe();
    f.graph.container.scrollLeft = 100;
    f.graph.container.scrollTop = 0;
    f.graph.view.scale = 2;
    f.graph.view.translate = { x: 10, y: 20 } as any;
    // ((100 + 600) / 2) - 10 ; ((0 + 400) / 2) - 20
    expect(getVisibleCenter(f.iframe)).toEqual({ x: 340, y: 180 });
  });

  it("is null without a graph, and when the container is missing", () => {
    expect(getVisibleCenter(NO_GRAPH)).toBeNull();
    const f = fakeIframe();
    (f.graph as any).container = undefined;
    expect(getVisibleCenter(f.iframe)).toBeNull();
  });
});

describe("insertPendingCard / markCellSynced", () => {
  const opts = { tempId: "pending-1", type: "Application", name: "Draft", color: "#0f7eb5", icon: "apps", x: 5, y: 6 };

  it("inserts a dashed 210x60 cell flagged pending, named without composition", () => {
    const f = fakeIframe();
    const cellId = insertPendingCard(f.iframe, opts)!;
    expect(cellId).toMatch(/^pfs-\d+$/);
    const cell = f.model.getCell(cellId)!;
    expect(cell.geometry).toMatchObject({ x: 5, y: 6, width: 210, height: 60 });
    const style = styleTokens(cell.style);
    expect(style.dashed).toBe("1");
    expect(style.fillColor).toBe("#0f7eb5");
    expect(style.shape).toBe("label");
    expect(cell.value.getAttribute("pending")).toBe("1");
    expect(cell.value.getAttribute("cardId")).toBe("pending-1");
    expect(cell.value.getAttribute("cardType")).toBe("Application");
    expect(cell.value.getAttribute("label")).toBe("Draft");
    expect(cell.value.getAttribute("cardName")).toBe("Draft");
    expect(insertPendingCard(NO_GRAPH, opts)).toBeNull();
  });

  it("markCellSynced swaps the id, drops the pending flag and keeps the icon tokens across the restyle", () => {
    const f = fakeIframe();
    const cellId = insertPendingCard(f.iframe, opts)!;
    const cell = f.model.getCell(cellId)!;
    const imageToken = cell.style.split(";").find((p) => p.startsWith("image="));
    expect(imageToken).toBeDefined();

    expect(markCellSynced(f.iframe, cellId, "real-id", "#ff0000")).toBe(true);

    expect(cell.value.getAttribute("cardId")).toBe("real-id");
    expect(cell.value.getAttribute("pending")).toBeNull();
    const style = styleTokens(cell.style);
    expect(style.dashed).toBeUndefined();
    expect(style.shadow).toBe("1");
    expect(style.fillColor).toBe("#ff0000");
    expect(cell.style.split(";")).toContain(imageToken);
    expect(f.model.updateLevel).toBe(0);
  });

  it("markCellSynced on a cell without icon tokens leaves a bare synced style", () => {
    const c = plainCell("p", { value: attrBag({ cardId: "t", pending: "1" }), style: "dashed=1;" });
    const f = fakeIframe({ cells: [c] });
    expect(markCellSynced(f.iframe, "p", "real", "#123456")).toBe(true);
    expect(c.style).not.toContain("image=");
    expect(styleTokens(c.style).fillColor).toBe("#123456");
    expect(markCellSynced(f.iframe, "missing", "real", "#123456")).toBe(false);
    expect(markCellSynced(NO_GRAPH, "p", "real", "#123456")).toBe(false);
  });
});

describe("updateCellLabel", () => {
  it("renames the card and re-renders its stored detail rows", () => {
    const rows = [{ label: "Owner", value: "Alice" }];
    const c = app("c", "id-1", "Old", { cardDetail: JSON.stringify(rows), label: composeCardLabel("Old", rows) });
    const f = fakeIframe({ cells: [c] });
    expect(updateCellLabel(f.iframe, "c", "New")).toBe(true);
    expect(c.value.getAttribute("cardName")).toBe("New");
    expect(c.value.getAttribute("label")).toBe(composeCardLabel("New", rows));
    expect(f.graph.refreshed).toEqual([c]);
  });

  it("leaves a string-valued shape alone but still refreshes it", () => {
    const c = plainCell("p", { label: "box" });
    const f = fakeIframe({ cells: [c] });
    expect(updateCellLabel(f.iframe, "p", "New")).toBe(true);
    expect(c.value).toBe("box");
    expect(updateCellLabel(f.iframe, "nope", "New")).toBe(false);
    expect(updateCellLabel(NO_GRAPH, "p", "New")).toBe(false);
  });
});

describe("removeDiagramCell", () => {
  it("removes the cell and the edges hanging off it", () => {
    const a = app("a", "id-a", "A");
    const b = app("b", "id-b", "B");
    const e = edgeCell("e", a, b, { relationId: "r1" });
    const f = fakeIframe({ cells: [a, b, e] });
    expect(removeDiagramCell(f.iframe, "a")).toBe(true);
    expect(f.cells.a).toBeUndefined();
    expect(f.cells.e).toBeUndefined();
    expect(f.cells.b).toBe(b);
    expect(removeDiagramCell(f.iframe, "a")).toBe(false);
    expect(removeDiagramCell(NO_GRAPH, "b")).toBe(false);
  });
});

describe("relinkCell / classifyCell / getCellLabel / convertShapeToPendingCard", () => {
  it("relinkCell wraps a plain shape in a user object and recolours it without changing its shape", () => {
    const c = plainCell("p", { label: "Hand drawn", style: "ellipse;fillColor=#ffffff;strokeColor=#000000;fontColor=#000000;html=1" });
    const f = fakeIframe({ cells: [c] });
    expect(relinkCell(f.iframe, "p", { cardId: "id-1", cardType: "Application", name: "ERP", color: "#0f7eb5" })).toBe(true);
    expect(c.value.getAttribute("cardId")).toBe("id-1");
    expect(c.value.getAttribute("cardType")).toBe("Application");
    expect(c.value.getAttribute("cardName")).toBe("ERP");
    expect(c.value.getAttribute("label")).toBe("ERP");
    const style = styleTokens(c.style);
    expect(style.ellipse).toBe("");
    expect(style.html).toBe("1");
    expect(style.fillColor).toBe("#0f7eb5");
    expect(style.strokeColor).not.toBe("#000000");
    expect(style.fontColor).not.toBe("#000000");
    expect(f.graph.refreshed).toEqual([c]);
  });

  it("relinkCell replaces the whole style of a cell that was already card-shaped and clears the group markers", () => {
    const c = app("c", "old", "Old", { pending: "1", expanded: "1", childCellIds: "x,y" });
    c.style = "dashed=1;fillColor=#000;";
    const f = fakeIframe({ cells: [c] });
    expect(relinkCell(f.iframe, "c", { cardId: "new", cardType: "ITComponent", name: "DB", color: "#d29270", icon: "memory" })).toBe(true);
    expect(c.value.getAttribute("cardId")).toBe("new");
    expect(c.value.getAttribute("pending")).toBeNull();
    expect(c.value.getAttribute("expanded")).toBeNull();
    expect(c.value.getAttribute("childCellIds")).toBeNull();
    const style = styleTokens(c.style);
    expect(style.dashed).toBeUndefined();
    expect(style.shadow).toBe("1");
    expect(style.fillColor).toBe("#d29270");
    expect(style.shape).toBe("label");
    expect(relinkCell(f.iframe, "nope", { cardId: "n", cardType: "T", name: "N", color: "#000" })).toBe(false);
    expect(relinkCell(NO_GRAPH, "c", { cardId: "n", cardType: "T", name: "N", color: "#000" })).toBe(false);
  });

  it("classifyCell tells synced, pending, unlinked and plain cells apart", () => {
    const f = fakeIframe({
      cells: [
        app("synced", "id-1", "A"),
        cardCell("pending", { cardId: "pending-x", cardType: "Application", pending: true }),
        plainCell("unlinked", { value: attrBag({ label: "stub" }) }),
        plainCell("plain", { label: "box" }),
        edgeCell("edge", null, null, { relationId: "r" }),
      ],
    });
    expect(classifyCell(f.iframe, "synced")).toBe("synced");
    expect(classifyCell(f.iframe, "pending")).toBe("pending");
    expect(classifyCell(f.iframe, "unlinked")).toBe("unlinked");
    expect(classifyCell(f.iframe, "plain")).toBe("plain");
    expect(classifyCell(f.iframe, "edge")).toBeNull();
    expect(classifyCell(f.iframe, "missing")).toBeNull();
    expect(classifyCell(NO_GRAPH, "plain")).toBeNull();
  });

  it("getCellLabel reads the plain name off a card and the string off a shape", () => {
    const rows = [{ label: "Owner", value: "Alice" }];
    const f = fakeIframe({
      cells: [
        app("card", "id-1", "ERP", { label: composeCardLabel("ERP", rows), cardDetail: JSON.stringify(rows) }),
        plainCell("plain", { label: "box" }),
      ],
    });
    expect(getCellLabel(f.iframe, "card")).toBe("ERP");
    expect(getCellLabel(f.iframe, "plain")).toBe("box");
    expect(getCellLabel(f.iframe, "missing")).toBe("");
    expect(getCellLabel(NO_GRAPH, "plain")).toBe("");
  });

  it("convertShapeToPendingCard keeps the geometry and swaps the user object and style", () => {
    const c = plainCell("p", { label: "box", geometry: { x: 1, y: 2, width: 90, height: 45 } });
    const f = fakeIframe({ cells: [c] });
    expect(convertShapeToPendingCard(f.iframe, "p", { tempId: "pending-9", type: "Application", name: "Box", color: "#0f7eb5" })).toBe(true);
    expect(c.geometry).toMatchObject({ x: 1, y: 2, width: 90, height: 45 });
    expect(c.value.getAttribute("cardId")).toBe("pending-9");
    expect(c.value.getAttribute("pending")).toBe("1");
    expect(c.value.getAttribute("cardType")).toBe("Application");
    expect(c.value.getAttribute("cardName")).toBe("Box");
    expect(styleTokens(c.style).dashed).toBe("1");
    expect(f.graph.refreshed).toEqual([c]);
    expect(convertShapeToPendingCard(f.iframe, "nope", { tempId: "t", type: "T", name: "N", color: "#000" })).toBe(false);
    expect(convertShapeToPendingCard(NO_GRAPH, "p", { tempId: "t", type: "T", name: "N", color: "#000" })).toBe(false);
  });
});

/* ---------------------------------------------------------------------- */
/*  Overlays                                                               */
/* ---------------------------------------------------------------------- */

describe("overlays", () => {
  it("addExpandOverlay replaces earlier overlays with a +/- affordance whose click calls back", () => {
    const c = app("c", "id-1", "A");
    const f = fakeIframe({ cells: [c] });
    const onClick = vi.fn();
    expect(addExpandOverlay(f.iframe, "c", false, vi.fn())).toBe(true);
    expect(addExpandOverlay(f.iframe, "c", true, onClick)).toBe(true);

    const overlays = f.graph.getCellOverlays(c)!;
    expect(overlays).toHaveLength(1);
    const [overlay] = overlays;
    expect(overlay.image.width).toBe(24);
    expect(overlay.tooltip).toBe("Collapse");
    expect(overlay.align).toBe("right");
    expect(overlay.verticalAlign).toBe("middle");
    expect(overlay.offset).toEqual({ x: 0, y: -14 });
    expect(overlay.cursor).toBe("pointer");
    overlay.click();
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(addExpandOverlay(f.iframe, "missing", false, onClick)).toBe(false);
    expect(addExpandOverlay(NO_GRAPH, "c", false, onClick)).toBe(false);
  });

  it("addResyncOverlay adds a second, top-left overlay without clearing the first", () => {
    const c = app("c", "id-1", "A");
    const f = fakeIframe({ cells: [c] });
    const onClick = vi.fn();
    addExpandOverlay(f.iframe, "c", false, vi.fn());
    expect(addResyncOverlay(f.iframe, "c", onClick)).toBe(true);
    const overlays = f.graph.getCellOverlays(c)!;
    expect(overlays).toHaveLength(2);
    expect(overlays[1].align).toBe("left");
    expect(overlays[1].verticalAlign).toBe("top");
    expect(overlays[1].image.width).toBe(18);
    overlays[1].click();
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(addResyncOverlay(f.iframe, "missing", onClick)).toBe(false);
    expect(addResyncOverlay(NO_GRAPH, "c", onClick)).toBe(false);
  });

  it("addChevronOverlay anchors the menu at the click translated into the parent page", () => {
    const c = app("c", "id-1", "A");
    const f = fakeIframe({ cells: [c], iframeRect: { x: 100, y: 50 } });
    const onClick = vi.fn();
    expect(addChevronOverlay(f.iframe, "c", onClick)).toBe(true);
    const [overlay] = f.graph.getCellOverlays(c)!;
    overlay.click({ clientX: 30, clientY: 40 });
    expect(onClick).toHaveBeenCalledWith({ x: 130, y: 90 });
  });

  it("addChevronOverlay falls back to the cell's right edge, then to a fixed offset, when the event carries no position", () => {
    const c = cardCell("c", { cardId: "id-1", cardType: "Application", geometry: { x: 20, y: 10, width: 210, height: 60 } });
    const bare = cardCell("bare", { cardId: "id-2", cardType: "Application", geometry: null });
    const f = fakeIframe({ cells: [c, bare], iframeRect: { x: 100, y: 50 } });
    f.graph.view.scale = 2;
    f.graph.view.translate = { x: 5, y: 5 } as any;
    f.graph.container.scrollLeft = 10;
    f.graph.container.scrollTop = 20;
    const onClick = vi.fn();
    addChevronOverlay(f.iframe, "c", onClick);
    f.graph.getCellOverlays(c)![0].click({});
    // x = 100 + ((20 + 210 + 5) * 2 - 10) ; y = 50 + ((10 + 30 + 5) * 2 - 20)
    expect(onClick).toHaveBeenLastCalledWith({ x: 560, y: 120 });
    addChevronOverlay(f.iframe, "bare", onClick);
    f.graph.getCellOverlays(bare)![0].click({});
    expect(onClick).toHaveBeenLastCalledWith({ x: 200, y: 150 });
    expect(addChevronOverlay(f.iframe, "missing", onClick)).toBe(false);
    expect(addChevronOverlay(NO_GRAPH, "c", onClick)).toBe(false);
  });

  it("refreshCardOverlays gives expanded parents the minus and everything else the chevron", () => {
    const parent = app("p", "id-p", "P", { expanded: "1" });
    const orphanParent = app("op", "id-op", "OP", { expanded: "1" });
    const child = cardCell("ch", { cardId: "id-ch", cardType: "Application", parentGroupCell: "p" });
    const pending = cardCell("pe", { cardId: "pending-1", cardType: "Application", pending: true });
    const plain = plainCell("pl", { label: "box" });
    const f = fakeIframe({ cells: [parent, orphanParent, child, pending, plain] });
    const onCollapse = vi.fn();
    const onChevron = vi.fn();

    refreshCardOverlays(f.iframe, onCollapse, onChevron);

    expect(f.graph.getCellOverlays(parent)![0].tooltip).toBe("Collapse");
    // Marked expanded but no children present: treated as collapsed.
    expect(f.graph.getCellOverlays(orphanParent)![0].tooltip).toBe("Expand related cards");
    expect(f.graph.getCellOverlays(child)![0].tooltip).toBe("Expand related cards");
    expect(f.graph.getCellOverlays(pending)).toBeNull();
    expect(f.graph.getCellOverlays(plain)).toBeNull();

    f.graph.getCellOverlays(parent)![0].click();
    expect(onCollapse).toHaveBeenCalledWith("p", "id-p");
    f.graph.getCellOverlays(child)![0].click({ clientX: 1, clientY: 2 });
    expect(onChevron).toHaveBeenCalledWith("ch", "id-ch", { x: 1, y: 2 });
    expect(() => refreshCardOverlays(NO_GRAPH, onCollapse, onChevron)).not.toThrow();
  });
});

/* ---------------------------------------------------------------------- */
/*  Expansion groups                                                       */
/* ---------------------------------------------------------------------- */

function groupFixture() {
  const parent = app("p", "id-p", "Parent", { expanded: "1", childCellIds: "c1,c2" });
  const c1 = cardCell("c1", { cardId: "id-c1", cardType: "ITComponent", name: "C1", parentGroupCell: "p" });
  const c2 = cardCell("c2", { cardId: "id-c2", cardType: "ITComponent", name: "C2", parentGroupCell: "p" });
  const g = cardCell("g", { cardId: "id-g", cardType: "Provider", name: "G", parentGroupCell: "c1" });
  const e1 = edgeCell("e1", parent, c1, { relationId: "r1", relationType: "relAppToITC", label: "uses" });
  const e1b = edgeCell("e1b", parent, c1, { relationId: "r1b", relationType: "relAppToITCOwns", label: "owns" });
  const e2 = edgeCell("e2", parent, c2, { relationId: "r2", relationType: "relAppToITC", label: "uses" });
  const eg = edgeCell("eg", c1, g, { relationId: "rg", relationType: "relProviderToITC" });
  const f = fakeIframe({ cells: [parent, c1, c2, g, e1, e1b, e2, eg] });
  return { f, parent, c1, c2, g, e1, e1b, e2, eg };
}

describe("expansion groups", () => {
  it("getGroupChildCardIds lists children still wired to the parent, getGroupChildRelationIds every surviving relation", () => {
    const { f, e2 } = groupFixture();
    expect(getGroupChildCardIds(f.iframe, "p")).toEqual(new Set(["id-c1", "id-c2"]));
    expect(getGroupChildRelationIds(f.iframe, "p")).toEqual(new Set(["r1", "r1b", "r2"]));
    f.graph.removeCells([e2]);
    expect(getGroupChildCardIds(f.iframe, "p")).toEqual(new Set(["id-c1"]));
    expect(getGroupChildRelationIds(f.iframe, "p")).toEqual(new Set(["r1", "r1b"]));
    expect(getGroupChildCardIds(f.iframe, "missing")).toEqual(new Set());
    expect(getGroupChildRelationIds(f.iframe, "missing")).toEqual(new Set());
    expect(getGroupChildCardIds(NO_GRAPH, "p")).toEqual(new Set());
    expect(getGroupChildRelationIds(NO_GRAPH, "p")).toEqual(new Set());
  });

  it("collapseCardGroup removes the whole subtree with its edges and resets the parent's markers", () => {
    const { f, parent } = groupFixture();
    const { removedCellIds } = collapseCardGroup(f.iframe, "p");
    expect(new Set(removedCellIds)).toEqual(new Set(["c1", "c2", "g", "e1", "e1b", "e2", "eg"]));
    for (const id of ["c1", "c2", "g", "e1", "e1b", "e2", "eg"]) expect(f.cells[id]).toBeUndefined();
    expect(f.cells.p).toBe(parent);
    expect(parent.value.getAttribute("expanded")).toBe("0");
    expect(parent.value.getAttribute("childCellIds")).toBeNull();
    expect(f.model.updateLevel).toBe(0);
  });

  it("collapseCardGroup is a no-op for a parent without children, a missing parent and no graph", () => {
    const f = fakeIframe({ cells: [app("lonely", "id-l", "L")] });
    expect(collapseCardGroup(f.iframe, "lonely")).toEqual({ removedCellIds: [] });
    expect(collapseCardGroup(f.iframe, "missing")).toEqual({ removedCellIds: [] });
    expect(collapseCardGroup(NO_GRAPH, "lonely")).toEqual({ removedCellIds: [] });
  });

  const child = (id: string, type = "ITComponent", extra: Partial<Parameters<typeof expandCardGroupAt>[2][number]> = {}) => ({
    id,
    name: id.toUpperCase(),
    type,
    color: "#d29270",
    relationType: "relAppToITC",
    relationLabel: "uses",
    relationId: `rel-${id}`,
    ...extra,
  });

  it("expandCardGroupAt stacks children to the right, grouped by type, and stamps the parent", () => {
    const parent = cardCell("p", { cardId: "id-p", cardType: "Application", geometry: { x: 100, y: 100, width: 210, height: 60 } });
    const f = fakeIframe({ cells: [parent] });
    const inserted = expandCardGroupAt(f.iframe, "p", [child("a"), child("b"), child("c", "Provider")], "right");

    expect(inserted).toHaveLength(3);
    expect(inserted.map((i) => i.cardId)).toEqual(["a", "b", "c"]);
    expect(inserted[0]).toMatchObject({ relationId: "rel-a", relationType: "relAppToITC", relationLabel: "uses" });
    const cells = inserted.map((i) => f.model.getCell(i.cellId)!);
    // x: parent right edge + gap; stacked downward, with the larger gap at the type boundary.
    expect(cells.every((c) => c.geometry!.x === 100 + 210 + 60)).toBe(true);
    const ys = cells.map((c) => c.geometry!.y);
    expect(ys[1] - ys[0]).toBe(40 + 10);
    expect(ys[2] - ys[1]).toBe(40 + 16);
    // Centred on the parent: total height 40*3 + 10 + 16 = 146.
    expect(ys[0]).toBe(100 + 30 - 146 / 2);
    for (const c of cells) {
      expect(c.value.getAttribute("parentGroupCell")).toBe("p");
      expect(c.geometry).toMatchObject({ width: 190, height: 40 });
    }
    expect(parent.value.getAttribute("expanded")).toBe("1");
    expect(parent.value.getAttribute("childCellIds")).toBe(inserted.map((i) => i.cellId).join(","));
    for (const i of inserted) {
      const edge = f.model.getCell(i.edgeCellId)!;
      expect(edge.source).toBe(parent);
      expect(edge.target).toBe(f.model.getCell(i.cellId));
      expect(edge.value.getAttribute("relationId")).toBe(i.relationId);
    }
  });

  it("expandCardGroupAt tiles below and above the parent, centred horizontally", () => {
    const below = fakeIframe({ cells: [cardCell("p", { cardId: "id-p", cardType: "Application", geometry: { x: 0, y: 0, width: 440, height: 60 } })] });
    const insertedBelow = expandCardGroupAt(below.iframe, "p", [child("a"), child("b"), child("c"), child("d")], "below");
    const cellsBelow = insertedBelow.map((i) => below.model.getCell(i.cellId)!);
    // 4 children → 2 columns (ceil(sqrt 4)), 2 rows; width 190*2 + 60 = 440 → starts at x 0.
    expect(cellsBelow.map((c) => [c.geometry!.x, c.geometry!.y])).toEqual([
      [0, 120],
      [250, 120],
      [0, 170],
      [250, 170],
    ]);

    const above = fakeIframe({ cells: [cardCell("p", { cardId: "id-p", cardType: "Application", geometry: { x: 0, y: 500, width: 440, height: 60 } })] });
    const insertedAbove = expandCardGroupAt(above.iframe, "p", [child("a")], "above", true);
    const cellAbove = above.model.getCell(insertedAbove[0].cellId)!;
    // One child: one column; total height 40; y = 500 - 60 - 40.
    expect(cellAbove.geometry).toMatchObject({ x: 220 - 95, y: 400 });
    expect(styleTokens(above.model.getCell(insertedAbove[0].edgeCellId)!.style).noLabel).toBe("1");
  });

  it("expandCardGroupAt restores a remembered layout instead of the computed slot", () => {
    const f = fakeIframe({ cells: [cardCell("p", { cardId: "id-p", cardType: "Application", geometry: { x: 0, y: 0, width: 210, height: 60 } })] });
    const [info] = expandCardGroupAt(
      f.iframe,
      "p",
      [child("a", "ITComponent", { layout: { x: 900, y: 900, width: 300, height: 80, style: "rounded=0;fillColor=#abcdef;", detail: [{ label: "Owner", value: "Bob" }] } })],
      "right",
    );
    const cell = f.model.getCell(info.cellId)!;
    expect(cell.geometry).toMatchObject({ x: 900, y: 900, width: 300, height: 80 });
    expect(cell.style).toBe("rounded=0;fillColor=#abcdef;");
    expect(cell.value.getAttribute("cardDetail")).toBe(JSON.stringify([{ label: "Owner", value: "Bob" }]));
  });

  it("expandCardGroupAt answers an empty list for a missing parent, a parent without geometry and no graph", () => {
    const f = fakeIframe({ cells: [cardCell("bare", { cardId: "x", cardType: "Application", geometry: null })] });
    expect(expandCardGroupAt(f.iframe, "missing", [child("a")], "right")).toEqual([]);
    expect(expandCardGroupAt(f.iframe, "bare", [child("a")], "right")).toEqual([]);
    expect(expandCardGroupAt(NO_GRAPH, "bare", [child("a")], "right")).toEqual([]);
  });
});

/* ---------------------------------------------------------------------- */
/*  Containers                                                             */
/* ---------------------------------------------------------------------- */

describe("container helpers", () => {
  function containerFixture() {
    const box = containerCell("box", { cardId: "id-box", cardType: "BusinessCapability", name: "Box" });
    const kid = cardCell("kid", { cardId: "id-kid", cardType: "BusinessCapability", name: "Kid", parent: box, attrs: { drillDownChild: "1" } });
    const plainKid = plainCell("pk", { label: "note", parent: box });
    box.children.push(kid, plainKid);
    const top = app("top", "id-top", "Top");
    const groupChild = cardCell("gc", { cardId: "id-top", cardType: "Application", parentGroupCell: "top" });
    const f = fakeIframe({ cells: [box, top, groupChild] });
    return { f, box, kid, top };
  }

  it("isContainerCell / isInsideContainer read the swimlane style of the cell or its parent", () => {
    const { f } = containerFixture();
    expect(isContainerCell(f.iframe, "box")).toBe(true);
    expect(isContainerCell(f.iframe, "top")).toBe(false);
    expect(isContainerCell(f.iframe, "missing")).toBe(false);
    expect(isContainerCell(NO_GRAPH, "box")).toBe(false);
    expect(isInsideContainer(f.iframe, "kid")).toBe(true);
    expect(isInsideContainer(f.iframe, "pk")).toBe(true);
    expect(isInsideContainer(f.iframe, "top")).toBe(false);
    expect(isInsideContainer(f.iframe, "box")).toBe(false);
    expect(isInsideContainer(f.iframe, "missing")).toBe(false);
    expect(isInsideContainer(NO_GRAPH, "kid")).toBe(false);
  });

  it("isInsideContainer is false under a parent that is not a swimlane or has no user object", () => {
    const plainParent = plainCell("pp", { label: "group", style: "group;" });
    const kid = app("k", "id-k", "K", {});
    kid.parent = plainParent;
    plainParent.children.push(kid);
    const f = fakeIframe({ cells: [plainParent] });
    expect(isInsideContainer(f.iframe, "k")).toBe(false);
  });

  it("getNestedCardIds lists the card children of a container", () => {
    const { f } = containerFixture();
    expect(getNestedCardIds(f.iframe, "box")).toEqual(new Set(["id-kid"]));
    expect(getNestedCardIds(f.iframe, "top")).toEqual(new Set());
    expect(getNestedCardIds(f.iframe, "missing")).toEqual(new Set());
    expect(getNestedCardIds(NO_GRAPH, "box")).toEqual(new Set());
  });

  it("findExistingCardCellId skips edges and expansion-group children", () => {
    const { f } = containerFixture();
    expect(findExistingCardCellId(f.iframe, "id-top")).toBe("top");
    expect(findExistingCardCellId(f.iframe, "id-kid")).toBe("kid");
    expect(findExistingCardCellId(f.iframe, "nope")).toBeNull();
    expect(findExistingCardCellId(NO_GRAPH, "id-top")).toBeNull();
  });
});

/* ---------------------------------------------------------------------- */
/*  Scans, edge restore and bulk removal                                   */
/* ---------------------------------------------------------------------- */

describe("scans", () => {
  function scanFixture() {
    const a = app("a", "id-a", "A");
    const b = app("b", "id-b", "B");
    const stub = plainCell("stub", { value: attrBag({ label: "stub" }) });
    const groupChild = cardCell("gc", { cardId: "id-b", cardType: "Application", parentGroupCell: "a" });
    const pending = cardCell("pe", { cardId: "pending-1", cardType: "Application", pending: true });
    const rel = edgeCell("rel", a, b, { relationId: "r1", relationType: "relAppToApp", label: "sends data to" });
    const bare = edgeCell("bare", a, b, { label: "hand drawn" });
    const typed = edgeCell("typed", a, b, { relationType: "relAppToApp" });
    const f = fakeIframe({ cells: [a, b, stub, groupChild, pending, rel, bare, typed] });
    return { f, a, b, rel, bare, stub };
  }

  it("scanForDuplicateCells routes every unregistered top-level card cell through onDuplicate", () => {
    const { f } = scanFixture();
    const onDuplicate = vi.fn();
    scanForDuplicateCells(f.iframe, (id) => id === "a", onDuplicate);
    expect(onDuplicate.mock.calls).toEqual([
      ["b", "id-b", false],
      ["pe", "pending-1", true],
    ]);
    expect(() => scanForDuplicateCells(NO_GRAPH, () => false, onDuplicate)).not.toThrow();
  });

  it("collectExistingCardCellIds / collectExistingEdgeRelations seed the editor's registers", () => {
    const { f } = scanFixture();
    expect(collectExistingCardCellIds(f.iframe)).toEqual(["a", "b", "pe"]);
    expect(collectExistingEdgeRelations(f.iframe)).toEqual([
      { edgeCellId: "rel", relationId: "r1", relationType: "relAppToApp", relationLabel: "sends data to" },
    ]);
    expect(collectExistingCardCellIds(NO_GRAPH)).toEqual([]);
    expect(collectExistingEdgeRelations(NO_GRAPH)).toEqual([]);
  });

  it("collectLiveCellIds / collectLiveEdgeCellIds snapshot the model", () => {
    const { f } = scanFixture();
    expect(collectLiveEdgeCellIds(f.iframe)).toEqual(new Set(["rel", "bare", "typed"]));
    expect(collectLiveCellIds(f.iframe)).toEqual(new Set(["0", "1", "a", "b", "stub", "gc", "pe", "rel", "bare", "typed"]));
    expect(collectLiveEdgeCellIds(NO_GRAPH)).toEqual(new Set());
    expect(collectLiveCellIds(NO_GRAPH)).toEqual(new Set());
  });

  it("describeEdgeEndpoints reads the names off the cards and the verb off the edge", () => {
    const { f } = scanFixture();
    expect(describeEdgeEndpoints(f.iframe, "rel")).toEqual({
      sourceName: "A",
      targetName: "B",
      sourceCellId: "a",
      targetCellId: "b",
      style: "edgeStyle=orthogonalEdgeStyle;rounded=0;html=1;",
      label: "sends data to",
    });
    expect(describeEdgeEndpoints(f.iframe, "bare").label).toBe("hand drawn");
    const empty = { sourceName: "", targetName: "", sourceCellId: null, targetCellId: null, style: "", label: "" };
    expect(describeEdgeEndpoints(f.iframe, "missing")).toEqual(empty);
    expect(describeEdgeEndpoints(NO_GRAPH, "rel")).toEqual(empty);
  });

  it("describeEdgeEndpoints tolerates a detached edge and a valueless one", () => {
    const e = edgeCell("e", null, null);
    e.value = null;
    const f = fakeIframe({ cells: [e] });
    expect(describeEdgeEndpoints(f.iframe, "e")).toEqual({
      sourceName: "",
      targetName: "",
      sourceCellId: null,
      targetCellId: null,
      style: "edgeStyle=orthogonalEdgeStyle;rounded=0;html=1;",
      label: "",
    });
  });

  it("removeEdgeCellsByIds drops only edges, falling back to the model when the graph refuses", () => {
    const { f, rel, bare } = scanFixture();
    removeEdgeCellsByIds(f.iframe, []);
    removeEdgeCellsByIds(f.iframe, ["a", "missing"]);
    expect(f.cells.a).toBeDefined();
    vi.spyOn(f.graph, "removeCells").mockImplementation(() => {
      throw new Error("intercepted");
    });
    removeEdgeCellsByIds(f.iframe, ["rel", "bare", "a"]);
    expect(f.cells.rel).toBeUndefined();
    expect(f.cells.bare).toBeUndefined();
    expect(f.cells.a).toBeDefined();
    expect(f.model.updateLevel).toBe(0);
    expect(() => removeEdgeCellsByIds(NO_GRAPH, ["rel"])).not.toThrow();
    expect([rel, bare].every((e) => !f.model.getCell(e.id))).toBe(true);
  });

  it("restoreRemovedEdge re-inserts the edge with its captured label, ids and style", () => {
    const { f, a, b } = scanFixture();
    const tombstone: RemovedRelationTombstone = {
      kind: "relation",
      edgeCellId: "restored",
      relationId: "r9",
      relationType: "relAppToApp",
      relationLabel: "sends data to",
      sourceName: "A",
      targetName: "B",
      sourceCellId: "a",
      targetCellId: "b",
      style: "edgeStyle=entityRelationEdgeStyle;strokeColor=#666;",
      edgeLabel: "",
    };
    expect(restoreRemovedEdge(f.iframe, tombstone)).toBe(true);
    const edge = f.model.getCell("restored")!;
    expect(edge.source).toBe(a);
    expect(edge.target).toBe(b);
    expect(edge.style).toBe(tombstone.style);
    expect(edge.value.getAttribute("label")).toBe("");
    expect(edge.value.getAttribute("relationId")).toBe("r9");
    expect(edge.value.getAttribute("relationType")).toBe("relAppToApp");
    expect(f.model.updateLevel).toBe(0);
  });

  it("restoreRemovedEdge falls back to the default relation style and refuses when an endpoint is gone", () => {
    const { f } = scanFixture();
    const base: RemovedRelationTombstone = {
      kind: "relation",
      edgeCellId: "r2",
      relationId: "r2",
      relationType: "",
      relationLabel: "",
      sourceName: "A",
      targetName: "B",
      sourceCellId: "a",
      targetCellId: "b",
      style: "",
    };
    expect(restoreRemovedEdge(f.iframe, base)).toBe(true);
    const edge = f.model.getCell("r2")!;
    expect(edge.style).toContain("edgeStyle=");
    expect(edge.value.getAttribute("relationType")).toBeNull();
    expect(restoreRemovedEdge(f.iframe, { ...base, edgeCellId: "r3", targetCellId: "gone" })).toBe(false);
    expect(restoreRemovedEdge(f.iframe, { ...base, edgeCellId: "r4", sourceCellId: null })).toBe(false);
    expect(restoreRemovedEdge(NO_GRAPH, base)).toBe(false);
  });
});

/* ---------------------------------------------------------------------- */
/*  attachCellLifecycleListeners                                           */
/* ---------------------------------------------------------------------- */

describe("attachCellLifecycleListeners", () => {
  function lifecycle(f: FakeIframe, registered: string[] = [], extra: Record<string, any> = {}) {
    const handlers = {
      onDuplicate: vi.fn(),
      onRemoved: vi.fn(),
      onIncidentalEdgeRemoval: vi.fn(),
      isRegistered: (id: string) => registered.includes(id),
      ...extra,
    };
    const cleanup = attachCellLifecycleListeners(f.iframe, handlers);
    return { handlers, cleanup };
  }

  function relationFixture() {
    const a = app("a", "id-a", "A");
    const b = app("b", "id-b", "B");
    const rel = edgeCell("rel", a, b, { relationId: "r1", relationType: "relAppToApp", label: "sends data to", style: "edgeStyle=entityRelationEdgeStyle;" });
    const f = fakeIframe({ cells: [a, b, rel] });
    return { f, a, b, rel };
  }

  beforeEach(() => {
    vi.spyOn(console, "debug").mockImplementation(() => {});
  });

  it("returns a no-op cleanup without a graph", () => {
    const cleanup = attachCellLifecycleListeners(NO_GRAPH, { onDuplicate: vi.fn(), onRemoved: vi.fn(), isRegistered: () => true });
    expect(() => cleanup()).not.toThrow();
  });

  it("routes an unregistered card cell added to the canvas through onDuplicate, and nothing else", () => {
    const f = fakeIframe();
    const { handlers } = lifecycle(f, ["known"]);
    f.graph.insertVertex(f.defaultParent, "known", attrBag({ cardId: "id-k" }), 0, 0, 10, 10);
    f.graph.insertVertex(f.defaultParent, "pasted", attrBag({ cardId: "id-k", pending: "1" }), 0, 0, 10, 10);
    f.graph.insertVertex(f.defaultParent, "child", attrBag({ cardId: "id-c", parentGroupCell: "known" }), 0, 0, 10, 10);
    f.graph.insertVertex(f.defaultParent, "drilled", attrBag({ cardId: "id-d", drillDownChild: "1" }), 0, 0, 10, 10);
    f.graph.insertVertex(f.defaultParent, "plain", "box", 0, 0, 10, 10);
    f.graph.insertVertex(f.defaultParent, "stub", attrBag({ label: "stub" }), 0, 0, 10, 10);
    f.graph.insertEdge(f.defaultParent, "edge", attrBag({ cardId: "id-k" }), f.cells.known, f.cells.pasted);
    f.fire.model("CELLS_ADDED", { cells: [] });
    expect(handlers.onDuplicate.mock.calls).toEqual([["pasted", "id-k", true]]);
    expect(handlers.onRemoved).not.toHaveBeenCalled();
  });

  it("files one tombstone when a relation edge is removed on its own", () => {
    const { f, rel } = relationFixture();
    const { handlers } = lifecycle(f, ["a", "b"]);
    f.graph.removeCells([rel]);
    expect(handlers.onRemoved).toHaveBeenCalledTimes(1);
    const [tombstones] = handlers.onRemoved.mock.calls[0];
    expect(tombstones).toEqual([
      {
        kind: "relation",
        edgeCellId: "rel",
        relationId: "r1",
        relationType: "relAppToApp",
        relationLabel: "sends data to",
        sourceName: "A",
        targetName: "B",
        sourceCellId: "a",
        targetCellId: "b",
        style: "edgeStyle=entityRelationEdgeStyle;",
        edgeLabel: "sends data to",
      },
    ]);
    expect(handlers.onIncidentalEdgeRemoval).not.toHaveBeenCalled();
  });

  it("resolves relation metadata from the editor's side-table when the edge carries none", () => {
    const a = app("a", "id-a", "A");
    const b = app("b", "id-b", "B");
    const bare = edgeCell("bare", a, b, { label: "", style: "" });
    const f = fakeIframe({ cells: [a, b, bare] });
    const meta = {
      relationId: "r-side",
      relationType: "relAppToApp",
      relationLabel: "sends data to",
      sourceName: "Side A",
      targetName: "Side B",
      edgeLabel: "",
      sourceCellId: "a",
      targetCellId: "b",
      style: "edgeStyle=entityRelationEdgeStyle;",
    };
    const { handlers } = lifecycle(f, ["a", "b"], { getRelationIdForEdge: (id: string) => (id === "bare" ? meta : null) });
    f.graph.removeCells([bare]);
    expect(handlers.onRemoved).toHaveBeenCalledTimes(1);
    expect(handlers.onRemoved.mock.calls[0][0][0]).toMatchObject({
      edgeCellId: "bare",
      relationId: "r-side",
      sourceName: "Side A",
      targetName: "Side B",
      style: meta.style,
      sourceCellId: "a",
      targetCellId: "b",
    });
  });

  it("ignores edges with no relation anywhere", () => {
    const a = app("a", "id-a", "A");
    const b = app("b", "id-b", "B");
    const hand = edgeCell("hand", a, b, { label: "arrow" });
    const f = fakeIframe({ cells: [a, b, hand] });
    const { handlers } = lifecycle(f, ["a", "b"], { getRelationIdForEdge: () => null });
    f.graph.removeCells([hand]);
    expect(handlers.onRemoved).not.toHaveBeenCalled();
  });

  it("treats an edge removed together with its endpoint as incidental, with no tombstone", () => {
    const { f, a } = relationFixture();
    const { handlers } = lifecycle(f, ["a", "b"]);
    f.graph.removeCells([a]);
    expect(handlers.onRemoved).not.toHaveBeenCalled();
    expect(handlers.onIncidentalEdgeRemoval).toHaveBeenCalledWith("rel");
  });

  it("treats an edge whose endpoint already left the model as incidental", () => {
    const { f, a, rel } = relationFixture();
    const { handlers } = lifecycle(f, ["a", "b"]);
    // The vertex vanished in an earlier transaction nobody reported.
    delete f.model.cells.a;
    rel.source = a;
    f.fire.graph("CELLS_REMOVED", { cells: [rel] });
    expect(handlers.onRemoved).not.toHaveBeenCalled();
    expect(handlers.onIncidentalEdgeRemoval).toHaveBeenCalledWith("rel");
  });

  it("cascades the edges DrawIO left dangling after a vertex-only removal, silently", () => {
    vi.useFakeTimers();
    const { f, a, rel } = relationFixture();
    const { handlers } = lifecycle(f, ["a", "b"]);
    // DrawIO reported the vertex alone and left the edge in the model.
    f.model.remove(a);
    rel.source = a;
    handlers.onRemoved.mockClear();
    handlers.onIncidentalEdgeRemoval.mockClear();
    f.fire.graph("CELLS_REMOVED", { cells: [a] });
    expect(handlers.onIncidentalEdgeRemoval).toHaveBeenCalledWith("rel");
    expect(f.cells.rel).toBeDefined();
    vi.runAllTimers();
    expect(f.cells.rel).toBeUndefined();
    expect(handlers.onRemoved).not.toHaveBeenCalled();
    expect(f.model.updateLevel).toBe(0);
  });

  it("falls back to model.remove when the graph refuses the cascade, and skips edges already gone", () => {
    vi.useFakeTimers();
    const a = app("a", "id-a", "A");
    const b = app("b", "id-b", "B");
    const c = app("c", "id-c", "C");
    const e1 = edgeCell("e1", a, b, { relationId: "r1" });
    const e2 = edgeCell("e2", a, c, { relationId: "r2" });
    const f = fakeIframe({ cells: [a, b, c, e1, e2] });
    const { handlers } = lifecycle(f, ["a", "b", "c"]);
    vi.spyOn(f.graph, "removeCells").mockImplementation(() => {
      throw new Error("intercepted");
    });
    f.fire.graph("CELLS_REMOVED", { cells: [a] });
    expect(handlers.onIncidentalEdgeRemoval.mock.calls.map((c) => c[0]).sort()).toEqual(["e1", "e2"]);
    // The user removed one of them by hand before the cascade ran.
    f.model.remove(e2);
    vi.runAllTimers();
    expect(f.cells.e1).toBeUndefined();
    expect(f.cells.e2).toBeUndefined();
    expect(f.model.updateLevel).toBe(0);
  });

  it("does nothing on the cascade tick when every dangling edge is already gone", () => {
    vi.useFakeTimers();
    const { f, a, rel } = relationFixture();
    lifecycle(f, ["a", "b"]);
    f.fire.graph("CELLS_REMOVED", { cells: [a] });
    f.model.remove(rel);
    expect(() => vi.runAllTimers()).not.toThrow();
  });

  it("synthesises a removal from the CHANGE diff when DrawIO fires no CELLS_REMOVED at all", () => {
    vi.useFakeTimers();
    const { f, a, rel } = relationFixture();
    const { handlers } = lifecycle(f, ["a", "b"]);
    // A plain CHANGE with nothing missing only refreshes the known sets.
    f.graph.insertVertex(f.defaultParent, "late", attrBag({ cardId: "late" }), 0, 0, 1, 1);
    f.fire.change();
    handlers.onDuplicate.mockClear();
    // Now the vertex disappears through a path that only produces a CHANGE.
    delete f.model.cells.a;
    f.fire.change();
    expect(handlers.onIncidentalEdgeRemoval).toHaveBeenCalledWith("rel");
    expect(handlers.onRemoved).not.toHaveBeenCalled();
    vi.runAllTimers();
    expect(f.model.getCell("rel")).toBeNull();
    // Gone edges are reported too — a relation edge that vanished alone is a tombstone.
    const b2 = app("b2", "id-b2", "B2");
    f.model.add(f.defaultParent, b2);
    const rel2 = edgeCell("rel2", f.cells.b, b2, { relationId: "r2", relationType: "relAppToApp", label: "x" });
    f.model.add(f.defaultParent, rel2);
    f.fire.change();
    delete f.model.cells.rel2;
    f.fire.change();
    expect(handlers.onRemoved).toHaveBeenCalledTimes(1);
    expect(handlers.onRemoved.mock.calls[0][0][0]).toMatchObject({ edgeCellId: "rel2", relationId: "r2" });
    expect(rel.id).toBe("rel");
  });

  it("the cleanup detaches every listener from the model and the graph", () => {
    const { f, rel } = relationFixture();
    const { handlers, cleanup } = lifecycle(f, ["a", "b"]);
    expect(f.model.listenerCount()).toBe(3);
    expect(f.graph.listenerCount(MX_EVENT.CELLS_REMOVED)).toBe(1);
    cleanup();
    expect(f.model.listenerCount()).toBe(0);
    expect(f.graph.listenerCount()).toBe(0);
    f.graph.insertVertex(f.defaultParent, "pasted", attrBag({ cardId: "id-x" }), 0, 0, 1, 1);
    f.graph.removeCells([rel]);
    expect(handlers.onDuplicate).not.toHaveBeenCalled();
    expect(handlers.onRemoved).not.toHaveBeenCalled();
  });

  it("survives a graph that refuses graph-level listeners", () => {
    const { f, rel } = relationFixture();
    f.graph.addListener = (() => {
      throw new Error("no graph listeners");
    }) as any;
    f.graph.removeListener = (() => {
      throw new Error("no graph listeners");
    }) as any;
    const { handlers, cleanup } = lifecycle(f, ["a", "b"]);
    f.fire.model("CELLS_REMOVED", { cells: [rel] });
    expect(handlers.onRemoved).toHaveBeenCalledTimes(1);
    expect(() => cleanup()).not.toThrow();
  });
});

/* ---------------------------------------------------------------------- */
/*  attachParentChangeListener / revertParentChange                        */
/* ---------------------------------------------------------------------- */

describe("attachParentChangeListener", () => {
  function hierarchyFixture() {
    const box = containerCell("box", { cardId: "id-box", cardType: "BusinessCapability", name: "Box", geometry: { x: 100, y: 100, width: 400, height: 300 } });
    const card = cardCell("card", { cardId: "id-card", cardType: "BusinessCapability", name: "Card", geometry: { x: 10, y: 20, width: 210, height: 60 } });
    const groupChild = cardCell("gc", { cardId: "id-gc", cardType: "Application", parentGroupCell: "box" });
    const f = fakeIframe({ cells: [box, card, groupChild] });
    const events: ParentChangeEvent[] = [];
    const cleanup = attachParentChangeListener(f.iframe, (ev) => events.push(ev));
    return { f, box, card, groupChild, events, cleanup };
  }

  it("returns a no-op cleanup without a graph", () => {
    expect(() => attachParentChangeListener(NO_GRAPH, vi.fn())()).not.toThrow();
  });

  it("reports a move into a container with the geometry the cell had before", () => {
    const { f, box, card, events } = hierarchyFixture();
    f.fire.change();
    expect(events).toEqual([]);
    f.model.add(box, card);
    expect(events).toEqual([
      {
        cellId: "card",
        cardId: "id-card",
        cardName: "Card",
        cardType: "BusinessCapability",
        newParentCellId: "box",
        newParentCardId: "id-box",
        newParentName: "Box",
        newParentType: "BusinessCapability",
        oldParentCellId: null,
        oldParentCardId: null,
        oldParentName: "",
        oldParentType: "",
        oldGeometry: { x: 10, y: 20, width: 210, height: 60 },
      },
    ]);
    // Moving back reports the container as the old parent and the canvas as the new one.
    f.model.add(f.defaultParent, card);
    expect(events).toHaveLength(2);
    expect(events[1]).toMatchObject({ newParentCellId: null, newParentCardId: null, oldParentCellId: "box", oldParentCardId: "id-box", oldParentName: "Box" });
  });

  it("stays silent for expansion-group children and for a cell's first sighting, and tracks geometry between moves", () => {
    const { f, box, card, groupChild, events } = hierarchyFixture();
    f.model.add(box, groupChild);
    expect(events).toEqual([]);
    // A card inserted after attach is recorded on first sight, not reported.
    const late = app("late", "id-late", "Late");
    f.model.add(box, late);
    expect(events).toEqual([]);
    f.model.add(f.defaultParent, late);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ cellId: "late", oldParentCellId: "box", newParentCellId: null });
    // A geometry change without a parent change updates the snapshot the next event carries.
    f.model.setGeometry(card, new f.win.mxGeometry(50, 60, 210, 60));
    f.model.add(box, card);
    expect(events[1].oldGeometry).toEqual({ x: 50, y: 60, width: 210, height: 60 });
  });

  it("re-runs the diff on MOVE_CELLS", () => {
    const { f, box, card, events } = hierarchyFixture();
    f.model.beginUpdate();
    f.model.add(box, card);
    f.model.endUpdate();
    expect(events).toHaveLength(1);
    card.parent = f.defaultParent;
    f.fire.graph("MOVE_CELLS", { cells: [card] });
    expect(events).toHaveLength(2);
    expect(events[1]).toMatchObject({ newParentCellId: null, oldParentCellId: "box" });
  });

  it("force-detaches a card dragged out of its container on mouseup, converting its geometry to canvas coordinates", () => {
    vi.useFakeTimers();
    const { f, box, card, events } = hierarchyFixture();
    card.value.setAttribute("drillDownChild", "1");
    f.model.add(box, card);
    expect(events).toHaveLength(1);
    // Dropped well outside the 400x300 box.
    f.model.setGeometry(card, new f.win.mxGeometry(450, 20, 210, 60));
    f.fire.mouseup();
    expect(events).toHaveLength(1);
    vi.runAllTimers();
    expect(card.parent).toBe(f.defaultParent);
    expect(card.geometry).toMatchObject({ x: 550, y: 120, width: 210, height: 60 });
    expect(card.value.getAttribute("drillDownChild")).toBeNull();
    expect(events).toHaveLength(2);
    expect(events[1]).toMatchObject({ cellId: "card", oldParentCellId: "box", newParentCellId: null });
    expect(f.model.updateLevel).toBe(0);
  });

  it("leaves a child inside its bounds, under a collapsed container, or in an expansion group where it is", () => {
    vi.useFakeTimers();
    const { f, box, card, groupChild, events } = hierarchyFixture();
    f.model.add(box, card);
    f.model.add(box, groupChild);
    groupChild.geometry = new f.win.mxGeometry(900, 900, 10, 10);
    f.fire.mouseup();
    vi.runAllTimers();
    expect(card.parent).toBe(box);
    expect(groupChild.parent).toBe(box);
    // Escaped, but the container is folded: its bounds are the header's, not the layout's.
    f.model.setGeometry(card, new f.win.mxGeometry(450, 20, 210, 60));
    box.collapsed = true;
    f.fire.mouseup();
    vi.runAllTimers();
    expect(card.parent).toBe(box);
    expect(events).toHaveLength(1);
  });

  it("skips cells with no geometry and parents that are layers on mouseup", () => {
    vi.useFakeTimers();
    const box = containerCell("box", { cardId: "id-box", cardType: "BusinessCapability", geometry: null });
    const card = cardCell("card", { cardId: "id-card", cardType: "BusinessCapability", geometry: { x: 900, y: 900, width: 10, height: 10 }, parent: box });
    box.children.push(card);
    const f = fakeIframe({ cells: [box] });
    const events: ParentChangeEvent[] = [];
    attachParentChangeListener(f.iframe, (ev) => events.push(ev));
    f.fire.mouseup();
    vi.runAllTimers();
    expect(card.parent).toBe(box);
    expect(events).toEqual([]);
  });

  it("the cleanup detaches the model, graph and container listeners", () => {
    const { f, box, card, events, cleanup } = hierarchyFixture();
    expect(f.graph.container.listeners.some((l) => l.name === "mouseup")).toBe(true);
    cleanup();
    expect(f.model.listenerCount()).toBe(0);
    expect(f.graph.listenerCount()).toBe(0);
    expect(f.graph.container.listeners).toEqual([]);
    f.model.add(box, card);
    expect(events).toEqual([]);
  });

  it("a mouseup check still pending at cleanup does not report after it", () => {
    vi.useFakeTimers();
    const { f, box, card, events, cleanup } = hierarchyFixture();
    f.model.add(box, card);
    f.model.setGeometry(card, new f.win.mxGeometry(450, 20, 210, 60));
    f.fire.mouseup();
    cleanup();
    vi.runAllTimers();
    expect(events).toHaveLength(1);
    expect(card.parent).toBe(box);
  });

  it("tolerates a container that refuses listeners", () => {
    const f = fakeIframe({ cells: [app("a", "id-a", "A")] });
    (f.graph as any).container = undefined;
    f.graph.addListener = (() => {
      throw new Error("no");
    }) as any;
    f.model.removeListener = (() => {
      throw new Error("no");
    }) as any;
    const cleanup = attachParentChangeListener(f.iframe, vi.fn());
    expect(() => cleanup()).not.toThrow();
  });
});

describe("revertParentChange", () => {
  it("puts the cell back under its old parent at its old geometry", () => {
    const box = containerCell("box", { cardId: "id-box", cardType: "BusinessCapability" });
    const card = cardCell("card", { cardId: "id-card", cardType: "BusinessCapability", geometry: { x: 0, y: 0, width: 210, height: 60 } });
    const f = fakeIframe({ cells: [box, card] });
    expect(revertParentChange(f.iframe, "card", "box", { x: 12, y: 34, width: 180, height: 50 })).toBe(true);
    expect(card.parent).toBe(box);
    expect(card.geometry).toMatchObject({ x: 12, y: 34, width: 180, height: 50 });
    expect(f.graph.refreshed).toEqual([card]);
    expect(f.model.updateLevel).toBe(0);
  });

  it("falls back to the default parent when the old parent is null or gone, keeping the geometry when none is given", () => {
    const box = containerCell("box", { cardId: "id-box", cardType: "BusinessCapability" });
    const card = cardCell("card", { cardId: "id-card", cardType: "BusinessCapability", parent: box, geometry: { x: 5, y: 6, width: 210, height: 60 } });
    box.children.push(card);
    const f = fakeIframe({ cells: [box] });
    expect(revertParentChange(f.iframe, "card", null)).toBe(true);
    expect(card.parent).toBe(f.defaultParent);
    expect(card.geometry).toMatchObject({ x: 5, y: 6 });
    f.model.add(box, card);
    expect(revertParentChange(f.iframe, "card", "vanished")).toBe(true);
    expect(card.parent).toBe(f.defaultParent);
    expect(revertParentChange(f.iframe, "missing", null)).toBe(false);
    expect(revertParentChange(NO_GRAPH, "card", null)).toBe(false);
  });
});

/* ---------------------------------------------------------------------- */
/*  Resize and label-edit listeners                                        */
/* ---------------------------------------------------------------------- */

describe("attachCardResizeListener", () => {
  it("debounces a burst of resizes into one callback after the delay", () => {
    vi.useFakeTimers();
    const c = app("c", "id-1", "A");
    const f = fakeIframe({ cells: [c] });
    const onResized = vi.fn();
    const cleanup = attachCardResizeListener(f.iframe, onResized);
    f.graph.resizeCell(c, new f.win.mxRectangle(0, 0, 220, 60));
    vi.advanceTimersByTime(200);
    f.graph.resizeCell(c, new f.win.mxRectangle(0, 0, 230, 60));
    vi.advanceTimersByTime(299);
    expect(onResized).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onResized).toHaveBeenCalledTimes(1);
    cleanup();
    expect(f.graph.listenerCount()).toBe(0);
  });

  it("cleanup cancels a pending callback and tolerates a torn-down graph", () => {
    vi.useFakeTimers();
    const c = app("c", "id-1", "A");
    const f = fakeIframe({ cells: [c] });
    const onResized = vi.fn();
    const cleanup = attachCardResizeListener(f.iframe, onResized, 50);
    f.graph.resizeCell(c, new f.win.mxRectangle(0, 0, 220, 60));
    f.graph.removeListener = (() => {
      throw new Error("gone");
    }) as any;
    expect(() => cleanup()).not.toThrow();
    vi.runAllTimers();
    expect(onResized).not.toHaveBeenCalled();
    expect(() => attachCardResizeListener(NO_GRAPH, onResized)()).not.toThrow();
  });
});

describe("attachCardLabelEditListener", () => {
  it("re-syncs the plain name after a hand-typed label edit and reports it", () => {
    const rows = [{ label: "Owner", value: "Alice" }];
    const c = app("c", "id-1", "Old", { cardDetail: JSON.stringify(rows), label: composeCardLabel("Old", rows) });
    const plain = plainCell("p", { label: "box" });
    const f = fakeIframe({ cells: [c, plain] });
    const onRenamed = vi.fn();
    const cleanup = attachCardLabelEditListener(f.iframe, onRenamed);

    c.value.setAttribute("label", `<b>Hand Typed</b><div style="font-size:9px">Owner: Alice</div>`);
    f.fire.labelChanged(c);
    expect(onRenamed).toHaveBeenCalledWith("c", "Hand Typed");
    expect(c.value.getAttribute("cardName")).toBe("Hand Typed");
    expect(c.value.getAttribute("label")).toBe(composeCardLabel("Hand Typed", rows));

    f.fire.labelChanged(plain);
    f.fire.graph("LABEL_CHANGED", { cell: null });
    f.fire.graph("LABEL_CHANGED", {});
    expect(onRenamed).toHaveBeenCalledTimes(1);

    cleanup();
    c.value.setAttribute("label", "Again");
    f.fire.labelChanged(c);
    expect(onRenamed).toHaveBeenCalledTimes(1);
  });

  it("works without a callback and tolerates a torn-down graph", () => {
    const c = app("c", "id-1", "Old");
    const f = fakeIframe({ cells: [c] });
    const cleanup = attachCardLabelEditListener(f.iframe);
    c.value.setAttribute("label", "Typed");
    expect(() => f.fire.labelChanged(c)).not.toThrow();
    expect(c.value.getAttribute("cardName")).toBe("Typed");
    f.graph.removeListener = (() => {
      throw new Error("gone");
    }) as any;
    expect(() => cleanup()).not.toThrow();
    expect(() => attachCardLabelEditListener(NO_GRAPH)()).not.toThrow();
  });
});

// Type-level check that the fake cell satisfies what the helpers expect.
const _typeCheck: FakeCell = cardCell("t", { cardId: "x", cardType: "y" });
void _typeCheck;
