/**
 * PPM risks ⇄ `.xlsx`: the export rows and file, the round trip, and every
 * import validation rule with its reason.
 *
 * Parsing runs against real in-memory workbooks serialised with `XLSX.write`;
 * only `writeFile` (a browser download jsdom cannot perform) is stubbed.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as XLSX from "xlsx";
import "@/i18n";
import type { PpmRisk } from "@/types";
import {
  PPM_RISK_COLUMNS,
  PPM_RISK_SHEET,
  buildPpmRiskWorkbook,
  downloadPpmRiskTemplate,
  exportPpmRisks,
  isSpreadsheetBytes,
  parsePpmRiskWorkbook,
  planPpmRiskImport,
  ppmRiskExportFileName,
  ppmRiskHeaders,
  ppmRiskRow,
  type ImportUser,
  type PpmRiskSheetRow,
} from "./ppmRiskSpreadsheet";

vi.mock("xlsx", async (importOriginal) => {
  const actual = await importOriginal<typeof import("xlsx")>();
  return { ...actual, writeFile: vi.fn() };
});

const writeFile = vi.mocked(XLSX.writeFile);

const HEADERS = [
  "Risk ID",
  "Risk Title",
  "Description",
  "Probability",
  "Impact",
  "Risk Score",
  "Status",
  "Owner",
  "Mitigation",
];

function risk(over: Partial<PpmRisk> = {}): PpmRisk {
  return {
    id: "r1",
    initiative_id: "i1",
    title: "Vendor delay",
    description: "Supplier late",
    probability: 4,
    impact: 3,
    risk_score: 12,
    mitigation: "Weekly checkpoint",
    owner_id: "u1",
    owner_name: "Alice Admin",
    status: "mitigating",
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-02T00:00:00Z",
    ...over,
  };
}

const RISKS: PpmRisk[] = [
  risk(),
  risk({
    id: "r2",
    title: "Budget overrun",
    description: null,
    probability: 2,
    impact: 5,
    risk_score: 10,
    mitigation: null,
    owner_id: null,
    owner_name: null,
    status: "open",
  }),
];

const USERS: ImportUser[] = [
  { id: "u1", display_name: "Alice Admin", email: "alice@example.com" },
  { id: "u2", display_name: "Bob Builder", email: "Bob@Example.com" },
  { id: "u3", display_name: "Sam Same", email: "sam1@example.com" },
  { id: "u4", display_name: "Sam Same", email: "sam2@example.com" },
];

function bytesOf(aoa: unknown[][], sheet = PPM_RISK_SHEET): ArrayBuffer {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), sheet);
  return XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
}

function aoaOf(wb: XLSX.WorkBook): unknown[][] {
  return XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[PPM_RISK_SHEET], {
    header: 1,
    defval: "",
  });
}

/** A parsed row of the given cells (sheet row 1 unless said otherwise). */
function row(cells: PpmRiskSheetRow["cells"], sheetRow = 1): PpmRiskSheetRow {
  return { sheetRow, cells };
}

function planOne(cells: PpmRiskSheetRow["cells"], existing: PpmRisk[] = RISKS) {
  return planPpmRiskImport([row(cells)], existing, USERS).rows[0];
}

beforeEach(() => {
  writeFile.mockReset();
});

describe("export", () => {
  it("lists the columns in sheet order", () => {
    expect([...PPM_RISK_COLUMNS]).toEqual([
      "id",
      "title",
      "description",
      "probability",
      "impact",
      "risk_score",
      "status",
      "owner",
      "mitigation",
    ]);
    expect(PPM_RISK_SHEET).toBe("Risks");
  });

  it("writes translated headers", () => {
    expect(ppmRiskHeaders()).toEqual(HEADERS);
  });

  it("writes a risk with its status label and owner name, blanks for nulls", () => {
    expect(ppmRiskRow(RISKS[0])).toEqual([
      "r1",
      "Vendor delay",
      "Supplier late",
      4,
      3,
      12,
      "Mitigating",
      "Alice Admin",
      "Weekly checkpoint",
    ]);
    expect(ppmRiskRow(RISKS[1])).toEqual(["r2", "Budget overrun", "", 2, 5, 10, "Open", "", ""]);
  });

  it("downloads one sheet with one row per risk in the order given", () => {
    exportPpmRisks([RISKS[1], RISKS[0]], "Cloud Migration");
    expect(writeFile).toHaveBeenCalledTimes(1);
    const [wb, name] = writeFile.mock.calls[0];
    expect(wb.SheetNames).toEqual(["Risks"]);
    const aoa = aoaOf(wb);
    expect(aoa).toHaveLength(3);
    expect(aoa[0]).toEqual(HEADERS);
    expect(aoa[1][0]).toBe("r2");
    expect(aoa[2][0]).toBe("r1");
    expect(name).toMatch(/^Cloud_Migration_risks_\d{4}-\d{2}-\d{2}_\d{4}\.xlsx$/);
  });

  it("names the file after the initiative, made safe, and the timestamp", () => {
    const now = new Date(2026, 10, 13, 9, 5);
    expect(ppmRiskExportFileName('A/B: "C"  d', now)).toBe("A_B___C__d_risks_2026-11-13_0905.xlsx");
    expect(ppmRiskExportFileName("  Cloud  ", now)).toBe("Cloud_risks_2026-11-13_0905.xlsx");
    expect(ppmRiskExportFileName("x<y>z|w?*\\", now)).toBe("x_y_z_w____risks_2026-11-13_0905.xlsx");
    expect(ppmRiskExportFileName("   ", now)).toBe("initiative_risks_2026-11-13_0905.xlsx");
    expect(ppmRiskExportFileName("n".repeat(70), now)).toBe(
      `${"n".repeat(60)}_risks_2026-11-13_0905.xlsx`,
    );
  });

  it("downloads a template with the headers and one creating example row", () => {
    downloadPpmRiskTemplate();
    const [wb, name] = writeFile.mock.calls[0];
    expect(name).toBe("initiative-risks-import-template.xlsx");
    const aoa = aoaOf(wb);
    expect(aoa[0]).toEqual(HEADERS);
    expect(aoa).toHaveLength(2);
    expect(aoa[1][0]).toBe("");
    // The template itself imports as one valid new risk.
    const bytes = XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
    const plan = planPpmRiskImport(parsePpmRiskWorkbook(bytes), [], USERS);
    expect(plan.rows.map((r) => r.kind)).toEqual(["create"]);
  });
});

describe("round trip", () => {
  it("parses an exported workbook back to the same risks, all unchanged", () => {
    const wb = buildPpmRiskWorkbook(RISKS);
    const bytes = XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
    const rows = parsePpmRiskWorkbook(bytes);
    expect(rows).toEqual([
      {
        sheetRow: 1,
        cells: {
          id: "r1",
          title: "Vendor delay",
          description: "Supplier late",
          probability: "4",
          impact: "3",
          risk_score: "12",
          status: "Mitigating",
          owner: "Alice Admin",
          mitigation: "Weekly checkpoint",
        },
      },
      {
        sheetRow: 2,
        cells: {
          id: "r2",
          title: "Budget overrun",
          description: "",
          probability: "2",
          impact: "5",
          risk_score: "10",
          status: "Open",
          owner: "",
          mitigation: "",
        },
      },
    ]);
    const plan = planPpmRiskImport(rows, RISKS, USERS);
    expect(plan.rows.map((r) => [r.kind, "riskId" in r ? r.riskId : null])).toEqual([
      ["unchanged", "r1"],
      ["unchanged", "r2"],
    ]);
    expect(plan).toMatchObject({ create: 0, update: 0, unchanged: 2, rejected: 0, warnings: 0 });
  });

  it("an edited export updates only the edited fields; a new row creates", () => {
    const aoa = aoaOf(buildPpmRiskWorkbook(RISKS));
    aoa[1][4] = 5; // impact of r1
    aoa[2][6] = "Closed"; // status of r2
    aoa.push(["", "New one", "", 1, 1, "", "", "", ""]);
    const plan = planPpmRiskImport(parsePpmRiskWorkbook(bytesOf(aoa)), RISKS, USERS);
    expect(plan.rows[0]).toMatchObject({
      kind: "update",
      riskId: "r1",
      body: { impact: 5 },
      changed: ["Impact"],
    });
    expect(Object.keys((plan.rows[0] as { body: object }).body)).toEqual(["impact"]);
    expect(plan.rows[1]).toMatchObject({ kind: "update", riskId: "r2", body: { status: "closed" } });
    expect(plan.rows[2]).toEqual({
      kind: "create",
      sheetRow: 3,
      title: "New one",
      warnings: [],
      body: { title: "New one", probability: 1, impact: 1, status: "open" },
    });
    expect(plan).toMatchObject({ create: 1, update: 2, unchanged: 0, rejected: 0 });
  });
});

describe("parse", () => {
  it("rejects bytes that are not a spreadsheet", () => {
    const text = new TextEncoder().encode("title,description\nA,B\n").buffer;
    expect(isSpreadsheetBytes(text)).toBe(false);
    expect(() => parsePpmRiskWorkbook(text)).toThrow("not a spreadsheet");
  });

  it("recognises xlsx (zip) and xls (OLE2) signatures only", () => {
    const of = (...b: number[]) => new Uint8Array(b).buffer;
    expect(isSpreadsheetBytes(of(0x50, 0x4b, 0x03, 0x04, 0))).toBe(true);
    expect(isSpreadsheetBytes(of(0xd0, 0xcf, 0x11, 0xe0, 0))).toBe(true);
    expect(isSpreadsheetBytes(of(0x50, 0x4b, 0x03, 0x05))).toBe(false);
    expect(isSpreadsheetBytes(of(0x50, 0x4b, 0x00, 0x04))).toBe(false);
    expect(isSpreadsheetBytes(of(0x50, 0x00, 0x03, 0x04))).toBe(false);
    expect(isSpreadsheetBytes(of(0x00, 0x4b, 0x03, 0x04))).toBe(false);
    expect(isSpreadsheetBytes(of(0xd0, 0xcf, 0x11, 0x00))).toBe(false);
    expect(isSpreadsheetBytes(of(0xd0, 0xcf, 0x00, 0xe0))).toBe(false);
    expect(isSpreadsheetBytes(of(0xd0, 0x00, 0x11, 0xe0))).toBe(false);
    expect(isSpreadsheetBytes(of(0x00, 0xcf, 0x11, 0xe0))).toBe(false);
    expect(isSpreadsheetBytes(of())).toBe(false);
  });

  it("gives no rows for a sheet with only a header", () => {
    expect(parsePpmRiskWorkbook(bytesOf([HEADERS]))).toEqual([]);
    expect(parsePpmRiskWorkbook(bytesOf([HEADERS, ["", "", ""]]))).toEqual([]);
  });

  it("accepts raw keys, ignores unknown columns and prefers the Risks sheet", () => {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["title"], ["wrong sheet"]]), "Notes");
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.aoa_to_sheet([
        ["TITLE", "Colour", "owner_email", "Risk Score"],
        ["A", "blue", "alice@example.com", 99],
      ]),
      "risks",
    );
    const bytes = XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
    expect(parsePpmRiskWorkbook(bytes)).toEqual([
      { sheetRow: 1, cells: { title: "A", owner: "alice@example.com", risk_score: "99" } },
    ]);
  });

  it("takes the first non-blank cell when two headers name one column", () => {
    const rows = parsePpmRiskWorkbook(
      bytesOf([
        ["title", "owner_name", "owner_email", "Owner"],
        ["A", "", "bob@example.com", "Alice Admin"],
        ["B", "Alice Admin", "bob@example.com", ""],
      ]),
    );
    expect(rows[0].cells.owner).toBe("bob@example.com");
    expect(rows[1].cells.owner).toBe("Alice Admin");
  });

  it("keeps the sheet position of rows after a blank one", () => {
    const rows = parsePpmRiskWorkbook(bytesOf([["title"], ["A"], [""], ["B"]]));
    expect(rows.map((r) => r.sheetRow)).toEqual([1, 3]);
  });

  it("matches headers by the current language with the English ones as fallback", () => {
    const t = (key: string) => (key === "ppm:riskTitle" ? "Titel" : key);
    const rows = parsePpmRiskWorkbook(bytesOf([["Titel", "Risk ID"], ["A", "r1"]]), t);
    expect(rows[0].cells).toEqual({ title: "A", id: "r1" });
  });
});

describe("validation", () => {
  it("requires a title", () => {
    expect(planOne({ title: "" })).toMatchObject({
      kind: "rejected",
      errors: ["Title is required"],
    });
    expect(planOne({ title: "  " })).toMatchObject({ kind: "rejected" });
    expect(planOne({ description: "x" })).toMatchObject({
      kind: "rejected",
      errors: ["Title is required"],
    });
  });

  it.each(["0", "6", "2.5", "high", "-1", "12"])(
    "rejects probability and impact %s",
    (value) => {
      expect(planOne({ title: "A", probability: value })).toMatchObject({
        kind: "rejected",
        errors: [`Probability must be a whole number from 1 to 5, not ${value}`],
      });
      expect(planOne({ title: "A", impact: value })).toMatchObject({
        kind: "rejected",
        errors: [`Impact must be a whole number from 1 to 5, not ${value}`],
      });
    },
  );

  it("accepts every whole number from 1 to 5", () => {
    for (const v of ["1", "2", "3", "4", "5"]) {
      expect(planOne({ title: "A", probability: v, impact: ` ${v} ` })).toMatchObject({
        kind: "create",
        body: { probability: Number(v), impact: Number(v) },
      });
    }
  });

  it("defaults a blank probability, impact and status on create", () => {
    expect(planOne({ title: "A", probability: "", impact: "", status: "" })).toMatchObject({
      kind: "create",
      body: { title: "A", probability: 3, impact: 3, status: "open" },
    });
  });

  it("accepts a status by its label or key, case-insensitively", () => {
    const status = (s: string) =>
      (planOne({ title: "A", status: s }) as { body: { status: string } }).body.status;
    expect(status("Mitigating")).toBe("mitigating");
    expect(status("mitigated")).toBe("mitigated");
    expect(status("CLOSED")).toBe("closed");
    expect(status(" accepted ")).toBe("accepted");
    expect(status("oPeN")).toBe("open");
  });

  it("rejects an unknown status and lists the allowed ones", () => {
    expect(planOne({ title: "A", status: "Done" })).toMatchObject({
      kind: "rejected",
      errors: ["Unknown status Done; use one of Open, Mitigating, Mitigated, Closed, Accepted"],
    });
  });

  it("collects every reason of a row", () => {
    expect(planOne({ id: "nope", title: "", probability: "9", impact: "x", status: "?" })).toEqual({
      kind: "rejected",
      sheetRow: 1,
      title: "",
      warnings: [],
      errors: [
        "This initiative has no risk with the ID nope",
        "Title is required",
        "Probability must be a whole number from 1 to 5, not 9",
        "Impact must be a whole number from 1 to 5, not x",
        "Unknown status ?; use one of Open, Mitigating, Mitigated, Closed, Accepted",
      ],
    });
  });

  it("rejects an id this initiative does not have, and a repeated id", () => {
    const plan = planPpmRiskImport(
      [row({ id: "r1", title: "A" }, 1), row({ id: "r1", title: "B" }, 4), row({ id: "zz", title: "C" }, 5)],
      RISKS,
      USERS,
    );
    expect(plan.rows[0]).toMatchObject({ kind: "update", riskId: "r1" });
    expect(plan.rows[1]).toMatchObject({
      kind: "rejected",
      errors: ["The ID r1 is already used in row 2"],
    });
    expect(plan.rows[2]).toMatchObject({
      kind: "rejected",
      errors: ["This initiative has no risk with the ID zz"],
    });
    expect(plan).toMatchObject({ create: 0, update: 1, unchanged: 0, rejected: 2, warnings: 0 });
  });
});

describe("owner", () => {
  it("matches by display name and by email, case-insensitively", () => {
    expect(planOne({ title: "A", owner: "bob builder" })).toMatchObject({
      kind: "create",
      body: { owner_id: "u2" },
      warnings: [],
    });
    expect(planOne({ title: "A", owner: "BOB@example.COM" })).toMatchObject({
      body: { owner_id: "u2" },
    });
    expect(planOne({ title: "A", owner: "sam2@example.com" })).toMatchObject({
      body: { owner_id: "u4" },
    });
  });

  it("reports an unknown owner and creates without one", () => {
    const r = planOne({ title: "A", owner: "Zed" });
    expect(r).toMatchObject({
      kind: "create",
      warnings: ["No user matches the owner Zed; the owner is left unchanged"],
    });
    expect((r as { body: object }).body).not.toHaveProperty("owner_id");
  });

  it("reports an ambiguous owner name", () => {
    expect(planOne({ title: "A", owner: "Sam Same" })).toMatchObject({
      warnings: ["Several users match the owner Sam Same; the owner is left unchanged"],
    });
  });

  it("leaves the owner alone on an update when it cannot be matched", () => {
    const r = planOne({ id: "r1", title: "Vendor delay", owner: "Zed" });
    expect(r).toMatchObject({ kind: "unchanged", riskId: "r1" });
    expect(r.warnings).toHaveLength(1);
    const plan = planPpmRiskImport([row({ id: "r1", title: "Vendor delay", owner: "Zed" })], RISKS, USERS);
    expect(plan.warnings).toBe(1);
  });

  it("keeps the current owner by name even when the user list lacks them", () => {
    expect(planPpmRiskImport([row({ id: "r1", title: "Vendor delay", owner: "alice admin" })], RISKS, []).rows[0]).toMatchObject({
      kind: "unchanged",
      warnings: [],
    });
  });

  it("changes and clears the owner on an update", () => {
    expect(planOne({ id: "r1", title: "Vendor delay", owner: "Bob Builder" })).toMatchObject({
      kind: "update",
      body: { owner_id: "u2" },
      changed: ["Owner"],
    });
    expect(planOne({ id: "r1", title: "Vendor delay", owner: "" })).toMatchObject({
      kind: "update",
      body: { owner_id: null },
    });
    expect(planOne({ id: "r2", title: "Budget overrun", owner: "" })).toMatchObject({
      kind: "unchanged",
    });
  });
});

describe("create vs update", () => {
  it("creates with every given field", () => {
    expect(
      planOne({
        title: "A",
        description: "d",
        probability: "5",
        impact: "4",
        status: "Accepted",
        owner: "alice@example.com",
        mitigation: "m",
        risk_score: "1",
      }),
    ).toEqual({
      kind: "create",
      sheetRow: 1,
      title: "A",
      warnings: [],
      body: {
        title: "A",
        description: "d",
        probability: 5,
        impact: 4,
        status: "accepted",
        owner_id: "u1",
        mitigation: "m",
      },
    });
  });

  it("updates every changed field and only those", () => {
    expect(
      planOne({
        id: "r1",
        title: "Renamed",
        description: "",
        probability: "1",
        impact: "2",
        status: "Closed",
        owner: "Bob Builder",
        mitigation: "new plan",
      }),
    ).toEqual({
      kind: "update",
      sheetRow: 1,
      title: "Renamed",
      warnings: [],
      riskId: "r1",
      body: {
        title: "Renamed",
        description: null,
        probability: 1,
        impact: 2,
        status: "closed",
        owner_id: "u2",
        mitigation: "new plan",
      },
      changed: ["Risk Title", "Description", "Probability", "Impact", "Status", "Owner", "Mitigation"],
    });
  });

  it("sets text a risk did not have", () => {
    expect(planOne({ id: "r2", title: "Budget overrun", description: "now", mitigation: "plan" })).toMatchObject({
      kind: "update",
      body: { description: "now", mitigation: "plan" },
    });
  });

  it("leaves fields alone whose column is missing or whose score/status cell is blank", () => {
    expect(planOne({ id: "r1", title: "Vendor delay" })).toMatchObject({ kind: "unchanged" });
    expect(
      planOne({ id: "r1", title: "Vendor delay", probability: "", impact: "", status: "" }),
    ).toMatchObject({ kind: "unchanged" });
  });

  it("ignores whitespace-only differences in stored text", () => {
    const stored = [risk({ title: "Vendor delay ", description: "Supplier late  ", mitigation: " x" })];
    const cells = { id: "r1", title: "Vendor delay", description: "Supplier late", mitigation: "x" };
    expect(planOne(cells, stored)).toMatchObject({ kind: "unchanged" });
  });
});
