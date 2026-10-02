/**
 * Workbook-level tests for the mitigation-task / risk-register exports.
 *
 * `taskHistoryExport.test.ts` covers the pure row builders
 * (`flattenTasksForExport`, `risksToRows`). This file covers what actually
 * reaches the user: the workbooks `exportTaskHistory` and `exportRegister`
 * hand to `XLSX.writeFile` — sheet names and order, the header row that must
 * exist even for an empty export, cell types, column widths, file names and
 * the logged-and-rethrown failure path — plus the row-builder edge cases the
 * first file leaves out.
 *
 * `XLSX.writeFile` is the only thing mocked: under jsdom it would try to
 * trigger a browser download (`URL.createObjectURL` + `<a download>`), which
 * jsdom does not implement. Every other `xlsx` export stays real, so the
 * workbook handed to the mock is a genuine SheetJS workbook that the test
 * reads back with `sheet_to_json`.
 *
 * The file name carries a local-time stamp, so the clock is frozen with
 * `vi.setSystemTime` wherever a name is asserted.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as XLSX from "xlsx";

import type { MitigationTask, MitigationTaskOccurrence, Risk } from "@/types";

import {
  exportRegister,
  exportTaskHistory,
  flattenTasksForExport,
  risksToRows,
} from "./taskHistoryExport";

vi.mock("xlsx", async (importOriginal) => {
  const actual = await importOriginal<typeof import("xlsx")>();
  return { ...actual, writeFile: vi.fn() };
});

const writeFile = vi.mocked(XLSX.writeFile);

/* ------------------------------------------------------------------------- */
/*  Fixtures                                                                   */
/* ------------------------------------------------------------------------- */

const RISK_ID = "00000000-0000-4000-8000-00000000a001";
const OTHER_RISK_ID = "00000000-0000-4000-8000-00000000a002";

function makeOccurrence(
  overrides: Partial<MitigationTaskOccurrence> = {},
): MitigationTaskOccurrence {
  return {
    id: "occ-1",
    task_id: "task-1",
    sequence: 1,
    assigned_owner_id: null,
    assigned_owner_name: null,
    due_date: null,
    status: "open",
    activated_at: null,
    completed_at: null,
    completed_by: null,
    completed_by_name: null,
    owner_at_completion: null,
    owner_at_completion_name: null,
    completion_notes: null,
    created_at: null,
    updated_at: null,
    ...overrides,
  };
}

function makeTask(overrides: Partial<MitigationTask> = {}): MitigationTask {
  return {
    id: "task-1",
    reference: "T-000001",
    risk_id: RISK_ID,
    title: "Rotate the signing keys",
    description: null,
    owner_id: null,
    owner_name: "Alice Owner",
    recurrence_unit: "none",
    recurrence_interval: 1,
    lead_time_days: 0,
    is_active: true,
    created_by: null,
    created_at: null,
    updated_at: null,
    occurrences: [makeOccurrence()],
    ...overrides,
  };
}

function makeRisk(overrides: Partial<Risk> = {}): Risk {
  return {
    id: RISK_ID,
    reference: "R-000001",
    title: "IdP outage",
    description: "Loss of access if the IdP is down",
    category: "operational",
    source_type: "manual",
    source_ref: null,
    initial_probability: "high",
    initial_impact: "critical",
    initial_level: "critical",
    residual_probability: "low",
    residual_impact: "high",
    residual_level: "medium",
    owner_id: null,
    owner_name: "Bob Owner",
    target_resolution_date: "2026-12-31",
    status: "in_progress",
    acceptance_rationale: null,
    accepted_by: null,
    accepted_at: null,
    created_by: null,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-09-30T12:00:00Z",
    cards: [
      { card_id: "c1", card_name: "NexaCore ERP", card_type: "Application", role: "affected" },
      { card_id: "c2", card_name: "Identity Platform", card_type: "Application", role: "affected" },
    ],
    ...overrides,
  };
}

const OCCURRENCE_HEADERS = [
  "risk_reference",
  "task_reference",
  "task_title",
  "task_owner",
  "recurrence",
  "lead_time_days",
  "is_active",
  "cycle",
  "assigned_owner",
  "due_date",
  "status",
  "activated_at",
  "completed_at",
  "completed_by",
  "owner_at_completion",
  "completion_notes",
];

const RISK_HEADERS = [
  "reference",
  "title",
  "description",
  "category",
  "initial_level",
  "residual_level",
  "status",
  "owner",
  "target_resolution_date",
  "cards",
  "updated_at",
];

/** The workbook handed to the (mocked) `writeFile` on the latest call. */
function lastWritten(): { wb: XLSX.WorkBook; filename: string } {
  const call = writeFile.mock.calls.at(-1);
  if (!call) throw new Error("writeFile was not called");
  return { wb: call[0] as XLSX.WorkBook, filename: call[1] as string };
}

/** A sheet as an array of arrays (header row first), blanks as "". */
function aoa(ws: XLSX.WorkSheet): unknown[][] {
  return XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: "" });
}

beforeEach(() => {
  writeFile.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

/* ------------------------------------------------------------------------- */
/*  Row builders — the cases taskHistoryExport.test.ts leaves out              */
/* ------------------------------------------------------------------------- */

describe("flattenTasksForExport", () => {
  it("maps every occurrence column and blanks the nulls", () => {
    const task = makeTask({
      lead_time_days: 7,
      occurrences: [
        makeOccurrence({
          sequence: 3,
          assigned_owner_name: "Carol",
          due_date: "2026-10-15",
          status: "done",
          activated_at: "2026-10-08T03:00:00Z",
          completed_at: "2026-10-14T09:30:00Z",
          completed_by_name: "Dave",
          owner_at_completion_name: "Carol",
          completion_notes: "All keys rotated",
        }),
      ],
    });
    const [row] = flattenTasksForExport([task], new Map([[RISK_ID, "R-000009"]]));
    expect(row).toEqual({
      risk_reference: "R-000009",
      task_reference: "T-000001",
      task_title: "Rotate the signing keys",
      task_owner: "Alice Owner",
      recurrence: "one-shot",
      lead_time_days: 7,
      is_active: "yes",
      cycle: 3,
      assigned_owner: "Carol",
      due_date: "2026-10-15",
      status: "done",
      activated_at: "2026-10-08T03:00:00Z",
      completed_at: "2026-10-14T09:30:00Z",
      completed_by: "Dave",
      owner_at_completion: "Carol",
      completion_notes: "All keys rotated",
    });

    const [bare] = flattenTasksForExport(
      [makeTask({ owner_name: null, is_active: false })],
      new Map([[RISK_ID, "R-000001"]]),
    );
    expect(bare.task_owner).toBe("");
    expect(bare.is_active).toBe("no");
    expect(bare.assigned_owner).toBe("");
    expect(bare.due_date).toBe("");
    expect(bare.completed_by).toBe("");
    expect(bare.completion_notes).toBe("");
  });

  it("falls back to empty strings when the reference, title or lead time are missing", () => {
    const task = makeTask({
      reference: undefined as unknown as string,
      title: undefined as unknown as string,
      lead_time_days: undefined as unknown as number,
    });
    const [row] = flattenTasksForExport([task], new Map([[RISK_ID, "R-000001"]]));
    expect(row.task_reference).toBe("");
    expect(row.task_title).toBe("");
    expect(row.lead_time_days).toBe(0);
  });

  it("drops tasks with no occurrences and keeps the order of the rest", () => {
    const rows = flattenTasksForExport(
      [
        makeTask({ id: "a", reference: "T-000001", occurrences: [] }),
        makeTask({ id: "b", reference: "T-000002" }),
        makeTask({ id: "c", reference: "T-000003" }),
      ],
      new Map([[RISK_ID, "R-000001"]]),
    );
    expect(rows.map((r) => r.task_reference)).toEqual(["T-000002", "T-000003"]);
  });

  it("returns an empty list for no tasks", () => {
    expect(flattenTasksForExport([], new Map())).toEqual([]);
  });
});

describe("risksToRows", () => {
  it("maps a risk to the register row shape, joining card names with '; '", () => {
    expect(risksToRows([makeRisk()])).toEqual([
      {
        reference: "R-000001",
        title: "IdP outage",
        description: "Loss of access if the IdP is down",
        category: "operational",
        initial_level: "critical",
        residual_level: "medium",
        status: "in_progress",
        owner: "Bob Owner",
        target_resolution_date: "2026-12-31",
        cards: "NexaCore ERP; Identity Platform",
        updated_at: "2026-09-30T12:00:00Z",
      },
    ]);
  });

  it("blanks every nullable column", () => {
    const [row] = risksToRows([
      makeRisk({
        description: null as unknown as string,
        residual_level: null,
        owner_name: null,
        target_resolution_date: null,
        updated_at: null,
        cards: [],
      }),
    ]);
    expect(row.description).toBe("");
    expect(row.residual_level).toBe("");
    expect(row.owner).toBe("");
    expect(row.target_resolution_date).toBe("");
    expect(row.updated_at).toBe("");
    expect(row.cards).toBe("");
  });

  it("returns an empty list for no risks", () => {
    expect(risksToRows([])).toEqual([]);
  });
});

/* ------------------------------------------------------------------------- */
/*  exportTaskHistory                                                          */
/* ------------------------------------------------------------------------- */

describe("exportTaskHistory", () => {
  it("writes a single 'Cycles' sheet with the canonical header row and one row per cycle", () => {
    const task = makeTask({
      occurrences: [
        makeOccurrence({ sequence: 1, status: "done", due_date: "2026-01-31" }),
        makeOccurrence({ id: "occ-2", sequence: 2, status: "open", due_date: "2026-07-31" }),
      ],
    });
    exportTaskHistory(task, "R-000042");

    expect(writeFile).toHaveBeenCalledTimes(1);
    const { wb } = lastWritten();
    expect(wb.SheetNames).toEqual(["Cycles"]);
    const rows = aoa(wb.Sheets.Cycles);
    expect(rows[0]).toEqual(OCCURRENCE_HEADERS);
    expect(rows).toHaveLength(3);
    expect(rows[1][0]).toBe("R-000042");
    expect(rows[1][7]).toBe(1);
    expect(rows[1][9]).toBe("2026-01-31");
    expect(rows[2][7]).toBe(2);
    expect(rows[2][10]).toBe("open");
  });

  it("keeps numeric columns numeric and stringifies the rest", () => {
    exportTaskHistory(makeTask({ lead_time_days: 14 }), "R-000001");
    const ws = lastWritten().wb.Sheets.Cycles;
    // lead_time_days is column F, is_active column G, cycle column H.
    expect(ws.F2.t).toBe("n");
    expect(ws.F2.v).toBe(14);
    expect(ws.H2.t).toBe("n");
    expect(ws.H2.v).toBe(1);
    expect(ws.G2.t).toBe("s");
    expect(ws.G2.v).toBe("yes");
  });

  it("names the file after the task reference and a zero-padded local-time stamp", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 2, 5, 7, 4, 59));
    exportTaskHistory(makeTask({ reference: "T-000123" }), "R-000001");
    expect(lastWritten().filename).toBe("mitigation-task-T-000123-2026-03-05_0704.xlsx");
  });

  it("falls back to the task id in the file name when the reference is blank", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 11, 24, 23, 59));
    exportTaskHistory(makeTask({ id: "abc-123", reference: "" }), "R-000001");
    expect(lastWritten().filename).toBe("mitigation-task-abc-123-2026-12-24_2359.xlsx");
  });

  it("still writes the header row when the task has no occurrences", () => {
    exportTaskHistory(makeTask({ occurrences: [] }), "R-000001");
    const ws = lastWritten().wb.Sheets.Cycles;
    expect(ws["!ref"]).toBe("A1:P1");
    expect(aoa(ws)).toEqual([OCCURRENCE_HEADERS]);
    // Column widths are still computed, from the headers alone.
    expect(ws["!cols"]).toHaveLength(OCCURRENCE_HEADERS.length);
  });

  it("auto-fits column widths between 8 and 60 characters", () => {
    const longNotes = "x".repeat(200);
    exportTaskHistory(
      makeTask({ occurrences: [makeOccurrence({ completion_notes: longNotes })] }),
      "R-1",
    );
    const cols = lastWritten().wb.Sheets.Cycles["!cols"] as XLSX.ColInfo[];
    const widthOf = (header: string) => cols[OCCURRENCE_HEADERS.indexOf(header)].wch;
    // Header-only columns: header length + 2, floored at 8.
    expect(widthOf("cycle")).toBe(8);
    expect(widthOf("risk_reference")).toBe("risk_reference".length + 2);
    // A very long value is capped at 60.
    expect(widthOf("completion_notes")).toBe(60);
    // The longest value wins when it beats the header.
    expect(widthOf("task_title")).toBe("Rotate the signing keys".length + 2);
  });

  it("logs and rethrows when the download fails", () => {
    const boom = new Error("disk full");
    writeFile.mockImplementationOnce(() => {
      throw boom;
    });
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => exportTaskHistory(makeTask(), "R-000001")).toThrow(boom);
    expect(error).toHaveBeenCalledWith("Failed to export mitigation task history:", boom);
  });
});

/* ------------------------------------------------------------------------- */
/*  exportRegister                                                             */
/* ------------------------------------------------------------------------- */

describe("exportRegister", () => {
  it("writes the Risks sheet first and the Mitigation tasks sheet second", () => {
    const risks = [makeRisk(), makeRisk({ id: OTHER_RISK_ID, reference: "R-000002", cards: [] })];
    const tasks = [
      makeTask({ id: "t1", reference: "T-000001", risk_id: RISK_ID }),
      makeTask({
        id: "t2",
        reference: "T-000002",
        risk_id: OTHER_RISK_ID,
        occurrences: [makeOccurrence({ sequence: 1 }), makeOccurrence({ id: "o2", sequence: 2 })],
      }),
    ];
    exportRegister(risks, tasks);

    expect(writeFile).toHaveBeenCalledTimes(1);
    const { wb } = lastWritten();
    expect(wb.SheetNames).toEqual(["Risks", "Mitigation tasks"]);

    const riskRows = aoa(wb.Sheets.Risks);
    expect(riskRows[0]).toEqual(RISK_HEADERS);
    expect(riskRows.slice(1).map((r) => r[0])).toEqual(["R-000001", "R-000002"]);
    expect(riskRows[1][9]).toBe("NexaCore ERP; Identity Platform");
    expect(riskRows[2][9]).toBe("");

    const taskRows = aoa(wb.Sheets["Mitigation tasks"]);
    expect(taskRows[0]).toEqual(OCCURRENCE_HEADERS);
    // Three occurrences across two tasks, each joined back to its risk.
    expect(taskRows.slice(1).map((r) => [r[0], r[1], r[7]])).toEqual([
      ["R-000001", "T-000001", 1],
      ["R-000002", "T-000002", 1],
      ["R-000002", "T-000002", 2],
    ]);
  });

  it("stringifies every risk cell, so an empty residual level is a blank string cell", () => {
    exportRegister([makeRisk({ residual_level: null })], []);
    const ws = lastWritten().wb.Sheets.Risks;
    // residual_level is column F.
    expect(ws.F2.t).toBe("s");
    expect(ws.F2.v).toBe("");
    expect(ws["!cols"]).toHaveLength(RISK_HEADERS.length);
  });

  it("leaves the risk reference blank for a task whose risk is not in the export", () => {
    exportRegister([makeRisk()], [makeTask({ risk_id: "not-exported" })]);
    const taskRows = aoa(lastWritten().wb.Sheets["Mitigation tasks"]);
    expect(taskRows[1][0]).toBe("");
    expect(taskRows[1][1]).toBe("T-000001");
  });

  it("writes header-only sheets for an empty register", () => {
    exportRegister([], []);
    const { wb } = lastWritten();
    expect(aoa(wb.Sheets.Risks)).toEqual([RISK_HEADERS]);
    expect(aoa(wb.Sheets["Mitigation tasks"])).toEqual([OCCURRENCE_HEADERS]);
  });

  it("names the file risk-register-<stamp>.xlsx", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 9, 2, 14, 30));
    exportRegister([makeRisk()], []);
    expect(lastWritten().filename).toBe("risk-register-2026-10-02_1430.xlsx");
  });

  it("logs and rethrows when the download fails", () => {
    const boom = new Error("quota exceeded");
    writeFile.mockImplementationOnce(() => {
      throw boom;
    });
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => exportRegister([makeRisk()], [makeTask()])).toThrow(boom);
    expect(error).toHaveBeenCalledWith("Failed to export risk register:", boom);
  });
});
