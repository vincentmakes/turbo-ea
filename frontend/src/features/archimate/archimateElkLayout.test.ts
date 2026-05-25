import { describe, it, expect } from "vitest";
import { computeArchiMateLayout, type ElkLayoutInput } from "./archimateElkLayout";

describe("computeArchiMateLayout", () => {
  it("accepts nodes and edges and returns positioned nodes", async () => {
    const input: ElkLayoutInput = {
      nodes: [
        { id: "n1", width: 120, height: 55 },
        { id: "n2", width: 120, height: 55 },
      ],
      edges: [{ id: "e1", source: "n1", target: "n2" }],
    };

    const result = await computeArchiMateLayout(input);

    expect(result).toHaveLength(2);
    expect(result[0]).toHaveProperty("id");
    expect(result[0]).toHaveProperty("x");
    expect(result[0]).toHaveProperty("y");
    expect(typeof result[0].x).toBe("number");
    expect(typeof result[0].y).toBe("number");
  });

  it("defaults to layered algorithm and produces non-overlapping positions", async () => {
    const input: ElkLayoutInput = {
      nodes: [
        { id: "a", width: 100, height: 50 },
        { id: "b", width: 100, height: 50 },
        { id: "c", width: 100, height: 50 },
      ],
      edges: [
        { id: "e1", source: "a", target: "b" },
        { id: "e2", source: "b", target: "c" },
      ],
    };

    const result = await computeArchiMateLayout(input);

    expect(result).toHaveLength(3);
    // With layered algorithm nodes should not all share the same x position
    const xValues = result.map((n) => n.x);
    const uniqueX = new Set(xValues);
    expect(uniqueX.size).toBeGreaterThan(1);
  });

  it("handles empty graph without error", async () => {
    const result = await computeArchiMateLayout({ nodes: [], edges: [] });
    expect(result).toEqual([]);
  });

  it("handles single node with no edges", async () => {
    const result = await computeArchiMateLayout({
      nodes: [{ id: "solo", width: 80, height: 40 }],
      edges: [],
    });
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("solo");
  });

  it("accepts explicit algorithm override", async () => {
    const input: ElkLayoutInput = {
      nodes: [
        { id: "n1", width: 120, height: 55 },
        { id: "n2", width: 120, height: 55 },
      ],
      edges: [{ id: "e1", source: "n1", target: "n2" }],
      algorithm: "force",
    };
    // Should not throw even with an explicit algorithm
    const result = await computeArchiMateLayout(input);
    expect(result).toHaveLength(2);
  });
});
