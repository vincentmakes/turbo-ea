/**
 * Workbook builders for mitigation tasks and their occurrence history.
 *
 * Two entry points:
 *
 * * ``exportTaskHistory(task)`` — single-sheet workbook with one row per
 *   occurrence of one task. Triggered from the Risk Detail page's
 *   per-task "Export history" button.
 * * ``exportRegister(risks, allTasks)`` — two-sheet workbook for the
 *   register-level export. Sheet 1 carries the risk grid (same columns
 *   as the legacy CSV export). Sheet 2 carries one row per occurrence
 *   across all tasks, joined back to risks via ``risk_reference``.
 *
 * ``flattenTasksForExport`` is the shared row-builder used by both, so
 * the column shape stays in sync.
 */
import * as XLSX from "xlsx";
import type { MitigationTask, Risk } from "@/types";

export interface OccurrenceRow {
  risk_reference: string;
  task_reference: string;
  task_title: string;
  task_owner: string;
  recurrence: string;
  lead_time_days: number;
  is_active: string;
  cycle: number;
  assigned_owner: string;
  due_date: string;
  status: string;
  activated_at: string;
  completed_at: string;
  completed_by: string;
  owner_at_completion: string;
  completion_notes: string;
}

function recurrenceLabel(task: MitigationTask): string {
  if (task.recurrence_unit === "none") return "one-shot";
  return `every ${task.recurrence_interval} ${task.recurrence_unit}`;
}

// Column order is the canonical schema for sheet rendering. Used as the
// header row when a task has zero occurrences (so an empty export still
// produces a usable workbook instead of a sheet with no headers).
const OCCURRENCE_COLUMNS: readonly (keyof OccurrenceRow)[] = [
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
] as const;

/**
 * Flatten tasks to one row per occurrence. Tasks with no occurrences
 * (shouldn't happen — every task gets a first cycle on create) drop out
 * silently so the spreadsheet doesn't show empty rows.
 */
export function flattenTasksForExport(
  tasks: MitigationTask[],
  riskReferenceById: Map<string, string>,
): OccurrenceRow[] {
  const rows: OccurrenceRow[] = [];
  for (const task of tasks) {
    const riskRef = riskReferenceById.get(task.risk_id) ?? "";
    for (const occ of task.occurrences) {
      rows.push({
        risk_reference: riskRef,
        task_reference: task.reference ?? "",
        task_title: task.title ?? "",
        task_owner: task.owner_name ?? "",
        recurrence: recurrenceLabel(task),
        lead_time_days: task.lead_time_days ?? 0,
        is_active: task.is_active ? "yes" : "no",
        cycle: occ.sequence,
        assigned_owner: occ.assigned_owner_name ?? "",
        due_date: occ.due_date ?? "",
        status: occ.status,
        activated_at: occ.activated_at ?? "",
        completed_at: occ.completed_at ?? "",
        completed_by: occ.completed_by_name ?? "",
        owner_at_completion: occ.owner_at_completion_name ?? "",
        completion_notes: occ.completion_notes ?? "",
      });
    }
  }
  return rows;
}

function timestamp(now: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}` +
    `_${pad(now.getHours())}${pad(now.getMinutes())}`
  );
}

function autoFitColumns(rows: Record<string, unknown>[], headers: string[]): XLSX.ColInfo[] {
  return headers.map((h) => {
    const longest = rows.reduce((max, row) => {
      const v = String(row[h] ?? "");
      return Math.max(max, v.length);
    }, h.length);
    return { wch: Math.min(Math.max(longest + 2, 8), 60) };
  });
}

/**
 * Build a worksheet that always has a header row, even when there are
 * no data rows. ``XLSX.utils.json_to_sheet([])`` produces a sheet with
 * no ``!ref`` and no headers — some Excel clients render that as a
 * blank file. Using ``aoa_to_sheet`` with the canonical header row up
 * front guarantees a usable spreadsheet.
 */
function buildOccurrenceSheet(rows: OccurrenceRow[]): XLSX.WorkSheet {
  const headers = OCCURRENCE_COLUMNS as readonly string[];
  const aoa: (string | number)[][] = [headers as string[]];
  for (const row of rows) {
    aoa.push(
      headers.map((h) => {
        const v = (row as unknown as Record<string, unknown>)[h];
        if (typeof v === "number") return v;
        return v === null || v === undefined ? "" : String(v);
      }),
    );
  }
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws["!cols"] = autoFitColumns(
    rows as unknown as Record<string, unknown>[],
    headers as string[],
  );
  return ws;
}

export function exportTaskHistory(task: MitigationTask, riskReference: string): void {
  try {
    const rows = flattenTasksForExport(
      [task],
      new Map([[task.risk_id, riskReference]]),
    );
    const ws = buildOccurrenceSheet(rows);
    const wb = XLSX.utils.book_new();
    // Sheet name "History" is reserved by Excel (used internally for
    // change-tracking metadata) and SheetJS will refuse to append it,
    // so we use the user-facing "Cycles" label instead. Matches the
    // ``risks.tasks.history.cycleLabel`` translation we already use in
    // the inline history list.
    XLSX.utils.book_append_sheet(wb, ws, "Cycles");
    const ref = task.reference || task.id;
    XLSX.writeFile(wb, `mitigation-task-${ref}-${timestamp()}.xlsx`);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("Failed to export mitigation task history:", err);
    throw err;
  }
}

interface RiskRow {
  reference: string;
  title: string;
  description: string;
  category: string;
  initial_level: string;
  residual_level: string;
  status: string;
  owner: string;
  target_resolution_date: string;
  cards: string;
  updated_at: string;
}

export function risksToRows(risks: Risk[]): RiskRow[] {
  return risks.map((r) => ({
    reference: r.reference,
    title: r.title,
    description: r.description ?? "",
    category: r.category,
    initial_level: r.initial_level,
    residual_level: r.residual_level ?? "",
    status: r.status,
    owner: r.owner_name ?? "",
    target_resolution_date: r.target_resolution_date ?? "",
    cards: r.cards.map((c) => c.card_name).join("; "),
    updated_at: r.updated_at ?? "",
  }));
}

const RISK_COLUMNS: readonly (keyof RiskRow)[] = [
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
] as const;

function buildRiskSheet(rows: RiskRow[]): XLSX.WorkSheet {
  const headers = RISK_COLUMNS as readonly string[];
  const aoa: (string | number)[][] = [headers as string[]];
  for (const row of rows) {
    aoa.push(
      headers.map((h) => {
        const v = (row as unknown as Record<string, unknown>)[h];
        return v === null || v === undefined ? "" : String(v);
      }),
    );
  }
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws["!cols"] = autoFitColumns(
    rows as unknown as Record<string, unknown>[],
    headers as string[],
  );
  return ws;
}

export function exportRegister(risks: Risk[], allTasks: MitigationTask[]): void {
  try {
    const riskRefById = new Map(risks.map((r) => [r.id, r.reference] as const));
    const riskRows = risksToRows(risks);
    const taskRows = flattenTasksForExport(allTasks, riskRefById);

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, buildRiskSheet(riskRows), "Risks");
    XLSX.utils.book_append_sheet(wb, buildOccurrenceSheet(taskRows), "Mitigation tasks");
    XLSX.writeFile(wb, `risk-register-${timestamp()}.xlsx`);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("Failed to export risk register:", err);
    throw err;
  }
}
