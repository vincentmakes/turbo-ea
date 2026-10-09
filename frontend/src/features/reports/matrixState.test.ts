/**
 * The Matrix report's state rules, one by one. The MatrixReport suites cover
 * the same behaviour through the page; these pin each rule where it lives.
 */
import { describe, expect, it } from "vitest";

import type { RelationType } from "@/types";
import { DIR_FORWARD, DIR_REVERSE, type CellDatum } from "./matrixCells";
import type { MatrixValue, MatrixValueIndex } from "./matrixDimensions";
import { buildTree, type MatrixItem, type TreeNode } from "./matrixHierarchy";
import {
  CELL_MODES,
  DIRECTIONS,
  EMPTY_FILTERS,
  HEAT_COLORS_DARK,
  HEAT_COLORS_LIGHT,
  activeFilterCount,
  axisHasHierarchy,
  cellTitle,
  cellValues,
  columnHeaderRowsFor,
  coveragePercent,
  directionBorder,
  effectiveDepth,
  effectiveSort,
  flatLeafNodes,
  heatColor,
  hoveredIds,
  legendGroups,
  matchesSearch,
  matrixPath,
  pairRelationTypes,
  parentsWithOwnRelations,
  relationCounts,
  rowHeaderLayoutFor,
  sanitiseFilters,
  searchedIds,
  stepDepth,
  totalRelations,
  visibleIds,
} from "./matrixState";

const item = (id: string, parent_id: string | null = null, name = id): MatrixItem => ({
  id,
  name,
  parent_id,
});

const rt = (key: string, source: string, target: string) =>
  ({ key, source_type_key: source, target_type_key: target }) as RelationType;

const cell = (over: Partial<CellDatum> = {}): CellDatum => ({
  count: 1,
  dirMask: 0,
  valueIds: [],
  relationTypeKeys: [],
  ...over,
});

const value = (id: string, label: string, code = label[0]): MatrixValue => ({
  id,
  dimensionId: id.split(":")[0],
  relationTypeKey: id.split(".")[0],
  fieldKey: "f",
  kind: "enum",
  code,
  label,
  color: "#123456",
});

function index(values: MatrixValue[]): MatrixValueIndex {
  const byRelationType = new Map<string, MatrixValue[]>();
  for (const v of values) {
    byRelationType.set(v.relationTypeKey, [...(byRelationType.get(v.relationTypeKey) ?? []), v]);
  }
  return {
    dimensions: [],
    values,
    byId: new Map(values.map((v) => [v.id, v])),
    byRelationType,
  };
}

/** A fake t that shows the key and its options, so a test can see what was asked. */
const t = (key: string, options?: Record<string, unknown>) =>
  options ? `${key}${JSON.stringify(options)}` : key;

describe("constants", () => {
  it("pins the cell modes, directions and empty filter", () => {
    expect(CELL_MODES).toEqual(["exists", "count", "codes", "labels"]);
    expect(DIRECTIONS).toEqual(["any", "forward", "reverse"]);
    expect(EMPTY_FILTERS).toEqual({ relationTypes: [], attrValues: {}, direction: "any" });
  });
});

describe("heatColor", () => {
  it("leaves an empty cell or an empty grid on the paper colour", () => {
    expect(heatColor(0, 10, "paper", false)).toBe("paper");
    expect(heatColor(-1, 10, "paper", false)).toBe("paper");
    expect(heatColor(5, 0, "paper", false)).toBe("paper");
  });

  it("shades a count across ten steps, light and dark", () => {
    expect(HEAT_COLORS_LIGHT).toHaveLength(10);
    expect(HEAT_COLORS_DARK).toHaveLength(10);
    expect(heatColor(1, 10, "p", false)).toBe("#e3f2fd");
    expect(heatColor(4, 10, "p", false)).toBe("#64b5f6"); // 3.6 → step 3
    expect(heatColor(5, 10, "p", false)).toBe("#42a5f5"); // 4.5 → step 4
    expect(heatColor(10, 10, "p", false)).toBe("#0d47a1");
    expect(heatColor(10, 10, "p", true)).toBe("#42a5f5");
    expect(heatColor(1, 10, "p", true)).toBe("#0d2137");
  });

  it("caps a count above the maximum at the darkest step", () => {
    expect(heatColor(30, 10, "p", false)).toBe("#0d47a1");
  });
});

describe("sanitiseFilters", () => {
  it.each([undefined, null, "x", 3, ["a"]])(
    "falls back to the shared empty filter for %j",
    (raw) => {
      expect(sanitiseFilters(raw)).toBe(EMPTY_FILTERS);
    },
  );

  it("keeps the well-formed parts and drops the rest", () => {
    expect(
      sanitiseFilters({
        relationTypes: ["relA", 3, null, "relB"],
        attrValues: {
          "relA.usage": ["owns", 1, "uses"],
          "relA.empty": [],
          "relA.junk": [7],
          "relA.notList": "owns",
        },
        direction: "reverse",
      }),
    ).toEqual({
      relationTypes: ["relA", "relB"],
      attrValues: { "relA.usage": ["owns", "uses"] },
      direction: "reverse",
    });
  });

  it("reads no attribute filter from a missing, primitive or list value", () => {
    expect(sanitiseFilters({ direction: "forward" })).toEqual({
      ...EMPTY_FILTERS,
      direction: "forward",
    });
    expect(sanitiseFilters({ attrValues: "x" })).toEqual(EMPTY_FILTERS);
    expect(sanitiseFilters({ attrValues: 5 })).toEqual(EMPTY_FILTERS);
    expect(sanitiseFilters({ attrValues: [["owns"]] })).toEqual(EMPTY_FILTERS);
  });

  it("drops relation types that are not a list, and an unknown direction", () => {
    expect(sanitiseFilters({ relationTypes: "relA", direction: "up" })).toEqual(EMPTY_FILTERS);
  });
});

describe("activeFilterCount", () => {
  it("counts the relation-type pick once, each non-empty attribute, and the direction", () => {
    expect(activeFilterCount(EMPTY_FILTERS)).toBe(0);
    expect(
      activeFilterCount({
        relationTypes: ["a", "b"],
        attrValues: { x: ["1"], y: ["2", "3"], z: [] },
        direction: "forward",
      }),
    ).toBe(4);
  });
});

describe("matrixPath", () => {
  it("asks for the axis pair", () => {
    expect(matrixPath("Application", "BusinessCapability", EMPTY_FILTERS)).toBe(
      "/reports/matrix?row_type=Application&col_type=BusinessCapability",
    );
  });

  it("writes the filters sorted, so equivalent sets share one path", () => {
    const a = matrixPath("A", "B", {
      relationTypes: ["relZ", "relA"],
      attrValues: { "relZ.u": ["y", "x"], "relA.u": ["k"] },
      direction: "reverse",
    });
    const b = matrixPath("A", "B", {
      relationTypes: ["relA", "relZ"],
      attrValues: { "relA.u": ["k"], "relZ.u": ["x", "y"] },
      direction: "reverse",
    });
    expect(a).toBe(b);
    expect(a).toBe(
      "/reports/matrix?row_type=A&col_type=B&relation_types=relA%2CrelZ" +
        "&attr=relA.u%3Ak&attr=relZ.u%3Ax&attr=relZ.u%3Ay&direction=reverse",
    );
  });

  it("does not reorder the filters it was given", () => {
    const filters = {
      relationTypes: ["b", "a"],
      attrValues: { k: ["2", "1"] },
      direction: "any" as const,
    };
    matrixPath("A", "B", filters);
    expect(filters.relationTypes).toEqual(["b", "a"]);
    expect(filters.attrValues.k).toEqual(["2", "1"]);
  });
});

describe("pairRelationTypes", () => {
  it("keeps every type connecting the axes, either way round", () => {
    const types = [
      rt("owns", "Org", "App"),
      rt("uses", "Org", "App"),
      rt("runsOn", "App", "Org"),
      rt("other", "App", "IT"),
      rt("self", "Org", "Org"),
    ];
    expect(pairRelationTypes(types, "App", "Org").map((r) => r.key)).toEqual([
      "owns",
      "uses",
      "runsOn",
    ]);
    expect(pairRelationTypes(types, "Org", "Org").map((r) => r.key)).toEqual(["self"]);
    expect(pairRelationTypes(types, "App", "Nope")).toEqual([]);
  });
});

describe("axes", () => {
  const types = [
    { key: "Cap", has_hierarchy: true },
    { key: "Flat", has_hierarchy: false },
  ];

  it("takes the metamodel's word on hierarchy", () => {
    expect(axisHasHierarchy(types, "Cap", [item("a")])).toBe(true);
    expect(axisHasHierarchy(types, "Cap", null)).toBe(true);
    expect(axisHasHierarchy(types, "Flat", [item("a"), item("b", "a")])).toBe(false);
  });

  it("judges an unknown type by its cards", () => {
    expect(axisHasHierarchy(types, "X", [item("a"), item("b", "a")])).toBe(true);
    expect(axisHasHierarchy(types, "X", [item("a")])).toBe(false);
    expect(axisHasHierarchy(types, "X", null)).toBe(false);
  });

  it("reads a hierarchy sort as A → Z on a flat axis", () => {
    expect(effectiveSort("hierarchy", true)).toBe("hierarchy");
    expect(effectiveSort("hierarchy", false)).toBe("alpha");
    expect(effectiveSort("count", false)).toBe("count");
    expect(effectiveSort("alpha", true)).toBe("alpha");
  });

  it("clamps the depth to the tree", () => {
    const tree = buildTree([item("a"), item("b", "a"), item("c", "b")]);
    expect(tree.maxDepth).toBe(2);
    expect(effectiveDepth(tree, Infinity)).toBe(2);
    expect(effectiveDepth(tree, 1)).toBe(1);
    expect(effectiveDepth(tree, 5)).toBe(2);
    expect(effectiveDepth(null, 3)).toBe(0);
  });

  it("steps the depth within 0 and the tree", () => {
    expect(stepDepth(Infinity, 3, -1)).toBe(2);
    expect(stepDepth(2, 3, -1)).toBe(1);
    expect(stepDepth(0, 3, -1)).toBe(0);
    expect(stepDepth(1, 3, 1)).toBe(2);
    expect(stepDepth(3, 3, 1)).toBe(3);
    expect(stepDepth(Infinity, 3, 1)).toBe(3);
    expect(stepDepth(7, 3, -1)).toBe(2);
  });
});

describe("search", () => {
  it("matches names case-insensitively", () => {
    expect(matchesSearch("Order Management", "MANAGE")).toBe(true);
    expect(matchesSearch("Order", "bill")).toBe(false);
  });

  it("keeps the matching ids, or nothing to filter without a query or data", () => {
    const items = [
      item("1", null, "Billing"),
      item("2", null, "CRM"),
      item("3", null, "billing hub"),
    ];
    expect(searchedIds(items, "BILL")).toEqual(new Set(["1", "3"]));
    expect(searchedIds(items, "   ")).toBeNull();
    expect(searchedIds(items, "")).toBeNull();
    expect(searchedIds(null, "bill")).toBeNull();
  });

  it("matches the query as typed, spaces included", () => {
    const items = [item("1", null, "Order hub"), item("2", null, "Orderhub")];
    expect(searchedIds(items, "r h")).toEqual(new Set(["1"]));
  });
});

describe("visibleIds", () => {
  const all = [{ id: "a" }, { id: "b" }, { id: "c" }];
  const related = new Set(["a", "b"]);
  const none = { hideEmpty: false, showOnlyGaps: false };

  it("shows everything with no toggle and no search", () => {
    expect(visibleIds(all, related, null, none)).toBeNull();
  });

  it("hides the unrelated, or shows only the gaps", () => {
    expect(visibleIds(all, related, null, { hideEmpty: true, showOnlyGaps: false })).toBe(related);
    expect(visibleIds(all, related, null, { hideEmpty: false, showOnlyGaps: true })).toEqual(
      new Set(["c"]),
    );
    expect(visibleIds(all, related, null, { hideEmpty: true, showOnlyGaps: true })).toBe(related);
  });

  it("narrows a coverage view by the search", () => {
    const searched = new Set(["b", "c"]);
    expect(visibleIds(all, related, searched, none)).toBe(searched);
    expect(visibleIds(all, related, searched, { hideEmpty: true, showOnlyGaps: false })).toEqual(
      new Set(["b"]),
    );
    expect(visibleIds(all, related, searched, { hideEmpty: false, showOnlyGaps: true })).toEqual(
      new Set(["c"]),
    );
  });
});

describe("parentsWithOwnRelations", () => {
  const tree = buildTree([item("p"), item("c", "p"), item("leaf")]);

  it("finds the related cards that also have children", () => {
    expect(parentsWithOwnRelations(tree, new Set(["p", "c", "leaf", "gone"]))).toEqual(
      new Set(["p"]),
    );
    expect(parentsWithOwnRelations(tree, new Set(["c"]))).toEqual(new Set());
    expect(parentsWithOwnRelations(null, new Set(["p"]))).toEqual(new Set());
  });
});

describe("relationCounts", () => {
  it("sums each card's relations on each axis, skipping empty intersections", () => {
    const { rows, cols } = relationCounts([
      {
        row_id: "r1",
        col_id: "c1",
        e: [
          [0, "f", 0],
          [1, "r", 0],
        ],
      },
      { row_id: "r1", col_id: "c2", e: [[0, "f", 0]] },
      { row_id: "r2", col_id: "c1", e: [] },
      { row_id: "r3", col_id: "c3" },
    ]);
    expect([...rows]).toEqual([["r1", 3]]);
    expect([...cols]).toEqual([
      ["c1", 2],
      ["c2", 1],
    ]);
  });
});

describe("flatLeafNodes", () => {
  const items = [item("1", null, "beta"), item("2", null, "Alpha"), item("3", null, "gamma")];
  const counts = new Map([
    ["3", 5],
    ["1", 2],
  ]);

  it("sorts by name, or by relation count with the most first", () => {
    expect(flatLeafNodes(items, null, "alpha", counts).map((n) => n.item.id)).toEqual([
      "2",
      "1",
      "3",
    ]);
    expect(flatLeafNodes(items, null, "hierarchy", counts).map((n) => n.item.id)).toEqual([
      "2",
      "1",
      "3",
    ]);
    expect(flatLeafNodes(items, null, "count", counts).map((n) => n.item.id)).toEqual([
      "3",
      "1",
      "2",
    ]);
  });

  it("keeps only the visible cards", () => {
    expect(
      flatLeafNodes(items, new Set(["3", "1"]), "alpha", counts).map((n) => n.item.id),
    ).toEqual(["1", "3"]);
  });

  it("makes each card a one-leaf node, leaving the input in its order", () => {
    const [node] = flatLeafNodes([items[0]], null, "alpha", counts);
    expect(node).toEqual({
      item: items[0],
      children: [],
      depth: 0,
      leafCount: 1,
      leafDescendants: ["1"],
      isPrunedGroup: false,
      originalLeafCount: 1,
    });
    flatLeafNodes(items, null, "alpha", counts);
    expect(items.map((i) => i.id)).toEqual(["1", "2", "3"]);
  });
});

describe("header layouts", () => {
  const tree = buildTree([item("p"), item("c1", "p"), item("c2", "p")]);
  const leaves = flatLeafNodes([item("x"), item("y")], null, "alpha", new Map());

  it("merges a hierarchy's levels", () => {
    const rows = columnHeaderRowsFor(tree.roots, tree.maxDepth, 1, leaves);
    expect(rows).toHaveLength(2);
    expect(rows[0][0]).toMatchObject({ colspan: 2 });
    const layout = rowHeaderLayoutFor(tree.roots, tree.maxDepth, 1, leaves);
    expect(layout).toHaveLength(2);
    expect(layout[0][0]).toMatchObject({ rowspan: 2 });
  });

  it("lays a flat axis out as one row of leaves", () => {
    for (const pruned of [null, tree.roots]) {
      const maxDepth = pruned ? 0 : tree.maxDepth;
      expect(columnHeaderRowsFor(pruned, maxDepth, 1, leaves)).toEqual([
        leaves.map((node) => ({
          node,
          colspan: 1,
          rowspan: 1,
          isLeaf: true,
          isPrunedGroup: false,
        })),
      ]);
      expect(rowHeaderLayoutFor(pruned, maxDepth, 1, leaves)).toEqual(
        leaves.map((node) => [{ node, rowspan: 1, isLeaf: true, isPrunedGroup: false }]),
      );
    }
  });
});

describe("hoveredIds", () => {
  const group = { leafDescendants: ["a", "b"] } as TreeNode;
  const empty = { leafDescendants: [] as string[] } as TreeNode;
  const nodes = new Map([
    ["g", group],
    ["e", empty],
  ]);

  it("covers a group's leaves, or the header itself", () => {
    expect(hoveredIds("g", nodes)).toEqual(new Set(["a", "b"]));
    expect(hoveredIds("e", nodes)).toEqual(new Set(["e"]));
    expect(hoveredIds("leaf", nodes)).toEqual(new Set(["leaf"]));
    expect(hoveredIds(null, nodes)).toEqual(new Set());
  });
});

describe("KPIs", () => {
  const intersections = [
    {
      row_id: "r1",
      col_id: "c1",
      e: [
        [0, "f", 0],
        [0, "f", 1],
      ] as [number, string, number][],
    },
    { row_id: "r2", col_id: "c1", e: [[0, "f", 0]] as [number, string, number][] },
    { row_id: "r1", col_id: "c2" },
  ];

  it("counts relations within each axis's scope", () => {
    expect(totalRelations(intersections, null, null)).toBe(3);
    expect(totalRelations(intersections, new Set(["r1"]), null)).toBe(2);
    expect(totalRelations(intersections, null, new Set(["c2"]))).toBe(0);
    expect(totalRelations(intersections, new Set(["r2"]), new Set(["c1"]))).toBe(1);
  });

  it("gives coverage to one decimal", () => {
    expect(coveragePercent(1, 3, 1)).toBe("33.3");
    expect(coveragePercent(4, 2, 2)).toBe("100.0");
    expect(coveragePercent(0, 0, 5)).toBe("0");
    expect(coveragePercent(0, 5, 0)).toBe("0");
  });
});

describe("cells", () => {
  const owns = value("relA.usage:owns", "Owns", "O");
  const uses = value("relA.usage:uses", "Uses", "U");
  const idx = index([owns, uses]);

  it("finds a cell's values in legend order, skipping unknown ids", () => {
    expect(
      cellValues(cell({ valueIds: ["relA.usage:uses", "gone", "relA.usage:owns"] }), idx),
    ).toEqual([uses, owns]);
    expect(cellValues(cell(), idx)).toEqual([]);
  });

  it("tells a cell's whole story", () => {
    expect(
      cellTitle("ERP", "Billing", cell({ count: 2, dirMask: DIR_FORWARD }), true, [owns, uses], t),
    ).toBe(
      [
        "ERP × Billing",
        'matrix.relations{"count":2}',
        "matrix.aggregatedHint",
        "Owns, Uses",
        "matrix.directionForward",
      ].join("\n"),
    );
  });

  it("names each direction, and leaves out what a cell does not have", () => {
    const title = (dirMask: number) =>
      cellTitle("A", "B", cell({ dirMask }), false, [], t).split("\n");
    expect(title(DIR_REVERSE)).toEqual([
      "A × B",
      'matrix.relations{"count":1}',
      "matrix.directionReverse",
    ]);
    expect(title(DIR_FORWARD | DIR_REVERSE)).toEqual([
      "A × B",
      'matrix.relations{"count":1}',
      "matrix.directionBoth",
    ]);
    expect(title(0)).toEqual(["A × B", 'matrix.relations{"count":1}']);
  });

  it("borders the side each direction belongs to", () => {
    expect(directionBorder(DIR_FORWARD, "left", "#1976d2")).toBe("2px solid #1976d2");
    expect(directionBorder(DIR_FORWARD, "right", "#1976d2")).toBeUndefined();
    expect(directionBorder(DIR_REVERSE, "right", "red")).toBe("2px solid red");
    expect(directionBorder(DIR_REVERSE, "left", "red")).toBeUndefined();
    expect(directionBorder(DIR_FORWARD | DIR_REVERSE, "left", "c")).toBe("2px solid c");
    expect(directionBorder(DIR_FORWARD | DIR_REVERSE, "right", "c")).toBe("2px solid c");
    expect(directionBorder(0, "left", "c")).toBeUndefined();
  });

  it("groups the legend per relation type, only in the value modes", () => {
    const types = [rt("relA", "X", "Y"), rt("relB", "X", "Y")];
    const groups = legendGroups("codes", types, idx);
    expect(groups).toEqual([{ rt: types[0], values: [owns, uses] }]);
    expect(legendGroups("labels", types, idx)).toEqual(groups);
    expect(legendGroups("exists", types, idx)).toEqual([]);
    expect(legendGroups("count", types, idx)).toEqual([]);
  });
});
