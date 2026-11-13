/**
 * The pure model behind an initiative's report page: the sections it can
 * show and the remembered choice of them, the schedule's nesting and its
 * timeline scale, the risk heat map's counts and its 5×5 configuration, the
 * risk status breakdown, and one formatter for a budget / actual pair.
 *
 * Plain data only, no React and no HTML: the page draws everything with the
 * app's own components (`RiskMatrix`, `PpmScheduleTimeline`, the chips), and
 * this module only decides what goes where.
 */
import { alpha } from "@mui/material/styles";
import { toLocalDate } from "@/lib/dates";
import type { PpmRisk, PpmTask, PpmWbs } from "@/types";
import { costPair, getQuarters } from "./ppmPortfolioFormat";
import {
  RISK_SCORE_BANDS,
  RISK_STATUSES,
  bandColor,
  scoreBand,
  type RiskScoreBand,
} from "./ppmRiskModel";

// ─── Sections and the remembered choice ─────────────────────────────────────

/** Every section the report can show, in the order it shows them. */
export const REPORT_SECTIONS = ["overview", "reports", "costs", "risks", "schedule"] as const;
export type ReportSection = (typeof REPORT_SECTIONS)[number];

/** Where the report remembers which sections are shown, per browser. */
export const REPORT_PREFS_KEY = "turboea.ppm.projectReport.prefs";

/** The known names among `sections`, once each, in report order. */
export function orderedSections(sections: Iterable<unknown>): ReportSection[] {
  const chosen = new Set<unknown>(sections);
  return REPORT_SECTIONS.filter((s) => chosen.has(s));
}

/**
 * The sections shown last time in this browser, in report order. Anything
 * unreadable, unknown names dropped, and an empty choice all mean every section.
 */
export function loadReportSections(): ReportSection[] {
  try {
    // Nothing stored reads as the JSON `null`.
    const parsed: unknown = JSON.parse(String(localStorage.getItem(REPORT_PREFS_KEY)));
    const kept = Array.isArray(parsed) ? orderedSections(parsed) : [];
    return kept.length > 0 ? kept : [...REPORT_SECTIONS];
  } catch {
    return [...REPORT_SECTIONS];
  }
}

/** Remember the shown sections for next time; a storage failure is ignored. */
export function saveReportSections(sections: Iterable<unknown>): void {
  try {
    localStorage.setItem(REPORT_PREFS_KEY, JSON.stringify(orderedSections(sections)));
  } catch {
    // Storage full or disabled — the report falls back to every section.
  }
}

// ─── The PowerPoint export ──────────────────────────────────────────────────

/**
 * What a section's slides are cut between (`paginateRowSelector`): the
 * blocks marked `data-export-row` (a tile strip, a card, the chart card, a
 * schedule row), the latest status report (`data-export-keep`: kept whole on
 * a slide, though print lets it break across pages) and every table row.
 */
export const REPORT_EXPORT_ROWS = "[data-export-row], [data-export-keep], tbody > tr, tfoot > tr";

/** How much each section has to show; `null` where a read failed. */
export interface ReportSectionContent {
  reports: number;
  /** Budget and cost lines, the initiative's own and those beneath it. */
  costLines: number;
  risks: number;
  /** Work packages and tasks together; `null` when either could not be read. */
  scheduleItems: number | null;
}

/**
 * The shown sections that go into the deck, in report order: those with
 * something to show. A section with nothing recorded (no status report, no
 * budget or cost line, no risk, no work package or task), or whose read
 * failed, is left out; the overview always has its figures.
 */
export function exportableSections(
  shown: readonly ReportSection[],
  content: ReportSectionContent,
): ReportSection[] {
  const hasContent: Record<ReportSection, boolean> = {
    overview: true,
    reports: content.reports > 0,
    costs: content.costLines > 0,
    risks: content.risks > 0,
    schedule: (content.scheduleItems ?? 0) > 0,
  };
  return orderedSections(shown).filter((s) => hasContent[s]);
}

// ─── Money ──────────────────────────────────────────────────────────────────

/**
 * The actual and the budget of one pair in one scale and unit, the rule the
 * budget bars' captions use (`costPair`), so a figure shown beside its bar
 * agrees with it digit for digit ("2.5 / 4.3 MUSD", never "4.3" beside "4.4").
 */
export function pairFigures(
  actual: number,
  budget: number,
  currency: string,
): { actual: string; budget: string } {
  const { actualText, plannedText, unit } = costPair(actual, budget, currency);
  return { actual: `${actualText} ${unit}`, budget: `${plannedText} ${unit}` };
}

// ─── Risks ──────────────────────────────────────────────────────────────────

/** Probability and impact both run 1-5. */
export const HEAT_STEPS = [1, 2, 3, 4, 5] as const;

/**
 * Risks per cell: `counts[p - 1][i - 1]` holds the risks of probability `p`
 * and impact `i`. A risk outside 1-5 on either axis, or off the integers, is
 * in no cell.
 */
export function heatMapCounts(risks: readonly PpmRisk[]): number[][] {
  const counts = HEAT_STEPS.map(() => HEAT_STEPS.map(() => 0));
  for (const r of risks) {
    const p = r.probability;
    const i = r.impact;
    if (Number.isInteger(p) && Number.isInteger(i) && p >= 1 && p <= 5 && i >= 1 && i <= 5) {
      counts[p - 1][i - 1] += 1;
    }
  }
  return counts;
}

/**
 * The matrix's rows, top to bottom: probability 5 down to 1, as the GRC
 * register runs probability from very high down to low.
 */
export const MATRIX_PROBABILITIES: readonly number[] = [5, 4, 3, 2, 1];

/**
 * The matrix's columns, in reading order: impact 5 down to 1. The GRC
 * register runs its impact axis from critical to low, the most severe first,
 * so its top-left cell is the worst one ("Top-left = highest concentration of
 * critical risks"); the initiative's matrix keeps that reading.
 */
export const MATRIX_IMPACTS: readonly number[] = [5, 4, 3, 2, 1];

/**
 * The counts in the matrix's display order: one array per row
 * (`MATRIX_PROBABILITIES`), one number per column (`MATRIX_IMPACTS`).
 */
export function riskMatrixCounts(risks: readonly PpmRisk[]): number[][] {
  const counts = heatMapCounts(risks);
  return MATRIX_PROBABILITIES.map((p) => MATRIX_IMPACTS.map((i) => counts[p - 1][i - 1]));
}

/**
 * A band's cell tint, at the strengths the GRC matrix tints its levels
 * (`riskMatrixColors.ts`): red as its critical (0.28), amber as its high
 * (0.24), green as its low (0.18).
 */
const BAND_TINT: Record<RiskScoreBand, number> = { high: 0.28, medium: 0.24, low: 0.18 };

/** A band's legend swatch, at the GRC legend's strengths for the same hues. */
const BAND_SWATCH: Record<RiskScoreBand, number> = { high: 0.7, medium: 0.7, low: 0.6 };

/**
 * The background of the cell at probability `p`, impact `i`: the band of
 * p × i, so a cell and the score chip of a risk in it agree.
 */
export function riskMatrixCellColor(p: number, i: number): string {
  const band = scoreBand(p * i);
  return alpha(bandColor(band), BAND_TINT[band]);
}

/** The legend's swatch for a band. */
export function riskBandSwatch(band: RiskScoreBand): string {
  return alpha(bandColor(band), BAND_SWATCH[band]);
}

/** The bands the legend lists, highest first. */
export const MATRIX_LEGEND_BANDS: readonly RiskScoreBand[] = RISK_SCORE_BANDS;

/** Risks per status, in the Risk Management tab's status order; unknown statuses in none. */
export function riskStatusCounts(risks: readonly PpmRisk[]): { status: string; count: number }[] {
  return RISK_STATUSES.map((status) => ({
    status,
    count: risks.filter((r) => r.status === status).length,
  }));
}

// ─── Schedule nesting ───────────────────────────────────────────────────────

export type ScheduleRow =
  | { kind: "wbs"; item: PpmWbs; depth: number }
  | { kind: "task"; item: PpmTask; depth: number };

export interface ScheduleRows {
  /** Work packages depth first, each followed by its tasks, then its child packages. */
  rows: ScheduleRow[];
  /** Tasks in no package, or in one that is not in the list. */
  unassigned: PpmTask[];
}

const bySortOrder = (a: { sort_order: number }, b: { sort_order: number }) =>
  a.sort_order - b.sort_order;

/**
 * The schedule's rows: work packages in `sort_order`, each one's tasks beneath
 * it (one level deeper), then its child packages. A package whose parent is
 * not in the list is a root. Tasks with no package or an unknown one are
 * returned apart, in `sort_order`. The inputs are left alone.
 */
export function scheduleRows(wbs: readonly PpmWbs[], tasks: readonly PpmTask[]): ScheduleRows {
  const ids = new Set(wbs.map((w) => w.id));
  const children = new Map<string | null, PpmWbs[]>();
  for (const w of wbs) {
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
  const rows: ScheduleRow[] = [];
  const visit = (parent: string | null, depth: number) => {
    for (const w of [...(children.get(parent) ?? [])].sort(bySortOrder)) {
      rows.push({ kind: "wbs", item: w, depth });
      for (const task of [...(tasksOf.get(w.id) ?? [])].sort(bySortOrder)) {
        rows.push({ kind: "task", item: task, depth: depth + 1 });
      }
      visit(w.id, depth + 1);
    }
  };
  visit(null, 0);
  return { rows, unassigned: [...unassigned].sort(bySortOrder) };
}

// ─── Timeline ───────────────────────────────────────────────────────────────

const DAY_MS = 86_400_000;

/** A local calendar day as a whole day number, immune to daylight-saving shifts. */
function dayNumber(d: Date): number {
  return Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / DAY_MS;
}

/** The first day of the quarter `d` falls in. */
function quarterStart(d: Date): Date {
  return new Date(d.getFullYear(), Math.floor(d.getMonth() / 3) * 3, 1);
}

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

export interface TimelineSpan {
  start?: string | null;
  end?: string | null;
}

export interface TimelineQuarter {
  /** As the Portfolio board labels a quarter: `Q1'26`. */
  label: string;
  /** The quarter opens a calendar year (a darker rule through the lanes). */
  yearStart: boolean;
  startPct: number;
  widthPct: number;
}

export interface TimelineModel {
  /** First day of the first quarter. */
  start: Date;
  /** First day after the last quarter. */
  end: Date;
  quarters: TimelineQuarter[];
  /** Where today sits, or null when it is outside the range. */
  todayPct: number | null;
}

/** The span of a work package or a task on the scale. */
export const wbsSpan = (w: PpmWbs): TimelineSpan => ({ start: w.start_date, end: w.end_date });
export const taskSpan = (t: PpmTask): TimelineSpan => ({ start: t.start_date, end: t.due_date });

/**
 * The scale every row shares: the earliest date to the latest across all
 * spans, widened to whole quarters. Null when no span has a usable date.
 */
export function timelineModel(spans: readonly TimelineSpan[], now: Date): TimelineModel | null {
  const days: Date[] = [];
  for (const it of spans) {
    for (const v of [it.start, it.end]) {
      const d = toLocalDate(v ?? null);
      if (d) days.push(d);
    }
  }
  if (days.length === 0) return null;
  const min = new Date(Math.min(...days.map((d) => d.getTime())));
  const max = new Date(Math.max(...days.map((d) => d.getTime())));
  const start = quarterStart(min);
  const lastQ = quarterStart(max);
  const end = new Date(lastQ.getFullYear(), lastQ.getMonth() + 3, 1);
  // Stryker disable next-line ArithmeticOperator: equivalent: a mutated sum only ever raises the month count, and the q.start < end filter below drops every quarter past the range
  const months = (end.getFullYear() - start.getFullYear()) * 12 + end.getMonth() - start.getMonth();
  const span = dayNumber(end) - dayNumber(start);
  const at = (d: Date) => ((dayNumber(d) - dayNumber(start)) / span) * 100;

  // getQuarters walks month by month with an approximate month length, so it
  // can overshoot by one quarter: keep only the quarters inside the range.
  const quarters = getQuarters(start, months)
    .filter((q) => q.start < end)
    .map((q) => {
      const next = new Date(q.start.getFullYear(), q.start.getMonth() + 3, 1);
      return {
        label: q.label,
        yearStart: q.start.getMonth() === 0,
        startPct: at(q.start),
        widthPct: at(next) - at(q.start),
      };
    });
  const today = startOfDay(now);
  const todayPct = today >= start && today < end ? at(today) : null;
  return { start, end, quarters, todayPct };
}

export type TimelinePosition = { startPct: number; widthPct: number } | { atPct: number };

/**
 * Where a span sits on the scale: a bar from its start to the end of its end
 * day (reversed dates are put in order), or a point when it has one date
 * only. Null when it has none.
 */
export function timelinePosition(
  model: TimelineModel,
  span: TimelineSpan,
): TimelinePosition | null {
  const s = toLocalDate(span.start ?? null);
  const e = toLocalDate(span.end ?? null);
  const total = dayNumber(model.end) - dayNumber(model.start);
  const at = (d: Date, plusDays = 0) =>
    ((dayNumber(d) + plusDays - dayNumber(model.start)) / total) * 100;
  if (s && e) {
    // Stryker disable next-line EqualityOperator: equivalent: when s and e are the same day both orders give the same pair
    const [a, b] = s <= e ? [s, e] : [e, s];
    return { startPct: at(a), widthPct: at(b, 1) - at(a) };
  }
  const only = s ?? e;
  return only ? { atPct: at(only) } : null;
}

/** A milestone is a moment: its date is its end, else its start. Null when it has neither. */
export function milestonePosition(model: TimelineModel, w: PpmWbs): number | null {
  const pos = timelinePosition(model, { start: w.end_date || w.start_date });
  return pos && "atPct" in pos ? pos.atPct : null;
}
