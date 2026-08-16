import { describe, it, expect } from "vitest";
import type { ColDef } from "ag-grid-community";
import {
  MAX_ORDER_IDS,
  applyVisibleOrder,
  colIdOf,
  isFixedColumn,
  isInternalColId,
  isOrderableColumn,
  mergeOrder,
  sameOrder,
  sortColumnsByOrder,
} from "./columnOrder";

describe("colIdOf / isOrderableColumn", () => {
  it("prefers colId, falls back to field", () => {
    expect(colIdOf({ colId: "a", field: "b" })).toBe("a");
    expect(colIdOf({ field: "b" })).toBe("b");
    expect(colIdOf({})).toBe("");
  });

  it("treats AG Grid's own generated columns as internal", () => {
    expect(isInternalColId("ag-Grid-ControlsColumn")).toBe(true);
    expect(isInternalColId("name")).toBe(false);
  });

  it("treats suppressMovable and lockPosition columns as fixed", () => {
    expect(isFixedColumn({ colId: "actions", suppressMovable: true })).toBe(true);
    expect(isFixedColumn({ colId: "first", lockPosition: "left" })).toBe(true);
    expect(isFixedColumn({ colId: "name" })).toBe(false);
  });

  it("only orderable columns are id-bearing, external and movable", () => {
    expect(isOrderableColumn({ colId: "name" })).toBe(true);
    expect(isOrderableColumn({})).toBe(false);
    expect(isOrderableColumn({ colId: "ag-Grid-ControlsColumn" })).toBe(false);
    expect(isOrderableColumn({ colId: "actions", suppressMovable: true })).toBe(false);
  });
});

describe("mergeOrder", () => {
  it("with nothing stored, keeps the natural order", () => {
    expect(mergeOrder(["a", "b", "c"], [])).toEqual(["a", "b", "c"]);
  });

  it("the stored order wins over the natural one", () => {
    expect(mergeOrder(["a", "b", "c"], ["c", "a", "b"])).toEqual(["c", "a", "b"]);
  });

  // The inventory case: the first render carries only core columns, so a merge
  // that pruned unknown ids would wipe every attribute position on mount.
  it("keeps stored ids that are not currently present", () => {
    expect(mergeOrder(["a"], ["b", "a", "c"])).toEqual(["b", "a", "c"]);
  });

  it("anchors a block of new ids in its natural neighbourhood", () => {
    const natural = ["core_name", "attr_x", "attr_y", "attr_z", "meta_created"];
    const stored = ["core_name", "meta_created"];
    expect(mergeOrder(natural, stored)).toEqual([
      "core_name",
      "attr_x",
      "attr_y",
      "attr_z",
      "meta_created",
    ]);
  });

  it("puts a new id with no placed predecessor at the head", () => {
    expect(mergeOrder(["new", "a"], ["a"])).toEqual(["new", "a"]);
  });

  it("ignores empty ids", () => {
    expect(mergeOrder(["a", "", "b"], [])).toEqual(["a", "b"]);
  });

  it("prunes only absent ids once over MAX_ORDER_IDS", () => {
    const stale = Array.from({ length: MAX_ORDER_IDS + 20 }, (_, i) => `stale_${i}`);
    const natural = ["live_a", "live_b"];
    const merged = mergeOrder(natural, stale);

    expect(merged.length).toBe(MAX_ORDER_IDS);
    // Every column actually on screen survives the prune.
    expect(merged).toContain("live_a");
    expect(merged).toContain("live_b");
  });
});

describe("sortColumnsByOrder", () => {
  const cols: ColDef[] = [
    { colId: "a" },
    { colId: "b" },
    { colId: "c" },
  ];

  it("permutes movable columns into the stored order", () => {
    expect(sortColumnsByOrder(cols, ["c", "a", "b"]).map(colIdOf)).toEqual(["c", "a", "b"]);
  });

  it("sorts unknown ids last, stably", () => {
    expect(sortColumnsByOrder(cols, ["c"]).map(colIdOf)).toEqual(["c", "a", "b"]);
  });

  it("holds a suppressMovable action column at its own index", () => {
    const withAction: ColDef[] = [
      { colId: "a" },
      { colId: "b" },
      { colId: "actions", suppressMovable: true },
    ];
    // "actions" is last in the array and must stay last even though the stored
    // order puts it first — AG Grid would happily move it otherwise.
    expect(sortColumnsByOrder(withAction, ["actions", "b", "a"]).map(colIdOf)).toEqual([
      "b",
      "a",
      "actions",
    ]);
  });

  it("holds a lockPosition column at its own index", () => {
    const locked: ColDef[] = [
      { colId: "first", lockPosition: "left" },
      { colId: "a" },
      { colId: "b" },
    ];
    expect(sortColumnsByOrder(locked, ["b", "a", "first"]).map(colIdOf)).toEqual([
      "first",
      "b",
      "a",
    ]);
  });

  it("leaves an id-less column def where it is", () => {
    const mixed: ColDef[] = [{ colId: "a" }, { headerName: "spacer" }, { colId: "b" }];
    expect(sortColumnsByOrder(mixed, ["b", "a"]).map(colIdOf)).toEqual(["b", "", "a"]);
  });

  it("never lets AG Grid's own column be permuted", () => {
    const withInternal: ColDef[] = [{ colId: "ag-Grid-ControlsColumn" }, { colId: "a" }, { colId: "b" }];
    expect(sortColumnsByOrder(withInternal, ["b", "a"]).map(colIdOf)).toEqual([
      "ag-Grid-ControlsColumn",
      "b",
      "a",
    ]);
  });

  it("is a no-op with fewer than two movable columns", () => {
    const one: ColDef[] = [{ colId: "a" }];
    expect(sortColumnsByOrder(one, ["z", "a"])).toBe(one);
  });
});

describe("applyVisibleOrder", () => {
  it("keeps a hidden id attached to the visible id it follows", () => {
    // "b" is hidden and sits after "a"; moving "a" carries "b" with it.
    expect(applyVisibleOrder(["a", "b", "c"], ["c", "a"])).toEqual(["c", "a", "b"]);
  });

  it("keeps leading hidden ids leading", () => {
    expect(applyVisibleOrder(["hidden", "a", "b"], ["b", "a"])).toEqual(["hidden", "b", "a"]);
  });

  it("handles a move to the tail", () => {
    expect(applyVisibleOrder(["a", "b", "c"], ["b", "c", "a"])).toEqual(["b", "c", "a"]);
  });

  it("handles a single visible column", () => {
    expect(applyVisibleOrder(["a", "b"], ["a"])).toEqual(["a", "b"]);
  });

  it("accepts a visible id the stored order has never seen", () => {
    expect(applyVisibleOrder(["a"], ["fresh", "a"])).toEqual(["fresh", "a"]);
  });

  it("round-trips when nothing moved", () => {
    expect(applyVisibleOrder(["a", "hidden", "b"], ["a", "b"])).toEqual(["a", "hidden", "b"]);
  });
});

describe("sameOrder", () => {
  it("compares contents, not identity", () => {
    expect(sameOrder(["a", "b"], ["a", "b"])).toBe(true);
    expect(sameOrder(["a", "b"], ["b", "a"])).toBe(false);
    expect(sameOrder(["a"], ["a", "b"])).toBe(false);
  });
});
