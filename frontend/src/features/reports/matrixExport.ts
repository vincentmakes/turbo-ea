/**
 * What the Matrix report hands to print and export: the parameter summary,
 * and two sheets built from data structures rather than scraped from the DOM —
 * the grid as it looks on screen, and a row per relation with its attribute
 * values spread into columns. Which columns exist is decided by the relation
 * types in play, so a new admin-defined dimension appears in the export with
 * no code change.
 */
import type { FieldDef, RelationType } from "@/types";
import type { MatrixFilterState } from "./MatrixFilterBar";
import { getCell, type CellMatrix, type MatrixPayload } from "./matrixCells";
import type { MatrixValueIndex } from "./matrixDimensions";
import type { TreeNode } from "./matrixHierarchy";
import { cellValues, type CellMode, type SortMode, type Translate } from "./matrixState";
import type { ExportSheet } from "./reportExport";

/** The label resolvers the summary and the sheets need, injected so this stays hook-free. */
export interface MatrixLabels {
  t: Translate;
  relationLabel: (rt: RelationType, reverse?: boolean) => string;
  fieldLabel: (field: FieldDef) => string;
}

export interface MatrixPrintState {
  rowLabel: string;
  colLabel: string;
  rowScopeCount: number;
  colScopeCount: number;
  cellMode: CellMode;
  sortRows: SortMode;
  sortCols: SortMode;
  hideEmpty: boolean;
  showOnlyGaps: boolean;
  filters: MatrixFilterState;
  pairRelationTypes: RelationType[];
  valueIndex: MatrixValueIndex;
}

const SORT_LABEL_KEYS: Record<SortMode, string> = {
  alpha: "matrix.alphaSort",
  count: "matrix.byCount",
  hierarchy: "matrix.hierarchy",
};

const CELL_MODE_LABEL_KEYS: Record<CellMode, string> = {
  exists: "matrix.existsDot",
  count: "matrix.countHeatmap",
  codes: "matrix.codes",
  labels: "matrix.labels",
};

const DIRECTION_LABEL_KEYS: Record<MatrixFilterState["direction"], string> = {
  any: "matrix.directionAny",
  forward: "matrix.directionForward",
  reverse: "matrix.directionReverse",
};

export const sortModeLabel = (m: SortMode, t: Translate) => t(SORT_LABEL_KEYS[m]);
export const cellModeLabel = (m: CellMode, t: Translate) => t(CELL_MODE_LABEL_KEYS[m]);
export const directionLabel = (d: MatrixFilterState["direction"], t: Translate) =>
  t(DIRECTION_LABEL_KEYS[d]);

/** The report's parameters as label/value pairs, for print and the export's summary. */
export function buildPrintParams(
  s: MatrixPrintState,
  { t, relationLabel, fieldLabel }: MatrixLabels,
): { label: string; value: string }[] {
  const params: { label: string; value: string }[] = [
    { label: t("matrix.rows"), value: s.rowLabel },
    { label: t("matrix.columns"), value: s.colLabel },
  ];
  if (s.rowScopeCount > 0) {
    params.push({
      label: t("matrix.scopeRows"),
      value: t("matrix.scopeCountRows", { count: s.rowScopeCount }),
    });
  }
  if (s.colScopeCount > 0) {
    params.push({
      label: t("matrix.scopeCols"),
      value: t("matrix.scopeCountCols", { count: s.colScopeCount }),
    });
  }
  params.push({ label: t("matrix.cell"), value: cellModeLabel(s.cellMode, t) });
  params.push({ label: t("matrix.sortRows"), value: sortModeLabel(s.sortRows, t) });
  params.push({ label: t("matrix.sortColumns"), value: sortModeLabel(s.sortCols, t) });
  if (s.hideEmpty) params.push({ label: t("matrix.hideUnrelated"), value: t("matrix.on") });
  if (s.showOnlyGaps) params.push({ label: t("matrix.showOnlyGaps"), value: t("matrix.on") });
  if (s.filters.relationTypes.length > 0) {
    params.push({
      label: t("matrix.relationType"),
      value: s.filters.relationTypes
        .map((key) => {
          const rt = s.pairRelationTypes.find((r) => r.key === key);
          return rt ? relationLabel(rt) : key;
        })
        .join(", "),
    });
  }
  for (const [dimensionId, values] of Object.entries(s.filters.attrValues)) {
    if (values.length === 0) continue;
    const dim = s.valueIndex.dimensions.find((d) => d.id === dimensionId);
    // A flag filters on "true" / "false" (the filter bar's Yes / No); only an
    // enum's values are options with labels of their own.
    const valueLabel = (v: string) =>
      dim?.kind === "flag"
        ? t(v === "true" ? "common:labels.yes" : "common:labels.no")
        : (s.valueIndex.byId.get(`${dimensionId}:${v}`)?.label ?? v);
    params.push({
      label: dim ? fieldLabel(dim.field) : dimensionId,
      value: values.map(valueLabel).join(", "),
    });
  }
  if (s.filters.direction !== "any") {
    params.push({ label: t("matrix.direction"), value: directionLabel(s.filters.direction, t) });
  }
  return params;
}

export interface MatrixSheetsInput {
  data: MatrixPayload | null;
  rowLabel: string;
  colLabel: string;
  leafRows: TreeNode[];
  leafCols: TreeNode[];
  cellMatrix: CellMatrix;
  cellMode: CellMode;
  valueIndex: MatrixValueIndex;
  pairRelationTypes: RelationType[];
  relationTypes: RelationType[];
}

/** The grid sheet: the grid as it looks on screen, one column per visible column leaf. */
export function buildGridSheet(input: MatrixSheetsInput, t: Translate): Omit<ExportSheet, "name"> {
  const { leafRows, leafCols, cellMatrix, cellMode, valueIndex } = input;
  const columns = [
    { key: "row", label: input.rowLabel },
    ...leafCols.map((node, i) => ({ key: `c${i}`, label: node.item.name })),
    { key: "total", label: t("matrix.total"), type: "number" as const },
  ];
  const rows = leafRows.map((rowNode, rowIdx) => {
    const record: Record<string, string | number> = { row: rowNode.item.name };
    leafCols.forEach((_, colIdx) => {
      const cell = getCell(cellMatrix, rowIdx, colIdx);
      const key = `c${colIdx}`;
      if (cell.count === 0) {
        record[key] = "";
      } else if (cellMode === "codes") {
        record[key] =
          cellValues(cell, valueIndex)
            .map((v) => v.code)
            .join(" ") || String(cell.count);
      } else if (cellMode === "labels") {
        record[key] =
          cellValues(cell, valueIndex)
            .map((v) => v.label)
            .join(", ") || String(cell.count);
      } else if (cellMode === "count") {
        record[key] = cell.count;
      } else {
        record[key] = "●";
      }
    });
    record.total = cellMatrix.rowTotals[rowIdx] ?? 0;
    return record;
  });
  return { columns, rows };
}

/**
 * The relations sheet — the one an architect pivots on: a row per visible
 * relation, read from the row card's side, with one column per dimension the
 * relation types in play declare.
 */
export function buildRelationsSheet(
  input: MatrixSheetsInput,
  { t, relationLabel, fieldLabel }: MatrixLabels,
): Omit<ExportSheet, "name"> {
  const { data, leafRows, leafCols, valueIndex, pairRelationTypes, relationTypes } = input;
  const dimensions = valueIndex.dimensions;
  const columns = [
    { key: "rowCard", label: input.rowLabel },
    { key: "colCard", label: input.colLabel },
    { key: "relationType", label: t("matrix.relationType") },
    { key: "direction", label: t("matrix.direction") },
    ...dimensions.map((d) => ({
      key: d.id,
      label:
        pairRelationTypes.length > 1
          ? `${relationLabel(relationTypes.find((r) => r.key === d.relationTypeKey)!)} · ${fieldLabel(d.field)}`
          : fieldLabel(d.field),
    })),
  ];

  const rows: Record<string, string>[] = [];
  if (!data) return { columns, rows };

  const rowNames = new Map(data.rows.map((r) => [r.id, r.name]));
  const colNames = new Map(data.columns.map((c) => [c.id, c.name]));
  const visibleRows = new Set(leafRows.flatMap((n) => n.leafDescendants));
  const visibleCols = new Set(leafCols.flatMap((n) => n.leafDescendants));

  for (const intersection of data.intersections) {
    if (!visibleRows.has(intersection.row_id) || !visibleCols.has(intersection.col_id)) continue;
    for (const [rtIdx, orientation, attrIdx] of intersection.e ?? []) {
      const rtKey = data.relation_types?.[rtIdx];
      const rt = pairRelationTypes.find((r) => r.key === rtKey);
      const attributes = data.attr_sets?.[attrIdx] ?? {};
      const reverse = orientation === "r";
      const record: Record<string, string> = {
        rowCard: rowNames.get(intersection.row_id) ?? "",
        colCard: colNames.get(intersection.col_id) ?? "",
        // Read the verb from the row's point of view, so the sheet says what
        // the row card does rather than what some other card does to it.
        relationType: rt ? relationLabel(rt, reverse) : (rtKey ?? ""),
        direction: reverse ? t("matrix.directionReverse") : t("matrix.directionForward"),
      };
      for (const dim of dimensions) {
        if (dim.relationTypeKey !== rtKey) continue;
        const raw = attributes[dim.field.key];
        if (raw === undefined || raw === null || raw === "") continue;
        // A flag reads as Yes / No; an enum value as its option's label; a
        // scalar (which the index holds no values for) as itself.
        record[dim.id] =
          dim.kind === "flag"
            ? t(raw === true ? "common:labels.yes" : "common:labels.no")
            : (valueIndex.byId.get(`${dim.id}:${raw}`)?.label ?? String(raw));
      }
      rows.push(record);
    }
  }
  return { columns, rows };
}
