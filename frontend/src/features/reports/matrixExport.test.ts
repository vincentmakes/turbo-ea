/**
 * The Matrix report's print summary and export sheets, built from plain data
 * with label resolvers that echo what they were asked, so each test reads
 * exactly which label went where.
 */
import { describe, expect, it } from "vitest";

import type { FieldDef, RelationType } from "@/types";
import type { CellDatum, CellMatrix, MatrixPayload } from "./matrixCells";
import type { MatrixDimension, MatrixValue, MatrixValueIndex } from "./matrixDimensions";
import type { TreeNode } from "./matrixHierarchy";
import {
  buildGridSheet,
  buildPrintParams,
  buildRelationsSheet,
  cellModeLabel,
  directionLabel,
  sortModeLabel,
  type MatrixLabels,
  type MatrixPrintState,
  type MatrixSheetsInput,
} from "./matrixExport";
import { EMPTY_FILTERS } from "./matrixState";

const t = (key: string, options?: Record<string, unknown>) =>
  options ? `${key}${JSON.stringify(options)}` : key;

const labels: MatrixLabels = {
  t,
  relationLabel: (rt, reverse) => `${rt.key}${reverse ? "←" : "→"}`,
  fieldLabel: (field) => `field:${field.key}`,
};

const rt = (key: string) =>
  ({ key, source_type_key: "App", target_type_key: "Cap" }) as RelationType;

const field = (key: string): FieldDef => ({ key, label: key, type: "text" }) as FieldDef;

const dim = (
  relationTypeKey: string,
  key: string,
  kind: MatrixDimension["kind"],
): MatrixDimension => ({
  id: `${relationTypeKey}.${key}`,
  relationTypeKey,
  field: field(key),
  kind,
});

const value = (
  id: string,
  label: string,
  code: string,
  kind: "flag" | "enum" = "enum",
): MatrixValue => ({
  id,
  dimensionId: id.split(":")[0],
  relationTypeKey: id.split(".")[0],
  fieldKey: "f",
  kind,
  code,
  label,
  color: "#000",
});

function index(dimensions: MatrixDimension[], values: MatrixValue[]): MatrixValueIndex {
  return {
    dimensions,
    values,
    byId: new Map(values.map((v) => [v.id, v])),
    byRelationType: new Map(),
  };
}

const leaf = (id: string, name: string, descendants = [id]): TreeNode => ({
  item: { id, name, parent_id: null },
  children: [],
  depth: 0,
  leafCount: 1,
  leafDescendants: descendants,
  isPrunedGroup: false,
  originalLeafCount: 1,
});

function matrix(
  cells: [number, number, Partial<CellDatum>][],
  numCols: number,
  rowTotals: number[],
): CellMatrix {
  return {
    cells: new Map(
      cells.map(([r, c, d]) => [
        r * numCols + c,
        { count: 0, dirMask: 0, valueIds: [], relationTypeKeys: [], ...d },
      ]),
    ),
    numCols,
    rowTotals: Int32Array.from(rowTotals),
    colTotals: new Int32Array(numCols),
    max: 0,
    grandTotal: 0,
    emptyRowIndices: new Set(),
    emptyColIndices: new Set(),
    droppedEdges: 0,
  };
}

describe("mode and direction labels", () => {
  it("names every sort, cell mode and direction", () => {
    expect(["alpha", "count", "hierarchy"].map((m) => sortModeLabel(m as never, t))).toEqual([
      "matrix.alphaSort",
      "matrix.byCount",
      "matrix.hierarchy",
    ]);
    expect(["exists", "count", "codes", "labels"].map((m) => cellModeLabel(m as never, t))).toEqual(
      ["matrix.existsDot", "matrix.countHeatmap", "matrix.codes", "matrix.labels"],
    );
    expect(["any", "forward", "reverse"].map((d) => directionLabel(d as never, t))).toEqual([
      "matrix.directionAny",
      "matrix.directionForward",
      "matrix.directionReverse",
    ]);
  });
});

describe("buildPrintParams", () => {
  const base: MatrixPrintState = {
    rowLabel: "Applications",
    colLabel: "Capabilities",
    rowScopeCount: 0,
    colScopeCount: 0,
    cellMode: "exists",
    sortRows: "hierarchy",
    sortCols: "alpha",
    hideEmpty: false,
    showOnlyGaps: false,
    filters: EMPTY_FILTERS,
    pairRelationTypes: [],
    valueIndex: index([], []),
  };

  it("always names the axes, the cell mode and both sorts", () => {
    expect(buildPrintParams(base, labels)).toEqual([
      { label: "matrix.rows", value: "Applications" },
      { label: "matrix.columns", value: "Capabilities" },
      { label: "matrix.cell", value: "matrix.existsDot" },
      { label: "matrix.sortRows", value: "matrix.hierarchy" },
      { label: "matrix.sortColumns", value: "matrix.alphaSort" },
    ]);
  });

  it("adds every scope, toggle and filter in play, in order", () => {
    const usage = dim("relA", "usage", "enum");
    const critical = dim("relA", "critical", "flag");
    const params = buildPrintParams(
      {
        ...base,
        rowScopeCount: 2,
        colScopeCount: 1,
        cellMode: "codes",
        hideEmpty: true,
        showOnlyGaps: true,
        pairRelationTypes: [rt("relA")],
        valueIndex: index([usage, critical], [value("relA.usage:owns", "Owns", "O")]),
        filters: {
          relationTypes: ["relA", "relGone"],
          attrValues: {
            "relA.usage": ["owns", "raw"],
            "relA.critical": ["true", "false"],
            "relA.empty": [],
            "relGone.x": ["v"],
          },
          direction: "reverse",
        },
      },
      labels,
    );
    expect(params).toEqual([
      { label: "matrix.rows", value: "Applications" },
      { label: "matrix.columns", value: "Capabilities" },
      { label: "matrix.scopeRows", value: 'matrix.scopeCountRows{"count":2}' },
      { label: "matrix.scopeCols", value: 'matrix.scopeCountCols{"count":1}' },
      { label: "matrix.cell", value: "matrix.codes" },
      { label: "matrix.sortRows", value: "matrix.hierarchy" },
      { label: "matrix.sortColumns", value: "matrix.alphaSort" },
      { label: "matrix.hideUnrelated", value: "matrix.on" },
      { label: "matrix.showOnlyGaps", value: "matrix.on" },
      { label: "matrix.relationType", value: "relA→, relGone" },
      { label: "field:usage", value: "Owns, raw" },
      { label: "field:critical", value: "common:labels.yes, common:labels.no" },
      { label: "relGone.x", value: "v" },
      { label: "matrix.direction", value: "matrix.directionReverse" },
    ]);
  });
});

describe("export sheets", () => {
  const usage = dim("relA", "usage", "enum");
  const critical = dim("relA", "critical", "flag");
  const note = dim("relA", "note", "scalar");
  const other = dim("relB", "since", "scalar");
  const idx = index(
    [usage, critical, note, other],
    [value("relA.usage:owns", "Owns", "O"), value("relA.usage:uses", "Uses", "U")],
  );

  const data: MatrixPayload = {
    rows: [
      { id: "r1", name: "ERP", parent_id: null },
      { id: "r2", name: "CRM", parent_id: null },
    ],
    columns: [
      { id: "c1", name: "Billing", parent_id: null },
      { id: "c2", name: "Sales", parent_id: null },
    ],
    relation_types: ["relA", "relB", "relGone"],
    attr_sets: [
      { usage: "owns", critical: true, note: "core", since: "2020" },
      { usage: "odd", critical: false, note: "" },
      {},
    ],
    intersections: [
      {
        row_id: "r1",
        col_id: "c1",
        e: [
          [0, "f", 0],
          [1, "r", 0],
        ],
      },
      {
        row_id: "r2",
        col_id: "c2",
        e: [
          [0, "r", 1],
          [2, "f", 9],
        ],
      },
      { row_id: "r2", col_id: "c1" },
      { row_id: "hidden", col_id: "c1", e: [[0, "f", 0]] },
      { row_id: "r1", col_id: "hidden", e: [[0, "f", 0]] },
    ],
  };

  const input = (over: Partial<MatrixSheetsInput> = {}): MatrixSheetsInput => ({
    data,
    rowLabel: "Applications",
    colLabel: "Capabilities",
    leafRows: [leaf("r1", "ERP"), leaf("r2", "CRM")],
    leafCols: [leaf("c1", "Billing"), leaf("c2", "Sales")],
    cellMatrix: matrix(
      [
        [0, 0, { count: 2, valueIds: ["relA.usage:owns", "relA.usage:uses"] }],
        [1, 1, { count: 3 }],
      ],
      2,
      [2, 3],
    ),
    cellMode: "exists",
    valueIndex: idx,
    pairRelationTypes: [rt("relA"), rt("relB")],
    relationTypes: [rt("relA"), rt("relB")],
    ...over,
  });

  it("lays the grid out with a total column", () => {
    const sheet = buildGridSheet(input(), t);
    expect(sheet.columns).toEqual([
      { key: "row", label: "Applications" },
      { key: "c0", label: "Billing" },
      { key: "c1", label: "Sales" },
      { key: "total", label: "matrix.total", type: "number" },
    ]);
    expect(sheet.rows).toEqual([
      { row: "ERP", c0: "●", c1: "", total: 2 },
      { row: "CRM", c0: "", c1: "●", total: 3 },
    ]);
  });

  it.each([
    ["count", 2, 3],
    ["codes", "O U", "3"],
    ["labels", "Owns, Uses", "3"],
  ] as const)("fills a %s grid with what the cell shows", (cellMode, valued, plain) => {
    const rows = buildGridSheet(input({ cellMode }), t).rows;
    expect(rows[0].c0).toBe(valued);
    // A cell whose relations carry no values falls back to its count.
    expect(rows[1].c1).toBe(plain);
  });

  it("totals a row with no total as zero", () => {
    const rows = buildGridSheet(input({ cellMatrix: matrix([], 2, []) }), t).rows;
    expect(rows.map((r) => r.total)).toEqual([0, 0]);
  });

  it("lists every visible relation with its attributes, read from the row's side", () => {
    const sheet = buildRelationsSheet(input(), labels);
    expect(sheet.columns).toEqual([
      { key: "rowCard", label: "Applications" },
      { key: "colCard", label: "Capabilities" },
      { key: "relationType", label: "matrix.relationType" },
      { key: "direction", label: "matrix.direction" },
      { key: "relA.usage", label: "relA→ · field:usage" },
      { key: "relA.critical", label: "relA→ · field:critical" },
      { key: "relA.note", label: "relA→ · field:note" },
      { key: "relB.since", label: "relB→ · field:since" },
    ]);
    expect(sheet.rows).toEqual([
      {
        rowCard: "ERP",
        colCard: "Billing",
        relationType: "relA→",
        direction: "matrix.directionForward",
        "relA.usage": "Owns",
        "relA.critical": "common:labels.yes",
        "relA.note": "core",
      },
      {
        rowCard: "ERP",
        colCard: "Billing",
        relationType: "relB←",
        direction: "matrix.directionReverse",
        "relB.since": "2020",
      },
      {
        rowCard: "CRM",
        colCard: "Sales",
        relationType: "relA←",
        direction: "matrix.directionReverse",
        "relA.usage": "odd",
        "relA.critical": "common:labels.no",
      },
      {
        rowCard: "CRM",
        colCard: "Sales",
        relationType: "relGone",
        direction: "matrix.directionForward",
      },
    ]);
  });

  it("names a dimension by its field alone when one relation type connects the axes", () => {
    const sheet = buildRelationsSheet(input({ pairRelationTypes: [rt("relA")] }), labels);
    expect(sheet.columns.slice(4).map((c) => c.label)).toEqual([
      "field:usage",
      "field:critical",
      "field:note",
      "field:since",
    ]);
  });

  it("reaches a hidden card only through a group it belongs to", () => {
    const sheet = buildRelationsSheet(
      input({
        leafRows: [leaf("g", "Group", ["r1", "hidden"])],
        leafCols: [leaf("c1", "Billing")],
      }),
      labels,
    );
    expect(sheet.rows.map((r) => [r.rowCard, r.colCard, r.relationType])).toEqual([
      ["ERP", "Billing", "relA→"],
      ["ERP", "Billing", "relB←"],
      ["", "Billing", "relA→"],
    ]);
  });

  it("is empty without data", () => {
    const sheet = buildRelationsSheet(input({ data: null }), labels);
    expect(sheet.rows).toEqual([]);
    expect(sheet.columns.map((c) => c.key)).toEqual([
      "rowCard",
      "colCard",
      "relationType",
      "direction",
      "relA.usage",
      "relA.critical",
      "relA.note",
      "relB.since",
    ]);
  });

  it("leaves out a value that is missing, null or empty", () => {
    const sheet = buildRelationsSheet(
      input({
        data: {
          ...data,
          attr_sets: [{}, { usage: null, critical: null, note: null }, { usage: "", note: "" }],
          intersections: [
            {
              row_id: "r1",
              col_id: "c1",
              e: [
                [0, "f", 0],
                [0, "f", 1],
                [0, "f", 2],
              ],
            },
          ],
        },
      }),
      labels,
    );
    for (const row of sheet.rows) {
      expect(Object.keys(row)).toEqual(["rowCard", "colCard", "relationType", "direction"]);
    }
    expect(sheet.rows).toHaveLength(3);
  });

  it("reads a scalar value as itself, even when it looks like an option", () => {
    const sheet = buildRelationsSheet(
      input({
        data: {
          ...data,
          attr_sets: [{ note: "owns", usage: 3 }],
          intersections: [{ row_id: "r1", col_id: "c1", e: [[0, "f", 0]] }],
        },
      }),
      labels,
    );
    expect(sheet.rows[0]).toMatchObject({ "relA.note": "owns", "relA.usage": "3" });
  });

  it("copes with a payload that names no relation types or attribute sets", () => {
    const sheet = buildRelationsSheet(
      input({
        data: {
          rows: data.rows,
          columns: data.columns,
          intersections: [{ row_id: "r1", col_id: "c1", e: [[0, "f", 0]] }],
        },
      }),
      labels,
    );
    expect(sheet.rows).toEqual([
      {
        rowCard: "ERP",
        colCard: "Billing",
        relationType: "",
        direction: "matrix.directionForward",
      },
    ]);
  });

  it("leaves a card the payload does not name blank, on either axis", () => {
    const sheet = buildRelationsSheet(
      input({ leafRows: [leaf("r1", "ERP")], leafCols: [leaf("g", "Group", ["c1", "hidden"])] }),
      labels,
    );
    expect(sheet.rows.map((r) => [r.rowCard, r.colCard])).toEqual([
      ["ERP", "Billing"],
      ["ERP", "Billing"],
      ["ERP", ""],
    ]);
  });
});
