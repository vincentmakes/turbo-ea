/**
 * Print / PDF document of one PPM initiative, section by section.
 *
 * The user ticks the sections they want (overview, status reports, budget and
 * costs, risks, tasks and schedule) in `PpmProjectPdfDialog`; this module turns
 * what the initiative page already holds, plus the few reads the dialog adds,
 * into an HTML body for the shared pop-up print path in `@/lib/printDocument`.
 * Pure and free of React, like `features/grc/risk/riskPrint.ts`: every figure
 * and date is formatted through the `fmt` the dialog hands in.
 *
 * The figures mirror the initiative's own tabs: budget and actuals are decided
 * per side by `financialTotals` (a side with no lines of its own shows the
 * initiatives' beneath it, and says so), and the budget and cost tables group
 * by fiscal year through `costTableGroups`, never a second grouping rule.
 */
import i18n from "@/i18n";
import { fiscalYearLabel } from "@/lib/fiscalYear";
import {
  DOCUMENT_PRINT_CSS,
  documentHeader,
  escapeHtml,
  metaTable,
  section,
  tableHtml,
  textBlock,
  writePrintDocument,
  type PrintDocumentOptions,
} from "@/lib/printDocument";
import { PRINT_COLORS } from "@/theme/tokens";
import type {
  Card,
  PpmBudgetLine,
  PpmCostLine,
  PpmRisk,
  PpmRollupOut,
  PpmStatusReport,
  PpmTask,
  PpmWbs,
} from "@/types";
import { bucketFor, type BudgetTotals } from "./costChartData";
import { grandTotals, groupBudgetLines, groupCostLines, type GroupKey } from "./costTableGroups";
import { derivedYearGroups, financialTotals, type DerivedYearRow } from "./derivedFinancials";
import { riskStatusLabelKey, riskSummary, sortRisksForPrint } from "./ppmRiskModel";

/** Every section the document can hold, in the order it prints them. */
export const PPM_PRINT_SECTIONS = ["overview", "reports", "costs", "risks", "schedule"] as const;
export type PpmPrintSection = (typeof PPM_PRINT_SECTIONS)[number];

/** Where the dialog remembers the last choice, per browser. */
export const PPM_PDF_PREFS_KEY = "turboea.ppm.projectPdf.prefs";

/** Formatting the page's hooks supply, so the builders stay pure. */
export interface ProjectPrintFormat {
  /** A money figure in the workspace currency. */
  amount: (n: number) => string;
  /** A date in the workspace date format. */
  date: (value: string) => string;
  /** A date and time in the workspace date format. */
  dateTime: (value: string | Date) => string;
  /** Month (1-12) the fiscal year starts in. */
  fiscalYearStart: number;
}

/** `GET /ppm/initiatives/{id}/completion`. */
export interface ProjectCompletion {
  completion: number;
  wbs_count: number;
}

/** What the document is built from. The last three are read by the dialog only when needed. */
export interface ProjectPrintData {
  card: Card;
  /** The card's subtype, already translated; `null` when it has none. */
  subtypeLabel: string | null;
  /** The card's `initiativeStatus`, already translated; `null` when it has none. */
  initiativeStatusLabel: string | null;
  /** Newest first, as `GET /ppm/initiatives/{id}/reports` returns them. */
  reports: PpmStatusReport[];
  costLines: PpmCostLine[];
  budgetLines: PpmBudgetLine[];
  risks: PpmRisk[];
  rollup: PpmRollupOut | null;
  completion?: ProjectCompletion | null;
  wbs?: PpmWbs[];
  tasks?: PpmTask[];
}

const t = (key: string, opts?: Record<string, unknown>) =>
  String(i18n.t(`ppm:${key}`, opts as never));
const tCommon = (key: string, opts?: Record<string, unknown>) =>
  String(i18n.t(`common:${key}`, opts as never));
const tDelivery = (key: string, opts?: Record<string, unknown>) =>
  String(i18n.t(`delivery:${key}`, opts as never));

const DASH = "—";

/** The `ppm` key heading each section: the initiative tab it mirrors. */
export const SECTION_LABEL_KEYS: Record<PpmPrintSection, string> = {
  overview: "overview",
  reports: "statusReports",
  costs: "budgetAndCosts",
  risks: "riskManagement",
  schedule: "pdfSchedule",
};

const TASK_STATUS_KEYS: Record<string, string> = {
  todo: "statusTodo",
  in_progress: "statusInProgress",
  done: "statusDone",
  blocked: "statusBlocked",
};

const TASK_PRIORITY_KEYS: Record<string, string> = {
  critical: "priorityCritical",
  high: "priorityHigh",
  medium: "priorityMedium",
  low: "priorityLow",
};

/** The extra rules this document adds to the shared stylesheet. */
export const PROJECT_PRINT_CSS = `${DOCUMENT_PRINT_CSS}
  .doc-print h2, .doc-print h3 { break-after: avoid; page-break-after: avoid; }
  .doc-print tr { break-inside: avoid; page-break-inside: avoid; }
  .doc-print thead { display: table-header-group; break-inside: avoid; break-after: avoid; page-break-after: avoid; }
  .doc-print tbody tr:first-child { break-before: avoid; page-break-before: avoid; }
  .doc-print table.pdf-schedule th, .doc-print table.pdf-schedule td { font-size: 9pt; padding: 6px; }
  .doc-print .pdf-printed { text-align: center; color: ${PRINT_COLORS.inkSecondary}; font-size: 10pt; }
  .doc-print th, .doc-print td { overflow-wrap: anywhere; }
  .doc-print table.pdf-fixed { table-layout: fixed; }
  .doc-print td.num, .doc-print th.num { text-align: end; white-space: nowrap; }
  .doc-print td.date, .doc-print th.date { white-space: nowrap; }
  .doc-print .pdf-sub { color: ${PRINT_COLORS.inkSecondary}; font-size: 9pt; }
  .doc-print tr.pdf-group td { font-weight: 600; background: ${PRINT_COLORS.panel}; }
  .doc-print tr.pdf-total td { font-weight: 700; border-top: 2px solid ${PRINT_COLORS.text}; }
  .doc-print tr.pdf-wbs td:first-child { font-weight: 600; }
  .doc-print .derived { font-style: italic; }
  .doc-print .pdf-note { color: ${PRINT_COLORS.inkSecondary}; font-size: 10pt; }
`;

/** Indent of a work-breakdown row's first cell per level, in px. */
export const WBS_INDENT_PX = 18;

// ─── Fragments ──────────────────────────────────────────────────────────────

/**
 * A table cell: a scalar, escaped when the table is built, or a fragment the
 * section built itself — every scalar inside it already escaped.
 */
type Cell = string | { html: string };

/** A table column: its header, a class for its cells and an optional width. */
interface Column {
  label: string;
  /** `num` (end-aligned, one line), `date` (one line) or `pre` (keeps line breaks). */
  cls?: string;
  /** Header width, e.g. `30%`; read by a `pdf-fixed` table. */
  width?: string;
}

interface Row {
  cells: Cell[];
  /** Class on the `<tr>`. */
  cls?: string;
  /** Indent level of the first cell. */
  depth?: number;
}

/**
 * A header + rows table like `tableHtml`, with a class per column and per row,
 * an indent on the first cell, and cells that may be built fragments. A
 * `pdf-fixed` table lays out by its header widths, so no text can widen it
 * past the page. Callers only ever pass rows.
 */
function rowsTable(columns: Column[], rows: Row[], tableCls?: string): string {
  const cellClass = (i: number) => (columns[i].cls ? ` class="${columns[i].cls}"` : "");
  const head = `<tr>${columns
    .map((c, i) => {
      const width = c.width ? ` style="width:${c.width}"` : "";
      return `<th${cellClass(i)}${width}>${escapeHtml(c.label)}</th>`;
    })
    .join("")}</tr>`;
  const body = rows
    .map((row) => {
      const cls = row.cls ? ` class="${row.cls}"` : "";
      const cells = row.cells
        .map((c, i) => {
          const indent =
            i === 0 && row.depth
              ? ` style="padding-inline-start:${10 + row.depth * WBS_INDENT_PX}px"`
              : "";
          const inner = typeof c === "string" ? escapeHtml(c) : c.html;
          return `<td${cellClass(i)}${indent}>${inner}</td>`;
        })
        .join("");
      return `<tr${cls}>${cells}</tr>`;
    })
    .join("");
  // A real head: Chromium repeats it on every page the table spans.
  return `<table${tableCls ? ` class="${tableCls}"` : ""}><thead>${head}</thead><tbody>${body}</tbody></table>`;
}

/** Columns from labels: the first plain or with `firstCls`, the rest end-aligned figures. */
const figureColumns = (labels: string[], plain = 1, firstCls?: string): Column[] =>
  labels.map((label, i) => ({ label, cls: i === 0 ? firstCls : i < plain ? undefined : "num" }));

const h3 = (text: string) => `<h3>${escapeHtml(text)}</h3>`;
const note = (text: string) => `<p class="pdf-note">${escapeHtml(text)}</p>`;
const noneRecorded = () => textBlock(t("pdfNoneRecorded"));
const healthLabel = (value: string) => t(`health_${value}`, { defaultValue: value });
const dateOr = (fmt: ProjectPrintFormat, iso: string | null | undefined) =>
  iso ? fmt.date(iso) : DASH;

// ─── Sections ───────────────────────────────────────────────────────────────

function overviewSection(data: ProjectPrintData, fmt: ProjectPrintFormat): string {
  const attrs = (data.card.attributes || {}) as Record<string, unknown>;
  const asDate = (v: unknown) => (typeof v === "string" && v ? fmt.date(v) : "");
  const completion = data.completion;
  const completionText = !completion
    ? ""
    : completion.wbs_count === 0
      ? t("noWbsItems")
      : `${Math.round(completion.completion)}%`;
  let html = metaTable([
    [t("subtype"), data.subtypeLabel],
    [t("initiativeStatus"), data.initiativeStatusLabel],
    [t("startDate"), asDate(attrs.startDate)],
    [t("endDate"), asDate(attrs.endDate)],
    [t("completion"), completionText],
  ]);

  html += h3(t("healthSummary"));
  const latest = data.reports[0];
  html += latest
    ? metaTable([
        [t("health_schedule"), healthLabel(latest.schedule_health)],
        [t("health_cost"), healthLabel(latest.cost_health)],
        [t("health_scope"), healthLabel(latest.scope_health)],
      ])
    : textBlock(t("health_noReport"));

  const totals = financialTotals(data.budgetLines, data.costLines, data.rollup);
  const count = data.rollup?.descendant_count;
  const varianceOf = (key: keyof BudgetTotals) => totals.budget[key] - totals.actual[key];
  const figureRow = (label: string, get: (key: keyof BudgetTotals) => number, derived: boolean) => ({
    cells: [label, fmt.amount(get("capex")), fmt.amount(get("opex")), fmt.amount(get("total"))],
    cls: derived ? "derived" : undefined,
  });
  html += h3(t("financials"));
  html += rowsTable(figureColumns(["", t("capex"), t("opex"), t("total")]), [
    figureRow(t("totalBudget"), (k) => totals.budget[k], totals.budget.derived),
    figureRow(t("totalActual"), (k) => totals.actual[k], totals.actual.derived),
    figureRow(t("variance"), varianceOf, totals.budget.derived || totals.actual.derived),
  ]);
  if (totals.budget.derived) html += note(t("derivedBudgetTooltip", { count }));
  if (totals.actual.derived) html += note(t("derivedActualTooltip", { count }));

  if (data.card.description?.trim()) {
    html += h3(tCommon("labels.description")) + textBlock(data.card.description);
  }
  return html;
}

function reportsSection(data: ProjectPrintData, fmt: ProjectPrintFormat): string {
  const [latest, ...earlier] = data.reports;
  if (!latest) return noneRecorded();
  let html = h3(t("pdfLatestReport"));
  html += metaTable([
    [t("reportDate"), dateOr(fmt, latest.report_date)],
    [t("reporter"), latest.reporter?.display_name],
    [t("health_schedule"), healthLabel(latest.schedule_health)],
    [t("health_cost"), healthLabel(latest.cost_health)],
    [t("health_scope"), healthLabel(latest.scope_health)],
    [t("summary"), latest.summary],
    [t("accomplishments"), latest.accomplishments],
    [t("nextSteps"), latest.next_steps],
  ]);
  if (earlier.length > 0) {
    html += h3(t("pdfEarlierReports"));
    html += tableHtml(
      [t("reportDate"), t("reporter"), t("health_schedule"), t("health_cost"), t("health_scope")],
      earlier.map((r) => [
        dateOr(fmt, r.report_date),
        r.reporter?.display_name ?? DASH,
        healthLabel(r.schedule_health),
        healthLabel(r.cost_health),
        healthLabel(r.scope_health),
      ]),
    );
  }
  return html;
}

/** A line's amount under its category's column; any other category under Total only. */
function amountCells(amount: number, category: string, fmt: ProjectPrintFormat): string[] {
  const bucket = bucketFor(category);
  const text = fmt.amount(amount);
  return [bucket === "capex" ? text : "", bucket === "opex" ? text : "", bucket === null ? text : ""];
}

function totalsCells(totals: BudgetTotals, fmt: ProjectPrintFormat): string[] {
  return [fmt.amount(totals.capex), fmt.amount(totals.opex), fmt.amount(totals.total)];
}

function costsSection(data: ProjectPrintData, fmt: ProjectPrintFormat): string {
  const totals = financialTotals(data.budgetLines, data.costLines, data.rollup);
  const count = data.rollup?.descendant_count;
  const groupLabel = (key: GroupKey) =>
    key === "undated" ? t("undated") : fiscalYearLabel(key, fmt.fiscalYearStart, i18n.t);
  const allYears = t("totalAllYears");

  /** The derived side's table: one read-only row per fiscal year beneath, then their sum. */
  const derivedTable = (rows: DerivedYearRow[], sum: BudgetTotals) =>
    rowsTable(figureColumns([t("fiscalYear"), t("capex"), t("opex"), t("total")]), [
      ...rows.map((row) => ({
        cells: [groupLabel(row.key), ...totalsCells(row, fmt)],
        cls: "derived",
      })),
      { cells: [allYears, ...totalsCells(sum, fmt)], cls: "pdf-total derived" },
    ]);

  if (
    data.budgetLines.length === 0 &&
    data.costLines.length === 0 &&
    !totals.budget.derived &&
    !totals.actual.derived
  ) {
    return noneRecorded();
  }

  let html = h3(t("plannedBudget"));
  if (totals.budget.derived) {
    html += note(t("derivedBudgetCaption", { count }));
    html += derivedTable(derivedYearGroups(data.rollup, "budget"), totals.budget);
  } else if (data.budgetLines.length === 0) {
    html += textBlock(t("noBudgetLines"));
  } else {
    const groups = groupBudgetLines(data.budgetLines);
    const rows: Row[] = [];
    for (const g of groups) {
      rows.push({ cells: [groupLabel(g.key), ...totalsCells(g.totals, fmt)], cls: "pdf-group" });
      for (const line of g.lines) {
        rows.push({ cells: [line.description || DASH, ...amountCells(line.amount, line.category, fmt)], depth: 1 });
      }
    }
    rows.push({ cells: [allYears, ...totalsCells(grandTotals(groups), fmt)], cls: "pdf-total" });
    html += rowsTable(
      figureColumns([tCommon("labels.description"), t("capex"), t("opex"), t("total")], 1, "pre"),
      rows,
    );
  }

  html += h3(t("costItems"));
  if (totals.actual.derived) {
    html += note(t("derivedCostCaption", { count }));
    html += derivedTable(derivedYearGroups(data.rollup, "cost"), totals.actual);
  } else if (data.costLines.length === 0) {
    html += textBlock(t("noCostLines"));
  } else {
    const groups = groupCostLines(data.costLines, fmt.fiscalYearStart);
    const rows: Row[] = [];
    for (const g of groups) {
      rows.push({ cells: [groupLabel(g.key), "", ...totalsCells(g.totals, fmt)], cls: "pdf-group" });
      for (const line of g.lines) {
        rows.push({
          cells: [line.description || DASH, dateOr(fmt, line.date), ...amountCells(line.actual, line.category, fmt)],
          depth: 1,
        });
      }
    }
    rows.push({ cells: [allYears, "", ...totalsCells(grandTotals(groups), fmt)], cls: "pdf-total" });
    const columns = figureColumns(
      [tCommon("labels.description"), t("date"), t("capex"), t("opex"), t("total")],
      2,
      "pre",
    );
    columns[1].cls = "date";
    html += rowsTable(columns, rows);
  }
  return html;
}

/** The risk table's cells: title over its description, score over probability × impact. */
function riskRow(r: PpmRisk): Row {
  const description = r.description?.trim()
    ? `<div class="pre">${escapeHtml(r.description)}</div>`
    : "";
  return {
    cells: [
      { html: `<strong>${escapeHtml(r.title)}</strong>${description}` },
      {
        html:
          `<strong>${r.risk_score}</strong>` +
          `<div class="pdf-sub">${r.probability} \u00d7 ${r.impact}</div>`,
      },
      t(riskStatusLabelKey(r.status)),
      r.owner_name || DASH,
      r.mitigation || DASH,
    ],
  };
}

/** Risk, Score, Status, Owner, Mitigation: the text columns take the width. */
export const RISK_COLUMN_WIDTHS = ["36%", "10%", "13%", "13%", "28%"] as const;

function risksSection(data: ProjectPrintData): string {
  if (data.risks.length === 0) return noneRecorded();
  const summary = riskSummary(data.risks);
  const [risk, score, status, owner, mitigation] = RISK_COLUMN_WIDTHS;
  let html = textBlock(t("pdfRiskSummary", summary));
  html += rowsTable(
    [
      { label: t("pdfRisk"), width: risk },
      { label: t("pdfScore"), cls: "num", width: score },
      { label: t("riskStatus"), width: status },
      { label: t("riskOwner"), width: owner },
      { label: t("mitigation"), cls: "pre", width: mitigation },
    ],
    sortRisksForPrint(data.risks).map(riskRow),
    "pdf-fixed",
  );
  return html;
}

/** The translated label of a task status or priority; a value with no label prints as stored. */
function labelOr(keys: Record<string, string>, value: string): string {
  return keys[value] ? t(keys[value]) : value;
}

function taskCells(task: PpmTask, fmt: ProjectPrintFormat): string[] {
  return [
    task.title,
    dateOr(fmt, task.start_date),
    dateOr(fmt, task.due_date),
    task.assignee_name || DASH,
    labelOr(TASK_STATUS_KEYS, task.status),
    labelOr(TASK_PRIORITY_KEYS, task.priority),
  ];
}

/**
 * Title, Start, End / Due, Owner, Progress, Priority. At the schedule's 9pt and
 * compact padding a date, "In Progress" and "Medium" each fit on one line.
 */
export const SCHEDULE_COLUMN_WIDTHS = ["36%", "14%", "14%", "13%", "13%", "10%"] as const;
const SCHEDULE_TABLE_CLASS = "pdf-fixed pdf-schedule";

function scheduleSection(data: ProjectPrintData, fmt: ProjectPrintFormat): string {
  const wbs = data.wbs ?? [];
  const tasks = data.tasks ?? [];
  if (wbs.length === 0 && tasks.length === 0) return noneRecorded();

  const ids = new Set(wbs.map((w) => w.id));
  const bySortOrder = (a: { sort_order: number }, b: { sort_order: number }) =>
    a.sort_order - b.sort_order;
  const children = new Map<string | null, PpmWbs[]>();
  for (const w of wbs) {
    // A parent the reader cannot see (or that is gone) makes the package a root.
    const parent = w.parent_id && ids.has(w.parent_id) ? w.parent_id : null;
    const list = children.get(parent);
    if (list) list.push(w);
    else children.set(parent, [w]);
  }
  const tasksOf = new Map<string, PpmTask[]>();
  const unassigned: PpmTask[] = [];
  for (const task of tasks) {
    if (task.wbs_id && ids.has(task.wbs_id)) {
      const list = tasksOf.get(task.wbs_id);
      if (list) list.push(task);
      else tasksOf.set(task.wbs_id, [task]);
    } else {
      unassigned.push(task);
    }
  }

  // Progress is a package's completion and a task's status: one column, never half empty.
  const [title, start, end, owner, progress, priority] = SCHEDULE_COLUMN_WIDTHS;
  const headers: Column[] = [
    { label: t("wbsTitle"), width: title },
    { label: t("startDate"), cls: "date", width: start },
    { label: t("pdfEndOrDue"), cls: "date", width: end },
    { label: t("pdfOwner"), width: owner },
    { label: t("pdfProgress"), width: progress },
    { label: t("taskPriority"), width: priority },
  ];
  const rows: Row[] = [];
  const visit = (parent: string | null, depth: number) => {
    for (const w of [...(children.get(parent) ?? [])].sort(bySortOrder)) {
      const title = w.is_milestone ? `◆ ${w.title} (${t("milestone")})` : w.title;
      rows.push({
        cells: [
          title,
          dateOr(fmt, w.start_date),
          dateOr(fmt, w.end_date),
          w.assignee_name || DASH,
          `${Math.round(w.completion)}%`,
          "",
        ],
        cls: "pdf-wbs",
        depth,
      });
      for (const task of [...(tasksOf.get(w.id) ?? [])].sort(bySortOrder)) {
        rows.push({ cells: taskCells(task, fmt), cls: "pdf-task", depth: depth + 1 });
      }
      visit(w.id, depth + 1);
    }
  };
  visit(null, 0);

  let html = "";
  if (rows.length > 0) html += h3(t("wbs")) + rowsTable(headers, rows, SCHEDULE_TABLE_CLASS);
  if (unassigned.length > 0) {
    html += h3(t("unassigned"));
    html += rowsTable(
      headers,
      [...unassigned].sort(bySortOrder).map((task) => ({ cells: taskCells(task, fmt), cls: "pdf-task" })),
      SCHEDULE_TABLE_CLASS,
    );
  }
  return html;
}

// ─── Document ───────────────────────────────────────────────────────────────

/** The ticked sections in print order, whatever order they were ticked in. */
export function orderedSections(sections: Iterable<unknown>): PpmPrintSection[] {
  const ticked = new Set<unknown>(sections);
  return PPM_PRINT_SECTIONS.filter((s) => ticked.has(s));
}

/** The inner HTML body for the ticked sections. Pure; exported for tests. */
export function buildProjectPrintBody(
  data: ProjectPrintData,
  sections: Iterable<unknown>,
  fmt: ProjectPrintFormat,
  now: Date = new Date(),
): string {
  const builders: Record<PpmPrintSection, () => string> = {
    overview: () => overviewSection(data, fmt),
    reports: () => reportsSection(data, fmt),
    costs: () => costsSection(data, fmt),
    risks: () => risksSection(data),
    schedule: () => scheduleSection(data, fmt),
  };
  // The print date sits on the cover, not in a footer fixed to the page
  // bottom, which a page filled to the bottom would print over.
  let html = documentHeader(t("pdfDocumentTitle"), data.card.name);
  html += `<p class="pdf-printed">${escapeHtml(
    tDelivery("export.printed", { date: fmt.dateTime(now) }),
  )}</p>`;
  for (const s of orderedSections(sections)) {
    html += section(t(SECTION_LABEL_KEYS[s]), builders[s]());
  }
  return html;
}

/** Title, body and stylesheet for the pop-up; no fixed footer. Pure; exported for tests. */
export function projectPrintDocument(
  data: ProjectPrintData,
  sections: Iterable<unknown>,
  fmt: ProjectPrintFormat,
  now: Date = new Date(),
): PrintDocumentOptions {
  return {
    title: data.card.name,
    bodyHtml: buildProjectPrintBody(data, sections, fmt, now),
    css: PROJECT_PRINT_CSS,
  };
}

/** Fill a pop-up opened in the click (see `openPrintWindow`) and print it. */
export function printProject(
  data: ProjectPrintData,
  sections: Iterable<unknown>,
  fmt: ProjectPrintFormat,
  win: Window,
): void {
  writePrintDocument(win, projectPrintDocument(data, sections, fmt));
}

// ─── Remembered choice ──────────────────────────────────────────────────────

/**
 * The sections ticked last time in this browser, in print order. Anything
 * unreadable, unknown names dropped, and an empty choice all mean every section.
 */
export function loadPrintSections(): PpmPrintSection[] {
  try {
    // Nothing stored reads as the JSON `null`.
    const parsed: unknown = JSON.parse(String(localStorage.getItem(PPM_PDF_PREFS_KEY)));
    const kept = Array.isArray(parsed) ? orderedSections(parsed) : [];
    return kept.length > 0 ? kept : [...PPM_PRINT_SECTIONS];
  } catch {
    return [...PPM_PRINT_SECTIONS];
  }
}

/** Remember the ticked sections for next time; a storage failure is ignored. */
export function savePrintSections(sections: Iterable<unknown>): void {
  try {
    localStorage.setItem(PPM_PDF_PREFS_KEY, JSON.stringify(orderedSections(sections)));
  } catch {
    // Storage full or disabled — the dialog falls back to every section.
  }
}
