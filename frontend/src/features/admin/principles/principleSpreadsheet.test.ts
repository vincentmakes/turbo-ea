/**
 * EA principles ⇄ `.xlsx`. Only `XLSX.writeFile` is mocked (jsdom cannot
 * download); the workbook it receives is real and is read back, and re-parsed
 * through the importer so the export is proven to be a valid import file.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as XLSX from "xlsx";
import type { EAPrinciple } from "@/types";
import {
  PRINCIPLE_COLUMNS,
  downloadPrincipleTemplate,
  exportPrinciples,
  parsePrincipleWorkbook,
  principleRow,
} from "./principleSpreadsheet";

vi.mock("xlsx", async (importOriginal) => {
  const actual = await importOriginal<typeof import("xlsx")>();
  return { ...actual, writeFile: vi.fn() };
});

const writeFile = vi.mocked(XLSX.writeFile);

function lastWritten(): { wb: XLSX.WorkBook; filename: string } {
  const call = writeFile.mock.calls.at(-1);
  if (!call) throw new Error("writeFile was not called");
  return { wb: call[0] as XLSX.WorkBook, filename: call[1] as string };
}

function bytes(wb: XLSX.WorkBook): ArrayBuffer {
  return XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
}

function sheetBuffer(rows: unknown[][], name = "Principles"): ArrayBuffer {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), name);
  return bytes(wb);
}

const PRINCIPLES: EAPrinciple[] = [
  {
    id: "p1",
    reference_number: "P-001",
    title: "Reuse first",
    description: "Prefer reuse",
    rationale: "Cheaper\nFaster",
    implications: undefined,
    is_active: true,
    sort_order: 10,
  },
  { id: "p2", reference_number: null, title: "Cloud", is_active: false, sort_order: 20 },
];

beforeEach(() => writeFile.mockReset());

describe("principleRow", () => {
  it("writes every column in order, blanks for missing values", () => {
    expect(principleRow(PRINCIPLES[0])).toEqual([
      "P-001",
      "Reuse first",
      "Prefer reuse",
      "Cheaper\nFaster",
      "",
      "true",
      10,
    ]);
    expect(principleRow(PRINCIPLES[1])).toEqual(["", "Cloud", "", "", "", "false", 20]);
  });
});

describe("exportPrinciples", () => {
  it("writes one Principles sheet that re-imports as the same values", () => {
    exportPrinciples(PRINCIPLES, new Date(2026, 10, 3, 14, 7));

    const { wb, filename } = lastWritten();
    expect(filename).toBe("principles-2026-11-03_1407.xlsx");
    expect(wb.SheetNames).toEqual(["Principles"]);
    const header = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets.Principles, { header: 1 })[0];
    expect(header).toEqual([...PRINCIPLE_COLUMNS]);

    const items = parsePrincipleWorkbook(bytes(wb));
    expect(items).toEqual([
      {
        row_index: 1,
        reference_number: "P-001",
        title: "Reuse first",
        description: "Prefer reuse",
        rationale: "Cheaper\nFaster",
        implications: "",
        is_active: "true",
        sort_order: "10",
      },
      {
        row_index: 2,
        reference_number: "",
        title: "Cloud",
        description: "",
        rationale: "",
        implications: "",
        is_active: "false",
        sort_order: "20",
      },
    ]);
  });
});

describe("parsePrincipleWorkbook", () => {
  it("leaves out the columns the sheet does not have", () => {
    const items = parsePrincipleWorkbook(
      sheetBuffer([
        ["Title", "Description"],
        ["Only these", "two columns"],
      ]),
    );
    expect(items).toEqual([{ row_index: 1, title: "Only these", description: "two columns" }]);
    expect("rationale" in items[0]).toBe(false);
    expect("is_active" in items[0]).toBe(false);
  });

  it("keeps a row without a title so the server can report it", () => {
    expect(parsePrincipleWorkbook(sheetBuffer([["title", "description"], ["", "orphan"]]))).toEqual(
      [{ row_index: 1, title: "", description: "orphan" }],
    );
  });

  it("reads the first sheet when none is named Principles", () => {
    expect(parsePrincipleWorkbook(sheetBuffer([["TITLE"], ["X"]], "Sheet1"))).toEqual([
      { row_index: 1, title: "X" },
    ]);
  });
});

describe("downloadPrincipleTemplate", () => {
  it("writes the columns and one example that parses as a new principle", () => {
    downloadPrincipleTemplate();
    const { wb, filename } = lastWritten();
    expect(filename).toBe("principles-import-template.xlsx");
    const [example] = parsePrincipleWorkbook(bytes(wb));
    expect(example).toMatchObject({
      row_index: 1,
      reference_number: "",
      title: "Reuse before buy before build",
      is_active: "true",
      sort_order: "10",
    });
  });
});
