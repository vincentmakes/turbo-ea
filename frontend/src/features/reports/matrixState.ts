/**
 * The Matrix report's state rules, as plain functions: which relation types
 * connect the two axes, the request path for a filter set, which cards an axis
 * may show (coverage toggles, quick-search, scope), the flat and hierarchical
 * leaf layouts, the depth and sort an axis actually uses, the KPIs, and what a
 * cell says about itself.
 *
 * `MatrixReport.tsx` renders; this decides. The tree, cell and dimension
 * mechanics live beside it in `matrixHierarchy`, `matrixCells` and
 * `matrixDimensions`; the export sheets in `matrixExport`.
 */
import type { CardType, RelationType } from "@/types";
import type { MatrixFilterState } from "./MatrixFilterBar";
import {
  DIR_FORWARD,
  DIR_REVERSE,
  type CellDatum,
  type MatrixPayloadIntersection,
} from "./matrixCells";
import type { MatrixValue, MatrixValueIndex } from "./matrixDimensions";
import {
  buildColumnHeaderRows,
  buildRowHeaderLayout,
  type ColumnHeaderCell,
  type MatrixItem,
  type RowHeaderCell,
  type TreeNode,
  type TreeResult,
} from "./matrixHierarchy";

export type CellMode = "exists" | "count" | "codes" | "labels";
export type SortMode = "alpha" | "count" | "hierarchy";

export const CELL_MODES: CellMode[] = ["exists", "count", "codes", "labels"];
export const DIRECTIONS = ["any", "forward", "reverse"] as const;

export const EMPTY_FILTERS: MatrixFilterState = {
  relationTypes: [],
  attrValues: {},
  direction: "any",
};

/** The translation function the label-building helpers need; i18next's `t` fits. */
export type Translate = (key: string, options?: Record<string, unknown>) => string;

/* ------------------------------------------------------------------ */
/*  Heat scale                                                         */
/* ------------------------------------------------------------------ */

export const HEAT_COLORS_LIGHT = [
  "#e3f2fd",
  "#bbdefb",
  "#90caf9",
  "#64b5f6",
  "#42a5f5",
  "#2196f3",
  "#1e88e5",
  "#1976d2",
  "#1565c0",
  "#0d47a1",
];

export const HEAT_COLORS_DARK = [
  "#0d2137",
  "#0d3054",
  "#0a3d6e",
  "#0d4a88",
  "#10579e",
  "#1565c0",
  "#1976d2",
  "#1e88e5",
  "#2196f3",
  "#42a5f5",
];

/** A count's shade on the ten-step heat scale; an empty cell keeps the paper colour. */
export function heatColor(value: number, max: number, paperBg: string, isDark: boolean): string {
  if (max <= 0 || value <= 0) return paperBg;
  const scale = isDark ? HEAT_COLORS_DARK : HEAT_COLORS_LIGHT;
  const idx = Math.min(Math.floor((value / max) * (scale.length - 1)), scale.length - 1);
  return scale[idx];
}

/* ------------------------------------------------------------------ */
/*  Filters and the request                                            */
/* ------------------------------------------------------------------ */

/** Coerce a persisted filter blob back into a usable state, dropping anything malformed. */
export function sanitiseFilters(raw: unknown): MatrixFilterState {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return EMPTY_FILTERS;
  const cfg = raw as Record<string, unknown>;
  const relationTypes = Array.isArray(cfg.relationTypes)
    ? cfg.relationTypes.filter((v): v is string => typeof v === "string")
    : [];
  const attrValues: Record<string, string[]> = {};
  // A primitive has no array-valued entries, so only an absent value and an
  // array (whose items would read as keys "0", "1", …) need turning away.
  if (cfg.attrValues && !Array.isArray(cfg.attrValues)) {
    for (const [key, value] of Object.entries(cfg.attrValues as Record<string, unknown>)) {
      if (!Array.isArray(value)) continue;
      const values = value.filter((v): v is string => typeof v === "string");
      if (values.length > 0) attrValues[key] = values;
    }
  }
  const direction = DIRECTIONS.includes(cfg.direction as (typeof DIRECTIONS)[number])
    ? (cfg.direction as MatrixFilterState["direction"])
    : "any";
  return { relationTypes, attrValues, direction };
}

/** How many filters are set: the relation-type pick, each attribute, the direction. */
export function activeFilterCount(filters: MatrixFilterState): number {
  return (
    (filters.relationTypes.length > 0 ? 1 : 0) +
    Object.values(filters.attrValues).filter((v) => v.length > 0).length +
    (filters.direction !== "any" ? 1 : 0)
  );
}

/**
 * The request for an axis pair and a filter set. Keys and values are sorted,
 * so two equivalent filter sets always produce the same path — otherwise a
 * re-render that rebuilt the object in another key order would refetch.
 */
export function matrixPath(rowType: string, colType: string, filters: MatrixFilterState): string {
  const params = new URLSearchParams();
  params.set("row_type", rowType);
  params.set("col_type", colType);
  if (filters.relationTypes.length > 0) {
    params.set("relation_types", [...filters.relationTypes].sort().join(","));
  }
  for (const key of Object.keys(filters.attrValues).sort()) {
    for (const value of [...filters.attrValues[key]].sort()) {
      params.append("attr", `${key}:${value}`);
    }
  }
  if (filters.direction !== "any") params.set("direction", filters.direction);
  return `/reports/matrix?${params.toString()}`;
}

/**
 * Every relation type able to connect the two axes, in either direction. Any
 * number may share an ordered pair, so this is a list, not one per orientation.
 */
export function pairRelationTypes(
  relationTypes: RelationType[],
  rowType: string,
  colType: string,
): RelationType[] {
  return relationTypes.filter(
    (rt) =>
      (rt.source_type_key === rowType && rt.target_type_key === colType) ||
      (rt.source_type_key === colType && rt.target_type_key === rowType),
  );
}

/* ------------------------------------------------------------------ */
/*  Axes                                                               */
/* ------------------------------------------------------------------ */

/**
 * Whether an axis has a hierarchy. The metamodel answers first: a
 * hierarchical type whose cards have no parent yet still deserves the option,
 * and the answer must not flip while a fetch is in flight. Only a type the
 * metamodel does not know is judged by its cards (none loaded: no hierarchy).
 */
export function axisHasHierarchy(
  types: Pick<CardType, "key" | "has_hierarchy">[],
  typeKey: string,
  items: MatrixItem[] | null,
): boolean {
  return (
    types.find((t) => t.key === typeKey)?.has_hierarchy ??
    (items ? items.some((r) => r.parent_id !== null) : false)
  );
}

/** A hierarchy sort only exists on an axis with a hierarchy; anywhere else it reads as A → Z. */
export function effectiveSort(sort: SortMode, hasHierarchy: boolean): SortMode {
  return sort === "hierarchy" && !hasHierarchy ? "alpha" : sort;
}

/** The depth an axis shows: the one asked for, never deeper than its tree. */
export function effectiveDepth(tree: TreeResult | null, expanded: number): number {
  return tree ? Math.min(expanded, tree.maxDepth) : 0;
}

/** Case-insensitive name match, used by the row/column quick-search. */
export function matchesSearch(name: string, query: string): boolean {
  return name.toLowerCase().includes(query.toLowerCase());
}

/** The ids a quick-search keeps, or null when there is no search (or nothing loaded). */
export function searchedIds(items: MatrixItem[] | null, query: string): Set<string> | null {
  if (!query.trim() || !items) return null;
  return new Set(items.filter((r) => matchesSearch(r.name, query)).map((r) => r.id));
}

/**
 * Which cards an axis may show, or null for all of them. Coverage
 * (hide-unrelated or only-gaps) and search intersect: searching inside a
 * filtered view narrows it rather than reopening what the filter closed.
 */
export function visibleIds(
  all: { id: string }[],
  related: Set<string>,
  searched: Set<string> | null,
  coverage: { hideEmpty: boolean; showOnlyGaps: boolean },
): Set<string> | null {
  let ids: Set<string> | null = null;
  if (coverage.hideEmpty) ids = related;
  else if (coverage.showOnlyGaps) {
    ids = new Set(all.filter((c) => !related.has(c.id)).map((c) => c.id));
  }
  if (!searched) return ids;
  const allowed = ids;
  return allowed ? new Set([...searched].filter((id) => allowed.has(id))) : searched;
}

/**
 * Cards that carry relations of their own AND have children. Such a card is
 * otherwise only a group header spanning its children, with no cell row of
 * its own, so its relations would have nowhere to land.
 */
export function parentsWithOwnRelations(
  tree: TreeResult | null,
  related: Set<string>,
): Set<string> {
  const ids = new Set<string>();
  if (!tree) return ids;
  for (const id of related) {
    if ((tree.allNodes.get(id)?.children.length ?? 0) > 0) ids.add(id);
  }
  return ids;
}

/** Relations per card on each axis, straight off the payload's edges. */
export function relationCounts(intersections: MatrixPayloadIntersection[]): {
  rows: Map<string, number>;
  cols: Map<string, number>;
} {
  const rows = new Map<string, number>();
  const cols = new Map<string, number>();
  for (const i of intersections) {
    const n = (i.e ?? []).length;
    if (n === 0) continue;
    rows.set(i.row_id, (rows.get(i.row_id) ?? 0) + n);
    cols.set(i.col_id, (cols.get(i.col_id) ?? 0) + n);
  }
  return { rows, cols };
}

/** A flat axis: the visible cards as one leaf each, by relation count (most first) or name. */
export function flatLeafNodes(
  items: MatrixItem[],
  visible: Set<string> | null,
  sort: SortMode,
  counts: Map<string, number>,
): TreeNode[] {
  const kept = visible ? items.filter((r) => visible.has(r.id)) : [...items];
  if (sort === "count") {
    kept.sort((a, b) => (counts.get(b.id) ?? 0) - (counts.get(a.id) ?? 0));
  } else {
    kept.sort((a, b) => a.name.localeCompare(b.name));
  }
  return kept.map(
    (item): TreeNode => ({
      item,
      children: [],
      depth: 0,
      leafCount: 1,
      leafDescendants: [item.id],
      isPrunedGroup: false,
      originalLeafCount: 1,
    }),
  );
}

/** The column header rows: merged per level for a hierarchy, one flat row otherwise. */
export function columnHeaderRowsFor(
  pruned: TreeNode[] | null,
  maxDepth: number,
  depth: number,
  leaves: TreeNode[],
): ColumnHeaderCell[][] {
  if (pruned && maxDepth > 0) return buildColumnHeaderRows(pruned, depth);
  return [
    leaves.map((node) => ({ node, colspan: 1, rowspan: 1, isLeaf: true, isPrunedGroup: false })),
  ];
}

/** The row header columns: merged per level for a hierarchy, one flat column otherwise. */
export function rowHeaderLayoutFor(
  pruned: TreeNode[] | null,
  maxDepth: number,
  depth: number,
  leaves: TreeNode[],
): (RowHeaderCell | null)[][] {
  if (pruned && maxDepth > 0) return buildRowHeaderLayout(pruned, depth);
  return leaves.map((node) => [{ node, rowspan: 1, isLeaf: true, isPrunedGroup: false }]);
}

/** The leaves a hovered header covers: a group's descendants, else itself. */
export function hoveredIds(id: string | null, nodes: Map<string, TreeNode>): Set<string> {
  if (!id) return new Set();
  const node = nodes.get(id);
  if (node && node.leafDescendants.length > 0) return new Set(node.leafDescendants);
  return new Set([id]);
}

/* ------------------------------------------------------------------ */
/*  KPIs                                                               */
/* ------------------------------------------------------------------ */

/** Relations between the two axes, within each axis's scope (a null scope keeps all). */
export function totalRelations(
  intersections: MatrixPayloadIntersection[],
  rowScope: Set<string> | null,
  colScope: Set<string> | null,
): number {
  return intersections.reduce((sum, i) => {
    if (rowScope && !rowScope.has(i.row_id)) return sum;
    if (colScope && !colScope.has(i.col_id)) return sum;
    return sum + (i.e ?? []).length;
  }, 0);
}

/** The share of possible cells that hold a relation, to one decimal; "0" for an empty grid. */
export function coveragePercent(populated: number, rows: number, cols: number): string {
  const possible = rows * cols;
  return possible > 0 ? ((populated / possible) * 100).toFixed(1) : "0";
}

/* ------------------------------------------------------------------ */
/*  Cells and legend                                                   */
/* ------------------------------------------------------------------ */

/** The legend values behind a cell, in legend order; ids the index does not know are skipped. */
export function cellValues(cell: CellDatum, index: MatrixValueIndex): MatrixValue[] {
  return cell.valueIds.map((id) => index.byId.get(id)).filter((v): v is MatrixValue => !!v);
}

/**
 * A cell's whole story as plain text, for the native `title`: the two cards,
 * the relation count, whether it aggregates a group, its values and its
 * direction.
 */
export function cellTitle(
  rowName: string,
  colName: string,
  cell: CellDatum,
  isAggregated: boolean,
  values: MatrixValue[],
  t: Translate,
): string {
  const lines = [`${rowName} × ${colName}`, t("matrix.relations", { count: cell.count })];
  if (isAggregated) lines.push(t("matrix.aggregatedHint"));
  if (values.length > 0) lines.push(values.map((v) => v.label).join(", "));
  if (cell.dirMask === (DIR_FORWARD | DIR_REVERSE)) lines.push(t("matrix.directionBoth"));
  else if (cell.dirMask === DIR_REVERSE) lines.push(t("matrix.directionReverse"));
  else if (cell.dirMask === DIR_FORWARD) lines.push(t("matrix.directionForward"));
  return lines.join("\n");
}

/**
 * The border marking a cell's direction: the left edge for relations where
 * the row card is the source, the right edge where it is the target.
 */
export function directionBorder(
  dirMask: number,
  side: "left" | "right",
  color: string,
): string | undefined {
  const wants = side === "left" ? DIR_FORWARD : DIR_REVERSE;
  return dirMask & wants ? `2px solid ${color}` : undefined;
}

/**
 * Legend entries grouped per relation type. Only the value-bearing cell modes
 * have a legend — a dot or a count explains itself.
 */
export function legendGroups(
  cellMode: CellMode,
  relationTypes: RelationType[],
  index: MatrixValueIndex,
): { rt: RelationType; values: MatrixValue[] }[] {
  if (cellMode !== "codes" && cellMode !== "labels") return [];
  return relationTypes
    .map((rt) => ({ rt, values: index.byRelationType.get(rt.key) ?? [] }))
    .filter((g) => g.values.length > 0);
}

/**
 * One step of an axis's depth stepper: up or down from the depth it shows
 * (an unexpanded axis shows its whole tree), never below 0 or past the tree.
 */
export function stepDepth(current: number, max: number, step: 1 | -1): number {
  return Math.min(max, Math.max(0, Math.min(current, max) + step));
}
