import { describe, it, expect } from "vitest";
import { buildAdjacency, mergeRelLabel } from "./dependencyAdjacency";

describe("mergeRelLabel", () => {
  it("joins two distinct verbs", () => {
    expect(mergeRelLabel("owns", "uses")).toBe("owns / uses");
  });

  it("does not repeat a verb already present", () => {
    expect(mergeRelLabel("owns / uses", "uses")).toBe("owns / uses");
  });

  it("tolerates an empty side", () => {
    expect(mergeRelLabel("", "uses")).toBe("uses");
    expect(mergeRelLabel("owns", "")).toBe("owns");
  });
});

describe("buildAdjacency", () => {
  it("links both ends of an edge, using the reverse verb inbound", () => {
    const adj = buildAdjacency([
      { source: "org", target: "app", type: "relOrgToApp", label: "uses", reverse_label: "is used by" },
    ]);
    expect(adj.get("org")).toEqual([
      { nodeId: "app", relType: "relOrgToApp", relLabel: "uses", relDescription: undefined },
    ]);
    expect(adj.get("app")).toEqual([
      { nodeId: "org", relType: "relOrgToApp", relLabel: "is used by", relDescription: undefined },
    ]);
  });

  it("merges several relation types between the same two cards into one entry", () => {
    // The tree renders one child per entry: without the merge, the same card
    // would appear twice under its parent once a pair carries two relation
    // types — which is exactly what allowing multiple types per pair produces.
    const adj = buildAdjacency([
      { source: "org", target: "app", type: "relOrgToApp", label: "uses", reverse_label: "is used by" },
      { source: "org", target: "app", type: "relOrgToAppOwns", label: "owns", reverse_label: "is owned by" },
    ]);

    const fromOrg = adj.get("org")!;
    expect(fromOrg).toHaveLength(1);
    expect(fromOrg[0].nodeId).toBe("app");
    expect(fromOrg[0].relLabel).toBe("uses / owns");
    // The first type wins the identity — the label is what carries both.
    expect(fromOrg[0].relType).toBe("relOrgToApp");

    const fromApp = adj.get("app")!;
    expect(fromApp).toHaveLength(1);
    expect(fromApp[0].relLabel).toBe("is used by / is owned by");
  });

  it("keeps distinct neighbours separate", () => {
    const adj = buildAdjacency([
      { source: "org", target: "app", type: "r1", label: "uses" },
      { source: "org", target: "db", type: "r2", label: "stores" },
    ]);
    expect(adj.get("org")!.map((e) => e.nodeId)).toEqual(["app", "db"]);
  });

  it("adopts a description from a later type when the first carries none", () => {
    const adj = buildAdjacency([
      { source: "org", target: "app", type: "r1", label: "uses" },
      { source: "org", target: "app", type: "r2", label: "owns", description: "since 2019" },
    ]);
    expect(adj.get("org")![0].relDescription).toBe("since 2019");
  });

  it("falls back to the relation type key when an edge has no label", () => {
    const adj = buildAdjacency([{ source: "a", target: "b", type: "relAToB" }]);
    expect(adj.get("a")![0].relLabel).toBe("relAToB");
  });

  it("does not mutate the caller's edge objects", () => {
    const edges = [
      { source: "org", target: "app", type: "r1", label: "uses" },
      { source: "org", target: "app", type: "r2", label: "owns" },
    ];
    buildAdjacency(edges);
    expect(edges[0].label).toBe("uses");
    expect(edges[1].label).toBe("owns");
  });
});
