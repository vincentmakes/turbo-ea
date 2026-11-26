import { describe, expect, it } from "vitest";
import { assertCellsFitExcel, EXCEL_CELL_MAX_LENGTH } from "./excelCellLimit";

describe("assertCellsFitExcel", () => {
  it("looks at text only, so an empty, numeric, boolean or date cell never counts", () => {
    const rows = [{ a: null, b: undefined, c: 40000, d: true, e: new Date(0), f: "short" }];
    expect(() => assertCellsFitExcel("Sheet", rows, () => "row")).not.toThrow();
  });

  it("asks for the row label only when a cell is too long", () => {
    const labels: number[] = [];
    const label = (_row: Record<string, unknown>, index: number) => {
      labels.push(index);
      return `row ${index}`;
    };
    assertCellsFitExcel("Sheet", [{ a: "x".repeat(EXCEL_CELL_MAX_LENGTH) }], label);
    expect(labels).toEqual([]);
    expect(() =>
      assertCellsFitExcel("Sheet", [{ a: "ok" }, { a: "x".repeat(EXCEL_CELL_MAX_LENGTH + 1) }], label),
    ).toThrow('row 1: column "a" on sheet "Sheet" holds 32768 characters');
    expect(labels).toEqual([1]);
  });
});
