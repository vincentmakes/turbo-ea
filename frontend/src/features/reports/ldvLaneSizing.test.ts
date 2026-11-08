/**
 * Layer lanes and aggregate boxes that fit their cards (#1295): the arithmetic
 * behind the refit on drag — grow as a card is dragged against an edge, shrink
 * back as it is moved back, never below the laid-out size.
 */
import { describe, it, expect } from "vitest";
import type { Node } from "@xyflow/react";
import {
  applyBoxFit,
  boxSize,
  CLUSTER_INSETS,
  fitBox,
  fitParentForDrag,
  insetsFor,
  LANE_INSETS,
  type BoxBase,
  type BoxInsets,
} from "./ldvLaneSizing";
import { LDV_NODE_W, LDV_NODE_H } from "./ldvHandles";
import { LABEL_H, PAD } from "./ldvLayoutShared";
import { CL_HEADER_H, CL_PAD } from "./ldvAggregate";

const INSETS: BoxInsets = { left: 10, top: 30, right: 20, bottom: 15 };
const BOX = { width: 400, height: 300 };
const BASE: BoxBase = { x: 0, y: 0, w: 400, h: 300 };
const card = (x: number, y: number) => ({ x, y, w: 100, h: 50 });

describe("fitBox", () => {
  it("leaves a box alone while every card sits inside its insets", () => {
    expect(fitBox([card(10, 30)], BASE, INSETS, BOX)).toBeNull();
    // Exactly on the right/bottom inset is still inside.
    expect(fitBox([card(280, 235)], BASE, INSETS, BOX)).toBeNull();
  });

  it("widens the box when a card crosses the right inset", () => {
    expect(fitBox([card(300, 50)], BASE, INSETS, BOX)).toEqual({ dx: 0, dy: 0, width: 420, height: 300 });
  });

  it("deepens the box when a card crosses the bottom inset", () => {
    expect(fitBox([card(50, 250)], BASE, INSETS, BOX)).toEqual({ dx: 0, dy: 0, width: 400, height: 315 });
  });

  it("moves the origin left and widens by as much when a card crosses the left inset", () => {
    expect(fitBox([card(4, 50)], BASE, INSETS, BOX)).toEqual({ dx: 6, dy: 0, width: 406, height: 300 });
  });

  it("moves the origin up when a card climbs into the title strip", () => {
    expect(fitBox([card(50, 0)], BASE, INSETS, BOX)).toEqual({ dx: 0, dy: 30, width: 400, height: 330 });
  });

  it("shrinks back to the base when the card is moved back from the right", () => {
    expect(fitBox([card(100, 50)], BASE, INSETS, { width: 420, height: 315 })).toEqual({
      dx: 0,
      dy: 0,
      width: 400,
      height: 300,
    });
  });

  it("moves the origin back right when the card is moved back from the left", () => {
    // Grown 6 px past its left edge: the base now sits 6 px in from the origin.
    const grown: BoxBase = { x: 6, y: 0, w: 400, h: 300 };
    expect(fitBox([card(106, 50)], grown, INSETS, { width: 406, height: 300 })).toEqual({
      dx: -6,
      dy: 0,
      width: 400,
      height: 300,
    });
  });

  it("moves the origin back down when the card is moved back from the top", () => {
    const grown: BoxBase = { x: 0, y: 30, w: 400, h: 300 };
    expect(fitBox([card(50, 90)], grown, INSETS, { width: 400, height: 330 })).toEqual({
      dx: 0,
      dy: -30,
      width: 400,
      height: 300,
    });
  });

  it("never shrinks below the base", () => {
    // A box larger than its base with every card well inside comes back to the base, no smaller.
    expect(fitBox([card(150, 120)], BASE, INSETS, { width: 500, height: 400 })).toEqual({
      dx: 0,
      dy: 0,
      width: 400,
      height: 300,
    });
    expect(fitBox([], BASE, INSETS, BOX)).toBeNull();
  });

  it("keeps room for every card, not only the one being moved", () => {
    // Two cards dragged out; the further one comes back, the box shrinks only to the other.
    expect(fitBox([card(100, 50), card(300, 50)], BASE, INSETS, { width: 470, height: 300 })).toEqual({
      dx: 0,
      dy: 0,
      width: 420,
      height: 300,
    });
  });

  it("rounds outward to whole pixels", () => {
    expect(fitBox([card(300.4, 50)], BASE, INSETS, BOX)!.width).toBe(421);
    expect(fitBox([card(9.5, 50)], BASE, INSETS, BOX)).toEqual({ dx: 1, dy: 0, width: 401, height: 300 });
  });
});

describe("insets", () => {
  it("keeps a lane's cards clear of its padding and its title strip", () => {
    expect(LANE_INSETS).toEqual({ left: PAD, top: LABEL_H, right: PAD, bottom: PAD });
    expect(insetsFor("ldvGroup")).toBe(LANE_INSETS);
  });

  it("keeps a box's cards clear of its padding and its header", () => {
    expect(CLUSTER_INSETS).toEqual({
      left: CL_PAD,
      top: CL_HEADER_H,
      right: CL_PAD,
      bottom: CL_PAD,
    });
    expect(insetsFor("ldvCluster")).toBe(CLUSTER_INSETS);
  });

  it("has none for a card or an unknown node", () => {
    expect(insetsFor("ldvNode")).toBeUndefined();
    expect(insetsFor(undefined)).toBeUndefined();
  });
});

describe("boxSize", () => {
  const base: Node = { id: "n", position: { x: 0, y: 0 }, data: {} };

  it("prefers width/height, where a resize writes", () => {
    expect(boxSize({ ...base, width: 5, height: 6, style: { width: 1, height: 2 } }, 9, 9)).toEqual(
      { w: 5, h: 6 },
    );
  });

  it("falls back to the layout's style size, then to the fallback", () => {
    expect(boxSize({ ...base, style: { width: 1, height: 2 } }, 9, 9)).toEqual({ w: 1, h: 2 });
    expect(boxSize(base, 9, 8)).toEqual({ w: 9, h: 8 });
  });
});

/* A lane with two cards, laid out the way buildLdvFlow emits them. */
function lane(): Node[] {
  return [
    {
      id: "group:A",
      type: "ldvGroup",
      position: { x: 100, y: 50 },
      data: { label: "A" },
      style: { width: 500, height: 200 },
    },
    {
      id: "c1",
      type: "ldvNode",
      parentId: "group:A",
      extent: "parent",
      position: { x: 40, y: 60 },
      data: {},
      style: { width: LDV_NODE_W, height: LDV_NODE_H },
    },
    {
      id: "c2",
      type: "ldvNode",
      parentId: "group:A",
      extent: "parent",
      position: { x: 250, y: 60 },
      data: {},
      style: { width: LDV_NODE_W, height: LDV_NODE_H },
    },
    { id: "other", type: "ldvGroup", position: { x: 0, y: 400 }, data: {} },
  ];
}

/** Move a node, as React Flow does before calling onNodeDrag. */
function moveTo(nodes: Node[], id: string, x: number, y: number): Node[] {
  return nodes.map((n) => (n.id === id ? { ...n, position: { x, y } } : n));
}
const at = (nodes: Node[], id: string) => nodes.find((n) => n.id === id)!;
const baseOf = (n: Node) => (n.data as { fitBase?: BoxBase }).fitBase;

describe("applyBoxFit", () => {
  it("moves and resizes the box, shifts its children the other way and offsets its base", () => {
    const nodes = lane();
    const out = applyBoxFit(nodes, "group:A", { dx: 7, dy: 3, width: 600, height: 250 }, {
      x: 0,
      y: 0,
      w: 500,
      h: 200,
    });
    const box = out[0];
    expect(box.position).toEqual({ x: 93, y: 47 });
    expect(box.width).toBe(600);
    expect(box.height).toBe(250);
    expect(box.measured).toEqual({ width: 600, height: 250 });
    expect(box.style).toEqual({ width: 600, height: 250 });
    expect(box.data).toEqual({ label: "A", fitBase: { x: 7, y: 3, w: 500, h: 200 } });
    expect(out[1].position).toEqual({ x: 47, y: 63 });
    expect(out[2].position).toEqual({ x: 257, y: 63 });
    // Everything else keeps its identity.
    expect(out[3]).toBe(nodes[3]);
  });

  it("moves the origin back for a negative shift", () => {
    const nodes = lane();
    const out = applyBoxFit(nodes, "group:A", { dx: -7, dy: -3, width: 480, height: 190 }, {
      x: 7,
      y: 3,
      w: 480,
      h: 190,
    });
    expect(out[0].position).toEqual({ x: 107, y: 53 });
    expect(baseOf(out[0])).toEqual({ x: 0, y: 0, w: 480, h: 190 });
    expect(out[1].position).toEqual({ x: 33, y: 57 });
    expect(out[2].position).toEqual({ x: 243, y: 57 });
  });

  it("leaves the children untouched when the origin stays put", () => {
    const nodes = lane();
    const out = applyBoxFit(nodes, "group:A", { dx: 0, dy: 0, width: 600, height: 200 }, {
      x: 0,
      y: 0,
      w: 500,
      h: 200,
    });
    expect(out[1]).toBe(nodes[1]);
    expect(out[2]).toBe(nodes[2]);
    expect(out[0].position).toEqual({ x: 100, y: 50 });
  });
});

describe("fitParentForDrag", () => {
  it("grows the lane as a card reaches its right edge", () => {
    // React Flow clamped the card flush with the lane's right edge.
    const out = fitParentForDrag(moveTo(lane(), "c2", 500 - LDV_NODE_W, 60), "c2");
    expect(out[0].width).toBe(500 + PAD);
    expect(out[0].height).toBe(200);
    expect(at(out, "c2").position).toEqual({ x: 500 - LDV_NODE_W, y: 60 });
    expect(baseOf(out[0])).toEqual({ x: 0, y: 0, w: 500, h: 200 });
  });

  it("grows the lane downwards as a card reaches its bottom edge", () => {
    const out = fitParentForDrag(moveTo(lane(), "c1", 40, 200 - LDV_NODE_H), "c1");
    expect(out[0].height).toBe(200 + PAD);
    expect(out[0].width).toBe(500);
  });

  it("shrinks back to its laid-out size when the card is moved back", () => {
    const grown = fitParentForDrag(moveTo(lane(), "c2", 500 - LDV_NODE_W, 60), "c2");
    const back = fitParentForDrag(moveTo(grown, "c2", 250, 60), "c2");
    expect(back[0].width).toBe(500);
    expect(back[0].height).toBe(200);
    expect(back[0].position).toEqual({ x: 100, y: 50 });
  });

  it("grows past the left edge and comes back, the cards staying put on screen", () => {
    const grown = fitParentForDrag(moveTo(lane(), "c1", 0, 60), "c1");
    expect(grown[0].position).toEqual({ x: 100 - PAD, y: 50 });
    expect(grown[0].width).toBe(500 + PAD);
    expect(at(grown, "c1").position.x).toBe(PAD);
    expect(at(grown, "c2").position.x).toBe(250 + PAD);
    expect(baseOf(grown[0])).toEqual({ x: PAD, y: 0, w: 500, h: 200 });

    // Back to where it started on screen: 140 absolute, now relative to the moved origin.
    const back = fitParentForDrag(moveTo(grown, "c1", 140 - (100 - PAD), 60), "c1");
    expect(back[0].position).toEqual({ x: 100, y: 50 });
    expect(back[0].width).toBe(500);
    expect(at(back, "c1").position.x).toBe(40);
    expect(at(back, "c2").position.x).toBe(250);
    expect(baseOf(back[0])).toEqual({ x: 0, y: 0, w: 500, h: 200 });
  });

  it("shrinks only as far as the other card it still holds", () => {
    let nodes = fitParentForDrag(moveTo(lane(), "c2", 500 - LDV_NODE_W, 60), "c2");
    // The second card follows to the grown edge, so the lane grows again.
    nodes = fitParentForDrag(moveTo(nodes, "c1", 500 + PAD - LDV_NODE_W, 60), "c1");
    expect(nodes[0].width).toBe(500 + 2 * PAD);
    nodes = fitParentForDrag(moveTo(nodes, "c1", 40, 60), "c1");
    expect(nodes[0].width).toBe(500 + PAD);
  });

  it("keeps its base relative to itself once the lane has been moved", () => {
    let nodes = fitParentForDrag(moveTo(lane(), "c2", 500 - LDV_NODE_W, 60), "c2");
    nodes = moveTo(nodes, "group:A", 300, 400);
    nodes = fitParentForDrag(moveTo(nodes, "c2", 250, 60), "c2");
    expect(nodes[0].position).toEqual({ x: 300, y: 400 });
    expect(nodes[0].width).toBe(500);
  });

  it("returns the very same array while every card stays inside", () => {
    const nodes = lane();
    expect(fitParentForDrag(nodes, "c1")).toBe(nodes);
  });

  it("reads a size written on width/height, not the stale style", () => {
    const nodes = lane();
    nodes[0] = { ...nodes[0], width: 800 };
    nodes[2] = { ...nodes[2], position: { x: 550, y: 60 } };
    // 550 + card + inset fits inside 800 (not inside the style's 500): no change.
    expect(fitParentForDrag(nodes, "c2")).toBe(nodes);
  });

  it("uses an aggregate box's own insets", () => {
    const nodes: Node[] = [
      {
        id: "cluster:x",
        type: "ldvCluster",
        position: { x: 0, y: 0 },
        data: {},
        style: { width: 300, height: 150 },
      },
      {
        id: "c",
        type: "ldvNode",
        parentId: "cluster:x",
        extent: "parent",
        position: { x: 300 - LDV_NODE_W, y: CL_HEADER_H },
        data: {},
        style: { width: LDV_NODE_W, height: LDV_NODE_H },
      },
    ];
    expect(fitParentForDrag(nodes, "c")[0].width).toBe(300 + CL_PAD);
  });

  it("leaves a card with no box, or an unknown card, alone", () => {
    const nodes = lane();
    const centred: Node = { id: "centre", type: "ldvNode", position: { x: 0, y: 0 }, data: {} };
    const withCentre = [...nodes, centred];
    expect(fitParentForDrag(withCentre, "centre")).toBe(withCentre);
    expect(fitParentForDrag(nodes, "missing")).toBe(nodes);
  });

  it("ignores a parent that is not a box", () => {
    const nodes: Node[] = [
      { id: "p", type: "somethingElse", position: { x: 0, y: 0 }, data: {}, width: 10, height: 10 },
      { id: "c", type: "ldvNode", parentId: "p", position: { x: 50, y: 50 }, data: {} },
    ];
    expect(fitParentForDrag(nodes, "c")).toBe(nodes);
  });
});
