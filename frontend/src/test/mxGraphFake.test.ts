import { describe, expect, it, vi } from "vitest";

import {
  FakeCellOverlay,
  FakeGeometry,
  FakeImage,
  FakePoint,
  MX_EVENT,
  attrBag,
  cardCell,
  containerCell,
  edgeCell,
  fakeIframe,
  plainCell,
  styleTokens,
} from "./mxGraphFake";

describe("fakeIframe", () => {
  it("places cells under the default parent and registers a subtree once", () => {
    const box = containerCell("box", { cardId: "b", cardType: "Application", label: "Box" });
    const kid = cardCell("kid", { cardId: "k", cardType: "Application", label: "Kid", parent: box });
    box.children.push(kid);
    const f = fakeIframe({ cells: [box, plainCell("p")] });

    expect(f.root.id).toBe("0");
    expect(f.defaultParent.id).toBe("1");
    expect(f.model.getCell("box")?.parent).toBe(f.defaultParent);
    expect(f.model.getCell("kid")?.parent).toBe(box);
    expect(f.model.getChildCount(box)).toBe(1);
    expect(f.model.getCell("p")?.parent).toBe(f.defaultParent);
    expect(Object.keys(f.cells).sort()).toEqual(["0", "1", "box", "kid", "p"]);
    expect(f.graph.getDefaultParent()).toBe(f.defaultParent);
    expect(f.win.__turboGraph).toBe(f.graph);
    expect((f.iframe.contentWindow as unknown as { __turboGraph: unknown }).__turboGraph).toBe(f.graph);
  });

  it("builds card and edge user objects as real XML elements", () => {
    const a = cardCell("a", { cardId: "id-a", cardType: "Application", name: "A", pending: true, parentGroupCell: "g" });
    const b = plainCell("b", { label: "Just a box" });
    const e = edgeCell("e", a, b, { relationId: "r1", relationType: "relAppToITC", label: "uses", flowDirection: "forward" });

    expect(a.value.getAttribute("cardId")).toBe("id-a");
    expect(a.value.getAttribute("cardName")).toBe("A");
    expect(a.value.getAttribute("label")).toBe("A");
    expect(a.value.getAttribute("pending")).toBe("1");
    expect(a.value.getAttribute("parentGroupCell")).toBe("g");
    expect(a.value.getAttribute("missing")).toBeNull();
    expect(a.getAttribute("cardType")).toBe("Application");
    expect(b.value).toBe("Just a box");
    expect(e.edge).toBe(true);
    expect(e.source).toBe(a);
    expect(e.target).toBe(b);
    expect(a.edges).toEqual([e]);
    expect(b.edges).toEqual([e]);
    expect(e.value.getAttribute("relationType")).toBe("relAppToITC");
    expect(e.value.getAttribute("flowDirection")).toBe("forward");
    expect(edgeCell("plain", a, b).value).toBe("");
    expect(attrBag({ x: "1" }).getAttribute("x")).toBe("1");
  });

  it("aliases _style and _geo onto style and geometry", () => {
    const c = cardCell("c", { cardId: "x", cardType: "Application", style: "a=1;", geometry: { width: 10, height: 5 } });
    expect(c._style).toBe("a=1;");
    c._style = "b=2;";
    expect(c.style).toBe("b=2;");
    expect(c._geo?.width).toBe(10);
    c._geo = new FakeGeometry(1, 2, 3, 4);
    expect(c.geometry?.height).toBe(4);
    expect(c.getGeometry()).toBe(c.geometry);
  });
});

describe("transactions and events", () => {
  it("fires CHANGE once on the outermost endUpdate", () => {
    const f = fakeIframe();
    const change = vi.fn();
    f.model.addListener(MX_EVENT.CHANGE, change);
    f.model.beginUpdate();
    f.model.beginUpdate();
    f.model.setStyle(plainCell("x"), "s");
    f.model.endUpdate();
    expect(change).not.toHaveBeenCalled();
    f.model.endUpdate();
    expect(change).toHaveBeenCalledTimes(1);
    f.model.endUpdate(); // unbalanced extra call is harmless
    expect(change).toHaveBeenCalledTimes(1);
  });

  it("fires CHANGE immediately for a write outside any transaction, and nothing without a write", () => {
    const f = fakeIframe();
    const change = vi.fn();
    f.model.addListener(MX_EVENT.CHANGE, change);
    f.model.beginUpdate();
    f.model.endUpdate();
    expect(change).not.toHaveBeenCalled();
    f.model.setValue(plainCell("x"), "v");
    expect(change).toHaveBeenCalledTimes(1);
  });

  it("insertVertex fires CELLS_ADDED on the graph and the model, inside one CHANGE", () => {
    const f = fakeIframe();
    const onGraph = vi.fn();
    const onModel = vi.fn();
    const change = vi.fn();
    f.graph.addListener(MX_EVENT.CELLS_ADDED, onGraph);
    f.model.addListener(MX_EVENT.CELLS_ADDED, onModel);
    f.model.addListener(MX_EVENT.CHANGE, change);

    const cell = f.graph.insertVertex(f.defaultParent, "v1", attrBag({ cardId: "a" }), 10, 20, 30, 40, "fillColor=#fff;");

    expect(f.cells.v1).toBe(cell);
    expect(cell.parent).toBe(f.defaultParent);
    expect(cell.geometry).toMatchObject({ x: 10, y: 20, width: 30, height: 40 });
    expect(cell.style).toBe("fillColor=#fff;");
    expect(onGraph).toHaveBeenCalledTimes(1);
    expect(onModel).toHaveBeenCalledTimes(1);
    expect(onGraph.mock.calls[0][1].getProperty("cells")).toEqual([cell]);
    expect(onModel.mock.calls[0][1].getProperty("nope")).toBeNull();
    expect(change).toHaveBeenCalledTimes(1);
  });

  it("insertEdge wires both terminals and gives the edge a relative geometry", () => {
    const f = fakeIframe({ cells: [plainCell("a"), plainCell("b")] });
    const e = f.graph.insertEdge(f.defaultParent, "e1", null, f.cells.a, f.cells.b, "edgeStyle=x;");
    expect(e.edge).toBe(true);
    expect(e.geometry?.relative).toBe(true);
    expect(e.geometry?.points).toBeNull();
    expect(f.cells.a.edges).toEqual([e]);
    expect(f.graph.getEdgesBetween(f.cells.a, f.cells.b)).toEqual([e]);
    expect(f.graph.getEdgesBetween(f.cells.b, f.cells.a)).toEqual([e]);
    expect(f.graph.getEdgesBetween(f.cells.b, f.cells.a, true)).toEqual([]);
    expect(f.graph.insertEdge(f.defaultParent, null, "", f.cells.a, f.cells.b).id).toMatch(/^e\d+$/);
  });

  it("removeCells fires CELLS_REMOVED on the graph only, cascading the dangling edges", () => {
    const a = plainCell("a");
    const b = plainCell("b");
    const e = edgeCell("e", a, b);
    const f = fakeIframe({ cells: [a, b, e] });
    const onGraph = vi.fn();
    const onModel = vi.fn();
    const change = vi.fn();
    f.graph.addListener(MX_EVENT.CELLS_REMOVED, onGraph);
    f.model.addListener(MX_EVENT.CELLS_REMOVED, onModel);
    f.model.addListener(MX_EVENT.CHANGE, change);

    const removed = f.graph.removeCells([a]);

    expect(removed).toEqual([e, a]);
    expect(f.cells.a).toBeUndefined();
    expect(f.cells.e).toBeUndefined();
    expect(f.cells.b).toBe(b);
    expect(b.edges).toEqual([]);
    expect(onGraph).toHaveBeenCalledTimes(1);
    expect(onGraph.mock.calls[0][1].getProperty("cells")).toEqual([e, a]);
    expect(onModel).not.toHaveBeenCalled();
    expect(change).toHaveBeenCalledTimes(1);
    expect(f.graph.removeCells([a])).toEqual([]);
  });

  it("model.remove produces a CHANGE and no CELLS_REMOVED", () => {
    const a = plainCell("a");
    const f = fakeIframe({ cells: [a] });
    const onGraph = vi.fn();
    const change = vi.fn();
    f.graph.addListener(MX_EVENT.CELLS_REMOVED, onGraph);
    f.model.addListener(MX_EVENT.CHANGE, change);
    f.model.remove(a);
    expect(f.cells.a).toBeUndefined();
    expect(f.defaultParent.children).not.toContain(a);
    expect(onGraph).not.toHaveBeenCalled();
    expect(change).toHaveBeenCalledTimes(1);
  });

  it("removeListener detaches every registration of a function", () => {
    const f = fakeIframe();
    const fn = vi.fn();
    f.model.addListener(MX_EVENT.CHANGE, fn);
    f.model.addListener(MX_EVENT.CELLS_ADDED, fn);
    expect(f.model.listenerCount()).toBe(2);
    f.model.removeListener(fn);
    expect(f.model.listenerCount()).toBe(0);
    f.fire.change();
    expect(fn).not.toHaveBeenCalled();
  });

  it("fire.* resolves mxEvent names and reaches model, graph and container listeners", () => {
    const f = fakeIframe();
    const onModel = vi.fn();
    const onGraph = vi.fn();
    const onMouseUp = vi.fn();
    f.model.addListener(MX_EVENT.CELLS_REMOVED, onModel);
    f.graph.addListener(MX_EVENT.MOVE_CELLS, onGraph);
    f.graph.container.addEventListener("mouseup", onMouseUp);

    f.fire.model("CELLS_REMOVED", { cells: [1] });
    f.fire.graph(MX_EVENT.MOVE_CELLS);
    f.fire.mouseup();

    expect(onModel.mock.calls[0][1].getProperty("cells")).toEqual([1]);
    expect(onGraph).toHaveBeenCalledTimes(1);
    expect(onMouseUp).toHaveBeenCalledTimes(1);
    f.graph.container.removeEventListener("mouseup", onMouseUp);
    f.fire.mouseup();
    expect(onMouseUp).toHaveBeenCalledTimes(1);
  });

  it("labelChanged carries the cell and resizeCell fires CELLS_RESIZED", () => {
    const c = cardCell("c", { cardId: "x", cardType: "Application" });
    const f = fakeIframe({ cells: [c] });
    const onLabel = vi.fn();
    const onResize = vi.fn();
    f.graph.addListener(MX_EVENT.LABEL_CHANGED, onLabel);
    f.graph.addListener(MX_EVENT.CELLS_RESIZED, onResize);

    f.fire.labelChanged(c, "typed");
    f.graph.resizeCell(c, new f.win.mxRectangle(1, 2, 300, 90));

    expect(onLabel.mock.calls[0][1].getProperty("cell")).toBe(c);
    expect(onLabel.mock.calls[0][1].getProperty("value")).toBe("typed");
    expect(onResize).toHaveBeenCalledTimes(1);
    expect(c.geometry).toMatchObject({ x: 1, y: 2, width: 300, height: 90 });
  });

  it("moveCells shifts geometry, re-parents into a target and fires MOVE_CELLS", () => {
    const box = containerCell("box", { cardId: "b", cardType: "Application" });
    const c = cardCell("c", { cardId: "x", cardType: "Application", geometry: { x: 5, y: 5, width: 10, height: 10 } });
    const f = fakeIframe({ cells: [box, c] });
    const onMove = vi.fn();
    f.graph.addListener(MX_EVENT.MOVE_CELLS, onMove);
    f.graph.moveCells([c], 10, 20, false, box);
    expect(c.geometry).toMatchObject({ x: 15, y: 25 });
    expect(c.parent).toBe(box);
    expect(box.children).toContain(c);
    expect(f.defaultParent.children).not.toContain(c);
    expect(onMove).toHaveBeenCalledTimes(1);
  });
});

describe("graph helpers", () => {
  it("overlays are stored per cell and a CLICK carries the DOM event", () => {
    const c = cardCell("c", { cardId: "x", cardType: "Application" });
    const f = fakeIframe({ cells: [c] });
    const overlay = new f.win.mxCellOverlay(
      new f.win.mxImage("data:x", 24, 24),
      null,
      f.win.mxConstants.ALIGN_RIGHT,
      f.win.mxConstants.ALIGN_MIDDLE,
      new f.win.mxPoint(0, -14),
    ) as FakeCellOverlay;
    const clicked = vi.fn();
    overlay.addListener(f.win.mxEvent.CLICK, (_s: unknown, evt: { properties?: { event?: unknown } }) =>
      clicked(evt.properties?.event),
    );
    f.graph.addCellOverlay(c, overlay);
    expect(f.graph.getCellOverlays(c)).toEqual([overlay]);
    overlay.click({ clientX: 7 });
    expect(clicked).toHaveBeenCalledWith({ clientX: 7 });
    expect(f.graph.removeCellOverlays(c)).toEqual([overlay]);
    expect(f.graph.getCellOverlays(c)).toBeNull();
    expect(f.graph.removeCellOverlays(c)).toBeNull();
    expect(overlay).toBeInstanceOf(FakeCellOverlay);
    expect(overlay.image).toBeInstanceOf(FakeImage);
    expect(overlay.offset).toBeInstanceOf(FakePoint);
  });

  it("setCellStyles replaces or appends one token per cell", () => {
    const a = plainCell("a", { style: "edgeStyle=old;rounded=1;" });
    const b = plainCell("b", { style: "" });
    const f = fakeIframe({ cells: [a, b] });
    f.graph.setCellStyles("edgeStyle", "entityRelationEdgeStyle", [a, b]);
    expect(styleTokens(a.style)).toEqual({ rounded: "1", edgeStyle: "entityRelationEdgeStyle" });
    expect(styleTokens(b.style)).toEqual({ edgeStyle: "entityRelationEdgeStyle" });
    f.graph.setCellStyles("rounded", null, [a]);
    expect(styleTokens(a.style)).toEqual({ edgeStyle: "entityRelationEdgeStyle" });
  });

  it("geometry clones deeply and the XML document is not the HTML one", () => {
    const g = new FakeGeometry(1, 2, 3, 4);
    g.points = [new FakePoint(5, 6)];
    const copy = g.clone();
    expect(copy).not.toBe(g);
    expect(copy.points?.[0]).not.toBe(g.points[0]);
    expect(copy.points?.[0]).toEqual({ x: 5, y: 6 });
    const f = fakeIframe();
    const el = f.win.mxUtils.createXmlDocument().createElement("object");
    expect(el.ownerDocument).not.toBe(document);
    expect(el.getAttribute("label")).toBeNull();
    f.win.parent.postMessage("hello");
    expect(f.posted).toEqual(["hello"]);
    expect(f.graph.refreshed).toEqual([]);
    f.graph.refresh(f.defaultParent);
    expect(f.graph.refreshed).toEqual([f.defaultParent]);
    expect(f.graph.view.translate).toEqual({ x: 0, y: 0 });
    expect(f.graph.container.clientWidth).toBe(1200);
  });

  it("styleTokens reads a bare flag as an empty value", () => {
    expect(styleTokens("swimlane;startSize=28;")).toEqual({ swimlane: "", startSize: "28" });
  });
});
