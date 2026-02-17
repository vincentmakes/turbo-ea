/**
 * Tree-building utilities and header layout computation for the Matrix report.
 * Keeps MatrixReport.tsx focused on rendering while this module handles
 * all hierarchy tree operations, pruning, and merged-cell layout.
 */

export interface MatrixItem {
  id: string;
  name: string;
  parent_id: string | null;
}

export interface TreeNode {
  item: MatrixItem;
  children: TreeNode[];
  depth: number;
  leafCount: number;
  leafDescendants: string[];
  isPrunedGroup: boolean;
  originalLeafCount: number;
}

export interface ColumnHeaderCell {
  node: TreeNode;
  colspan: number;
  rowspan: number;
  isLeaf: boolean;
  isPrunedGroup: boolean;
}

export interface RowHeaderCell {
  node: TreeNode;
  rowspan: number;
  isLeaf: boolean;
  isPrunedGroup: boolean;
}

export interface TreeResult {
  roots: TreeNode[];
  maxDepth: number;
  allNodes: Map<string, TreeNode>;
}

// ---------------------------------------------------------------------------
// buildTree – construct an ordered tree from flat items
// ---------------------------------------------------------------------------

export function buildTree(items: MatrixItem[]): TreeResult {
  if (items.length === 0) {
    return { roots: [], maxDepth: 0, allNodes: new Map() };
  }

  const byId = new Map<string, MatrixItem>(items.map((i) => [i.id, i]));
  const nodeMap = new Map<string, TreeNode>();

  // Create TreeNode shells
  for (const item of items) {
    nodeMap.set(item.id, {
      item,
      children: [],
      depth: 0,
      leafCount: 0,
      leafDescendants: [],
      isPrunedGroup: false,
      originalLeafCount: 0,
    });
  }

  // Link children to parents; collect roots
  const roots: TreeNode[] = [];
  for (const item of items) {
    const node = nodeMap.get(item.id)!;
    const pid = item.parent_id && byId.has(item.parent_id) ? item.parent_id : null;
    if (pid) {
      nodeMap.get(pid)!.children.push(node);
    } else {
      roots.push(node);
    }
  }

  // Sort children alphabetically at each level
  const sortChildren = (node: TreeNode) => {
    node.children.sort((a, b) => a.item.name.localeCompare(b.item.name));
    for (const child of node.children) sortChildren(child);
  };
  for (const root of roots) sortChildren(root);
  roots.sort((a, b) => a.item.name.localeCompare(b.item.name));

  // DFS to compute depth, leafCount, leafDescendants
  let maxDepth = 0;
  const computeMetrics = (node: TreeNode, depth: number) => {
    node.depth = depth;
    if (depth > maxDepth) maxDepth = depth;

    if (node.children.length === 0) {
      node.leafCount = 1;
      node.leafDescendants = [node.item.id];
      node.originalLeafCount = 1;
    } else {
      node.leafCount = 0;
      node.leafDescendants = [];
      for (const child of node.children) {
        computeMetrics(child, depth + 1);
        node.leafCount += child.leafCount;
        node.leafDescendants.push(...child.leafDescendants);
      }
      node.originalLeafCount = node.leafCount;
    }
  };

  for (const root of roots) computeMetrics(root, 0);

  return { roots, maxDepth, allNodes: nodeMap };
}

// ---------------------------------------------------------------------------
// pruneTreeToDepth – create a depth-limited copy of the tree
// ---------------------------------------------------------------------------

export function pruneTreeToDepth(roots: TreeNode[], visibleDepth: number): TreeNode[] {
  const clone = (node: TreeNode): TreeNode => {
    if (node.depth >= visibleDepth) {
      // This node becomes a virtual leaf
      return {
        item: node.item,
        children: [],
        depth: node.depth,
        leafCount: 1,
        leafDescendants: [...node.leafDescendants],
        isPrunedGroup: node.children.length > 0, // only mark as pruned if it actually had children
        originalLeafCount: node.originalLeafCount,
      };
    }
    const clonedChildren = node.children.map(clone);
    const leafCount = clonedChildren.reduce((sum, c) => sum + c.leafCount, 0) || 1;
    const leafDescendants = clonedChildren.length > 0
      ? clonedChildren.flatMap((c) => c.leafDescendants)
      : [node.item.id];
    return {
      item: node.item,
      children: clonedChildren,
      depth: node.depth,
      leafCount,
      leafDescendants,
      isPrunedGroup: false,
      originalLeafCount: node.originalLeafCount,
    };
  };

  return roots.map(clone);
}

// ---------------------------------------------------------------------------
// getLeafOrder – ordered leaf IDs from the tree (replaces hierarchySort)
// ---------------------------------------------------------------------------

export function getLeafOrder(roots: TreeNode[]): string[] {
  const result: string[] = [];
  const walk = (node: TreeNode) => {
    if (node.children.length === 0) {
      result.push(node.item.id);
    } else {
      for (const child of node.children) walk(child);
    }
  };
  for (const root of roots) walk(root);
  return result;
}

// ---------------------------------------------------------------------------
// getLeafNodes – ordered leaf TreeNodes from the tree
// ---------------------------------------------------------------------------

export function getLeafNodes(roots: TreeNode[]): TreeNode[] {
  const result: TreeNode[] = [];
  const walk = (node: TreeNode) => {
    if (node.children.length === 0) {
      result.push(node);
    } else {
      for (const child of node.children) walk(child);
    }
  };
  for (const root of roots) walk(root);
  return result;
}

// ---------------------------------------------------------------------------
// buildColumnHeaderRows – compute multi-row <thead> layout
// ---------------------------------------------------------------------------

export function buildColumnHeaderRows(
  roots: TreeNode[],
  maxDepth: number,
): ColumnHeaderCell[][] {
  if (maxDepth === 0) {
    // Flat: single header row with all roots as leaves
    return [
      roots.map((node) => ({
        node,
        colspan: 1,
        rowspan: 1,
        isLeaf: true,
        isPrunedGroup: node.isPrunedGroup,
      })),
    ];
  }

  const totalRows = maxDepth + 1; // levels 0..maxDepth
  const rows: ColumnHeaderCell[][] = Array.from({ length: totalRows }, () => []);

  // Walk the tree and place each node into the correct header row
  const placeNode = (node: TreeNode) => {
    const level = node.depth;

    if (node.children.length === 0) {
      // Leaf or pruned: it goes in its own depth row and spans down to the bottom
      const rowspan = totalRows - level;
      rows[level].push({
        node,
        colspan: 1,
        rowspan,
        isLeaf: true,
        isPrunedGroup: node.isPrunedGroup,
      });
    } else {
      // Group node: spans its leafCount columns, sits in one row
      rows[level].push({
        node,
        colspan: node.leafCount,
        rowspan: 1,
        isLeaf: false,
        isPrunedGroup: false,
      });
      for (const child of node.children) placeNode(child);
    }
  };

  for (const root of roots) placeNode(root);

  return rows;
}

// ---------------------------------------------------------------------------
// buildRowHeaderLayout – compute multi-column row header cells
// ---------------------------------------------------------------------------

export function buildRowHeaderLayout(
  roots: TreeNode[],
  maxDepth: number,
): (RowHeaderCell | null)[][] {
  const leaves = getLeafNodes(roots);
  const totalCols = maxDepth + 1; // levels 0..maxDepth

  if (maxDepth === 0) {
    // Flat: single header column
    return leaves.map((leaf) => [
      {
        node: leaf,
        rowspan: 1,
        isLeaf: true,
        isPrunedGroup: leaf.isPrunedGroup,
      },
    ]);
  }

  // Build the result: one row per leaf, each row has totalCols entries
  const result: (RowHeaderCell | null)[][] = leaves.map(() =>
    Array.from({ length: totalCols }, () => null),
  );

  // For each column level, track which group node has been "opened"
  // and which row index it was placed at.
  // We walk through all leaves in order and figure out group boundaries.

  // First, build ancestors for each leaf
  const allNodes = new Map<string, TreeNode>();
  const collectNodes = (node: TreeNode) => {
    allNodes.set(node.item.id, node);
    for (const child of node.children) collectNodes(child);
  };
  for (const root of roots) collectNodes(root);

  const getAncestorChain = (node: TreeNode): TreeNode[] => {
    // Returns [root, ..., parent, node] — ancestors from depth 0 to node's depth
    const chain: TreeNode[] = [];
    let current: TreeNode | undefined = node;
    while (current) {
      chain.unshift(current);
      const pid: string | null = current.item.parent_id;
      current = pid ? allNodes.get(pid) : undefined;
    }
    return chain;
  };

  // Track which group nodes have already had their header cell emitted
  // Key: `${colLevel}:${nodeId}`, Value: row index where it was placed
  const emitted = new Set<string>();

  for (let rowIdx = 0; rowIdx < leaves.length; rowIdx++) {
    const leaf = leaves[rowIdx];
    const ancestors = getAncestorChain(leaf);

    for (let colLevel = 0; colLevel < totalCols; colLevel++) {
      const ancestorAtLevel = ancestors[colLevel];

      if (!ancestorAtLevel) {
        // This leaf's chain doesn't reach this deep — already handled by a rowspan above
        continue;
      }

      const emitKey = `${colLevel}:${ancestorAtLevel.item.id}`;
      if (emitted.has(emitKey)) {
        // Already emitted by a previous leaf row — this cell is covered by rowspan
        result[rowIdx][colLevel] = null;
        continue;
      }

      emitted.add(emitKey);

      // Calculate rowspan: how many leaves does this node span?
      const isLeafNode = ancestorAtLevel.children.length === 0;
      const spanCount = isLeafNode ? 1 : ancestorAtLevel.leafCount;

      // If this node is a leaf at a level shallower than maxDepth,
      // it should span across remaining columns too. We handle this
      // by filling the remaining columns with null for this row.
      if (isLeafNode && colLevel < maxDepth) {
        // This leaf appears at colLevel and spans remaining columns
        result[rowIdx][colLevel] = {
          node: ancestorAtLevel,
          rowspan: spanCount,
          isLeaf: true,
          isPrunedGroup: ancestorAtLevel.isPrunedGroup,
        };
        // Mark remaining columns for this row/group as emitted (null)
        for (let c = colLevel + 1; c < totalCols; c++) {
          // We don't set anything — null is the default
          // But we mark as emitted so we don't try to place anything there
          emitted.add(`${c}:${ancestorAtLevel.item.id}`);
        }
        break; // Done with this row's headers — the leaf spans remaining cols
      }

      result[rowIdx][colLevel] = {
        node: ancestorAtLevel,
        rowspan: spanCount,
        isLeaf: isLeafNode,
        isPrunedGroup: ancestorAtLevel.isPrunedGroup,
      };
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// aggregateCount – sum intersections for a (possibly pruned) node pair
// ---------------------------------------------------------------------------

export function aggregateCount(
  rowLeafIds: string[],
  colLeafIds: string[],
  intersectionMap: Map<string, string[]>,
): number {
  let count = 0;
  for (const rId of rowLeafIds) {
    for (const cId of colLeafIds) {
      const k = `${rId}:${cId}`;
      count += intersectionMap.get(k)?.length || 0;
    }
  }
  return count;
}

// ---------------------------------------------------------------------------
// getEffectiveLeafIds – get leaf IDs for a node (handles pruned groups)
// ---------------------------------------------------------------------------

export function getEffectiveLeafIds(node: TreeNode): string[] {
  if (node.isPrunedGroup) {
    return node.leafDescendants;
  }
  return node.children.length === 0 ? [node.item.id] : node.leafDescendants;
}

// ---------------------------------------------------------------------------
// buildAllNodesMap – collect all nodes from pruned tree into a map
// ---------------------------------------------------------------------------

export function buildAllNodesMap(roots: TreeNode[]): Map<string, TreeNode> {
  const map = new Map<string, TreeNode>();
  const walk = (node: TreeNode) => {
    map.set(node.item.id, node);
    for (const child of node.children) walk(child);
  };
  for (const root of roots) walk(root);
  return map;
}
