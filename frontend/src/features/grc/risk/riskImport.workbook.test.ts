/**
 * Risk importer: the template download and the parser's edge cases.
 *
 * `riskImport.test.ts` (committed earlier) covers the happy path of
 * `parseRiskWorkbook`; this file covers what it leaves out — the template
 * writer, sheet selection, the owner / reference / residual columns, header
 * normalisation, cell coercion and the date handling that was suspected of
 * leaking `Date.prototype.toString()` output into the import payload.
 *
 * Every parse runs against a real in-memory workbook serialised with
 * `XLSX.write`, so the SheetJS reader runs for real. Two `xlsx` exports are
 * wrapped: `writeFile` (a browser download jsdom cannot perform) and `read`
 * (so one test can hand the parser a workbook with no sheet).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as XLSX from "xlsx";

import { downloadRiskTemplate, parseRiskWorkbook, RISK_IMPORT_COLUMNS } from "./riskImport";

vi.mock("xlsx", async (importOriginal) => {
  const actual = await importOriginal<typeof import("xlsx")>();
  return { ...actual, writeFile: vi.fn(), read: vi.fn(actual.read) };
});

const writeFile = vi.mocked(XLSX.writeFile);

/** Serialise a workbook of one or more `[name, aoa]` sheets into `.xlsx` bytes. */
function workbookOf(...sheets: [string, unknown[][]][]): ArrayBuffer {
  const wb = XLSX.utils.book_new();
  for (const [name, aoa] of sheets) {
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), name);
  }
  return XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
}

function workbook(aoa: unknown[][], sheetName = "Risks"): ArrayBuffer {
  return workbookOf([sheetName, aoa]);
}

function aoa(ws: XLSX.WorkSheet): unknown[][] {
  return XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: "" });
}

beforeEach(() => {
  writeFile.mockReset();
});

describe("RISK_IMPORT_COLUMNS", () => {
  it("lists the writable columns in template order", () => {
    expect([...RISK_IMPORT_COLUMNS]).toEqual([
      "title",
      "description",
      "category",
      "initial_probability",
      "initial_impact",
      "residual_probability",
      "residual_impact",
      "status",
      "owner_email",
      "target_resolution_date",
      "cards",
    ]);
  });
});

describe("downloadRiskTemplate", () => {
  it("downloads a one-sheet 'Risks' workbook with the canonical headers and one example row", () => {
    downloadRiskTemplate();

    expect(writeFile).toHaveBeenCalledTimes(1);
    const [wb, filename] = writeFile.mock.calls[0] as [XLSX.WorkBook, string];
    expect(filename).toBe("risk-import-template.xlsx");
    expect(wb.SheetNames).toEqual(["Risks"]);

    const rows = aoa(wb.Sheets.Risks);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual([...RISK_IMPORT_COLUMNS]);
    expect(rows[1]).toHaveLength(RISK_IMPORT_COLUMNS.length);
    expect(rows[1].every((cell) => typeof cell === "string" && cell !== "")).toBe(true);
  });

  it("sizes every column to its longest cell plus two, floored at 8 and capped at 60", () => {
    downloadRiskTemplate();
    const [wb] = writeFile.mock.calls[0] as [XLSX.WorkBook];
    const ws = wb.Sheets.Risks;
    const rows = aoa(ws) as string[][];
    const cols = ws["!cols"] as XLSX.ColInfo[];
    expect(cols).toHaveLength(RISK_IMPORT_COLUMNS.length);
    cols.forEach((col, i) => {
      const longest = Math.max(rows[0][i].length, rows[1][i].length) + 2;
      expect(col.wch).toBe(Math.min(Math.max(longest, 8), 60));
    });
  });

  it("round-trips through parseRiskWorkbook, so the example row is itself importable", () => {
    downloadRiskTemplate();
    const [wb] = writeFile.mock.calls[0] as [XLSX.WorkBook];
    const bytes = XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;

    const items = parseRiskWorkbook(bytes);
    expect(items).toHaveLength(1);
    const [item] = items;
    expect(item.row_index).toBe(0);
    expect(item.title).not.toBe("");
    expect(item.description).not.toBe("");
    expect(item.category).toBe("operational");
    expect(item.initial_probability).toBe("medium");
    expect(item.initial_impact).toBe("high");
    expect(item.residual_probability).toBe("low");
    expect(item.residual_impact).toBe("high");
    expect(item.status).toBe("identified");
    expect(item.owner_email).toBe("owner@example.com");
    expect(item.owner_name).toBeUndefined();
    expect(item.target_resolution_date).toBe("2026-12-31");
    expect(item.card_names).toEqual(["NexaCore ERP", "Identity Platform"]);
    expect(item.reference).toBeUndefined();
  });
});

describe("parseRiskWorkbook", () => {
  describe("sheet selection", () => {
    it("prefers a sheet named Risks over an earlier one, matching the name loosely", () => {
      const buf = workbookOf(
        ["Summary", [["title"], ["From the summary"]]],
        ["  rIsKs ", [["title"], ["From the risks sheet"]]],
      );
      expect(parseRiskWorkbook(buf).map((r) => r.title)).toEqual(["From the risks sheet"]);
    });

    it("returns no rows for a header-only sheet", () => {
      expect(parseRiskWorkbook(workbook([[...RISK_IMPORT_COLUMNS]]))).toEqual([]);
    });

    it("returns no rows when the workbook has no sheet at all", () => {
      vi.mocked(XLSX.read).mockReturnValueOnce({ SheetNames: [], Sheets: {} } as XLSX.WorkBook);
      expect(parseRiskWorkbook(new ArrayBuffer(0))).toEqual([]);
    });
  });

  describe("columns", () => {
    it("maps every canonical column, the bare owner column and the export's reference", () => {
      const buf = workbook([
        [
          "reference",
          "title",
          "description",
          "category",
          "initial_probability",
          "initial_impact",
          "residual_probability",
          "residual_impact",
          "status",
          "owner_email",
          "owner",
          "target_resolution_date",
          "cards",
        ],
        [
          "R-000007",
          "Key leak",
          "Signing keys in a public repo",
          "security",
          "very_high",
          "critical",
          "low",
          "medium",
          "mitigated",
          "owner@test.local",
          "Olivia Owner",
          "2026-11-30",
          "Vault; CI Runner",
        ],
      ]);
      expect(parseRiskWorkbook(buf)).toEqual([
        {
          row_index: 0,
          title: "Key leak",
          description: "Signing keys in a public repo",
          category: "security",
          initial_probability: "very_high",
          initial_impact: "critical",
          residual_probability: "low",
          residual_impact: "medium",
          status: "mitigated",
          owner_email: "owner@test.local",
          owner_name: "Olivia Owner",
          target_resolution_date: "2026-11-30",
          card_names: ["Vault", "CI Runner"],
          reference: "R-000007",
        },
      ]);
    });

    it("leaves every optional column undefined when its cell is blank, and description empty", () => {
      const buf = workbook([[...RISK_IMPORT_COLUMNS], ["Only a title"]]);
      expect(parseRiskWorkbook(buf)).toEqual([
        {
          row_index: 0,
          title: "Only a title",
          description: "",
          category: undefined,
          initial_probability: undefined,
          initial_impact: undefined,
          residual_probability: undefined,
          residual_impact: undefined,
          status: undefined,
          owner_email: undefined,
          owner_name: undefined,
          target_resolution_date: undefined,
          card_names: [],
          reference: undefined,
        },
      ]);
    });

    it("yields an empty title when the sheet has no title column but the row has content", () => {
      const buf = workbook([["description", "category"], ["No title here", "financial"]]);
      const [item] = parseRiskWorkbook(buf);
      expect(item.title).toBe("");
      expect(item.description).toBe("No title here");
      expect(item.category).toBe("financial");
    });

    it("normalises headers: case, surrounding space and any run of whitespace", () => {
      const buf = workbook([
        ["  TITLE ", "Initial\tProbability", "Residual   Impact", "Target Resolution Date", "Owner Email"],
        ["Spaced", "high", "low", "2027-01-15", "o@test.local"],
      ]);
      expect(parseRiskWorkbook(buf)[0]).toMatchObject({
        title: "Spaced",
        initial_probability: "high",
        residual_impact: "low",
        target_resolution_date: "2027-01-15",
        owner_email: "o@test.local",
      });
    });

    it("ignores columns it does not know", () => {
      const buf = workbook([
        ["title", "initial_level", "notes"],
        ["Known", "critical", "free text"],
      ]);
      const [item] = parseRiskWorkbook(buf);
      expect(item.title).toBe("Known");
      expect(item).not.toHaveProperty("initial_level");
      expect(item).not.toHaveProperty("notes");
    });

    it("splits cards on ';' only, trimming each name and dropping empties", () => {
      const buf = workbook([
        ["title", "cards"],
        ["A", "One, with comma ;;  Two ; "],
        ["B", ";"],
      ]);
      const items = parseRiskWorkbook(buf);
      expect(items[0].card_names).toEqual(["One, with comma", "Two"]);
      expect(items[1].card_names).toEqual([]);
    });
  });

  describe("cell coercion", () => {
    it("trims text cells and stringifies numbers", () => {
      const buf = workbook([
        ["title", "initial_probability", "description"],
        ["  Padded  ", 3, 42],
      ]);
      expect(parseRiskWorkbook(buf)[0]).toMatchObject({
        title: "Padded",
        initial_probability: "3",
        description: "42",
      });
    });

    it("treats a whitespace-only row as blank and renumbers the rows that remain", () => {
      const buf = workbook([
        ["title", "category"],
        ["First", ""],
        ["   ", "  "],
        ["Third", ""],
      ]);
      const items = parseRiskWorkbook(buf);
      expect(items.map((i) => [i.row_index, i.title])).toEqual([
        [0, "First"],
        [1, "Third"],
      ]);
    });

    it("renders a date cell as the local calendar day, never as Date.prototype.toString()", () => {
      // `XLSX.read(..., { cellDates: true })` hands a date-formatted cell back
      // as a `Date` at local midnight. The parser's `str()` takes the
      // `instanceof Date` branch and prints YYYY-MM-DD from the LOCAL getters,
      // which is what makes this hold in every timezone — the suspected
      // "Wed Oct 02 2026 00:00:00 GMT…" leak does not reproduce here (checked
      // under TZ=UTC and TZ=America/Los_Angeles). A local-midnight Date is used
      // on the write side for the same reason: `Date.UTC` would land on the
      // previous day west of UTC before the sheet is even written.
      const buf = workbook([
        ["title", "target_resolution_date"],
        ["Midnight", new Date(2026, 9, 2)],
        ["Late evening", new Date(2026, 9, 2, 23, 30)],
        ["Typed as text", "2026-10-02"],
      ]);
      const items = parseRiskWorkbook(buf);
      expect(items.map((i) => i.target_resolution_date)).toEqual([
        "2026-10-02",
        "2026-10-02",
        "2026-10-02",
      ]);
      for (const item of items) {
        expect(item.target_resolution_date).not.toMatch(/GMT/);
      }
    });

    it("passes a bare serial number in the date column through as digits", () => {
      // A cell that holds a number with no date format is not a date to
      // SheetJS, so `cellDates` leaves it a number and the parser stringifies
      // it. The backend rejects "46387" as a date, so the row fails with a
      // per-row error rather than landing on the wrong day. Pinned so the
      // behaviour is a known one; a future parser could resolve the serial.
      const buf = workbook([
        ["title", "target_resolution_date"],
        ["Serial", 46387],
      ]);
      expect(parseRiskWorkbook(buf)[0].target_resolution_date).toBe("46387");
    });

    it("counts a value under an unlabelled header as content, importing the row untitled", () => {
      // SheetJS names a blank header `__EMPTY`; the parser's blank-row check
      // looks at every normalised cell, so a stray value in an unlabelled
      // column keeps an otherwise empty row alive with an empty title. The
      // backend then reports the missing title per row.
      const buf = workbook([
        ["title", ""],
        ["", "stray"],
      ]);
      const items = parseRiskWorkbook(buf);
      expect(items).toHaveLength(1);
      expect(items[0].title).toBe("");
    });
  });

  it("numbers rows by their position among the non-blank data rows", () => {
    const buf = workbook([
      ["title"],
      [""],
      ["One"],
      [""],
      ["Two"],
      ["Three"],
    ]);
    const items = parseRiskWorkbook(buf);
    expect(items.map((i) => i.row_index)).toEqual([0, 1, 2]);
    expect(items.map((i) => i.title)).toEqual(["One", "Two", "Three"]);
  });
});
