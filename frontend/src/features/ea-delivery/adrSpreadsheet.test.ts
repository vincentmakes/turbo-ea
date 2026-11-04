/**
 * Decision records ⇄ `.xlsx`. Only `XLSX.writeFile` is mocked (jsdom cannot
 * download); the workbook it receives is real, read back, and re-parsed
 * through the importer.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as XLSX from "xlsx";
import type { ArchitectureDecision } from "@/types";
import {
  ADR_COLUMNS,
  adrRow,
  downloadAdrTemplate,
  exportAdrsToXlsx,
  parseAdrWorkbook,
} from "./adrSpreadsheet";

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

function sheetBuffer(rows: unknown[][], name = "Decisions"): ArrayBuffer {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), name);
  return bytes(wb);
}

const ADR: ArchitectureDecision = {
  id: "a1",
  reference_number: "ADR-007",
  title: "Adopt Kafka",
  status: "signed",
  context: "<p>Batch is slow</p>",
  decision: "<p>Stream events</p>",
  consequences: "<ul><li>Faster</li><li>New platform</li></ul>",
  alternatives_considered: null,
  related_decisions: ["x"],
  related_references: ["ADR-001", "ADR-002"],
  created_by: "u1",
  creator_name: "Ada",
  signatories: [
    { user_id: "u2", display_name: "Bob", email: "b@x.test", status: "signed", signed_at: null },
    { user_id: "u3", display_name: "Cy", email: "c@x.test", status: "pending", signed_at: null },
  ],
  signed_at: "2026-10-02T09:00:00",
  revision_number: 2,
  parent_id: null,
  linked_cards: [
    { id: "c1", name: "Billing", type: "Application" },
    { id: "c2", name: "Data Platform", type: "Application" },
  ],
  created_at: "2026-09-30T10:00:00",
  updated_at: "2026-10-01T10:00:00",
};

beforeEach(() => writeFile.mockReset());

describe("adrRow", () => {
  it("writes sections as plain text and lists joined by semicolons", () => {
    expect(adrRow(ADR)).toEqual([
      "ADR-007",
      "Adopt Kafka",
      "signed",
      2,
      "Batch is slow",
      "Stream events",
      "- Faster\n- New platform",
      "",
      "Billing; Data Platform",
      "ADR-001; ADR-002",
      "Ada",
      "Bob (signed); Cy (pending)",
      "2026-10-02",
      "2026-09-30",
      "2026-10-01",
    ]);
  });

  it("leaves optional facts blank", () => {
    const row = adrRow({
      ...ADR,
      linked_cards: undefined,
      related_references: undefined,
      creator_name: null,
      signatories: [],
      signed_at: null,
    });
    expect(row[8]).toBe("");
    expect(row[9]).toBe("");
    expect(row[10]).toBe("");
    expect(row[11]).toBe("");
    expect(row[12]).toBe("");
  });
});

describe("exportAdrsToXlsx", () => {
  it("writes a Decisions sheet whose rows re-import with their sections and links", () => {
    exportAdrsToXlsx([ADR], new Date(2026, 10, 3, 8, 30));

    const { wb, filename } = lastWritten();
    expect(filename).toBe("architecture-decisions-2026-11-03_0830.xlsx");
    expect(wb.SheetNames).toEqual(["Decisions"]);
    const header = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets.Decisions, { header: 1 })[0];
    expect(header).toEqual([...ADR_COLUMNS]);

    expect(parseAdrWorkbook(bytes(wb))).toEqual([
      {
        row_index: 1,
        reference_number: "ADR-007",
        title: "Adopt Kafka",
        status: "signed",
        context: "<p>Batch is slow</p>",
        decision: "<p>Stream events</p>",
        consequences: "<ul><li>Faster</li><li>New platform</li></ul>",
        card_names: ["Billing", "Data Platform"],
        related_references: ["ADR-001", "ADR-002"],
      },
    ]);
  });
});

describe("parseAdrWorkbook", () => {
  it("reads a minimal sheet and leaves blank sections out", () => {
    expect(
      parseAdrWorkbook(
        sheetBuffer([
          ["Title", "Decision", "Context"],
          ["Use Postgres", "Line one\nline two", ""],
        ]),
      ),
    ).toEqual([
      {
        row_index: 1,
        title: "Use Postgres",
        decision: "<p>Line one<br>line two</p>",
        card_names: [],
        related_references: [],
      },
    ]);
  });

  it("keeps a row without a title so the server can report it", () => {
    const [item] = parseAdrWorkbook(sheetBuffer([["title", "cards"], ["", "Billing"]], "Any"));
    expect(item).toEqual({ row_index: 1, title: "", card_names: ["Billing"], related_references: [] });
  });
});

describe("downloadAdrTemplate", () => {
  it("writes the importable columns and an example that parses", () => {
    downloadAdrTemplate();
    const { wb, filename } = lastWritten();
    expect(filename).toBe("architecture-decisions-import-template.xlsx");
    const [example] = parseAdrWorkbook(bytes(wb));
    expect(example.title).toBe("Adopt event streaming for order data");
    expect(example.reference_number).toBeUndefined();
    expect(example.consequences).toBe(
      "<ul><li>Near real-time updates</li><li>A new platform to operate</li></ul>",
    );
    expect(example.card_names).toEqual(["Order Management", "Data Platform"]);
  });
});
