import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import {
  autoFitColumns,
  buildSheetWorkbook,
  cellText,
  exportTimestamp,
  headerKey,
  listCell,
  readSheetRows,
} from "./sheetRows";

function workbook(sheets: Record<string, unknown[][]>): ArrayBuffer {
  const wb = XLSX.utils.book_new();
  for (const [name, rows] of Object.entries(sheets)) {
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), name);
  }
  return XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
}

describe("headerKey / cellText / listCell", () => {
  it("normalises headers", () => {
    expect(headerKey("  Reference Number ")).toBe("reference_number");
    expect(headerKey("IS  ACTIVE")).toBe("is_active");
  });

  it("formats cells as text", () => {
    expect(cellText(null)).toBe("");
    expect(cellText(undefined)).toBe("");
    expect(cellText("  x ")).toBe("x");
    expect(cellText(42)).toBe("42");
    expect(cellText(false)).toBe("false");
    expect(cellText(new Date(2026, 0, 5))).toBe("2026-01-05");
  });

  it("splits list cells on semicolons", () => {
    expect(listCell(" A ; B;;  ")).toEqual(["A", "B"]);
    expect(listCell("")).toEqual([]);
    expect(listCell(undefined)).toEqual([]);
  });
});

describe("readSheetRows", () => {
  it("reads the preferred sheet case-insensitively, keyed by normalised header", () => {
    const buffer = workbook({
      Notes: [["ignored"], ["x"]],
      principles: [
        ["Title", "Is Active"],
        ["A", true],
        ["", ""],
        ["B", ""],
      ],
    });
    // Blank rows are dropped, but every row keeps its place in the sheet.
    expect(readSheetRows(buffer, "Principles")).toEqual([
      { sheetRow: 1, cells: { title: "A", is_active: "true" } },
      { sheetRow: 3, cells: { title: "B", is_active: "" } },
    ]);
  });

  it("falls back to the first sheet", () => {
    const buffer = workbook({ Data: [["title"], ["Only"]] });
    expect(readSheetRows(buffer, "Principles")).toEqual([{ sheetRow: 1, cells: { title: "Only" } }]);
  });

  it("returns nothing for a header-only sheet", () => {
    expect(readSheetRows(workbook({ Data: [["title"]] }), "Data")).toEqual([]);
  });
});

describe("writing", () => {
  it("auto-fits columns on the longest line, capped at 60", () => {
    expect(autoFitColumns([["ab", "x".repeat(100), "one\nlonger line"]])).toEqual([
      { wch: 8 },
      { wch: 60 },
      { wch: 13 },
    ]);
  });

  it("stamps export file names in local time", () => {
    expect(exportTimestamp(new Date(2026, 10, 3, 9, 5))).toBe("2026-11-03_0905");
  });

  it("builds a single named sheet with the header row first", () => {
    const wb = buildSheetWorkbook("Decisions", ["a", "b"], [[1, "two"]]);
    expect(wb.SheetNames).toEqual(["Decisions"]);
    const rows = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets.Decisions, { header: 1 });
    expect(rows).toEqual([["a", "b"], [1, "two"]]);
    expect(wb.Sheets.Decisions["!cols"]).toEqual([{ wch: 8 }, { wch: 8 }]);
  });
});
