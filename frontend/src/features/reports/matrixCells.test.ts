import { describe, it, expect } from "vitest";
import {
  DIR_FORWARD,
  DIR_REVERSE,
  buildCellMatrix,
  getCell,
  relatedCardIds,
  type MatrixPayload,
} from "./matrixCells";
import { buildValueIndex } from "./matrixDimensions";
import { addSelfNodes, buildTree, pruneTreeToDepth, getLeafNodes } from "./matrixHierarchy";
import type { FieldDef, FieldOption, RelationType } from "@/types";

const rt: RelationType = {
  key: "relA",
  label: "uses",
  source_type_key: "Application",
  target_type_key: "DataObject",
  cardinality: "n:m",
  built_in: false,
  is_hidden: false,
  attributes_schema: [
    { key: "alpha", label: "Create", type: "boolean" },
    { key: "beta", label: "Read", type: "boolean" },
  ],
} as unknown as RelationType;

const rtB: RelationType = { ...rt, key: "relB", label: "feeds" } as RelationType;

const valueIndex = buildValueIndex([rt, rtB], {
  fieldLabel: (f: FieldDef) => f.label,
  optionLabel: (o: FieldOption) => o.label,
});

/** Flat (non-hierarchical) leaf nodes, the shape the report uses without hierarchy. */
function leaves(ids: string[]) {
  return getLeafNodes(
    buildTree(ids.map((id) => ({ id, name: id, parent_id: null }))).roots,
  );
}

function payload(
  intersections: MatrixPayload["intersections"],
  attrSets: Record<string, unknown>[] = [{}],
): MatrixPayload {
  return {
    rows: [],
    columns: [],
    intersections,
    relation_types: ["relA", "relB"],
    attr_sets: attrSets,
  };
}

describe("buildCellMatrix", () => {
  it("returns an empty matrix for no data", () => {
    const m = buildCellMatrix([], [], null, valueIndex);
    expect(m.cells.size).toBe(0);
    expect(m.grandTotal).toBe(0);
    expect(m.max).toBe(0);
  });

  it("counts every edge in a cell, not just the pair", () => {
    // Two relations between the same two cards is two, not one — the old
    // set-based payload could never express this.
    const m = buildCellMatrix(
      leaves(["r1"]),
      leaves(["c1"]),
      payload([{ row_id: "r1", col_id: "c1", e: [[0, "f", 0], [1, "r", 0]] }]),
      valueIndex,
    );
    expect(getCell(m, 0, 0).count).toBe(2);
    expect(m.grandTotal).toBe(2);
    expect(m.max).toBe(2);
  });

  it("records the orientation of each edge as a bitmask", () => {
    const m = buildCellMatrix(
      leaves(["r1", "r2", "r3"]),
      leaves(["c1"]),
      payload([
        { row_id: "r1", col_id: "c1", e: [[0, "f", 0]] },
        { row_id: "r2", col_id: "c1", e: [[0, "r", 0]] },
        { row_id: "r3", col_id: "c1", e: [[0, "f", 0], [1, "r", 0]] },
      ]),
      valueIndex,
    );
    expect(getCell(m, 0, 0).dirMask).toBe(DIR_FORWARD);
    expect(getCell(m, 1, 0).dirMask).toBe(DIR_REVERSE);
    expect(getCell(m, 2, 0).dirMask).toBe(DIR_FORWARD | DIR_REVERSE);
  });

  it("resolves attribute sets into value ids", () => {
    const m = buildCellMatrix(
      leaves(["r1"]),
      leaves(["c1"]),
      payload([{ row_id: "r1", col_id: "c1", e: [[0, "f", 1]] }], [{}, { alpha: true }]),
      valueIndex,
    );
    expect(getCell(m, 0, 0).valueIds).toEqual(["relA.alpha"]);
  });

  it("unions the values of several edges, in legend order", () => {
    const m = buildCellMatrix(
      leaves(["r1"]),
      leaves(["c1"]),
      payload(
        [{ row_id: "r1", col_id: "c1", e: [[0, "f", 1], [0, "f", 2]] }],
        [{}, { beta: true }, { alpha: true }],
      ),
      valueIndex,
    );
    // Declared alpha-then-beta in the schema, so that is how they read.
    expect(getCell(m, 0, 0).valueIds).toEqual(["relA.alpha", "relA.beta"]);
  });

  it("records which relation types are behind a cell", () => {
    const m = buildCellMatrix(
      leaves(["r1"]),
      leaves(["c1"]),
      payload([{ row_id: "r1", col_id: "c1", e: [[1, "f", 0], [0, "f", 0], [1, "r", 0]] }]),
      valueIndex,
    );
    expect(getCell(m, 0, 0).relationTypeKeys).toEqual(["relB", "relA"]);
  });

  it("ignores the structural diagonal of a self-matrix", () => {
    const m = buildCellMatrix(
      leaves(["r1", "r2"]),
      leaves(["r1", "r2"]),
      payload([
        { row_id: "r1", col_id: "r1", e: [] },
        { row_id: "r2", col_id: "r2", e: [] },
        { row_id: "r1", col_id: "r2", e: [[0, "f", 0]] },
      ]),
      valueIndex,
    );
    expect(getCell(m, 0, 0).count).toBe(0);
    expect(m.grandTotal).toBe(1);
    // A card related to nothing but itself is still a gap.
    expect(m.emptyRowIndices.has(1)).toBe(true);
  });

  it("computes row, column and grand totals in the same pass", () => {
    const m = buildCellMatrix(
      leaves(["r1", "r2"]),
      leaves(["c1", "c2"]),
      payload([
        { row_id: "r1", col_id: "c1", e: [[0, "f", 0]] },
        { row_id: "r1", col_id: "c2", e: [[0, "f", 0], [1, "f", 0]] },
        { row_id: "r2", col_id: "c1", e: [[0, "f", 0]] },
      ]),
      valueIndex,
    );
    expect(Array.from(m.rowTotals)).toEqual([3, 1]);
    expect(Array.from(m.colTotals)).toEqual([2, 2]);
    expect(m.grandTotal).toBe(4);
    expect(m.max).toBe(2);
  });

  it("only stores populated cells", () => {
    const m = buildCellMatrix(
      leaves(["r1", "r2", "r3"]),
      leaves(["c1", "c2", "c3"]),
      payload([{ row_id: "r2", col_id: "c3", e: [[0, "f", 0]] }]),
      valueIndex,
    );
    expect(m.cells.size).toBe(1);
    expect(getCell(m, 0, 0)).toEqual({
      count: 0,
      dirMask: 0,
      valueIds: [],
      relationTypeKeys: [],
    });
  });

  it("flags rows and columns with no relation at all", () => {
    const m = buildCellMatrix(
      leaves(["r1", "r2"]),
      leaves(["c1", "c2"]),
      payload([{ row_id: "r1", col_id: "c1", e: [[0, "f", 0]] }]),
      valueIndex,
    );
    expect(Array.from(m.emptyRowIndices)).toEqual([1]);
    expect(Array.from(m.emptyColIndices)).toEqual([1]);
  });

  it("ignores edges whose cards are not on screen", () => {
    const m = buildCellMatrix(
      leaves(["r1"]),
      leaves(["c1"]),
      payload([{ row_id: "elsewhere", col_id: "c1", e: [[0, "f", 0]] }]),
      valueIndex,
    );
    expect(m.grandTotal).toBe(0);
  });

  it("rolls a collapsed group's descendants up into the group cell", () => {
    // Same aggregation the old per-cell walk recomputed for every cell drawn.
    const tree = buildTree([
      { id: "parent", name: "Parent", parent_id: null },
      { id: "childA", name: "Child A", parent_id: "parent" },
      { id: "childB", name: "Child B", parent_id: "parent" },
    ]);
    const collapsed = getLeafNodes(pruneTreeToDepth(tree.roots, 0));

    const m = buildCellMatrix(
      collapsed,
      leaves(["c1"]),
      payload([
        { row_id: "childA", col_id: "c1", e: [[0, "f", 0]] },
        { row_id: "childB", col_id: "c1", e: [[0, "f", 0]] },
      ]),
      valueIndex,
    );

    expect(collapsed).toHaveLength(1);
    expect(getCell(m, 0, 0).count).toBe(2);
  });
});

describe("every relation lands in a cell", () => {
  // The invariant that was missing. The totals and the hide-unrelated toggle
  // are computed from raw card ids, so any edge the grid cannot place shows up
  // as a visible card with empty cells and a count that does not add up.
  const total = (p: MatrixPayload) =>
    p.intersections.reduce((sum, i) => sum + (i.e ?? []).length, 0);

  it("places a relation attached to a parent card, once it has a row of its own", () => {
    const items = [
      { id: "p", name: "Parent", parent_id: null },
      { id: "c1", name: "Child", parent_id: "p" },
    ];
    const rowNodes = getLeafNodes(addSelfNodes(buildTree(items).roots, new Set(["p"])));
    const data = payload([{ row_id: "p", col_id: "c1", e: [[0, "f", 0]] }]);

    const m = buildCellMatrix(rowNodes, leaves(["c1"]), data, valueIndex);

    expect(m.droppedEdges).toBe(0);
    expect(m.grandTotal).toBe(total(data));
    // The parent's own row, not one of its children.
    const selfIdx = rowNodes.findIndex((n) => n.isSelfNode);
    expect(getCell(m, selfIdx, 0).count).toBe(1);
  });

  it("places a relation attached to a collapsed parent", () => {
    const items = [
      { id: "p", name: "Parent", parent_id: null },
      { id: "c1", name: "Child", parent_id: "p" },
    ];
    const collapsed = getLeafNodes(pruneTreeToDepth(buildTree(items).roots, 0));
    const data = payload([{ row_id: "p", col_id: "c1", e: [[0, "f", 0]] }]);

    const m = buildCellMatrix(collapsed, leaves(["c1"]), data, valueIndex);

    expect(m.droppedEdges).toBe(0);
    expect(getCell(m, 0, 0).count).toBe(1);
  });

  it("counts an edge it cannot place instead of losing it silently", () => {
    const data = payload([{ row_id: "nowhere", col_id: "c1", e: [[0, "f", 0]] }]);
    const m = buildCellMatrix(leaves(["r1"]), leaves(["c1"]), data, valueIndex);
    expect(m.droppedEdges).toBe(1);
    expect(m.grandTotal).toBe(0);
  });
});

describe("relatedCardIds", () => {
  it("collects the cards on either end of a real relation", () => {
    const { rows, columns } = relatedCardIds(
      payload([
        { row_id: "r1", col_id: "c1", e: [[0, "f", 0]] },
        { row_id: "r2", col_id: "c2", e: [] },
      ]),
    );
    expect(Array.from(rows)).toEqual(["r1"]);
    expect(Array.from(columns)).toEqual(["c1"]);
  });

  it("is empty for no payload", () => {
    const { rows, columns } = relatedCardIds(null);
    expect(rows.size).toBe(0);
    expect(columns.size).toBe(0);
  });
});
