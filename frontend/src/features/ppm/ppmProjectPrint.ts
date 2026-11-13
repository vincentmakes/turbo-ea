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
  section,
  textBlock,
  writePrintDocument,
  type PrintDocumentOptions,
} from "@/lib/printDocument";
import { PRINT_COLORS, STATUS_COLORS, brand } from "@/theme/tokens";
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
import {
  bandColor,
  riskStatusLabelKey,
  riskSummary,
  scoreBand,
  sortRisksForPrint,
} from "./ppmRiskModel";
import {
  YEAR_BAND_TINT,
  bdi,
  budgetBar,
  chip,
  completionRing,
  healthDot,
  kpiTile,
  legend,
  pairFigures,
  priorityColor,
  riskHeatMap,
  riskStatusBreakdown,
  riskStatusColor,
  taskBarColors,
  tileRow,
  timelineLane,
  timelineModel,
  timelineScale,
  type LegendItem,
  type TimelineKind,
  type TimelineModel,
  type TimelineSpan,
} from "./ppmProjectPrintVisuals";

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
  /** A money figure in k / M with the currency, e.g. "1.2 MUSD", via `compactAmount`. */
  amountCompact: (n: number) => string;
  /** The workspace currency code, for `costPair` captions. */
  currency: string;
  /** The interface reads right to left. */
  isRtl: boolean;
}

/** A chart rendered to an SVG data URI by ppmProjectCharts. */
export interface ChartImage {
  src: string;
  title: string;
}
export interface ProjectPrintCharts {
  fiscalYear?: ChartImage;
  project?: ChartImage;
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
  /** The status's own colour (the metamodel option's, else the bundled one); `null` for a neutral chip. */
  initiativeStatusColor?: string | null;
  /** Newest first, as `GET /ppm/initiatives/{id}/reports` returns them. */
  reports: PpmStatusReport[];
  costLines: PpmCostLine[];
  budgetLines: PpmBudgetLine[];
  risks: PpmRisk[];
  rollup: PpmRollupOut | null;
  completion?: ProjectCompletion | null;
  wbs?: PpmWbs[];
  tasks?: PpmTask[];
  /** Charts the dialog rendered; a missing one does not print. */
  charts?: ProjectPrintCharts;
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
  html, body.doc-print, .doc-print * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .doc-print h2 { border-bottom: 2px solid ${brand.primary}; padding-bottom: 4px; margin: 20px 0 10px; }
  .doc-print h2, .doc-print h3 { break-after: avoid; page-break-after: avoid; }
  .doc-print tr { break-inside: avoid; page-break-inside: avoid; }
  .doc-print thead { display: table-header-group; break-inside: avoid; break-after: avoid; page-break-after: avoid; }
  .doc-print tbody tr:first-child { break-before: avoid; page-break-before: avoid; }
  .doc-print table.pdf-schedule th, .doc-print table.pdf-schedule td { font-size: 9pt; padding: 5px 6px; }
  .doc-print .pdf-printed { text-align: center; color: ${PRINT_COLORS.inkSecondary}; font-size: 10pt; }
  .doc-print .pdf-cover-chips { text-align: center; margin: -6px 0 6px; }
  .doc-print th, .doc-print td { overflow-wrap: anywhere; }
  .doc-print table.pdf-fixed { table-layout: fixed; }
  .doc-print td.num, .doc-print th.num { text-align: end; white-space: nowrap; }
  .doc-print td.date, .doc-print th.date { white-space: nowrap; }
  .doc-print .pdf-sub { color: ${PRINT_COLORS.inkSecondary}; font-size: 8.5pt; font-weight: 400; }
  .doc-print tr.pdf-group td { font-weight: 600; background: ${YEAR_BAND_TINT}; }
  .doc-print tr.pdf-total td { font-weight: 700; border-top: 2px solid ${PRINT_COLORS.text}; }
  .doc-print tr.pdf-wbs td:first-child { font-weight: 600; }
  .doc-print .derived { font-style: italic; }
  .doc-print .pdf-note { color: ${PRINT_COLORS.inkSecondary}; font-size: 10pt; }
  .doc-print .pdf-chip { display: inline-block; border: 1px solid; border-radius: 10px; padding: 0 7px; margin: 1px 2px; font-size: 8.5pt; font-weight: 600; line-height: 1.6; white-space: nowrap; font-style: normal; }
  .doc-print .pdf-keep { break-inside: avoid; page-break-inside: avoid; }
  .doc-print .pdf-tiles { display: flex; gap: 8px; margin: 10px 0; break-inside: avoid; page-break-inside: avoid; }
  .doc-print .pdf-tile { flex: 1 1 0; min-width: 0; border: 1px solid ${PRINT_COLORS.rule}; border-top: 3px solid ${brand.primary}; border-radius: 6px; padding: 6px 10px; background: ${PRINT_COLORS.panelLight}; }
  .doc-print .pdf-tile-label { font-size: 8.5pt; color: ${PRINT_COLORS.inkSecondary}; }
  .doc-print .pdf-tile-value { font-size: 14pt; font-weight: 700; line-height: 1.3; overflow-wrap: anywhere; }
  .doc-print .pdf-tile-sub { font-size: 8.5pt; color: ${PRINT_COLORS.inkSecondary}; }
  .doc-print .pdf-panels { display: flex; gap: 10px; margin: 10px 0; break-inside: avoid; page-break-inside: avoid; }
  .doc-print .pdf-panel { flex: 1 1 0; min-width: 0; border: 1px solid ${PRINT_COLORS.rule}; border-radius: 6px; padding: 8px 12px; }
  .doc-print .pdf-panel-title { font-weight: 600; font-size: 10.5pt; margin-bottom: 6px; color: ${PRINT_COLORS.text}; }
  .doc-print .pdf-panel p { margin: 0; }
  .doc-print .pdf-ring-row { display: flex; align-items: center; gap: 12px; }
  .doc-print .pdf-health { display: inline-flex; align-items: center; gap: 6px; }
  .doc-print .pdf-dot { display: inline-block; flex: none; width: 11px; height: 11px; border-radius: 50%; }
  .doc-print .pdf-health-row { display: flex; justify-content: space-between; gap: 8px; padding: 3px 0; }
  .doc-print .pdf-health-caption { color: ${PRINT_COLORS.inkSecondary}; }
  .doc-print .pdf-budget-bar { margin: 4px 0 10px; break-inside: avoid; page-break-inside: avoid; }
  .doc-print .pdf-bar-head { display: flex; justify-content: space-between; gap: 8px; font-size: 10pt; }
  .doc-print .pdf-bar-label { font-weight: 600; }
  .doc-print .pdf-bar-track { height: 10px; border-radius: 5px; overflow: hidden; box-sizing: border-box; }
  .doc-print .pdf-bar-fill { height: 100%; border-radius: 5px; box-sizing: border-box; }
  .doc-print .pdf-facts { display: flex; gap: 32px; margin: 8px 0; }
  .doc-print .pdf-fact-label { font-size: 8.5pt; color: ${PRINT_COLORS.inkSecondary}; }
  .doc-print .pdf-fact-value { font-weight: 600; }
  .doc-print .pdf-card { border: 1px solid ${PRINT_COLORS.rule}; border-inline-start: 4px solid ${brand.primary}; border-radius: 6px; padding: 8px 14px; margin: 8px 0; }
  .doc-print .pdf-card-head, .doc-print .pdf-card-health, .doc-print .pdf-card-label { break-after: avoid; page-break-after: avoid; }
  .doc-print .pdf-card-health { display: flex; flex-wrap: wrap; gap: 4px 20px; margin: 6px 0; break-inside: avoid; }
  .doc-print .pdf-card-label { font-weight: 600; font-size: 10pt; margin-top: 6px; color: ${PRINT_COLORS.text}; }
  .doc-print .pdf-card p { margin: 2px 0 4px; }
  .doc-print figure.pdf-chart { margin: 12px 0; break-inside: avoid; page-break-inside: avoid; }
  .doc-print .pdf-chart figcaption { font-weight: 600; font-size: 10.5pt; margin-bottom: 4px; }
  .doc-print .pdf-chart img { display: block; width: 100%; height: auto; }
  .doc-print .pdf-heatmap { margin: 10px 0; break-inside: avoid; page-break-inside: avoid; }
  .doc-print .pdf-heat-title { font-weight: 600; font-size: 10.5pt; margin-bottom: 4px; }
  .doc-print table.pdf-heat { width: auto; border-collapse: separate; border-spacing: 3px; margin: 0; }
  .doc-print table.pdf-heat th, .doc-print table.pdf-heat td { border: none; padding: 0; background: none; text-align: center; vertical-align: middle; font-size: 9pt; line-height: 1.3; }
  .doc-print table.pdf-heat td.pdf-heat-cell { width: 46px; height: 22px; line-height: 1; border-radius: 4px; font-size: 11pt; font-weight: 700; }
  .doc-print .pdf-heat-head { display: flex; flex-wrap: wrap; align-items: baseline; justify-content: space-between; gap: 2px 12px; margin-bottom: 2px; }
  .doc-print .pdf-heat-head .pdf-legend { margin: 0; }
  .doc-print table.pdf-heat th.pdf-heat-tick { width: 18px; color: ${PRINT_COLORS.inkSecondary}; }
  .doc-print table.pdf-heat th.pdf-heat-axis-y { width: 18px; }
  .doc-print .pdf-heat-axis-y span { display: inline-block; writing-mode: vertical-rl; transform: rotate(180deg); }
  .doc-print .pdf-legend { display: flex; flex-wrap: wrap; gap: 4px 14px; margin: 6px 0; font-size: 8.5pt; color: ${PRINT_COLORS.inkSecondary}; break-inside: avoid; page-break-inside: avoid; }
  .doc-print .pdf-legend-item { display: inline-flex; align-items: center; gap: 5px; }
  .doc-print .pdf-legend-mark { display: inline-block; flex: none; }
  .doc-print .pdf-legend-swatch { width: 12px; height: 10px; border-radius: 2px; }
  .doc-print .pdf-legend-track { width: 22px; height: 8px; border-radius: 3px; overflow: hidden; }
  .doc-print .pdf-legend-track span { display: block; width: 50%; height: 100%; }
  .doc-print .pdf-legend-diamond { width: 8px; height: 8px; transform: rotate(45deg); }
  .doc-print .pdf-legend-line { width: 2px; height: 12px; }
  .doc-print .pdf-legend-dot { width: 8px; height: 8px; border-radius: 50%; }
  .doc-print table.pdf-schedule .pdf-tl-cell { position: relative; padding: 0; }
  .doc-print .pdf-tl-scale { position: relative; height: 30px; margin: 4px 6px; }
  .doc-print .pdf-tl-years, .doc-print .pdf-tl-quarters { position: relative; height: 15px; }
  .doc-print .pdf-tl-year, .doc-print .pdf-tl-quarter { position: absolute; top: 0; box-sizing: border-box; overflow: hidden; white-space: nowrap; text-align: center; font-size: 7.5pt; line-height: 15px; border-inline-start: 1px solid ${PRINT_COLORS.control}; }
  .doc-print .pdf-tl-year { font-weight: 700; }
  .doc-print .pdf-tl-quarter { font-weight: 400; color: ${PRINT_COLORS.inkSecondary}; }
  .doc-print .pdf-tl-lane { position: absolute; top: 0; bottom: 0; inset-inline: 6px; }
  .doc-print .pdf-tl-grid { position: absolute; top: 0; bottom: 0; width: 1px; }
  .doc-print .pdf-tl-grid-y { background: ${PRINT_COLORS.control}; }
  .doc-print .pdf-tl-grid-q { background: ${PRINT_COLORS.panel}; }
  .doc-print .pdf-tl-bar { position: absolute; top: 6px; height: 14px; min-width: 3px; border-radius: 4px; overflow: hidden; }
  .doc-print .pdf-tl-fill { display: block; height: 100%; }
  .doc-print .pdf-tl-milestone { position: absolute; top: 7px; width: 12px; height: 12px; margin-inline-start: -6px; transform: rotate(45deg); }
  .doc-print .pdf-tl-point { position: absolute; top: 8px; width: 10px; height: 10px; margin-inline-start: -5px; border-radius: 50%; }
  .doc-print .pdf-tl-today { position: absolute; top: 0; bottom: 0; width: 2px; margin-inline-start: -1px; }
  .doc-print .pdf-stack { display: flex; flex-direction: column; align-items: flex-start; gap: 2px; }
  .doc-print .pdf-stack .pdf-chip { margin: 0; }
  .doc-print .pdf-risk-top { display: flex; gap: 16px; align-items: flex-start; margin: 10px 0; }
  .doc-print .pdf-risk-top .pdf-heatmap { flex: none; margin: 0; }
  .doc-print .pdf-risk-side { flex: 1 1 0; min-width: 0; }
  .doc-print .pdf-risk-side .pdf-tiles { margin-top: 0; }
  .doc-print .pdf-status-row { display: flex; justify-content: space-between; align-items: center; gap: 8px; padding: 2px 0; border-bottom: 1px solid ${PRINT_COLORS.panel}; }
  .doc-print .pdf-status-count { font-weight: 700; }
  .doc-print .pdf-status-rows { display: grid; grid-template-columns: 1fr 1fr; column-gap: 16px; }
  .doc-print .pdf-muted { opacity: 0.55; }
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
  /** A header built as HTML (every scalar in it escaped) in place of `label`. */
  head?: { html: string };
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
      return `<th${cellClass(i)}${width}>${c.head ? c.head.html : escapeHtml(c.label)}</th>`;
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

/** Stands in for an interpolated value until it is escaped and isolated. */
const SLOT = "\u0001";

/**
 * A translated sentence with one value isolated in `<bdi>`, so a date or an
 * amount keeps its own order inside a right-to-left sentence.
 */
function sentenceWith(text: (slot: string) => string, value: string): string {
  return escapeHtml(text(SLOT)).replace(SLOT, bdi(value));
}

// ─── Sections ───────────────────────────────────────────────────────────────

const panel = (title: string, body: string) =>
  `<div class="pdf-panel"><div class="pdf-panel-title">${escapeHtml(title)}</div>${body}</div>`;

/** The variance's colour: green while within budget, red once over. */
const varianceColor = (variance: number) =>
  variance < 0 ? STATUS_COLORS.error : STATUS_COLORS.success;

function overviewSection(data: ProjectPrintData, fmt: ProjectPrintFormat): string {
  const totals = financialTotals(data.budgetLines, data.costLines, data.rollup);
  const count = data.rollup?.descendant_count;
  const variance = totals.budget.total - totals.actual.total;
  const eitherDerived = totals.budget.derived || totals.actual.derived;
  // The same pair rule as the Total bar below, so tile and caption agree.
  const total = pairFigures(totals.actual.total, totals.budget.total, fmt.currency);
  let html = tileRow([
    kpiTile(t("totalBudget"), total.budget, { derived: totals.budget.derived }),
    kpiTile(t("totalActual"), total.actual, { derived: totals.actual.derived }),
    kpiTile(t("variance"), fmt.amountCompact(variance), {
      color: varianceColor(variance),
      derived: eitherDerived,
    }),
  ]);

  // Completion (when it was read) beside the latest health.
  const completion = data.completion;
  const panels: string[] = [];
  if (completion) {
    panels.push(
      panel(
        t("completion"),
        completion.wbs_count === 0
          ? textBlock(t("noWbsItems"))
          : `<div class="pdf-ring-row">${completionRing(completion.completion, fmt.isRtl)}` +
              `<span class="pdf-note">${escapeHtml(t("completionDesc"))}</span></div>`,
      ),
    );
  }
  const latest = data.reports[0];
  panels.push(
    panel(
      t("healthSummary"),
      latest
        ? healthRows(latest)
        : textBlock(t("health_noReport")),
    ),
  );
  html += `<div class="pdf-panels">${panels.join("")}</div>`;

  // Budget bars: Total, CapEx, OpEx, each side outlined when it is derived.
  const bar = (label: string, key: keyof BudgetTotals) =>
    budgetBar({
      label,
      budget: totals.budget[key],
      actual: totals.actual[key],
      currency: fmt.currency,
      derivedBudget: totals.budget.derived,
      derivedActual: totals.actual.derived,
    });
  let financials = bar(t("budgetBarTotal"), "total") + bar(t("capex"), "capex") + bar(t("opex"), "opex");
  if (totals.budget.derived) financials += note(t("derivedBudgetTooltip", { count }));
  if (totals.actual.derived) financials += note(t("derivedActualTooltip", { count }));
  html += `<div class="pdf-panels">${panel(t("financials"), financials)}</div>`;

  const attrs = (data.card.attributes || {}) as Record<string, unknown>;
  const facts = (
    [
      [t("startDate"), attrs.startDate],
      [t("endDate"), attrs.endDate],
    ] as [string, unknown][]
  )
    .filter(([, v]) => typeof v === "string" && v)
    .map(
      ([label, v]) =>
        `<div class="pdf-fact"><div class="pdf-fact-label">${escapeHtml(label)}</div>` +
        `<div class="pdf-fact-value">${bdi(fmt.date(v as string))}</div></div>`,
    );
  if (facts.length > 0) html += `<div class="pdf-facts">${facts.join("")}</div>`;

  if (data.card.description?.trim()) {
    html += h3(tCommon("labels.description")) + textBlock(data.card.description);
  }
  return html;
}

/** Schedule / Cost / Scope, each a caption and its rating dot. */
function healthRows(r: PpmStatusReport): string {
  return (
    [
      ["health_schedule", r.schedule_health],
      ["health_cost", r.cost_health],
      ["health_scope", r.scope_health],
    ] as const
  )
    .map(
      ([key, value]) =>
        `<div class="pdf-health-row"><span class="pdf-health-caption">${escapeHtml(t(key))}</span>` +
        `${healthDot(value, healthLabel(value))}</div>`,
    )
    .join("");
}

function reportsSection(data: ProjectPrintData, fmt: ProjectPrintFormat): string {
  const [latest, ...earlier] = data.reports;
  if (!latest) return noneRecorded();
  const reporter = latest.reporter?.display_name;
  const head =
    `<div class="pdf-card-head"><strong>${bdi(dateOr(fmt, latest.report_date))}</strong>` +
    (reporter ? ` · ${escapeHtml(t("reporter"))}: ${escapeHtml(reporter)}` : "") +
    `</div>`;
  const ratings = (
    [
      ["health_schedule", latest.schedule_health],
      ["health_cost", latest.cost_health],
      ["health_scope", latest.scope_health],
    ] as const
  )
    .map(
      ([key, value]) =>
        `<span class="pdf-card-rating"><span class="pdf-health-caption">${escapeHtml(t(key))}</span> ` +
        `${healthDot(value, healthLabel(value))}</span>`,
    )
    .join("");
  const blocks = (
    [
      ["summary", latest.summary],
      ["accomplishments", latest.accomplishments],
      ["nextSteps", latest.next_steps],
    ] as const
  )
    .filter(([, text]) => text && text.trim())
    .map(
      ([key, text]) =>
        `<div class="pdf-card-label">${escapeHtml(t(key))}</div>${textBlock(text)}`,
    )
    .join("");
  let html = h3(t("pdfLatestReport"));
  html += `<div class="pdf-card">${head}<div class="pdf-card-health">${ratings}</div>${blocks}</div>`;
  if (earlier.length > 0) {
    html += h3(t("pdfEarlierReports"));
    html += rowsTable(
      [
        { label: t("reportDate"), cls: "date" },
        { label: t("reporter") },
        { label: t("health_schedule") },
        { label: t("health_cost") },
        { label: t("health_scope") },
      ],
      earlier.map((r) => ({
        cells: [
          dateOr(fmt, r.report_date),
          r.reporter?.display_name ?? DASH,
          { html: healthDot(r.schedule_health, healthLabel(r.schedule_health)) },
          { html: healthDot(r.cost_health, healthLabel(r.cost_health)) },
          { html: healthDot(r.scope_health, healthLabel(r.scope_health)) },
        ],
      })),
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

/** A chart image under its title; nothing for a chart that was not rendered. */
function chartFigure(chart: ChartImage | undefined): string {
  if (!chart) return "";
  const title = escapeHtml(chart.title);
  return (
    `<figure class="pdf-chart"><figcaption>${title}</figcaption>` +
    `<img src="${escapeHtml(chart.src)}" alt="${title}"></figure>`
  );
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

  const variance = totals.budget.total - totals.actual.total;
  // One rule for every budget / actual figure in the document: the bars' pair
  // rule, so "2.5 / 4.3 MUSD" never sits beside "4.4 MUSD".
  const pairs = {
    total: pairFigures(totals.actual.total, totals.budget.total, fmt.currency),
    capex: pairFigures(totals.actual.capex, totals.budget.capex, fmt.currency),
    opex: pairFigures(totals.actual.opex, totals.budget.opex, fmt.currency),
  };
  const splitTile = (label: string, key: "capex" | "opex") =>
    kpiTile(label, pairs[key].actual, {
      sub: { html: sentenceWith((slot) => t("pdfOfBudget", { amount: slot }), pairs[key].budget) },
      derived: totals.actual.derived,
    });
  let html = tileRow([
    kpiTile(t("totalBudget"), pairs.total.budget, { derived: totals.budget.derived }),
    kpiTile(t("totalActual"), pairs.total.actual, { derived: totals.actual.derived }),
    kpiTile(t("variance"), fmt.amountCompact(variance), {
      color: varianceColor(variance),
      derived: totals.budget.derived || totals.actual.derived,
    }),
    splitTile(t("capex"), "capex"),
    splitTile(t("opex"), "opex"),
  ]);
  html += chartFigure(data.charts?.fiscalYear);
  html += chartFigure(data.charts?.project);

  html += h3(t("plannedBudget"));
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

/** The risk table's cells: title over its description, the score chip over probability × impact. */
function riskRow(r: PpmRisk): Row {
  const description = r.description?.trim()
    ? `<div class="pre">${escapeHtml(r.description)}</div>`
    : "";
  return {
    cells: [
      { html: `<strong>${escapeHtml(r.title)}</strong>${description}` },
      {
        html:
          chip(String(r.risk_score), bandColor(scoreBand(r.risk_score))) +
          `<div class="pdf-sub">${bdi(`${r.probability} × ${r.impact}`)}</div>`,
      },
      { html: chip(t(riskStatusLabelKey(r.status)), riskStatusColor(r.status), "outlined") },
      r.owner_name || DASH,
      r.mitigation || DASH,
    ],
  };
}

/** Risk, Score, Status, Owner, Mitigation: the text columns take the width. */
export const RISK_COLUMN_WIDTHS = ["34%", "11%", "14%", "13%", "28%"] as const;

function risksSection(data: ProjectPrintData): string {
  if (data.risks.length === 0) return noneRecorded();
  const summary = riskSummary(data.risks);
  const [risk, score, status, owner, mitigation] = RISK_COLUMN_WIDTHS;
  // The heat map beside the tiles and the status breakdown, one picture never
  // split across pages.
  let side = tileRow(
    [
      kpiTile(t("totalRisks"), String(summary.total)),
      kpiTile(t("riskStatusOpen"), String(summary.open), {
        color: summary.open > 0 ? riskStatusColor("open") : undefined,
      }),
      kpiTile(t("highRisks"), String(summary.high), {
        color: summary.high > 0 ? bandColor("high") : undefined,
      }),
    ],
    t("pdfRiskSummary", summary),
  );
  side += riskStatusBreakdown(data.risks, t("pdfByStatus"), (status) =>
    t(riskStatusLabelKey(status)),
  );
  const heat = riskHeatMap(data.risks, {
    title: t("pdfHeatMapTitle"),
    probability: t("probability"),
    impact: t("impact"),
    bands: {
      high: t("riskGridBandHigh"),
      medium: t("riskGridBandMedium"),
      low: t("riskGridBandLow"),
    },
  });
  let html = `<div class="pdf-keep pdf-risk-top">${heat}<div class="pdf-risk-side">${side}</div></div>`;
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

/**
 * Title (with its dates and owner beneath), Timeline, Progress (with the
 * priority beneath): the timeline takes over half the width. Measured: a
 * status chip ("In Progress") and a priority chip fit the last column.
 */
export const SCHEDULE_COLUMN_WIDTHS = ["28%", "55%", "17%"] as const;
/** The same columns when nothing has a date: no timeline. */
export const SCHEDULE_COLUMN_WIDTHS_NO_TIMELINE = ["72%", "28%"] as const;
const SCHEDULE_TABLE_CLASS = "pdf-fixed pdf-schedule";

/** "15 Jan 2023 – 30 Sep 2023", "– 31 Mar 2026", or nothing; each date isolated. */
function dateRange(fmt: ProjectPrintFormat, start: string | null, end: string | null): string {
  if (!start && !end) return "";
  const from = start ? `${bdi(fmt.date(start))} ` : "";
  const to = end ? ` ${bdi(fmt.date(end))}` : "";
  return `<div class="pdf-sub">${from}–${to}</div>`;
}

/** The owner line under a title; nothing when nobody owns it. */
function ownerLine(name: string | null): string {
  return name ? `<div class="pdf-sub">${escapeHtml(t("pdfOwner"))}: ${bdi(name)}</div>` : "";
}

function scheduleSection(data: ProjectPrintData, fmt: ProjectPrintFormat, now: Date): string {
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

  // One scale for both tables: every dated package and task.
  const model = timelineModel(
    [
      ...wbs.map((w) => ({ start: w.start_date, end: w.end_date })),
      ...tasks.map((tk) => ({ start: tk.start_date, end: tk.due_date })),
    ],
    now,
  );
  const titleHead = {
    html:
      `${escapeHtml(t("wbsTitle"))}<div class="pdf-sub">` +
      `${escapeHtml(`${t("startDate")} – ${t("pdfEndOrDue")} · ${t("pdfOwner")}`)}</div>`,
  };
  const progressHead = {
    html: `${escapeHtml(t("pdfProgress"))}<div class="pdf-sub">${escapeHtml(t("taskPriority"))}</div>`,
  };
  const headers: Column[] = model
    ? [
        { label: "", head: titleHead, width: SCHEDULE_COLUMN_WIDTHS[0] },
        { label: "", head: { html: timelineScale(model) }, cls: "pdf-tl-cell", width: SCHEDULE_COLUMN_WIDTHS[1] },
        { label: "", head: progressHead, width: SCHEDULE_COLUMN_WIDTHS[2] },
      ]
    : [
        { label: "", head: titleHead, width: SCHEDULE_COLUMN_WIDTHS_NO_TIMELINE[0] },
        { label: "", head: progressHead, width: SCHEDULE_COLUMN_WIDTHS_NO_TIMELINE[1] },
      ];
  const lane = (span: TimelineSpan, kind: TimelineKind): Cell[] =>
    model ? [{ html: timelineLane(model, span, kind) }] : [];

  const taskRow = (task: PpmTask, depth: number): Row => ({
    cells: [
      {
        html:
          escapeHtml(task.title) +
          dateRange(fmt, task.start_date, task.due_date) +
          ownerLine(task.assignee_name),
      },
      ...lane({ start: task.start_date, end: task.due_date }, { kind: "task", status: task.status }),
      {
        html:
          `<div class="pdf-stack">${chip(labelOr(TASK_STATUS_KEYS, task.status), taskBarColors(task.status).progress, "outlined")}` +
          `${chip(labelOr(TASK_PRIORITY_KEYS, task.priority), priorityColor(task.priority), "soft")}</div>`,
      },
    ],
    cls: "pdf-task",
    depth,
  });

  const rows: Row[] = [];
  const visit = (parent: string | null, depth: number) => {
    for (const w of [...(children.get(parent) ?? [])].sort(bySortOrder)) {
      const title = w.is_milestone ? `◆ ${w.title} (${t("milestone")})` : w.title;
      rows.push({
        cells: [
          {
            html: escapeHtml(title) + dateRange(fmt, w.start_date, w.end_date) + ownerLine(w.assignee_name),
          },
          ...lane(
            { start: w.start_date, end: w.end_date },
            { kind: "package", completion: w.completion, milestone: w.is_milestone },
          ),
          // A package's completion as a chip in its bar colour: the same weight as a task's status.
          { html: `<div class="pdf-stack">${chip(`${Math.round(w.completion)}%`, brand.primary, "outlined")}</div>` },
        ],
        cls: "pdf-wbs",
        depth,
      });
      for (const task of [...(tasksOf.get(w.id) ?? [])].sort(bySortOrder)) {
        rows.push(taskRow(task, depth + 1));
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
      [...unassigned].sort(bySortOrder).map((task) => taskRow(task, 0)),
      SCHEDULE_TABLE_CLASS,
    );
  }
  if (model) html += scheduleLegend(model);
  return html;
}

/** What the timeline's marks mean. */
function scheduleLegend(model: TimelineModel): string {
  const items: LegendItem[] = [
    { label: t("pdfLegendWorkPackage"), color: brand.primaryLight, fill: brand.primary, shape: "track" },
    ...(["todo", "in_progress", "done", "blocked"] as const).map((status) => ({
      label: `${t("pdfLegendTask")}: ${labelOr(TASK_STATUS_KEYS, status)}`,
      color: taskBarColors(status).bar,
      fill: taskBarColors(status).progress,
      shape: "track" as const,
    })),
    { label: t("milestone"), color: brand.primary, shape: "diamond" },
    { label: t("pdfLegendOneDate"), color: brand.primary, shape: "dot" },
  ];
  if (model.todayPct !== null) {
    items.push({ label: t("pdfToday"), color: STATUS_COLORS.error, shape: "line" });
  }
  return legend(items);
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
    schedule: () => scheduleSection(data, fmt, now),
  };
  // The print date sits on the cover, not in a footer fixed to the page
  // bottom, which a page filled to the bottom would print over.
  let html = documentHeader(t("pdfDocumentTitle"), data.card.name);
  const coverChips = [
    data.subtypeLabel ? chip(data.subtypeLabel, PRINT_COLORS.inkSecondary, "outlined") : "",
    data.initiativeStatusLabel
      ? chip(
          data.initiativeStatusLabel,
          data.initiativeStatusColor || PRINT_COLORS.inkSecondary,
          "outlined",
        )
      : "",
  ].join("");
  if (coverChips) html += `<div class="pdf-cover-chips">${coverChips}</div>`;
  html += `<p class="pdf-printed">${sentenceWith(
    (slot) => tDelivery("export.printed", { date: slot }),
    fmt.dateTime(now),
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
