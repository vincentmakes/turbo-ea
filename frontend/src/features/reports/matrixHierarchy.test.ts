import { describe, it, expect } from "vitest";
import {
  buildTree,
  pruneTreeToDepth,
  getLeafOrder,
  getLeafNodes,
  buildColumnHeaderRows,
  buildRowHeaderLayout,
  getEffectiveLeafIds,
  buildAllNodesMap,
  filterRelatedSubtrees,
  addSelfNodes,
  cardIdOf,
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

  it("mixed flat + hierarchical roots: every leaf row covers exactly numRowHeaderCols columns", () => {
    // Regression guard for the Matrix hierarchical-row misalignment: when a flat
    // root (no children) and a parent-with-children coexist, each rendered <tr>
    // must occupy the same number of table columns as the header grid, otherwise
    // the nested rows' data cells drift out of alignment.
    const items: MatrixItem[] = [
      { id: "flat", name: "Alpha App", parent_id: null },
      { id: "p", name: "Parent", parent_id: null },
      { id: "c1", name: "Child One", parent_id: "p" },
      { id: "c2", name: "Child Two", parent_id: "p" },
    ];
    const { roots, maxDepth } = buildTree(items);
    const layout = buildRowHeaderLayout(roots, maxDepth);
    const numRowHeaderCols = layout[0].length;

    expect(maxDepth).toBe(1);
    expect(numRowHeaderCols).toBe(2);
    // Leaves in DFS order: Alpha App, Child One, Child Two
    expect(layout).toHaveLength(3);
    // Every layout row has exactly numRowHeaderCols slots
    expect(layout.every((row) => row.length === numRowHeaderCols)).toBe(true);

    // Row 0 (flat leaf): shallow leaf at col0, col1 null (it will colSpan to fill)
    expect(layout[0][0]?.node.item.id).toBe("flat");
    expect(layout[0][0]?.isLeaf).toBe(true);
    expect(layout[0][1]).toBeNull();

    // Row 1 (first child): parent group at col0 (rowspan 2), child at col1
    expect(layout[1][0]?.node.item.id).toBe("p");
    expect(layout[1][0]?.isLeaf).toBe(false);
    expect(layout[1][0]?.rowspan).toBe(2);
    expect(layout[1][1]?.node.item.id).toBe("c1");
    expect(layout[1][1]?.isLeaf).toBe(true);

    // Row 2 (second child): col0 covered by the parent's rowspan, child at col1
    expect(layout[2][0]).toBeNull();
    expect(layout[2][1]?.node.item.id).toBe("c2");

    // Column-coverage invariant: simulate the rendered occupancy grid using the
    // exact rowSpan (from layout) and colSpan (shallow-leaf rule from MatrixReport)
    // and assert every slot of every row is covered — no gap that would shift a
    // nested row's data cells out of the column grid.
    const occupied: boolean[][] = layout.map(() => Array(numRowHeaderCols).fill(false));
    layout.forEach((row, rowIdx) => {
      row.forEach((cell, colIdx) => {
        if (!cell) return;
        const isShallowLeaf = cell.isLeaf && colIdx < numRowHeaderCols - 1;
        const colSpan = isShallowLeaf ? numRowHeaderCols - colIdx : 1;
        for (let r = 0; r < cell.rowspan; r++) {
          for (let c = 0; c < colSpan; c++) {
            occupied[rowIdx + r][colIdx + c] = true;
          }
        }
      });
    });
    occupied.forEach((row) => expect(row.every(Boolean)).toBe(true));
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

  it("includes the collapsed group's own id", () => {
    // A card can carry relations of its own. Returning only its descendants
    // meant those relations had no cell to land in and were dropped.
    const items: MatrixItem[] = [
      { id: "r", name: "Root", parent_id: null },
      { id: "c1", name: "A", parent_id: "r" },
    ];
    const pruned = pruneTreeToDepth(buildTree(items).roots, 0);
    expect(getEffectiveLeafIds(pruned[0])).toEqual(["r", "c1"]);
  });
});

// ---------------------------------------------------------------------------
// addSelfNodes
// ---------------------------------------------------------------------------
describe("addSelfNodes", () => {
  const family: MatrixItem[] = [
    { id: "p", name: "Parent", parent_id: null },
    { id: "c1", name: "Child One", parent_id: "p" },
    { id: "c2", name: "Child Two", parent_id: "p" },
  ];

  it("gives a parent a leaf of its own", () => {
    const roots = addSelfNodes(buildTree(family).roots, new Set(["p"]));
    const leaves = getLeafNodes(roots);

    expect(leaves.map(cardIdOf)).toEqual(["p", "c1", "c2"]);
    expect(leaves[0].isSelfNode).toBe(true);
    expect(getEffectiveLeafIds(leaves[0])).toEqual(["p"]);
  });

  it("leaves the tree alone when the parent carries nothing of its own", () => {
    const roots = addSelfNodes(buildTree(family).roots, new Set(["c1"]));
    expect(getLeafNodes(roots).map((n) => n.item.id)).toEqual(["c1", "c2"]);
  });

  it("keeps leafCount consistent so the header spans stay correct", () => {
    const roots = addSelfNodes(buildTree(family).roots, new Set(["p"]));
    expect(roots[0].leafCount).toBe(3);
    expect(roots[0].leafDescendants).toEqual(["p", "c1", "c2"]);
    // Its own node key is distinct so it cannot collide with its parent in the
    // header layout, which indexes nodes by `item.id`.
    expect(roots[0].children[0].item.id).not.toBe("p");
    expect(roots[0].children[0].item.parent_id).toBe("p");
  });

  it("sits at the same depth as its siblings, so maxDepth is unchanged", () => {
    const tree = buildTree(family);
    const roots = addSelfNodes(tree.roots, new Set(["p"]));
    expect(roots[0].children[0].depth).toBe(1);
    expect(Math.max(...getLeafNodes(roots).map((n) => n.depth))).toBe(tree.maxDepth);
  });

  it("does nothing to a childless node", () => {
    const roots = addSelfNodes(buildTree([{ id: "a", name: "A", parent_id: null }]).roots, new Set(["a"]));
    expect(roots[0].children).toHaveLength(0);
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

// ---------------------------------------------------------------------------
// filterRelatedSubtrees
// ---------------------------------------------------------------------------
describe("filterRelatedSubtrees", () => {
  it("keeps a related parent whose children are all unrelated", () => {
    // The toggle is meant to keep related cards. Testing only descendants
    // removed a card that is itself related.
    const items: MatrixItem[] = [
      { id: "p", name: "Parent", parent_id: null },
      { id: "c1", name: "Child", parent_id: "p" },
    ];
    const kept = filterRelatedSubtrees(buildTree(items).roots, new Set(["p"]));
    expect(kept).toHaveLength(1);
    expect(kept[0].item.id).toBe("p");
  });

  it("keeps a self node when its parent is related", () => {
    const items: MatrixItem[] = [
      { id: "p", name: "Parent", parent_id: null },
      { id: "c1", name: "Child", parent_id: "p" },
    ];
    const withSelf = addSelfNodes(buildTree(items).roots, new Set(["p"]));
    const kept = filterRelatedSubtrees(withSelf, new Set(["p"]));
    expect(getLeafNodes(kept).map(cardIdOf)).toEqual(["p"]);
  });

  it("drops flat leaves that are not in the related set", () => {
    const items: MatrixItem[] = [
      { id: "a", name: "Alpha", parent_id: null },
      { id: "b", name: "Beta", parent_id: null },
      { id: "c", name: "Gamma", parent_id: null },
    ];
    const { roots } = buildTree(items);
    const filtered = filterRelatedSubtrees(roots, new Set(["a", "c"]));
    expect(filtered.map((n) => n.item.id)).toEqual(["a", "c"]);
  });

  it("keeps a parent when at least one descendant is related", () => {
    const items: MatrixItem[] = [
      { id: "root", name: "Root", parent_id: null },
      { id: "c1", name: "Child A", parent_id: "root" },
      { id: "c2", name: "Child B", parent_id: "root" },
    ];
    const { roots } = buildTree(items);
    const filtered = filterRelatedSubtrees(roots, new Set(["c1"]));
    expect(filtered).toHaveLength(1);
    // Only the related child survives, and leafCount/leafDescendants are recomputed
    expect(filtered[0].item.id).toBe("root");
    expect(filtered[0].children.map((c) => c.item.id)).toEqual(["c1"]);
    expect(filtered[0].leafCount).toBe(1);
    expect(filtered[0].leafDescendants).toEqual(["c1"]);
  });

  it("drops an entire branch when no descendant is related", () => {
    const items: MatrixItem[] = [
      { id: "r1", name: "Root 1", parent_id: null },
      { id: "r1c", name: "R1 Child", parent_id: "r1" },
      { id: "r2", name: "Root 2", parent_id: null },
      { id: "r2c", name: "R2 Child", parent_id: "r2" },
    ];
    const { roots } = buildTree(items);
    const filtered = filterRelatedSubtrees(roots, new Set(["r2c"]));
    expect(filtered.map((n) => n.item.id)).toEqual(["r2"]);
  });

  it("keeps a pruned group leaf if any aggregated card is related", () => {
    const items: MatrixItem[] = [
      { id: "root", name: "Root", parent_id: null },
      { id: "c1", name: "Child A", parent_id: "root" },
      { id: "c2", name: "Child B", parent_id: "root" },
    ];
    const { roots } = buildTree(items);
    // Prune to depth 0 so the root becomes a group leaf aggregating c1 + c2
    const pruned = pruneTreeToDepth(roots, 0);
    expect(pruned[0].isPrunedGroup).toBe(true);
    // Related set only contains a child hidden inside the group
    const filtered = filterRelatedSubtrees(pruned, new Set(["c2"]));
    expect(filtered).toHaveLength(1);
    expect(filtered[0].isPrunedGroup).toBe(true);
  });

  it("returns an empty array when nothing is related", () => {
    const items: MatrixItem[] = [
      { id: "a", name: "Alpha", parent_id: null },
      { id: "b", name: "Beta", parent_id: null },
    ];
    const { roots } = buildTree(items);
    expect(filterRelatedSubtrees(roots, new Set())).toEqual([]);
  });
});
