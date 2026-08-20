import { describe, it, expect } from "vitest";
import { keepSelectionColumnPinned } from "./agGridSetup";

const col = (id: string) => ({ getColId: () => id });

describe("keepSelectionColumnPinned", () => {
  it("never lets the viewport guard unpin the auto selection column", () => {
    // AG Grid 33+ auto-unpins columns when the pinned region crowds the
    // centre viewport, and once the selection column is stripped nothing can
    // re-pin it — the checkboxes end up after the frozen columns. The guard
    // may relieve pressure with data columns, never with the checkboxes.
    const suggested = [col("ag-Grid-SelectionColumn"), col("name"), col("core_type")];
    expect(keepSelectionColumnPinned({ columns: suggested }).map((c) => c.getColId())).toEqual([
      "name",
      "core_type",
    ]);
  });

  it("also covers the pre-v33 controls column id and other ag-Grid internals", () => {
    const suggested = [col("ag-Grid-ControlsColumn"), col("ag-Grid-AutoColumn")];
    expect(keepSelectionColumnPinned({ columns: suggested })).toEqual([]);
  });

  it("passes an all-data-column suggestion through untouched", () => {
    const suggested = [col("a"), col("b")];
    expect(keepSelectionColumnPinned({ columns: suggested }).map((c) => c.getColId())).toEqual([
      "a",
      "b",
    ]);
  });
});
