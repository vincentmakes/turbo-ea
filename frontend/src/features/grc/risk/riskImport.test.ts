import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { parseRiskWorkbook } from "./riskImport";

/** Build an .xlsx ArrayBuffer from an array-of-arrays. */
function workbook(aoa: unknown[][], sheetName = "Risks"): ArrayBuffer {
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName);
  return XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
}

describe("parseRiskWorkbook", () => {
  it("parses rows and assigns sequential row_index", () => {
    const buf = workbook([
      ["title", "category", "initial_probability", "initial_impact"],
      ["First risk", "operational", "high", "critical"],
      ["Second risk", "financial", "low", "medium"],
    ]);
    const rows = parseRiskWorkbook(buf);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      row_index: 0,
      title: "First risk",
      category: "operational",
      initial_probability: "high",
      initial_impact: "critical",
    });
    expect(rows[1].row_index).toBe(1);
  });

  it("matches headers case-insensitively and ignores spacing", () => {
    const buf = workbook([
      ["Title", "Initial Probability", "OWNER_EMAIL"],
      ["A risk", "medium", "jane@example.com"],
    ]);
    const rows = parseRiskWorkbook(buf);
    expect(rows[0].title).toBe("A risk");
    expect(rows[0].initial_probability).toBe("medium");
    expect(rows[0].owner_email).toBe("jane@example.com");
  });

  it("splits the cards column on semicolons", () => {
    const buf = workbook([
      ["title", "cards"],
      ["Linked", "NexaCore ERP; Identity Platform ;  "],
    ]);
    const rows = parseRiskWorkbook(buf);
    expect(rows[0].card_names).toEqual(["NexaCore ERP", "Identity Platform"]);
  });

  it("skips fully blank rows", () => {
    const buf = workbook([
      ["title", "category"],
      ["Real", "security"],
      ["", ""],
      ["   ", ""],
    ]);
    const rows = parseRiskWorkbook(buf);
    expect(rows).toHaveLength(1);
    expect(rows[0].title).toBe("Real");
  });

  it("coerces date cells to YYYY-MM-DD", () => {
    const ws = XLSX.utils.aoa_to_sheet([
      ["title", "target_resolution_date"],
      // A local date: west of UTC a UTC midnight is still the previous day.
      ["Dated", new Date(2026, 11, 31)],
    ]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Risks");
    const buf = XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
    const rows = parseRiskWorkbook(buf);
    expect(rows[0].target_resolution_date).toBe("2026-12-31");
  });

  it("reads the first sheet when there is no 'Risks' sheet", () => {
    const buf = workbook([["title"], ["Sheet-named risk"]], "Export 1");
    const rows = parseRiskWorkbook(buf);
    expect(rows).toHaveLength(1);
    expect(rows[0].title).toBe("Sheet-named risk");
  });
});
