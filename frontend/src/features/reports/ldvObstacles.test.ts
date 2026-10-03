import { describe, it, expect } from "vitest";
import type { Node } from "@xyflow/react";
import { computeObstacles, GROUP_LABEL_STRIP_H } from "./ldvObstacles";
import { LDV_NODE_W, LDV_NODE_H } from "./layeredDependencyLayout";

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function node(
  id: string,
  type: string | undefined,
  position: { x: number; y: number },
  extra: Partial<Pick<Node, "parentId" | "style">> = {},
): Node {
  return { id, type, position, data: {}, ...extra };
}

describe("computeObstacles", () => {
  it("returns nothing for an empty canvas", () => {
    expect(computeObstacles([])).toEqual([]);
  });

  it("places a card nested two levels deep at its absolute position", () => {
    // Aggregate mode: a card inside a type box inside a lane. Its obstacle box
    // must sit at the sum of the whole chain — one level of flattening would
    // put it in the wrong place.
    const lane = node("lane", "ldvGroup", { x: 100, y: 50 }, { style: { width: 800 } });
    const box = node(
      "box",
      "ldvCluster",
      { x: 20, y: 30 },
      { parentId: "lane", style: { width: 300, height: 200 } },
    );
    const card = node(
      "card",
      "ldvNode",
      { x: 5, y: 7 },
      { parentId: "box", style: { width: 150, height: 60 } },
    );
    const bounds = computeObstacles([lane, box, card]);
    expect(bounds).toContainEqual({ x1: 125, y1: 87, x2: 275, y2: 147 });
  });

  it("sizes a card from its style when present and the default node size when absent", () => {
    const lane = node("lane", "ldvGroup", { x: 100, y: 50 });
    const unsized = node("a", "ldvNode", { x: 10, y: 20 }, { parentId: "lane" });
    // A style object with no width/height is the same as no style at all.
    const emptyStyle = node("b", "ldvNode", { x: 0, y: 0 }, { parentId: "lane", style: {} });
    const sized = node(
      "c",
      "ldvNode",
      { x: 0, y: 0 },
      { parentId: "lane", style: { width: 40, height: 10 } },
    );
    const bounds = computeObstacles([lane, unsized, emptyStyle, sized]);
    expect(bounds).toContainEqual({
      x1: 110,
      y1: 70,
      x2: 110 + LDV_NODE_W,
      y2: 70 + LDV_NODE_H,
    });
    expect(bounds).toContainEqual({
      x1: 100,
      y1: 50,
      x2: 100 + LDV_NODE_W,
      y2: 50 + LDV_NODE_H,
    });
    expect(bounds).toContainEqual({ x1: 100, y1: 50, x2: 140, y2: 60 });
  });

  it("ignores a card that sits in no lane", () => {
    // Only the centred card of the aggregate view is parentless; it is never
    // an obstacle for anything.
    const loose = node("loose", "ldvNode", { x: 10, y: 10 }, { style: { width: 50, height: 50 } });
    expect(computeObstacles([loose])).toEqual([]);
  });

  it("contributes a cluster's whole box, at its absolute position", () => {
    // A count must never come to rest inside a box it does not belong to, so
    // the whole box blocks — not just its title strip.
    const lane = node("lane", "ldvGroup", { x: 100, y: 50 });
    const box = node(
      "box",
      "ldvCluster",
      { x: 20, y: 30 },
      { parentId: "lane", style: { width: 300, height: 200 } },
    );
    const bounds = computeObstacles([lane, box]);
    expect(bounds).toContainEqual({ x1: 120, y1: 80, x2: 420, y2: 280 });
  });

  it("gives an unsized cluster a zero-area box", () => {
    const box = node("box", "ldvCluster", { x: 7, y: 9 });
    expect(computeObstacles([box])).toEqual([{ x1: 7, y1: 9, x2: 7, y2: 9 }]);
  });

  it("contributes a group's label strip across the top of its box", () => {
    expect(GROUP_LABEL_STRIP_H).toBe(34);
    const lane = node("lane", "ldvGroup", { x: 10, y: 20 }, { style: { width: 500, height: 900 } });
    expect(computeObstacles([lane])).toEqual([
      { x1: 10, y1: 20, x2: 510, y2: 20 + GROUP_LABEL_STRIP_H },
    ]);
  });

  it("gives an unsized group a zero-width strip", () => {
    const lane = node("lane", "ldvGroup", { x: 10, y: 20 });
    expect(computeObstacles([lane])).toEqual([
      { x1: 10, y1: 20, x2: 10, y2: 20 + GROUP_LABEL_STRIP_H },
    ]);
  });

  it("ignores node types it does not know", () => {
    const stranger = node("x", "default", { x: 0, y: 0 }, { style: { width: 10, height: 10 } });
    const untyped = node("y", undefined, { x: 0, y: 0 }, { parentId: "x" });
    expect(computeObstacles([stranger, untyped])).toEqual([]);
  });
});
