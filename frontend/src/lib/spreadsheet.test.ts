import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";

import { parseWorkbook, readWorkbookSheets } from "./spreadsheet";

function workbook(): ArrayBuffer {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.json_to_sheet([
      { name: "A", when: new Date(Date.UTC(2027, 0, 15)), note: "" },
      { name: "B", when: "", note: "x" },
    ]),
    "First",
  );
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet([{ _key: "live:1", n: 2 }]), "Plan");
  const out = XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
  return out;
}

describe("spreadsheet readers", () => {
  it("readWorkbookSheets returns every sheet in order with blank cells as empty strings", () => {
    const sheets = readWorkbookSheets(workbook());
    expect(sheets.map((s) => s.name)).toEqual(["First", "Plan"]);
    expect(sheets[0].rows).toHaveLength(2);
    // A date cell round-trips as a Date, never a serial number.
    expect(sheets[0].rows[0].when).toBeInstanceOf(Date);
    expect((sheets[0].rows[0].when as Date).getUTCFullYear()).toBe(2027);
    // A blank cell is "" (defval), so a row always carries every header.
    expect(sheets[0].rows[0].note).toBe("");
    expect(sheets[0].rows[1].when).toBe("");
    expect(sheets[1].rows).toEqual([{ _key: "live:1", n: 2 }]);
  });

  it("parseWorkbook reads the first sheet only", () => {
    const rows = parseWorkbook(workbook());
    expect(rows).toHaveLength(2);
    expect(rows[0].name).toBe("A");
  });

  it("an empty workbook reads as no sheets / no rows", () => {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["only", "headers"]]), "S");
    const buf = XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
    expect(parseWorkbook(buf)).toEqual([]);
    expect(readWorkbookSheets(buf)).toEqual([{ name: "S", rows: [] }]);
  });
});
