import { describe, expect, it } from "vitest";
import type { MitigationTask, Risk } from "@/types";
import { flattenTasksForExport, risksToRows } from "./taskHistoryExport";

function risk(overrides: Partial<Risk> = {}): Risk {
  return {
    id: "risk-1",
    reference: "R-000123",
    title: "Legacy auth service",
    description: "Unsupported identity provider still in production.",
    category: "technology",
    source_type: "manual",
    source_ref: null,
    initial_probability: "high",
    initial_impact: "high",
    initial_level: "high",
    residual_probability: null,
    residual_impact: null,
    residual_level: null,
    owner_id: null,
    owner_name: null,
    target_resolution_date: null,
    status: "identified",
    acceptance_rationale: null,
    accepted_by: null,
    accepted_at: null,
    created_by: "u1",
    created_at: "2026-05-14T10:00:00Z",
    updated_at: "2026-05-14T10:00:00Z",
    cards: [],
    ...overrides,
  } as Risk;
}

function task(overrides: Partial<MitigationTask> = {}): MitigationTask {
  return {
    id: "task-1",
    reference: "T-000001",
    risk_id: "risk-1",
    title: "Apply MFA",
    description: null,
    owner_id: "u1",
    owner_name: "Jane Smith",
    recurrence_unit: "none",
    recurrence_interval: 1,
    lead_time_days: 0,
    is_active: true,
    created_by: "u1",
    created_at: "2026-05-14T10:00:00Z",
    updated_at: "2026-05-14T10:00:00Z",
    occurrences: [],
    ...overrides,
  };
}

describe("flattenTasksForExport", () => {
  it("produces one row per occurrence", () => {
    const t = task({
      occurrences: [
        {
          id: "o1",
          task_id: "task-1",
          sequence: 1,
          assigned_owner_id: "u1",
          assigned_owner_name: "Jane Smith",
          due_date: "2026-01-15",
          status: "done",
          activated_at: null,
          completed_at: "2026-01-14T09:00:00Z",
          completed_by: "u1",
          completed_by_name: "Jane Smith",
          owner_at_completion: "u1",
          owner_at_completion_name: "Jane Smith",
          completion_notes: "All good",
          created_at: "2026-01-01T00:00:00Z",
          updated_at: "2026-01-14T09:00:00Z",
        },
        {
          id: "o2",
          task_id: "task-1",
          sequence: 2,
          assigned_owner_id: "u1",
          assigned_owner_name: "Jane Smith",
          due_date: "2026-04-15",
          status: "open",
          activated_at: "2026-04-08T03:00:00Z",
          completed_at: null,
          completed_by: null,
          completed_by_name: null,
          owner_at_completion: null,
          owner_at_completion_name: null,
          completion_notes: null,
          created_at: "2026-01-14T09:00:00Z",
          updated_at: "2026-01-14T09:00:00Z",
        },
      ],
    });
    const rows = flattenTasksForExport([t], new Map([["risk-1", "R-000123"]]));
    expect(rows).toHaveLength(2);
    expect(rows[0].risk_reference).toBe("R-000123");
    expect(rows[0].task_reference).toBe("T-000001");
    expect(rows[0].cycle).toBe(1);
    expect(rows[0].status).toBe("done");
    expect(rows[0].owner_at_completion).toBe("Jane Smith");
    expect(rows[1].cycle).toBe(2);
    expect(rows[1].status).toBe("open");
    expect(rows[1].completed_at).toBe("");
    // The completed (cycle 1) row was never gated, so activated_at is empty.
    expect(rows[0].activated_at).toBe("");
    // The newly-promoted open cycle carries its activation timestamp
    // through to the audit export.
    expect(rows[1].activated_at).toBe("2026-04-08T03:00:00Z");
  });

  it("flattens scheduled cycles with empty completion columns", () => {
    // A "scheduled" cycle is the dormant pre-state — it has a due_date
    // but no completion data; the export must still render it (audit
    // needs to see "next review: due 2026-11-15") without crashing on
    // missing fields.
    const t = task({
      recurrence_unit: "years",
      recurrence_interval: 1,
      lead_time_days: 14,
      occurrences: [
        {
          id: "scheduled-1",
          task_id: "task-1",
          sequence: 1,
          assigned_owner_id: "u1",
          assigned_owner_name: "Jane Smith",
          due_date: "2026-11-15",
          status: "scheduled",
          activated_at: null,
          completed_at: null,
          completed_by: null,
          completed_by_name: null,
          owner_at_completion: null,
          owner_at_completion_name: null,
          completion_notes: null,
          created_at: "2026-01-14T09:00:00Z",
          updated_at: "2026-01-14T09:00:00Z",
        },
      ],
    });
    const rows = flattenTasksForExport([t], new Map([["risk-1", "R-1"]]));
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("scheduled");
    expect(rows[0].due_date).toBe("2026-11-15");
    expect(rows[0].activated_at).toBe("");
    expect(rows[0].completed_at).toBe("");
    expect(rows[0].owner_at_completion).toBe("");
    // Lead time travels into the export — auditors can see "this
    // scheduled cycle was supposed to open Nov 1 (Nov 15 minus 14 days)".
    expect(rows[0].lead_time_days).toBe(14);
  });

  it("emits zero rows for a task with no occurrences", () => {
    const rows = flattenTasksForExport(
      [task({ occurrences: [] })],
      new Map([["risk-1", "R-000123"]]),
    );
    expect(rows).toEqual([]);
  });

  it("labels recurrence correctly", () => {
    const oneShot = task({ occurrences: [openOccurrence()] });
    const recurring = task({
      recurrence_unit: "months",
      recurrence_interval: 6,
      occurrences: [openOccurrence()],
    });
    const r1 = flattenTasksForExport([oneShot], new Map([["risk-1", "R-1"]]));
    const r2 = flattenTasksForExport([recurring], new Map([["risk-1", "R-1"]]));
    expect(r1[0].recurrence).toBe("one-shot");
    expect(r2[0].recurrence).toBe("every 6 months");
  });

  it("blank risk reference when not in the map", () => {
    const t = task({ occurrences: [openOccurrence()] });
    const rows = flattenTasksForExport([t], new Map());
    expect(rows[0].risk_reference).toBe("");
  });
});

describe("risksToRows", () => {
  it("includes the description field in the exported row", () => {
    const rows = risksToRows([
      risk({ description: "Unsupported identity provider still in production." }),
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0].description).toBe(
      "Unsupported identity provider still in production.",
    );
    expect(rows[0].reference).toBe("R-000123");
    expect(rows[0].title).toBe("Legacy auth service");
  });

  it("maps a blank description to an empty string", () => {
    const rows = risksToRows([risk({ description: "" })]);
    expect(rows[0].description).toBe("");
  });
});

function openOccurrence() {
  return {
    id: "o",
    task_id: "task-1",
    sequence: 1,
    assigned_owner_id: null,
    assigned_owner_name: null,
    due_date: null,
    status: "open" as const,
    activated_at: null,
    completed_at: null,
    completed_by: null,
    completed_by_name: null,
    owner_at_completion: null,
    owner_at_completion_name: null,
    completion_notes: null,
    created_at: null,
    updated_at: null,
  };
}
