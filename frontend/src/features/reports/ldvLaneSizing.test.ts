/**
 * Layer lanes and aggregate boxes that grow with their cards (#1295): the
 * arithmetic behind the auto-grow on drag.
 */
import { describe, it, expect } from "vitest";
import type { Node } from "@xyflow/react";
import {
  applyBoxGrowth,
  boxSize,
  CLUSTER_INSETS,
  growBoxToFit,
  growParentForDrag,
  insetsFor,
  LANE_INSETS,
  type BoxInsets,
} from "./ldvLaneSizing";
import { LDV_NODE_W, LDV_NODE_H } from "./ldvHandles";
import { LABEL_H, PAD } from "./ldvLayoutShared";
import { CL_HEADER_H, CL_PAD } from "./ldvAggregate";

const INSETS: BoxInsets = { left: 10, top: 30, right: 20, bottom: 15 };
const BOX = { width: 400, height: 300 };

describe("growBoxToFit", () => {
  it("leaves a box alone while the card sits inside its insets", () => {
    expect(growBoxToFit({ x: 10, y: 30, w: 100, h: 50 }, BOX, INSETS)).toBeNull();
    // Exactly on the right/bottom inset is still inside.
    expect(growBoxToFit({ x: 280, y: 235, w: 100, h: 50 }, BOX, INSETS)).toBeNull();
  });

  it("widens the box when the card crosses the right inset", () => {
    expect(growBoxToFit({ x: 300, y: 50, w: 100, h: 50 }, BOX, INSETS)).toEqual({
      dx: 0,
      dy: 0,
      width: 420,
      height: 300,
    });
  });

  it("deepens the box when the card crosses the bottom inset", () => {
    expect(growBoxToFit({ x: 50, y: 250, w: 100, h: 50 }, BOX, INSETS)).toEqual({
      dx: 0,
      dy: 0,
      width: 400,
      height: 315,
    });
  });

  it("grows both ways at the corner", () => {
    expect(growBoxToFit({ x: 300, y: 250, w: 100, h: 50 }, BOX, INSETS)).toEqual({
      dx: 0,
      dy: 0,
      width: 420,
      height: 315,
    });
  });

  it("moves the origin left and widens by as much when the card crosses the left inset", () => {
    expect(growBoxToFit({ x: 4, y: 50, w: 100, h: 50 }, BOX, INSETS)).toEqual({
      dx: 6,
      dy: 0,
      width: 406,
      height: 300,
    });
  });

  it("moves the origin up when the card climbs into the title strip", () => {
    expect(growBoxToFit({ x: 50, y: 0, w: 100, h: 50 }, BOX, INSETS)).toEqual({
      dx: 0,
      dy: 30,
      width: 400,
      height: 330,
    });
  });

  it("never shrinks the box", () => {
    const g = growBoxToFit({ x: 0, y: 100, w: 10, h: 10 }, BOX, INSETS)!;
    expect(g.width).toBeGreaterThanOrEqual(BOX.width);
    expect(g.height).toBe(BOX.height);
  });

  it("rounds a fractional drag position up to whole pixels", () => {
    expect(growBoxToFit({ x: 300.4, y: 50, w: 100, h: 50 }, BOX, INSETS)!.width).toBe(421);
    expect(growBoxToFit({ x: 9.5, y: 50, w: 100, h: 50 }, BOX, INSETS)!.dx).toBe(1);
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
      data: {},
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

describe("applyBoxGrowth", () => {
  it("moves and resizes the box and shifts its children the other way", () => {
    const nodes = lane();
    const out = applyBoxGrowth(nodes, "group:A", { dx: 7, dy: 3, width: 600, height: 250 });
    const box = out[0];
    expect(box.position).toEqual({ x: 93, y: 47 });
    expect(box.width).toBe(600);
    expect(box.height).toBe(250);
    expect(box.measured).toEqual({ width: 600, height: 250 });
    expect(box.style).toEqual({ width: 600, height: 250 });
    expect(out[1].position).toEqual({ x: 47, y: 63 });
    expect(out[2].position).toEqual({ x: 257, y: 63 });
    // Everything else keeps its identity.
    expect(out[3]).toBe(nodes[3]);
  });

  it("leaves the children untouched when the origin stays put", () => {
    const nodes = lane();
    const out = applyBoxGrowth(nodes, "group:A", { dx: 0, dy: 0, width: 600, height: 200 });
    expect(out[1]).toBe(nodes[1]);
    expect(out[2]).toBe(nodes[2]);
    expect(out[0].position).toEqual({ x: 100, y: 50 });
  });
});

describe("growParentForDrag", () => {
  it("grows the lane as the card reaches its right edge", () => {
    const nodes = lane();
    // React Flow clamped the card flush with the lane's right edge.
    nodes[2] = { ...nodes[2], position: { x: 500 - LDV_NODE_W, y: 60 } };
    const out = growParentForDrag(nodes, "c2");
    expect(out[0].width).toBe(500 + PAD);
    expect(out[0].height).toBe(200);
    expect(out[2].position).toEqual({ x: 500 - LDV_NODE_W, y: 60 });
  });

  it("grows the lane downwards as the card reaches its bottom edge", () => {
    const nodes = lane();
    nodes[1] = { ...nodes[1], position: { x: 40, y: 200 - LDV_NODE_H } };
    const out = growParentForDrag(nodes, "c1");
    expect(out[0].height).toBe(200 + PAD);
    expect(out[0].width).toBe(500);
  });

  it("returns the very same array while the card stays inside", () => {
    const nodes = lane();
    expect(growParentForDrag(nodes, "c1")).toBe(nodes);
  });

  it("reads a size the resizer wrote on width/height, not the stale style", () => {
    const nodes = lane();
    nodes[0] = { ...nodes[0], width: 800 };
    nodes[2] = { ...nodes[2], position: { x: 550, y: 60 } };
    // 550 + card + inset fits inside 800 (not inside the style's 500): no growth.
    expect(growParentForDrag(nodes, "c2")).toBe(nodes);
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
    expect(growParentForDrag(nodes, "c")[0].width).toBe(300 + CL_PAD);
  });

  it("leaves a card with no box, or an unknown card, alone", () => {
    const nodes = lane();
    const centred: Node = { id: "centre", type: "ldvNode", position: { x: 0, y: 0 }, data: {} };
    const withCentre = [...nodes, centred];
    expect(growParentForDrag(withCentre, "centre")).toBe(withCentre);
    expect(growParentForDrag(nodes, "missing")).toBe(nodes);
  });

  it("ignores a parent that is not a box", () => {
    const nodes: Node[] = [
      { id: "p", type: "somethingElse", position: { x: 0, y: 0 }, data: {}, width: 10, height: 10 },
      { id: "c", type: "ldvNode", parentId: "p", position: { x: 50, y: 50 }, data: {} },
    ];
    expect(growParentForDrag(nodes, "c")).toBe(nodes);
  });
});
