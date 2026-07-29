/**
 * Unit tests for the "Export current view" (WYSIWYG) flat export.
 *
 * We exercise `buildCurrentViewWorkbook` (the testable core, split out of
 * `exportCurrentViewToExcel` so we don't have to call `XLSX.writeFile` under
 * jsdom) and inspect the resulting sheet.
 */
import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";

import { buildCurrentViewWorkbook } from "./excelExport";

function sheetOf(
  rows: Record<string, unknown>[],
  columns: { colId: string; headerName: string }[],
): XLSX.WorkSheet {
  const wb = buildCurrentViewWorkbook(rows, columns, { sheetLabel: "Application" });
  return wb.Sheets[wb.SheetNames[0]];
}

describe("buildCurrentViewWorkbook", () => {
  it("emits one sheet with the visible columns in order, using displayed headers", () => {
    const wb = buildCurrentViewWorkbook(
      [{ core_name: "Alpha", core_type: "Application" }],
      [
        { colId: "core_name", headerName: "Name" },
        { colId: "core_type", headerName: "Type" },
      ],
      { sheetLabel: "Application" },
    );
    expect(wb.SheetNames).toEqual(["Application"]);
    const sheet = wb.Sheets["Application"];
    // Header row order is left-to-right as given.
    expect(sheet["A1"].v).toBe("Name");
    expect(sheet["B1"].v).toBe("Type");
    expect(sheet["A2"].v).toBe("Alpha");
    expect(sheet["B2"].v).toBe("Application");
  });

  it("includes only the provided columns (ignores other row keys)", () => {
    const out = XLSX.utils.sheet_to_json(
      sheetOf(
        [{ core_name: "Alpha", core_description: "hidden", attr_cost: 5 }],
        [{ colId: "core_name", headerName: "Name" }],
      ),
      { defval: "" },
    );
    expect(out).toEqual([{ Name: "Alpha" }]);
  });

  it("joins arrays and collapses tag refs to 'Group: Tag'", () => {
    const out = XLSX.utils.sheet_to_json(
      sheetOf(
        [
          {
            rel_App: ["Svc A", "Svc B"],
            core_tags: [{ name: "Critical", group_name: "Priority" }, { name: "PII" }],
          },
        ],
        [
          { colId: "rel_App", headerName: "Application" },
          { colId: "core_tags", headerName: "Tags" },
        ],
      ),
      { defval: "" },
    );
    expect(out[0]).toEqual({
      Application: "Svc A, Svc B",
      Tags: "Priority: Critical, PII",
    });
  });

  it("renders null/undefined cells as empty strings", () => {
    const out = XLSX.utils.sheet_to_json(
      sheetOf(
        [{ core_name: "Alpha", core_description: null }],
        [
          { colId: "core_name", headerName: "Name" },
          { colId: "core_description", headerName: "Description" },
        ],
      ),
      { defval: "" },
    );
    expect(out[0]).toEqual({ Name: "Alpha", Description: "" });
  });

  it("disambiguates duplicate header names by colId", () => {
    const sheet = sheetOf(
      [{ rel_App: "x", rel_Svc: "y" }],
      [
        { colId: "rel_App", headerName: "Linked" },
        { colId: "rel_Svc", headerName: "Linked" },
      ],
    );
    expect(sheet["A1"].v).toBe("Linked");
    expect(sheet["B1"].v).toBe("Linked (rel_Svc)");
  });

  it("keeps columns apart when a disambiguated header collides too", () => {
    // `json_to_sheet` addresses cells by `header.indexOf(key)`, so two equal
    // headers would resolve to the same column and one of them would silently
    // vanish. The colId suffix settles the ordinary clash — this covers the
    // case where that suffixed name is itself another column's real header.
    const sheet = sheetOf(
      [{ a: "1", rel_App: "2", rel_Svc: "3" }],
      [
        { colId: "a", headerName: "Linked (rel_Svc)" },
        { colId: "rel_App", headerName: "Linked" },
        { colId: "rel_Svc", headerName: "Linked" },
      ],
    );
    const headers = [sheet["A1"].v, sheet["B1"].v, sheet["C1"].v];
    expect(new Set(headers).size).toBe(3);
    // Each column still carries its own value, in its own cell.
    expect(sheet["A2"].v).toBe("1");
    expect(sheet["B2"].v).toBe("2");
    expect(sheet["C2"].v).toBe("3");
  });

  it("writes a header-only sheet when there are no rows", () => {
    const sheet = sheetOf([], [{ colId: "core_name", headerName: "Name" }]);
    expect(sheet["A1"].v).toBe("Name");
    expect(XLSX.utils.sheet_to_json(sheet, { defval: "" })).toEqual([]);
  });
});
