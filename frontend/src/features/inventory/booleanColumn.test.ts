import { describe, expect, it } from "vitest";

import {
  BOOLEAN_EDITOR_VALUES,
  BOOLEAN_EMPTY_CELL,
  booleanColumnDef,
  compareBooleanCells,
  formatBooleanCell,
} from "./booleanColumn";

const LABELS = { yes: "Yes", no: "No", notSet: "Not set" };

describe("formatBooleanCell", () => {
  it("shows Yes, No and a dash for the three states", () => {
    expect(formatBooleanCell(true, LABELS)).toBe("Yes");
    expect(formatBooleanCell(false, LABELS)).toBe("No");
    expect(formatBooleanCell("", LABELS)).toBe("—");
    expect(formatBooleanCell(null, LABELS)).toBe(BOOLEAN_EMPTY_CELL);
    expect(formatBooleanCell(undefined, LABELS)).toBe(BOOLEAN_EMPTY_CELL);
  });

  it("reads the legacy strings", () => {
    expect(formatBooleanCell("yes", LABELS)).toBe("Yes");
    expect(formatBooleanCell("FALSE", LABELS)).toBe("No");
    expect(formatBooleanCell("maybe", LABELS)).toBe("—");
  });

  it("labels the unset entry Not set inside the editor only", () => {
    expect(formatBooleanCell("", LABELS, true)).toBe("Not set");
    expect(formatBooleanCell(true, LABELS, true)).toBe("Yes");
    expect(formatBooleanCell(false, LABELS, true)).toBe("No");
  });
});

describe("compareBooleanCells", () => {
  it("sorts Not set before No before Yes", () => {
    const sorted = [true, "", false, null, true, false].sort(compareBooleanCells);
    expect(sorted.map((v) => formatBooleanCell(v, LABELS))).toEqual([
      "—",
      "—",
      "No",
      "No",
      "Yes",
      "Yes",
    ]);
  });

  it("treats equal states as equal", () => {
    expect(compareBooleanCells(true, "yes")).toBe(0);
    expect(compareBooleanCells(false, "no")).toBe(0);
    expect(compareBooleanCells("", undefined)).toBe(0);
    expect(compareBooleanCells(true, false)).toBeGreaterThan(0);
    expect(compareBooleanCells(false, "")).toBeGreaterThan(0);
  });
});

describe("booleanColumnDef", () => {
  const def = booleanColumnDef(LABELS);

  it("switches off AG Grid's type inference and edits through a select", () => {
    expect(def.cellDataType).toBe(false);
    expect(def.cellEditor).toBe("agSelectCellEditor");
    expect(def.cellEditorParams.values).toEqual(["", true, false]);
    expect(def.comparator).toBe(compareBooleanCells);
  });

  it("hands the editor its own copy of the values", () => {
    expect(def.cellEditorParams.values).not.toBe(BOOLEAN_EDITOR_VALUES);
  });

  it("formats a cell with a row as a dash and an editor entry as Not set", () => {
    expect(def.valueFormatter({ value: "", node: {} })).toBe("—");
    expect(def.valueFormatter({ value: "" })).toBe("—");
    expect(def.valueFormatter({ value: "", node: null })).toBe("Not set");
    expect(def.valueFormatter({ value: false, node: {} })).toBe("No");
  });
});
