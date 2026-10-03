import { describe, it, expect } from "vitest";
import type { GNode } from "./layeredDependencyLayout";
import { computeHierarchyMarkers } from "./ldvHierarchyMarkers";

function gnode(id: string, extra: Partial<GNode> = {}): GNode {
  return { id, name: id, type: "Application", ...extra };
}

describe("computeHierarchyMarkers", () => {
  it("is empty when the markers are switched off, whatever is hidden", () => {
    const nodes = [gnode("a", { parent_id: "ghost", hasChildren: true })];
    expect(computeHierarchyMarkers(nodes, false).size).toBe(0);
  });

  it("marks nothing on a card whose parent is on the canvas", () => {
    const nodes = [gnode("p"), gnode("c", { parent_id: "p" })];
    expect(computeHierarchyMarkers(nodes, true).size).toBe(0);
  });

  it("treats a null parent like no parent", () => {
    expect(computeHierarchyMarkers([gnode("a", { parent_id: null })], true).size).toBe(0);
  });

  it("marks a card whose parent is not on the canvas", () => {
    // The marker points at something the Reveal tools can surface.
    const m = computeHierarchyMarkers([gnode("c", { parent_id: "ghost" })], true);
    expect(m.get("c")).toEqual({ hiddenParent: true, hiddenChildren: false });
  });

  it("marks a card with children when none of them is on the canvas", () => {
    const m = computeHierarchyMarkers([gnode("p", { hasChildren: true })], true);
    expect(m.get("p")).toEqual({ hiddenParent: false, hiddenChildren: true });
  });

  it("marks nothing on a card with children once one of them is visible", () => {
    // Revealed: the marker disappears, even though other children may remain
    // hidden — it is an affordance, not a count.
    const nodes = [gnode("p", { hasChildren: true }), gnode("c", { parent_id: "p" })];
    expect(computeHierarchyMarkers(nodes, true).size).toBe(0);
  });

  it("raises both flags at once on a card hidden at both ends", () => {
    const m = computeHierarchyMarkers(
      [gnode("mid", { parent_id: "ghost", hasChildren: true })],
      true,
    );
    expect(m.get("mid")).toEqual({ hiddenParent: true, hiddenChildren: true });
  });

  it("marks only the cards that need one", () => {
    const nodes = [
      gnode("p", { hasChildren: true }),
      gnode("c", { parent_id: "p" }),
      gnode("orphan", { parent_id: "ghost" }),
    ];
    const m = computeHierarchyMarkers(nodes, true);
    expect([...m.keys()]).toEqual(["orphan"]);
  });
});
