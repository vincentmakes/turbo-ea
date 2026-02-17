# Matrix Report – Hierarchical Grouped Headers Implementation Plan

## Goal

Replace the current flat row/column headers in `MatrixReport.tsx` with **hierarchical multi-level grouped headers** that use merged cells (`rowspan`/`colspan`) to aggregate by hierarchy level, with expand/collapse capability — similar to how Excel pivot tables or enterprise architecture tools (LeanIX, Ardoq) display cross-reference matrices.

---

## Current State

**File:** `frontend/src/features/reports/MatrixReport.tsx` (~536 lines)
**Backend:** `backend/app/api/v1/reports.py` → `GET /reports/matrix`

### What exists today

- A flat `<table>` with one `<thead>` row for column headers (vertical text) and one `<td>` per row for row headers
- Hierarchy is shown via indentation (`paddingLeft + depth * 16`) and a `└` prefix character
- `hierarchySort()` flattens the tree into parent → children order
- The backend returns `{ rows: MatrixItem[], columns: MatrixItem[], intersections: [...] }` where each item has `{ id, name, parent_id }` — unlimited depth self-referencing hierarchy
- Sort mode "hierarchy" exists but only controls ordering, not visual grouping

### Problems with current approach

1. No merged cells — parent items look the same as leaf items, just bold
2. No expand/collapse — large hierarchies clutter the view
3. Column headers use vertical text with indentation hacks (`paddingTop + colDepth * 14`) instead of proper multi-row grouped headers
4. No aggregation — parent rows/columns don't show rolled-up intersection counts

---

## Target UX

### Visual Design Reference

Think: **Pivot table multi-level headers** or **Handsontable nested headers**.

#### Column headers (top) — multiple `<thead>` rows:

```
┌──────────────────────────────────────────────────────────────┐
│ (corner)  │   Business Capability A (colspan=3)  │  BC B (2) │  ← Level 0 (roots)
│           │   Sub-A1 (2)    │  Sub-A2 (1)        │  ...      │  ← Level 1
│           │ Leaf1 │ Leaf2   │  Leaf3             │  ...      │  ← Level 2 (leaves)
├───────────┼───────┼─────────┼────────────────────┼───────────┤
│ App X     │  ●    │         │   ●                │     ●     │
│ App Y     │       │  ●      │                    │           │
```

- Top-most row: root-level groups, spanning all their descendants
- Each subsequent row: next hierarchy level, spanning their descendants
- Bottom-most header row: leaf items (no colspan)
- Depth control in toolbar: `−` / `+` buttons (or level selector) to hide/show entire header rows at once
- When a level is collapsed, its items become the new "leaves" showing aggregated counts

#### Row headers (left) — multiple `<td>` columns using `rowspan`:

```
┌─────────────────────┬─────────────┬───────┬───┐
│ Domain A (rowspan=3) │  System X   │ App 1 │ … │  ← Level 0 spans rows
│                      │             │ App 2 │ … │
│                      │  System Y   │ App 3 │ … │
├─────────────────────┼─────────────┼───────┼───┤
│ Domain B (rowspan=2) │  System Z   │ App 4 │ … │
│                      │             │ App 5 │ … │
```

- Left-most column: root-level groups, using `rowspan` to span all descendants
- Each subsequent column: next hierarchy level
- Right-most header column: leaf items
- Same depth control applies: collapsing a row level removes one header column and merges items
- Expand/Collapse toggles in toolbar control the visible depth for each axis independently

### When hierarchy is flat (no parent_id)

Fall back to the existing single-row / single-column header behavior. The feature should be purely additive — no regressions when data has no hierarchy.

---

## Implementation Plan

### Phase 1: Data Structure Utilities (new file)

**Create:** `frontend/src/features/reports/matrixHierarchy.ts`

This module handles all tree-building and layout computation, keeping `MatrixReport.tsx` focused on rendering.

```typescript
export interface MatrixItem {
  id: string;
  name: string;
  parent_id: string | null;
}

export interface TreeNode {
  item: MatrixItem;
  children: TreeNode[];
  depth: number;          // 0 = root
  leafCount: number;      // total leaf descendants (for colspan/rowspan)
  leafDescendants: string[]; // IDs of all original leaf items under this node
  isPrunedGroup: boolean; // true if this node was turned into a virtual leaf by depth pruning
  originalLeafCount: number; // original leaf count before pruning (for badge display)
}

/**
 * Build ordered tree from flat items.
 * Returns { roots: TreeNode[], maxDepth: number, allNodes: Map<string, TreeNode> }
 */
export function buildTree(items: MatrixItem[]): {
  roots: TreeNode[];
  maxDepth: number;
  allNodes: Map<string, TreeNode>;
};

/**
 * Compute header layout for COLUMNS (horizontal merged cells).
 * Returns an array of header rows, where each row is an array of cells:
 *   { node: TreeNode, colspan: number, rowspan: number, isLeaf: boolean, isPrunedGroup: boolean }
 * 
 * Level 0 row = roots with colspan = their leafCount
 * Level 1 row = depth-1 nodes, etc.
 * Last row = leaf/pruned nodes (colspan = 1)
 * 
 * Nodes whose depth < current level row get omitted (they already span from above).
 * Nodes that are true leaves at a depth shallower than maxDepth get rowspan to fill down.
 */
export function buildColumnHeaderRows(roots: TreeNode[], maxDepth: number): ColumnHeaderCell[][];

/**
 * Compute header layout for ROWS (vertical merged cells).
 * Returns a flat list of body rows, where each row contains header cells:
 *   { node: TreeNode, rowspan: number, isLeaf: boolean, isPrunedGroup: boolean } | null
 * 
 * Only the first row of a group contains the header cell (with rowspan).
 * Subsequent rows in the group have null for that column level.
 */
export function buildRowHeaderLayout(roots: TreeNode[], maxDepth: number): (RowHeaderCell | null)[][];

/**
 * Get ordered leaf IDs from the tree (the actual columns/rows of the matrix body).
 * This replaces the current `hierarchySort` for determining cell order.
 */
export function getLeafOrder(roots: TreeNode[]): string[];

/**
 * Aggregate intersection counts: for a group node, sum all intersections
 * of its leaf descendants with a given set of target leaf IDs.
 */
export function aggregateCount(
  node: TreeNode,
  targetLeafIds: string[],
  intersectionMap: Map<string, number>
): number;

/**
 * Prune tree so that nodes at exactly `visibleDepth` become virtual leaves.
 * Returns new root array (deep-cloned, does not mutate originals).
 * Pruned nodes get: children=[], leafCount=1, isPrunedGroup=true,
 * but keep their original leafDescendants for aggregation.
 */
export function pruneTreeToDepth(roots: TreeNode[], visibleDepth: number): TreeNode[];
```

#### Key algorithm notes

**`buildTree`:**
1. Create a `Map<id, TreeNode>` from all items
2. Link children to parents, collect orphans as roots
3. DFS to compute `depth`, `leafCount`, and `leafDescendants` recursively
4. Sort children alphabetically at each level
5. `leafCount` for a leaf = 1; for a parent = sum of children's leafCounts

**`buildColumnHeaderRows`:**
1. BFS level-by-level from depth 0 to maxDepth
2. At each level, iterate left-to-right through nodes at that depth
3. For nodes at exactly this depth: emit a cell with `colspan = leafCount`
4. For nodes deeper than this level: skip (they'll appear in a later row)
5. For leaf nodes at a depth shallower than maxDepth: emit with `rowspan` spanning down to the leaf row (these are items with no children at a mid-level)

**`buildRowHeaderLayout`:**
1. Flatten tree in DFS order (same as current `hierarchySort`)
2. Walk through leaves; for each leaf, determine which ancestor group cells need to be emitted
3. Track which groups have already been "opened" — only emit a header cell with `rowspan` on the first leaf row of each group

### Phase 2: Level-Based Expand/Collapse State

The expand/collapse operates on **entire hierarchy levels**, not individual nodes. Think of it as a depth control: "show down to Level 0 only" → "show Level 0 + 1" → "show all levels". All groups at the same depth expand or collapse together.

**In `MatrixReport.tsx`, add state:**

```typescript
// The deepest visible level for each axis.
// 0 = only roots visible (all children collapsed into aggregated cells)
// maxDepth = fully expanded (all leaves visible)
// Initialized to maxDepth (fully expanded) on load.
const [rowExpandedDepth, setRowExpandedDepth] = useState<number>(Infinity);
const [colExpandedDepth, setColExpandedDepth] = useState<number>(Infinity);

// After tree is built, clamp to actual maxDepth:
const effectiveRowDepth = Math.min(rowExpandedDepth, rowTree.maxDepth);
const effectiveColDepth = Math.min(colExpandedDepth, colTree.maxDepth);
```

**Depth control logic:**

```typescript
// Expand one more level (show next level of children)
function expandOneLevel(current: number, max: number, setter: (n: number) => void) {
  if (current < max) setter(current + 1);
}

// Collapse one level (hide the deepest currently visible level)
function collapseOneLevel(current: number, setter: (n: number) => void) {
  if (current > 0) setter(current - 1);
}
```

**Impact on tree computation:**

- Add a `pruneTreeToDepth(roots, visibleDepth)` function to `matrixHierarchy.ts`
- Any node at `depth === visibleDepth` becomes a virtual leaf: its `children` are cleared, `leafCount` set to 1, but it retains its `leafDescendants` array (for aggregation)
- Nodes deeper than `visibleDepth` are completely removed from the layout
- The header rows produced by `buildColumnHeaderRows` / `buildRowHeaderLayout` will only go as deep as `visibleDepth`

```typescript
/**
 * Prune tree so that nodes at exactly `visibleDepth` become virtual leaves.
 * Returns new root array (deep-cloned, does not mutate originals).
 * Nodes at visibleDepth keep their leafDescendants for aggregation
 * but have children=[] and leafCount=1 for layout purposes.
 */
export function pruneTreeToDepth(roots: TreeNode[], visibleDepth: number): TreeNode[];
```

### Phase 3: Render Column Headers (multi-row `<thead>`)

**Replace the current single `<tr>` in `<thead>` with multiple rows.**

**Architecture:**

```tsx
<thead>
  {columnHeaderRows.map((row, levelIdx) => (
    <tr key={levelIdx}>
      {/* Corner cell: only on first row, spans all header rows + all row header columns */}
      {levelIdx === 0 && (
        <th
          rowSpan={effectiveColDepth + 1}
          colSpan={effectiveRowDepth + 1}
          style={{ /* sticky left+top, z-index: 4 */ }}
        >
          {rowLabel} / {colLabel}
        </th>
      )}
      {row.map(cell => (
        <th
          key={cell.node.item.id}
          colSpan={cell.colspan}
          rowSpan={cell.rowspan || 1}  // for mid-level leaves that span to bottom
          style={{
            position: 'sticky',
            top: levelIdx * ROW_HEIGHT,  // each header row sticks at different offset
            zIndex: 2,
            background: LEVEL_COLORS[levelIdx] || '#f5f5f5',
            fontWeight: cell.isLeaf ? 600 : 700,
            fontSize: cell.isLeaf ? 10 : 11,
            writingMode: cell.isLeaf ? 'vertical-lr' : 'initial', // vertical only for leaves
            textOrientation: cell.isLeaf ? 'mixed' : 'initial',
            textAlign: 'center',
            // ... other styling
          }}
        >
          {cell.node.item.name}
          {/* Show child count badge on virtual leaves (pruned groups) */}
          {cell.isPrunedGroup && (
            <span style={{ /* small count badge */ }}>
              ({cell.node.originalLeafCount})
            </span>
          )}
        </th>
      ))}
      {/* Σ column: only on first row, spans all header rows */}
      {levelIdx === 0 && (
        <th rowSpan={effectiveColDepth + 1}>Σ</th>
      )}
    </tr>
  ))}
</thead>
```

**Sticky positioning for multi-row headers:**

Each header row needs `position: sticky` with an increasing `top` value:
- Row 0: `top: 0`
- Row 1: `top: 32px` (or whatever the row height is)
- Row 2: `top: 64px`

Use a constant `HEADER_ROW_HEIGHT = 32` and compute `top: levelIdx * HEADER_ROW_HEIGHT`.

**Column header text orientation:**

- Group header cells (non-leaf, with colspan > 1): **horizontal text**, centered
- Leaf header cells: **vertical text** (`writingMode: 'vertical-lr'`) as current, to save horizontal space
- Alternative: all horizontal if there's room, but vertical is better for space efficiency with many columns

### Phase 4: Render Row Headers (multi-column with `rowspan`)

**Replace the current single `<td>` row header with multiple `<td>` columns.**

**Architecture for each body `<tr>`:**

```tsx
{sortedLeafRows.map((leafRow, rowIdx) => (
  <tr key={leafRow.id}>
    {/* Row header cells — one per visible hierarchy level */}
    {rowHeaderLayout[rowIdx].map((cell, colIdx) => {
      if (cell === null) return null; // This cell is covered by a rowspan above
      return (
        <td
          key={`rh-${colIdx}-${cell.node.item.id}`}
          rowSpan={cell.rowspan}
          style={{
            position: 'sticky',
            left: colIdx * ROW_HEADER_COL_WIDTH, // each level sticks at increasing left offset
            zIndex: 1,
            background: LEVEL_COLORS[colIdx] || '#fff',
            borderRight: '1px solid #e0e0e0',
            fontWeight: cell.isLeaf ? 500 : 700,
            fontSize: 12,
            padding: '6px 8px',
            maxWidth: ROW_HEADER_COL_WIDTH,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            cursor: 'pointer',
            verticalAlign: 'top',
          }}
          onClick={() => navigate(`/cards/${cell.node.item.id}`)}
        >
          <Tooltip title={cell.node.item.name}>
            <span>
              {cell.node.item.name}
              {/* Show child count for pruned groups */}
              {cell.isPrunedGroup && (
                <span style={{ opacity: 0.6, fontSize: 10, ml: 4 }}>
                  ({cell.node.originalLeafCount})
                </span>
              )}
            </span>
          </Tooltip>
        </td>
      );
    })}
    {/* Intersection cells — same as current but using leaf order from pruned tree */}
    {sortedLeafCols.map(col => (
      <td key={col.id} /* ... same cell rendering as today ... */ />
    ))}
    {/* Row total */}
    <td>...</td>
  </tr>
))}
```

**Sticky left positioning for multi-column row headers:**

Similar to column headers, each row header column level needs sticky left:
- Level 0: `left: 0`, `width: ROW_HEADER_COL_WIDTH`
- Level 1: `left: ROW_HEADER_COL_WIDTH`
- Level 2: `left: ROW_HEADER_COL_WIDTH * 2`

Use a constant like `ROW_HEADER_COL_WIDTH = 160` (adjustable).

The corner cell in `<thead>` must span all row header columns: `colSpan={maxRowDepth + 1}`.

### Phase 5: Aggregated Intersection Cells for Collapsed Groups

When the visible depth is less than maxDepth, some nodes become virtual leaves (pruned groups). Their single row/column should show **aggregated** counts:

```typescript
function getCellValue(rowId: string, colId: string): number {
  const rowNode = allRowNodes.get(rowId);
  const colNode = allColNodes.get(colId);
  
  // Get effective leaf IDs: if this node was pruned (is a virtual leaf),
  // use its original leafDescendants for aggregation.
  // If it's a true leaf, just use its own ID.
  const rowLeaves = rowNode.isPrunedGroup
    ? rowNode.originalLeafDescendants 
    : [rowId];
  const colLeaves = colNode.isPrunedGroup
    ? colNode.originalLeafDescendants 
    : [colId];
  
  let count = 0;
  for (const rLeaf of rowLeaves) {
    for (const cLeaf of colLeaves) {
      count += intersectionMap.get(`${rLeaf}:${cLeaf}`)?.length || 0;
    }
  }
  return count;
}
```

This way, when rows are at depth 0 (roots only), "ERP Domain" shows the total count of relations across all its child applications. The cell display should automatically switch to count/heatmap mode for pruned groups (since dots don't make sense for aggregated values).

### Phase 6: Styling & Polish

#### Color differentiation by level

```typescript
const LEVEL_COLORS = ['#f5f5f5', '#fafafa', '#fff'];  // darker for higher levels
const LEVEL_BORDER_LEFT = ['3px solid #1976d2', '2px solid #64b5f6', '1px solid #e0e0e0'];
```

- Root-level group cells get a subtle left/top accent border
- Deeper levels get lighter backgrounds
- Leaf cells are white

#### Hover highlighting

Extend the current hover logic to highlight the entire group when hovering a group header:
- Hovering a parent column header → highlight all its descendant columns (within the visible depth)
- Hovering a parent row header → highlight all its descendant rows (within the visible depth)

#### Smooth transitions

```css
/* Add to group cells for expand/collapse animation */
transition: all 0.2s ease-in-out;
```

#### Responsive behavior

- If maxDepth is 0 (flat data), fall back to current single-row/single-column layout; hide depth controls
- If maxDepth > 3, consider initializing `rowExpandedDepth` / `colExpandedDepth` to 1 or 2 instead of Infinity (start partially collapsed for readability)
- Minimum column width for pruned groups: `48px` (enough for count + badge)
- When depth changes, smoothly transition the table layout

### Phase 7: Toolbar Updates

Update the sort dropdown to reflect the new behavior:

- **Remove** the "Hierarchy" sort option (hierarchy is now always the visual grouping when applicable)
- **Add** level-based depth controls to the toolbar:

```tsx
{/* Row depth control — only show when row data has hierarchy */}
{rowHasHierarchy && rowTree.maxDepth > 0 && (
  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
    <Typography variant="caption" sx={{ color: 'text.secondary', mr: 0.5 }}>
      Row depth:
    </Typography>
    <Tooltip title="Collapse row level">
      <span> {/* span wrapper for disabled tooltip */}
        <IconButton
          size="small"
          disabled={effectiveRowDepth <= 0}
          onClick={() => setRowExpandedDepth(prev => Math.max(0, Math.min(prev, rowTree.maxDepth) - 1))}
        >
          <Icon fontSize="small">remove</Icon>
        </IconButton>
      </span>
    </Tooltip>
    <Chip
      size="small"
      label={`${effectiveRowDepth} / ${rowTree.maxDepth}`}
      variant="outlined"
    />
    <Tooltip title="Expand row level">
      <span>
        <IconButton
          size="small"
          disabled={effectiveRowDepth >= rowTree.maxDepth}
          onClick={() => setRowExpandedDepth(prev => Math.min(rowTree.maxDepth, (prev === Infinity ? rowTree.maxDepth : prev) + 1))}
        >
          <Icon fontSize="small">add</Icon>
        </IconButton>
      </span>
    </Tooltip>
  </Box>
)}

{/* Column depth control — same pattern */}
{colHasHierarchy && colTree.maxDepth > 0 && (
  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
    <Typography variant="caption" sx={{ color: 'text.secondary', mr: 0.5 }}>
      Col depth:
    </Typography>
    {/* Same -, chip, + pattern as rows */}
  </Box>
)}
```

**Alternative UI option:** A small slider or segmented button group showing level numbers `[ 0 | 1 | 2 | 3 ]` where clicking a number directly sets that depth — this may be more intuitive than +/- buttons. Either approach works; choose whichever fits the existing toolbar style best.

### Phase 8: Saved Report Config Update

Update the saved report config to include visible depth levels:

```typescript
const getConfig = () => ({
  rowType, colType, cellMode, sortRows, sortCols,
  rowExpandedDepth: effectiveRowDepth,
  colExpandedDepth: effectiveColDepth,
});
```

And restore from config:

```typescript
if (cfg.rowExpandedDepth !== undefined) setRowExpandedDepth(cfg.rowExpandedDepth as number);
if (cfg.colExpandedDepth !== undefined) setColExpandedDepth(cfg.colExpandedDepth as number);
```

---

## File Changes Summary

| File | Action | Description |
|------|--------|-------------|
| `frontend/src/features/reports/matrixHierarchy.ts` | **CREATE** | Tree-building utilities, header layout computation, aggregation helpers |
| `frontend/src/features/reports/MatrixReport.tsx` | **MODIFY** | Refactor to use hierarchical headers, add expand/collapse state, multi-row thead, multi-column row headers |

No backend changes required — the existing API already returns `parent_id` for all items.

---

## Implementation Order for Claude Code

1. **Start** by creating `matrixHierarchy.ts` with all utility functions and types. This is pure logic, easy to test and verify.
2. **Then** modify `MatrixReport.tsx`:
   a. Add imports from `matrixHierarchy.ts`
   b. Add `rowExpandedDepth` / `colExpandedDepth` state
   c. Replace the `hierarchySort` usage with `buildTree` + `pruneTreeToDepth` + `getLeafOrder`
   d. Refactor `<thead>` to render multi-row column headers using `buildColumnHeaderRows`
   e. Refactor `<tbody>` row headers to render multi-column using `buildRowHeaderLayout`
   f. Update `getCellValue` to handle aggregation for pruned groups
   g. Add toolbar depth control buttons (−/+) for rows and columns
   h. Update saved report config
3. **Test** with:
   - A type that has hierarchy (e.g., BusinessCapability with parent/child)
   - A flat type (e.g., Application with no parent_id)
   - Both axes having hierarchy
   - One axis hierarchical, one flat
   - Depth control: step through all levels on each axis
   - Verify aggregated counts match when collapsed vs expanded
   - Saved report restore with depth settings

---

## Edge Cases to Handle

- **Items with `parent_id` pointing to non-existent parent** → treat as root (current behavior, maintain it)
- **Single-level hierarchy** (all items are either root or depth-1) → produces exactly 2 header rows; depth control toggles between 0 and 1
- **Deeply nested hierarchy (4+ levels)** → initialize depth to 1 or 2 for readability; ensure sticky positioning still works with many header rows
- **Same type on both axes** → diagonal handling still applies, at whatever the current visible leaf level is
- **Empty groups** (parent with no children in the filtered set) → parent appears as a leaf with colspan/rowspan=1
- **Very wide hierarchies** (100+ leaf columns) → ensure performance; tree operations are O(n) and should be fine
- **Sort modes** → "alpha" and "count" sort should apply to leaf items (at the visible depth) within each group, not break the grouping. When sort is "alpha" or "count" and hierarchy exists, still show grouped headers but sort visible-level items within groups.
- **Mixed depth trees** → some branches may be deeper than others. Nodes that are leaves at a depth shallower than the header depth should span downward with `rowspan`/`colspan` to fill the gap (e.g., if maxDepth=2 but "HR" has no children, it spans all 3 header rows).
- **Depth change resets** → when user switches row/col type, reset depth to Infinity (fully expanded)

---

## Visual Mockup (ASCII)

### Fully expanded — Row depth: 2/2, Col depth: 2/2

```
┌──────────┬────────────┬──────────────────────────────┬────────────┬────┐
│          │            │     Finance (colspan=4)       │   HR (2)   │    │
│ App /    │            ├──────────────┬───────────────┤            │    │
│ BizCap   │            │   Acct (2)   │  Treasury (2) │            │  Σ │
│          │            ├──────┬───────┼───────┬───────┼─────┬──────┤    │
│          │            │ AP   │ AR    │ Cash  │ FX    │ Rec │ Pay  │    │
├──────────┼────────────┼──────┼───────┼───────┼───────┼─────┼──────┼────┤
│ ERP      │ SAP        │  ●   │  ●    │  ●    │       │  ●  │  ●   │  5 │
│ Domain   ├────────────┼──────┼───────┼───────┼───────┼─────┼──────┼────┤
│ (rspan=2)│ Oracle     │      │  ●    │       │  ●    │     │      │  2 │
├──────────┼────────────┼──────┼───────┼───────┼───────┼─────┼──────┼────┤
│ CRM      │ Salesforce │      │       │       │       │  ●  │      │  1 │
│ Domain   ├────────────┼──────┼───────┼───────┼───────┼─────┼──────┼────┤
│ (rspan=2)│ HubSpot    │      │       │       │       │     │  ●   │  1 │
├──────────┼────────────┼──────┼───────┼───────┼───────┼─────┼──────┼────┤
│ Σ Total  │            │  1   │  2    │  1    │  1    │  2  │  2   │  9 │
└──────────┴────────────┴──────┴───────┴───────┴───────┴─────┴──────┴────┘
```

### Column depth collapsed to 1/2 (hide leaf level, show up to Level 1)

All Level-2 leaves collapse into their Level-1 parents. Cells show aggregated counts.

```
┌──────────┬────────────┬──────────────────────────┬──────────┬────┐
│          │            │   Finance (colspan=2)     │  HR (1)  │    │
│ App /    │            ├────────────┬─────────────┤          │    │
│ BizCap   │            │  Acct (2)  │ Treasury (2)│          │  Σ │
├──────────┼────────────┼────────────┼─────────────┼──────────┼────┤
│ ERP      │ SAP        │     2      │      1      │    2     │  5 │
│ Domain   ├────────────┼────────────┼─────────────┼──────────┼────┤
│ (rspan=2)│ Oracle     │     1      │      1      │    0     │  2 │
├──────────┼────────────┼────────────┼─────────────┼──────────┼────┤
│ CRM      │ Salesforce │     0      │      0      │    1     │  1 │
│ Domain   ├────────────┼────────────┼─────────────┼──────────┼────┤
│ (rspan=2)│ HubSpot    │     0      │      0      │    1     │  1 │
├──────────┼────────────┼────────────┼─────────────┼──────────┼────┤
│ Σ Total  │            │     3      │      2      │    4     │  9 │
└──────────┴────────────┴────────────┴─────────────┴──────────┴────┘
```

### Column depth collapsed to 0/2 (show only roots)

All hierarchy collapses to root level. Full heatmap aggregation.

```
┌──────────┬────────────┬──────────────┬──────────┬────┐
│ App /    │            │ Finance (4)  │  HR (2)  │    │
│ BizCap   │            │              │          │  Σ │
├──────────┼────────────┼──────────────┼──────────┼────┤
│ ERP      │ SAP        │      3       │    2     │  5 │
│ Domain   ├────────────┼──────────────┼──────────┼────┤
│ (rspan=2)│ Oracle     │      2       │    0     │  2 │
├──────────┼────────────┼──────────────┼──────────┼────┤
│ CRM      │ Salesforce │      0       │    1     │  1 │
│ Domain   ├────────────┼──────────────┼──────────┼────┤
│ (rspan=2)│ HubSpot    │      0       │    1     │  1 │
├──────────┼────────────┼──────────────┼──────────┼────┤
│ Σ Total  │            │      5       │    4     │  9 │
└──────────┴────────────┴──────────────┴──────────┴────┘
```

### Row depth ALSO collapsed to 0/1 (both axes at root level)

Compact executive summary view — just domain-to-capability-group totals.

```
┌──────────────┬──────────────┬──────────┬────┐
│ App / BizCap │ Finance (4)  │  HR (2)  │  Σ │
├──────────────┼──────────────┼──────────┼────┤
│ ERP (2)      │      5       │    2     │  7 │
├──────────────┼──────────────┼──────────┼────┤
│ CRM (2)      │      0       │    2     │  2 │
├──────────────┼──────────────┼──────────┼────┤
│ Σ Total      │      5       │    4     │  9 │
└──────────────┴──────────────┴──────────┴────┘
```

Note: `(N)` badges on pruned groups show how many leaf items are aggregated underneath.
