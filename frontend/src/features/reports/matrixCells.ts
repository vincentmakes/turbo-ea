/**
 * Builds the Matrix report's grid contents in a single pass over the payload's
 * edges.
 *
 * The report used to walk the whole grid four times — once each for the heat
 * scale, the row totals, the column totals, and the render — and every cell of
 * every walk called an aggregation that was itself O(rowLeaves x colLeaves).
 * Cost grew with the *area* of the grid even though the data is sparse.
 *
 * Here the leaf ids are mapped to their visible column/row index once, and the
 * edges are visited once. Totals, the heat maximum and the per-cell contents
 * all fall out of that one pass, and memory is proportional to the number of
 * populated cells rather than to rows x columns.
 */

import { getEffectiveLeafIds, type TreeNode } from "./matrixHierarchy";
import { valueIdsForAttributes, type MatrixValueIndex } from "./matrixDimensions";

/** Which end of the relation the row card sits on. */
export const DIR_FORWARD = 1;
export const DIR_REVERSE = 2;

export interface MatrixPayloadIntersection {
  row_id: string;
  col_id: string;
  /** `[relationTypeIndex, "f" | "r", attributeSetIndex]` per underlying relation. */
  e?: [number, string, number][];
}

export interface MatrixPayload {
  rows: { id: string; name: string; parent_id: string | null }[];
  columns: { id: string; name: string; parent_id: string | null }[];
  intersections: MatrixPayloadIntersection[];
  relation_types?: string[];
  attr_sets?: Record<string, unknown>[];
  truncated?: boolean;
}

export interface CellDatum {
  /** Relations behind this cell. The self-diagonal is structural and counts 0. */
  count: number;
  /** Bitmask of {@link DIR_FORWARD} / {@link DIR_REVERSE}. */
  dirMask: number;
  /** Union of the value ids across this cell's edges, in legend order. */
  valueIds: string[];
  /** Relation types behind this cell, in payload order. */
  relationTypeKeys: string[];
}

export interface CellMatrix {
  /** Populated cells only, keyed `rowIndex * numCols + colIndex`. */
  cells: Map<number, CellDatum>;
  numCols: number;
  rowTotals: Int32Array;
  colTotals: Int32Array;
  /** Highest single-cell count, for the heat scale. */
  max: number;
  grandTotal: number;
  /** Row / column indices with no relation at all — the coverage gaps. */
  emptyRowIndices: Set<number>;
  emptyColIndices: Set<number>;
  /**
   * Edges whose cards could not be placed in the grid. Should always be zero:
   * every card in the payload has a row or column, so anything counted here is
   * a relation the user is being shown a total for but no cell to explain it.
   * Asserted in the tests rather than surfaced in the UI.
   */
  droppedEdges: number;
}

const EMPTY_CELL: CellDatum = { count: 0, dirMask: 0, valueIds: [], relationTypeKeys: [] };

/**
 * Map every card id reachable from a visible leaf node to that node's index.
 *
 * A collapsed group stands in for all of its descendants, so each descendant id
 * points at the group's index — which is exactly the aggregation the old
 * per-cell walk recomputed for every cell it drew.
 */
function buildIndexMap(nodes: TreeNode[]): Map<string, number> {
  const map = new Map<string, number>();
  nodes.forEach((node, index) => {
    for (const id of getEffectiveLeafIds(node)) map.set(id, index);
  });
  return map;
}

export function buildCellMatrix(
  rowNodes: TreeNode[],
  colNodes: TreeNode[],
  payload: MatrixPayload | null,
  valueIndex: MatrixValueIndex,
): CellMatrix {
  const numRows = rowNodes.length;
  const numCols = colNodes.length;
  const matrix: CellMatrix = {
    cells: new Map(),
    numCols,
    rowTotals: new Int32Array(numRows),
    colTotals: new Int32Array(numCols),
    max: 0,
    grandTotal: 0,
    emptyRowIndices: new Set(),
    emptyColIndices: new Set(),
    droppedEdges: 0,
  };
  if (!payload || numRows === 0 || numCols === 0) return matrix;

  const rowIndex = buildIndexMap(rowNodes);
  const colIndex = buildIndexMap(colNodes);
  const relationTypes = payload.relation_types ?? [];
  const attrSets = payload.attr_sets ?? [];

  // Value ids per (relation type, attribute set) pair, resolved once instead of
  // once per edge — the payload interns the bags precisely so this is cheap.
  const valueIdCache = new Map<string, string[]>();
  const valueIdsFor = (rtIdx: number, attrIdx: number): string[] => {
    const key = `${rtIdx}:${attrIdx}`;
    const hit = valueIdCache.get(key);
    if (hit) return hit;
    const rtKey = relationTypes[rtIdx];
    const ids = rtKey ? valueIdsForAttributes(rtKey, attrSets[attrIdx], valueIndex) : [];
    valueIdCache.set(key, ids);
    return ids;
  };

  for (const intersection of payload.intersections) {
    const edges = intersection.e ?? [];
    if (edges.length === 0) continue; // structural diagonal — not a relationship

    const r = rowIndex.get(intersection.row_id);
    const c = colIndex.get(intersection.col_id);
    if (r === undefined || c === undefined) {
      // A card the grid has no row or column for. The totals and the toggles
      // read raw card ids, so silently skipping here is what produced a visible
      // card with empty cells and a count that did not add up.
      matrix.droppedEdges += edges.length;
      continue;
    }

    const key = r * numCols + c;
    let cell = matrix.cells.get(key);
    if (!cell) {
      cell = { count: 0, dirMask: 0, valueIds: [], relationTypeKeys: [] };
      matrix.cells.set(key, cell);
    }

    for (const [rtIdx, orientation, attrIdx] of edges) {
      cell.count += 1;
      cell.dirMask |= orientation === "r" ? DIR_REVERSE : DIR_FORWARD;
      const rtKey = relationTypes[rtIdx];
      if (rtKey && !cell.relationTypeKeys.includes(rtKey)) cell.relationTypeKeys.push(rtKey);
      for (const id of valueIdsFor(rtIdx, attrIdx)) {
        if (!cell.valueIds.includes(id)) cell.valueIds.push(id);
      }
    }

    matrix.rowTotals[r] += edges.length;
    matrix.colTotals[c] += edges.length;
    matrix.grandTotal += edges.length;
    if (cell.count > matrix.max) matrix.max = cell.count;
  }

  // Keep the union in legend order so a cell's glyphs read the same way
  // everywhere, regardless of which edge happened to arrive first.
  const order = new Map(valueIndex.values.map((v, i) => [v.id, i]));
  for (const cell of matrix.cells.values()) {
    if (cell.valueIds.length > 1) {
      cell.valueIds.sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0));
    }
  }

  for (let r = 0; r < numRows; r++) if (matrix.rowTotals[r] === 0) matrix.emptyRowIndices.add(r);
  for (let c = 0; c < numCols; c++) if (matrix.colTotals[c] === 0) matrix.emptyColIndices.add(c);

  return matrix;
}

export function getCell(matrix: CellMatrix, rowIndex: number, colIndex: number): CellDatum {
  return matrix.cells.get(rowIndex * matrix.numCols + colIndex) ?? EMPTY_CELL;
}

/**
 * Card ids that take part in at least one relation, for the hide-unrelated and
 * show-only-gaps toggles. Derived from the payload rather than the visible
 * grid, so collapsing a level never changes which cards count as covered.
 */
export function relatedCardIds(payload: MatrixPayload | null): {
  rows: Set<string>;
  columns: Set<string>;
} {
  const rows = new Set<string>();
  const columns = new Set<string>();
  for (const intersection of payload?.intersections ?? []) {
    if ((intersection.e ?? []).length === 0) continue;
    rows.add(intersection.row_id);
    columns.add(intersection.col_id);
  }
  return { rows, columns };
}
