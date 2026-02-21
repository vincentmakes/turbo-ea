import { describe, it, expect } from "vitest";
import {
  buildTree,
  pruneTreeToDepth,
  getLeafOrder,
  getLeafNodes,
  buildColumnHeaderRows,
  buildRowHeaderLayout,
  aggregateCount,
  getEffectiveLeafIds,
  buildAllNodesMap,
  type MatrixItem,
} from "./matrixHierarchy";

// ---------------------------------------------------------------------------
// buildTree
// ---------------------------------------------------------------------------
describe("buildTree", () => {
  it("returns empty result for empty input", () => {
    const result = buildTree([]);
    expect(result.roots).toHaveLength(0);
    expect(result.maxDepth).toBe(0);
    expect(result.allNodes.size).toBe(0);
  });

  it("builds flat list of roots when no parent_ids", () => {
    const items: MatrixItem[] = [
      { id: "a", name: "Alpha", parent_id: null },
      { id: "b", name: "Beta", parent_id: null },
    ];
    const result = buildTree(items);
    expect(result.roots).toHaveLength(2);
    // Sorted alphabetically
    expect(result.roots[0].item.name).toBe("Alpha");
    expect(result.roots[1].item.name).toBe("Beta");
    expect(result.maxDepth).toBe(0);
  });

  it("builds parent-child hierarchy", () => {
    const items: MatrixItem[] = [
      { id: "root", name: "Root", parent_id: null },
      { id: "child1", name: "Child A", parent_id: "root" },
      { id: "child2", name: "Child B", parent_id: "root" },
    ];
    const result = buildTree(items);
    expect(result.roots).toHaveLength(1);
    expect(result.roots[0].children).toHaveLength(2);
    expect(result.maxDepth).toBe(1);
  });

  it("computes leafCount and leafDescendants", () => {
    const items: MatrixItem[] = [
      { id: "root", name: "Root", parent_id: null },
      { id: "c1", name: "A", parent_id: "root" },
      { id: "c2", name: "B", parent_id: "root" },
      { id: "gc1", name: "AA", parent_id: "c1" },
    ];
    const result = buildTree(items);
    const root = result.roots[0];
    // root has 2 leaf descendants: gc1 (leaf under c1) and c2 (leaf)
    expect(root.leafCount).toBe(2);
    expect(root.leafDescendants).toContain("gc1");
    expect(root.leafDescendants).toContain("c2");
  });

  it("computes correct depth for 3-level hierarchy", () => {
    const items: MatrixItem[] = [
      { id: "r", name: "Root", parent_id: null },
      { id: "c", name: "Child", parent_id: "r" },
      { id: "gc", name: "Grandchild", parent_id: "c" },
    ];
    const result = buildTree(items);
    expect(result.maxDepth).toBe(2);
    expect(result.allNodes.get("gc")!.depth).toBe(2);
  });

  it("sorts children alphabetically", () => {
    const items: MatrixItem[] = [
      { id: "root", name: "Root", parent_id: null },
      { id: "c", name: "Zulu", parent_id: "root" },
      { id: "b", name: "Alpha", parent_id: "root" },
      { id: "a", name: "Mike", parent_id: "root" },
    ];
    const result = buildTree(items);
    const names = result.roots[0].children.map((c) => c.item.name);
    expect(names).toEqual(["Alpha", "Mike", "Zulu"]);
  });

  it("treats orphaned parent_ids as roots", () => {
    const items: MatrixItem[] = [
      { id: "a", name: "A", parent_id: "nonexistent" },
    ];
    const result = buildTree(items);
    expect(result.roots).toHaveLength(1);
    expect(result.roots[0].item.id).toBe("a");
  });
});

// ---------------------------------------------------------------------------
// pruneTreeToDepth
// ---------------------------------------------------------------------------
describe("pruneTreeToDepth", () => {
  it("prunes tree to specified depth", () => {
    const items: MatrixItem[] = [
      { id: "r", name: "Root", parent_id: null },
      { id: "c", name: "Child", parent_id: "r" },
      { id: "gc", name: "Grandchild", parent_id: "c" },
    ];
    const { roots } = buildTree(items);
    const pruned = pruneTreeToDepth(roots, 1);

    // At depth 1, "Child" becomes a virtual leaf
    expect(pruned[0].children).toHaveLength(1);
    const child = pruned[0].children[0];
    expect(child.children).toHaveLength(0);
    expect(child.isPrunedGroup).toBe(true);
    expect(child.leafDescendants).toContain("gc");
  });

  it("does not mark leaf nodes as pruned", () => {
    const items: MatrixItem[] = [
      { id: "a", name: "A", parent_id: null },
    ];
    const { roots } = buildTree(items);
    const pruned = pruneTreeToDepth(roots, 0);
    expect(pruned[0].isPrunedGroup).toBe(false);
  });

  it("preserves tree at depth greater than maxDepth", () => {
    const items: MatrixItem[] = [
      { id: "r", name: "Root", parent_id: null },
      { id: "c", name: "Child", parent_id: "r" },
    ];
    const { roots } = buildTree(items);
    const pruned = pruneTreeToDepth(roots, 10);
    expect(pruned[0].children).toHaveLength(1);
    expect(pruned[0].children[0].isPrunedGroup).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// getLeafOrder
// ---------------------------------------------------------------------------
describe("getLeafOrder", () => {
  it("returns IDs of leaf nodes in tree order", () => {
    const items: MatrixItem[] = [
      { id: "r", name: "Root", parent_id: null },
      { id: "c1", name: "A", parent_id: "r" },
      { id: "c2", name: "B", parent_id: "r" },
    ];
    const { roots } = buildTree(items);
    const order = getLeafOrder(roots);
    expect(order).toEqual(["c1", "c2"]);
  });

  it("returns empty for empty tree", () => {
    expect(getLeafOrder([])).toEqual([]);
  });

  it("returns all IDs for flat list", () => {
    const items: MatrixItem[] = [
      { id: "b", name: "Beta", parent_id: null },
      { id: "a", name: "Alpha", parent_id: null },
    ];
    const { roots } = buildTree(items);
    const order = getLeafOrder(roots);
    // Sorted alphabetically
    expect(order).toEqual(["a", "b"]);
  });
});

// ---------------------------------------------------------------------------
// getLeafNodes
// ---------------------------------------------------------------------------
describe("getLeafNodes", () => {
  it("returns leaf TreeNodes", () => {
    const items: MatrixItem[] = [
      { id: "r", name: "Root", parent_id: null },
      { id: "c", name: "Child", parent_id: "r" },
    ];
    const { roots } = buildTree(items);
    const leaves = getLeafNodes(roots);
    expect(leaves).toHaveLength(1);
    expect(leaves[0].item.id).toBe("c");
  });
});

// ---------------------------------------------------------------------------
// buildColumnHeaderRows
// ---------------------------------------------------------------------------
describe("buildColumnHeaderRows", () => {
  it("returns single row for flat items (maxDepth=0)", () => {
    const items: MatrixItem[] = [
      { id: "a", name: "A", parent_id: null },
      { id: "b", name: "B", parent_id: null },
    ];
    const { roots, maxDepth } = buildTree(items);
    const rows = buildColumnHeaderRows(roots, maxDepth);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toHaveLength(2);
    expect(rows[0][0].isLeaf).toBe(true);
    expect(rows[0][0].colspan).toBe(1);
    expect(rows[0][0].rowspan).toBe(1);
  });

  it("returns multi-row headers for hierarchy", () => {
    const items: MatrixItem[] = [
      { id: "r", name: "Root", parent_id: null },
      { id: "c1", name: "A", parent_id: "r" },
      { id: "c2", name: "B", parent_id: "r" },
    ];
    const { roots, maxDepth } = buildTree(items);
    const rows = buildColumnHeaderRows(roots, maxDepth);
    expect(rows).toHaveLength(2); // depth 0 + depth 1
    // Row 0: Root spans 2 columns
    expect(rows[0][0].colspan).toBe(2);
    expect(rows[0][0].rowspan).toBe(1);
    // Row 1: two leaves
    expect(rows[1]).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// buildRowHeaderLayout
// ---------------------------------------------------------------------------
describe("buildRowHeaderLayout", () => {
  it("returns single column for flat items", () => {
    const items: MatrixItem[] = [
      { id: "a", name: "A", parent_id: null },
      { id: "b", name: "B", parent_id: null },
    ];
    const { roots, maxDepth } = buildTree(items);
    const layout = buildRowHeaderLayout(roots, maxDepth);
    expect(layout).toHaveLength(2);
    expect(layout[0][0]?.node.item.id).toBe("a");
  });

  it("returns multi-column headers for hierarchy", () => {
    const items: MatrixItem[] = [
      { id: "r", name: "Root", parent_id: null },
      { id: "c1", name: "A", parent_id: "r" },
      { id: "c2", name: "B", parent_id: "r" },
    ];
    const { roots, maxDepth } = buildTree(items);
    const layout = buildRowHeaderLayout(roots, maxDepth);
    // 2 leaf rows
    expect(layout).toHaveLength(2);
    // First row has Root cell spanning 2 rows
    expect(layout[0][0]?.rowspan).toBe(2);
    // Second row has null for column 0 (spanned)
    expect(layout[1][0]).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// aggregateCount
// ---------------------------------------------------------------------------
describe("aggregateCount", () => {
  it("sums intersections for given row and col leaf IDs", () => {
    const map = new Map<string, string[]>();
    map.set("r1:c1", ["x", "y"]);
    map.set("r1:c2", ["z"]);
    map.set("r2:c1", ["w"]);

    expect(aggregateCount(["r1"], ["c1"], map)).toBe(2);
    expect(aggregateCount(["r1"], ["c1", "c2"], map)).toBe(3);
    expect(aggregateCount(["r1", "r2"], ["c1"], map)).toBe(3);
  });

  it("returns 0 for no intersections", () => {
    const map = new Map<string, string[]>();
    expect(aggregateCount(["r1"], ["c1"], map)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// getEffectiveLeafIds
// ---------------------------------------------------------------------------
describe("getEffectiveLeafIds", () => {
  it("returns own ID for leaf node", () => {
    const items: MatrixItem[] = [
      { id: "a", name: "A", parent_id: null },
    ];
    const { roots } = buildTree(items);
    expect(getEffectiveLeafIds(roots[0])).toEqual(["a"]);
  });

  it("returns all descendants for pruned group", () => {
    const items: MatrixItem[] = [
      { id: "r", name: "Root", parent_id: null },
      { id: "c1", name: "A", parent_id: "r" },
      { id: "c2", name: "B", parent_id: "r" },
    ];
    const { roots } = buildTree(items);
    const pruned = pruneTreeToDepth(roots, 0);
    // Root is pruned with descendants
    const ids = getEffectiveLeafIds(pruned[0]);
    expect(ids).toContain("c1");
    expect(ids).toContain("c2");
  });
});

// ---------------------------------------------------------------------------
// buildAllNodesMap
// ---------------------------------------------------------------------------
describe("buildAllNodesMap", () => {
  it("collects all nodes into a map", () => {
    const items: MatrixItem[] = [
      { id: "r", name: "Root", parent_id: null },
      { id: "c", name: "Child", parent_id: "r" },
    ];
    const { roots } = buildTree(items);
    const map = buildAllNodesMap(roots);
    expect(map.size).toBe(2);
    expect(map.has("r")).toBe(true);
    expect(map.has("c")).toBe(true);
  });
});
