/**
 * The geometry primitives both Layered Dependency View layouts share. The
 * end-to-end layouts are covered through `layeredDependencyLayout.test.ts`
 * and `ldvOrientation.test.ts`; this file pins the pieces on their own —
 * the per-lane group layout, the flow-direction reader, the row transpose
 * and the cross-lane x-alignment.
 */
import { describe, expect, it } from "vitest";

import { CARD_TYPES } from "@/test/fixtures/metamodel";
import type { GEdge, GNode } from "./layeredDependencyLayout";
import { CARD_SIZE, LDV_NODE_H, LDV_NODE_W } from "./ldvHandles";
import {
  CATEGORY_COLORS,
  CATEGORY_ORDER,
  DRAG_ROOM,
  MAX_COLS,
  PAD,
  alignLanesX,
  layoutGroup,
  orientEdgesToRelationTypes,
  readFlowDir,
  transposeRow,
  typeCategory,
  typeColor,
  typeIcon,
  typeLabel,
} from "./ldvLayoutShared";

const node = (id: string, type = "Application"): GNode => ({ id, name: id.toUpperCase(), type });
const edge = (source: string, target: string, type = "relAppToApp"): GEdge => ({ source, target, type });

function overlaps(a: { x: number; y: number }, b: { x: number; y: number }, w = LDV_NODE_W, h = LDV_NODE_H) {
  return a.x < b.x + w && b.x < a.x + w && a.y < b.y + h && b.y < a.y + h;
}

describe("type lookups", () => {
  it("read the metamodel and fall back per attribute", () => {
    expect(typeColor("Application", CARD_TYPES)).toBe("#0f7eb5");
    expect(typeColor("Nope", CARD_TYPES)).toBe("#999");
    expect(typeLabel("ITComponent", CARD_TYPES)).toBe("IT Component");
    expect(typeLabel("Nope", CARD_TYPES)).toBe("Nope");
    expect(typeIcon("Provider", CARD_TYPES)).toBe("storefront");
    expect(typeIcon("Nope", CARD_TYPES)).toBe("category");
    expect(typeCategory("BusinessCapability", CARD_TYPES)).toBe("Business Architecture");
    expect(typeCategory("Nope", CARD_TYPES)).toBe("Other");
  });

  it("exposes the four EA layers in order, each with a colour", () => {
    expect(CATEGORY_ORDER).toEqual([
      "Strategy & Transformation",
      "Business Architecture",
      "Application & Data",
      "Technical Architecture",
    ]);
    for (const c of CATEGORY_ORDER) expect(CATEGORY_COLORS[c]).toMatch(/^#/);
  });
});

describe("layoutGroup", () => {
  it("answers an empty layout for no nodes", () => {
    expect(layoutGroup([], [])).toEqual({ positioned: [], width: 0, height: 0, hGap: 40 });
  });

  it("lays connected nodes out with dagre, top to bottom, normalised to the origin", () => {
    const nodes = [node("a"), node("b"), node("c")];
    const out = layoutGroup(nodes, [edge("a", "b"), edge("a", "c"), edge("x", "a")]);
    expect(out.positioned.map((p) => p.id).sort()).toEqual(["a", "b", "c"]);
    expect(out.hGap).toBe(50);
    const byId = Object.fromEntries(out.positioned.map((p) => [p.id, p]));
    // Source above its targets; both targets on one rank.
    expect(byId.a.y).toBeLessThan(byId.b.y);
    expect(byId.b.y).toBe(byId.c.y);
    expect(Math.min(...out.positioned.map((p) => p.x))).toBe(0);
    expect(Math.min(...out.positioned.map((p) => p.y))).toBe(0);
    expect(out.width).toBe(Math.max(...out.positioned.map((p) => p.x)) + LDV_NODE_W);
    expect(out.height).toBe(Math.max(...out.positioned.map((p) => p.y)) + LDV_NODE_H);
    expect(overlaps(byId.b, byId.c)).toBe(false);
    expect(Math.abs(byId.c.x - byId.b.x)).toBeGreaterThanOrEqual(LDV_NODE_W + 50);
  });

  it("honours a custom size lookup and spacing on the dagre path", () => {
    const sizes = { a: { w: 300, h: 100 }, b: { w: 100, h: 50 } };
    const out = layoutGroup([node("a"), node("b")], [edge("a", "b")], (id) => sizes[id as "a" | "b"], {
      ranksep: 10,
      nodesep: 5,
    });
    const byId = Object.fromEntries(out.positioned.map((p) => [p.id, p]));
    expect(out.hGap).toBe(5);
    expect(byId.b.y - (byId.a.y + 100)).toBe(10);
    expect(out.width).toBe(300);
    expect(out.height).toBe(160);
  });

  it("tiles unconnected nodes into a grid of at most MAX_COLS columns", () => {
    const nodes = ["a", "b", "c", "d", "e"].map((id) => node(id));
    const out = layoutGroup(nodes, [edge("a", "zz")]);
    expect(out.hGap).toBe(40);
    const xs = out.positioned.map((p) => p.x);
    const ys = out.positioned.map((p) => p.y);
    expect(new Set(xs).size).toBe(MAX_COLS);
    expect(new Set(ys).size).toBe(2);
    expect(out.positioned.slice(0, 3).map((p) => p.x)).toEqual([0, LDV_NODE_W + 40, 2 * (LDV_NODE_W + 40)]);
    expect(out.positioned[3]).toEqual({ id: "d", x: 0, y: LDV_NODE_H + 30 });
    expect(out.width).toBe(3 * LDV_NODE_W + 2 * 40);
    expect(out.height).toBe(2 * LDV_NODE_H + 30);
    for (let i = 0; i < out.positioned.length; i++)
      for (let j = i + 1; j < out.positioned.length; j++)
        expect(overlaps(out.positioned[i], out.positioned[j])).toBe(false);
  });

  it("sizes grid columns and rows by their widest and tallest member", () => {
    const sizes: Record<string, { w: number; h: number }> = {
      a: { w: 100, h: 50 },
      b: { w: 300, h: 50 },
      c: { w: 100, h: 120 },
      d: { w: 100, h: 50 },
    };
    const out = layoutGroup(["a", "b", "c", "d"].map((id) => node(id)), [], (id) => sizes[id]);
    const byId = Object.fromEntries(out.positioned.map((p) => [p.id, p]));
    expect(byId.b.x).toBe(100 + 40);
    expect(byId.c.x).toBe(100 + 40 + 300 + 40);
    expect(byId.d).toEqual({ id: "d", x: 0, y: 120 + 30 });
    expect(out.width).toBe(100 + 40 + 300 + 40 + 100);
    expect(out.height).toBe(120 + 30 + 50);
  });
});

describe("readFlowDir", () => {
  it("accepts the three known values and ignores anything else", () => {
    expect(readFlowDir({ flowDirection: "forward" })).toBe("forward");
    expect(readFlowDir({ flowDirection: "reverse" })).toBe("reverse");
    expect(readFlowDir({ flowDirection: "bidirectional" })).toBe("bidirectional");
    expect(readFlowDir({ flowDirection: "sideways" })).toBeUndefined();
    expect(readFlowDir({ flowDirection: 1 })).toBeUndefined();
    expect(readFlowDir({})).toBeUndefined();
    expect(readFlowDir(undefined)).toBeUndefined();
  });
});

describe("orientEdgesToRelationTypes", () => {
  const rts = new Map([["relAppToITC", { source_type_key: "Application", target_type_key: "ITComponent" }]]);

  it("returns the very same array when every edge already runs the type's way", () => {
    const nodes = [node("app"), node("itc", "ITComponent")];
    const edges = [edge("app", "itc", "relAppToITC"), edge("app", "itc", "unknownType")];
    expect(orientEdgesToRelationTypes(nodes, edges, rts)).toBe(edges);
  });

  it("swaps the endpoints of an edge stored against its type and keeps the rest", () => {
    const nodes = [node("app"), node("itc", "ITComponent")];
    const stored = { ...edge("itc", "app", "relAppToITC"), label: "uses", attributes: { flowDirection: "forward" } };
    const other = edge("app", "itc", "relAppToITC");
    const out = orientEdgesToRelationTypes(nodes, [stored, other], rts);
    expect(out).not.toBe([stored, other]);
    expect(out[0]).toEqual({ ...stored, source: "app", target: "itc" });
    expect(out[1]).toBe(other);
  });
});

describe("transposeRow", () => {
  it("swaps two adjacent nodes when that removes a crossing, keeping the row's x positions", () => {
    const centerX = new Map([
      ["l", 0],
      ["r", 250],
    ]);
    // l's neighbour above sits to the right, r's to the left: one crossing.
    const neighbours = (id: string) => (id === "l" ? { above: [250], below: [] } : { above: [0], below: [] });
    transposeRow(["l", "r"], centerX, neighbours);
    expect(centerX.get("l")).toBe(250);
    expect(centerX.get("r")).toBe(0);
  });

  it("leaves an uncrossed row, a one-node row and nodes of different widths alone", () => {
    const centerX = new Map([
      ["l", 0],
      ["r", 250],
    ]);
    const crossed = (id: string) => (id === "l" ? { above: [250], below: [] } : { above: [0], below: [] });
    transposeRow(["l"], centerX, crossed);
    transposeRow(["l", "r"], centerX, crossed, (id) => (id === "l" ? 400 : 200));
    expect(centerX.get("l")).toBe(0);
    const straight = (id: string) => (id === "l" ? { above: [0], below: [] } : { above: [250], below: [] });
    transposeRow(["l", "r"], centerX, straight);
    expect(centerX.get("l")).toBe(0);
    expect(centerX.get("r")).toBe(250);
  });
});

describe("alignLanesX", () => {
  const laneOf = (ids: string[], hGap = 40) => ({
    positioned: ids.map((id, i) => ({ id, x: i * (LDV_NODE_W + hGap), y: 0 })),
    hGap,
  });

  it("keeps a lane without neighbours exactly where it was", () => {
    const lanes = [laneOf(["a", "b"]), laneOf(["c"])];
    const out = alignLanesX(lanes, [], []);
    expect(out[0].positioned).toEqual(lanes[0].positioned);
    expect(out[0].innerW).toBe(2 * LDV_NODE_W + 40);
    expect(out[0].offsetX).toBe(0);
    // The narrower lane sits centred under the wide one, as the historical placement did.
    const wideW = out[0].innerW + 2 * PAD + DRAG_ROOM;
    const narrowW = LDV_NODE_W + 2 * PAD + DRAG_ROOM;
    expect(out[1].offsetX).toBe(Math.round((wideW - narrowW) / 2));
    expect(out[1].positioned).toEqual([{ id: "c", x: 0, y: 0 }]);
  });

  it("pulls a card under the cross-lane neighbour it is connected to", () => {
    const lanes = [laneOf(["a", "b", "c"]), laneOf(["x"])];
    const out = alignLanesX(lanes, [{ source: "c", target: "x" }], []);
    const upper = out[0];
    const lower = out[1];
    const centre = (lane: typeof upper, id: string) =>
      lane.offsetX + PAD + lane.positioned.find((p) => p.id === id)!.x + LDV_NODE_W / 2;
    expect(centre(lower, "x")).toBe(centre(upper, "c"));
    expect(Math.min(...out.map((l) => l.offsetX))).toBe(0);
  });

  it("never lets two cards of one row overlap, however hard they are pulled together", () => {
    const lanes = [laneOf(["a", "b"]), laneOf(["x", "y"])];
    // Both lower cards want to sit under "a".
    const out = alignLanesX(lanes, [
      { source: "x", target: "a" },
      { source: "y", target: "a" },
      { source: "y", target: "a" },
    ], []);
    const [x, y] = ["x", "y"].map((id) => out[1].positioned.find((p) => p.id === id)!);
    expect(Math.abs(x.x - y.x)).toBeGreaterThanOrEqual(LDV_NODE_W + 40);
    expect(out[1].positioned.every((p) => p.y === 0)).toBe(true);
    expect(out[1].innerW).toBe(Math.max(x.x, y.x) + LDV_NODE_W);
  });

  it("ignores edges to cards that are not on any lane and weighs intra-lane edges too", () => {
    const lanes = [laneOf(["a", "b"]), laneOf(["x"])];
    const out = alignLanesX(lanes, [{ source: "x", target: "ghost" }], [{ source: "a", target: "b" }]);
    expect(out[1].positioned).toEqual([{ id: "x", x: 0, y: 0 }]);
    expect(out[0].positioned.map((p) => p.id)).toEqual(["a", "b"]);
  });

  it("spaces a row holding an aggregate box for the box, not for a card", () => {
    const sizes: Record<string, { w: number; h: number }> = { big: { w: 600, h: 120 }, s: CARD_SIZE, x: CARD_SIZE };
    const lanes = [
      { positioned: [{ id: "big", x: 0, y: 0 }, { id: "s", x: 640, y: 20 }], hGap: 40 },
      laneOf(["x"]),
    ];
    const out = alignLanesX(lanes, [{ source: "x", target: "s" }], [], (id) => sizes[id]);
    const [big, s] = ["big", "s"].map((id) => out[0].positioned.find((p) => p.id === id)!);
    expect(s.x - big.x).toBeGreaterThanOrEqual(600 + 40);
    expect(out[0].innerW).toBe(s.x + LDV_NODE_W);
  });

  it("copes with an empty lane in the stack", () => {
    const out = alignLanesX([laneOf(["a"]), { positioned: [], hGap: 40 }], [], []);
    expect(out[1]).toEqual({ positioned: [], innerW: 0, offsetX: expect.any(Number) });
  });
});
