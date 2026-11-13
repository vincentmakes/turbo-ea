/**
 * The visual fragments of the initiative PDF: tiles, chips, health dots,
 * budget bars, the completion ring, the risk heat map and the schedule
 * timeline, as HTML / inline-SVG strings for the pop-up print path.
 *
 * Pure and free of React. Every scalar a builder is handed is escaped here;
 * every colour is a design token (or an `alpha()` tint of one), chosen from the
 * same source the initiative's screens use, so paper and screen agree. Every
 * colour-coded element also carries its text, so a black-and-white print
 * loses nothing. Geometry is in percentages with logical insets, so a
 * right-to-left document mirrors without a second code path.
 */
import { alpha } from "@mui/material/styles";
import { escapeHtml } from "@/lib/escapeHtml";
import { toLocalDate } from "@/lib/dates";
import {
  PPM_GANTT_COLORS,
  PRINT_COLORS,
  PRIORITY_COLORS,
  RAG_COLORS,
  STATUS_COLORS,
  brand,
} from "@/theme/tokens";
import type { PpmRisk } from "@/types";
import { COST_BAR_COLOR, COST_BAR_OVER, costPair, getQuarters } from "./ppmPortfolioFormat";
import { RISK_STATUSES, bandColor, scoreBand, type RiskScoreBand } from "./ppmRiskModel";
import { percentFromStatus } from "./taskProgress";

// ─── Colours ────────────────────────────────────────────────────────────────

/** A status report's rating dot, as `PpmReportsTab` draws it; neutral when unknown. */
const HEALTH_COLORS: Record<string, string> = {
  onTrack: RAG_COLORS.green,
  atRisk: RAG_COLORS.amber,
  offTrack: RAG_COLORS.red,
};

export function healthColor(value: string | null | undefined): string {
  return (value && HEALTH_COLORS[value]) || STATUS_COLORS.neutral;
}

/** The completion ring's colour at the Overview tab's thresholds (80 / 40). */
export function completionColor(pct: number): string {
  if (pct >= 80) return STATUS_COLORS.success;
  if (pct >= 40) return STATUS_COLORS.warning;
  return STATUS_COLORS.error;
}

/** A risk status chip's colour, as the Risk Management tab's chips read. */
const RISK_STATUS_COLORS: Record<string, string> = {
  open: STATUS_COLORS.error,
  mitigating: STATUS_COLORS.warning,
  mitigated: STATUS_COLORS.success,
  accepted: STATUS_COLORS.info,
  closed: STATUS_COLORS.neutral,
};

export function riskStatusColor(status: string): string {
  return RISK_STATUS_COLORS[status] ?? STATUS_COLORS.neutral;
}

/** A task's bar colours by status; an unknown status reads as To Do. */
export function taskBarColors(status: string): { bar: string; progress: string } {
  const c = PPM_GANTT_COLORS[status as keyof typeof PPM_GANTT_COLORS] ?? PPM_GANTT_COLORS.todo;
  return { bar: c.bar, progress: c.progress };
}

/** A task priority's colour; neutral when unknown. */
export function priorityColor(priority: string): string {
  return PRIORITY_COLORS[priority as keyof typeof PRIORITY_COLORS] ?? STATUS_COLORS.neutral;
}

/** Year bands in the budget and cost tables. */
export const YEAR_BAND_TINT = alpha(brand.primary, 0.08);

const pctText = (n: number) => `${Math.round(n * 100) / 100}%`;

/**
 * A figure, date or name isolated from the text around it, so a date's parts
 * or an amount's unit do not reorder inside a right-to-left line.
 */
export function bdi(text: string): string {
  return `<bdi>${escapeHtml(text)}</bdi>`;
}

/**
 * The CapEx / OpEx / Total pair of an initiative in one scale and unit, the
 * rule the budget bars' captions use; every other place in the document that
 * shows the same budget or actual reads it from here, so the two agree digit
 * for digit ("2.5 / 4.3 MUSD", never "4.3" beside "4.4").
 */
export function pairFigures(
  actual: number,
  budget: number,
  currency: string,
): { actual: string; budget: string } {
  const { actualText, plannedText, unit } = costPair(actual, budget, currency);
  return { actual: `${actualText} ${unit}`, budget: `${plannedText} ${unit}` };
}

// ─── Chips, dots, tiles, legend ─────────────────────────────────────────────

export type ChipVariant = "filled" | "outlined" | "soft";

/**
 * A label in a pill. Filled: the colour behind white text (a saturated
 * colour only). Outlined: a coloured border and text. Soft: a pale tint of the
 * colour behind body ink, for light colours that cannot carry white text.
 */
export function chip(label: string, color: string, variant: ChipVariant = "filled"): string {
  const style =
    variant === "filled"
      ? `background:${color};border-color:${color};color:${PRINT_COLORS.paper}`
      : variant === "outlined"
        ? `border-color:${color};color:${color}`
        : `background:${alpha(color, 0.25)};border-color:${color};color:${PRINT_COLORS.ink}`;
  return `<span class="pdf-chip pdf-chip-${variant}" style="${style}">${escapeHtml(label)}</span>`;
}

/** A rating dot in its colour, followed by the rating's text. */
export function healthDot(value: string | null | undefined, label: string): string {
  return (
    `<span class="pdf-health"><span class="pdf-dot" style="background:${healthColor(value)}"></span>` +
    `${escapeHtml(label)}</span>`
  );
}

export interface TileOptions {
  /** Colour of the value. */
  color?: string;
  /** A smaller line under the value: text, or a fragment built with `bdi`. */
  sub?: string | { html: string };
  /** The value is the initiatives' beneath: italic. */
  derived?: boolean;
}

/** One KPI: a label over a large value. */
export function kpiTile(label: string, value: string, opts: TileOptions = {}): string {
  const color = opts.color ? ` style="color:${opts.color}"` : "";
  const derived = opts.derived ? " derived" : "";
  const subHtml = typeof opts.sub === "string" ? escapeHtml(opts.sub) : opts.sub?.html;
  const sub = subHtml ? `<div class="pdf-tile-sub">${subHtml}</div>` : "";
  return (
    `<div class="pdf-tile"><div class="pdf-tile-label">${escapeHtml(label)}</div>` +
    `<div class="pdf-tile-value${derived}"${color}>${bdi(value)}</div>${sub}</div>`
  );
}

/** A row of tiles that never splits across pages; `label` names the group for screen readers. */
export function tileRow(tiles: string[], label?: string): string {
  const aria = label ? ` role="group" aria-label="${escapeHtml(label)}"` : "";
  return `<div class="pdf-tiles"${aria}>${tiles.join("")}</div>`;
}

export type LegendShape = "swatch" | "track" | "diamond" | "line" | "dot";

export interface LegendItem {
  label: string;
  color: string;
  shape?: LegendShape;
  /** A second colour: the fill drawn over a `track`. */
  fill?: string;
}

/** A row of keys: a small mark in each colour and its meaning. */
export function legend(items: LegendItem[]): string {
  const mark = (i: LegendItem) => {
    const shape = i.shape ?? "swatch";
    if (shape === "track") {
      return (
        `<span class="pdf-legend-mark pdf-legend-track" style="background:${i.color}">` +
        `<span style="background:${i.fill ?? i.color}"></span></span>`
      );
    }
    return `<span class="pdf-legend-mark pdf-legend-${shape}" style="background:${i.color}"></span>`;
  };
  return `<div class="pdf-legend">${items
    .map((i) => `<span class="pdf-legend-item">${mark(i)}${escapeHtml(i.label)}</span>`)
    .join("")}</div>`;
}

// ─── Completion ring ────────────────────────────────────────────────────────

export const RING_SIZE = 76;
export const RING_RADIUS = 30;
export const RING_STROKE = 9;

/** The arc of a ring at `pct` (clamped to 0-100): its dash length and the full circumference. */
export function ringArc(pct: number): { dash: number; circumference: number } {
  const circumference = 2 * Math.PI * RING_RADIUS;
  const clamped = Math.min(Math.max(pct, 0), 100);
  return { dash: (circumference * clamped) / 100, circumference };
}

/**
 * A donut with the percentage in its centre, coloured at the Overview's
 * thresholds, drawn from twelve o'clock clockwise (counter-clockwise when the
 * document reads right to left).
 */
export function completionRing(pct: number, isRtl = false): string {
  const c = RING_SIZE / 2;
  const { dash, circumference } = ringArc(pct);
  const round = (n: number) => Math.round(n * 100) / 100;
  const text = `${Math.round(pct)}%`;
  const rotate = `rotate(-90 ${c} ${c})`;
  const transform = isRtl ? `translate(${RING_SIZE} 0) scale(-1 1) ${rotate}` : rotate;
  return (
    `<svg class="pdf-ring" width="${RING_SIZE}" height="${RING_SIZE}" viewBox="0 0 ${RING_SIZE} ${RING_SIZE}" role="img" aria-label="${escapeHtml(text)}">` +
    `<circle cx="${c}" cy="${c}" r="${RING_RADIUS}" fill="none" stroke="${PRINT_COLORS.rule}" stroke-width="${RING_STROKE}"></circle>` +
    `<circle cx="${c}" cy="${c}" r="${RING_RADIUS}" fill="none" stroke="${completionColor(pct)}" stroke-width="${RING_STROKE}" ` +
    `stroke-dasharray="${round(dash)} ${round(circumference)}" transform="${transform}"></circle>` +
    `<text x="${c}" y="${c}" text-anchor="middle" dominant-baseline="central" font-size="15" font-weight="700" fill="${PRINT_COLORS.ink}">${escapeHtml(text)}</text>` +
    `</svg>`
  );
}

// ─── Budget bars ────────────────────────────────────────────────────────────

/** How far a budget bar fills (actual against budget, capped at 100) and whether it overran. */
export function barFill(actual: number, budget: number): { pct: number; over: boolean } {
  return {
    pct: budget > 0 ? Math.min((actual / budget) * 100, 100) : 0,
    over: actual > budget && budget > 0,
  };
}

export interface BudgetBarInput {
  label: string;
  budget: number;
  actual: number;
  currency: string;
  /** The budget is the initiatives' beneath: the track is outlined, its figure italic. */
  derivedBudget: boolean;
  /** The actuals are the initiatives' beneath: the fill is outlined, its figure italic. */
  derivedActual: boolean;
}

/** The Overview's budget-vs-actual bar with its caption ("578/900 kUSD (64%)"). */
export function budgetBar(b: BudgetBarInput): string {
  const { pct, over } = barFill(b.actual, b.budget);
  const color = over ? COST_BAR_OVER : COST_BAR_COLOR;
  const { actualText, plannedText, unit } = costPair(b.actual, b.budget, b.currency);
  const figure = (text: string, derived: boolean) =>
    derived ? `<em>${escapeHtml(text)}</em>` : escapeHtml(text);
  const share = b.budget > 0 ? ` (${Math.round((b.actual / b.budget) * 100)}%)` : "";
  const caption =
    `${figure(actualText, b.derivedActual)}/${figure(plannedText, b.derivedBudget)} ` +
    `${escapeHtml(unit)}${share}`;
  const track = b.derivedBudget
    ? `border:1px solid ${COST_BAR_COLOR};background:transparent`
    : `background:${PRINT_COLORS.rule}`;
  const fill = b.derivedActual
    ? `width:${pctText(pct)};border:1px solid ${color};background:transparent`
    : `width:${pctText(pct)};background:${color}`;
  const captionColor = over ? COST_BAR_OVER : PRINT_COLORS.inkSecondary;
  return (
    `<div class="pdf-budget-bar"><div class="pdf-bar-head"><span class="pdf-bar-label">${escapeHtml(b.label)}</span>` +
    `<span class="pdf-bar-caption" style="color:${captionColor}"><bdi>${caption}</bdi></span></div>` +
    `<div class="pdf-bar-track" style="${track}"><div class="pdf-bar-fill" style="${fill}"></div></div></div>`
  );
}

// ─── Risk heat map ──────────────────────────────────────────────────────────

/** Probability and impact both run 1-5. */
export const HEAT_STEPS = [1, 2, 3, 4, 5] as const;

/**
 * Risks per cell: `counts[p - 1][i - 1]` holds the risks of probability `p`
 * and impact `i`. A risk outside 1-5 on either axis is in no cell.
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

export interface HeatMapLabels {
  title: string;
  probability: string;
  impact: string;
  bands: Record<RiskScoreBand, string>;
}

/**
 * A 5×5 grid, probability 5 down to 1 as rows and impact 1 to 5 as columns.
 * Every cell is tinted by the band of probability × impact; a cell holding
 * risks is filled in the band colour and shows their number, an empty one
 * stays pale with a faint dash. A three-band legend shares the title's line;
 * axis titles frame the grid.
 */
export function riskHeatMap(risks: readonly PpmRisk[], labels: HeatMapLabels): string {
  const counts = heatMapCounts(risks);
  const rows = [...HEAT_STEPS]
    .reverse()
    .map((p, rowIndex) => {
      const axis =
        rowIndex === 0
          ? `<th class="pdf-heat-axis-y" rowspan="5"><span>${escapeHtml(labels.probability)}</span></th>`
          : "";
      const cells = HEAT_STEPS.map((i) => {
        const n = counts[p - 1][i - 1];
        const color = bandColor(scoreBand(p * i));
        const style =
          n > 0
            ? `background:${color};color:${PRINT_COLORS.paper}`
            : `background:${alpha(color, 0.18)};color:${PRINT_COLORS.muted}`;
        return `<td class="pdf-heat-cell" data-p="${p}" data-i="${i}" style="${style}">${n > 0 ? n : "·"}</td>`;
      }).join("");
      return `<tr>${axis}<th class="pdf-heat-tick">${p}</th>${cells}</tr>`;
    })
    .join("");
  const ticks = HEAT_STEPS.map((i) => `<th class="pdf-heat-tick">${i}</th>`).join("");
  const foot =
    `<tr><td class="pdf-heat-corner" colspan="2"></td>${ticks}</tr>` +
    `<tr><td class="pdf-heat-corner" colspan="2"></td><th class="pdf-heat-axis-x" colspan="5">${escapeHtml(labels.impact)}</th></tr>`;
  const key = legend(
    (["high", "medium", "low"] as const).map((band) => ({
      label: labels.bands[band],
      color: bandColor(band),
    })),
  );
  // The legend sits on the title's line, so the block stays short enough to
  // share a page with what comes before it.
  return (
    `<div class="pdf-heatmap"><div class="pdf-heat-head"><div class="pdf-heat-title">${escapeHtml(labels.title)}</div>${key}</div>` +
    `<table class="pdf-heat"><tbody>${rows}${foot}</tbody></table></div>`
  );
}

// ─── Risk status breakdown ──────────────────────────────────────────────────

/** Risks per status, in the Risk Management tab's status order. */
export function riskStatusCounts(risks: readonly PpmRisk[]): { status: string; count: number }[] {
  return RISK_STATUSES.map((status) => ({
    status,
    count: risks.filter((r) => r.status === status).length,
  }));
}

/** Each status as its chip with its count; a status no risk has reads muted. */
export function riskStatusBreakdown(
  risks: readonly PpmRisk[],
  title: string,
  labelOf: (status: string) => string,
): string {
  const rows = riskStatusCounts(risks)
    .map(
      ({ status, count }) =>
        `<div class="pdf-status-row${count === 0 ? " pdf-muted" : ""}">` +
        `${chip(labelOf(status), riskStatusColor(status), "outlined")}<span class="pdf-status-count">${count}</span></div>`,
    )
    .join("");
  return (
    `<div class="pdf-status-breakdown"><div class="pdf-heat-title">${escapeHtml(title)}</div>` +
    `<div class="pdf-status-rows">${rows}</div></div>`
  );
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

export interface TimelineSpan {
  start?: string | null;
  end?: string | null;
}

export interface TimelineScaleCell {
  label: string;
  startPct: number;
  widthPct: number;
}

export interface TimelineModel {
  /** First day of the first quarter. */
  start: Date;
  /** First day after the last quarter. */
  end: Date;
  years: TimelineScaleCell[];
  quarters: TimelineScaleCell[];
  /** Where today sits, or null when it is outside the range. */
  todayPct: number | null;
}

/**
 * The scale every row shares: the earliest date to the latest across all
 * items, widened to whole quarters. Null when no item has a usable date.
 */
export function timelineModel(items: readonly TimelineSpan[], now: Date): TimelineModel | null {
  const days: Date[] = [];
  for (const it of items) {
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
        label: q.label.split("'")[0],
        year: q.start.getFullYear(),
        startPct: at(q.start),
        widthPct: at(next) - at(q.start),
      };
    });
  const years: TimelineScaleCell[] = [];
  for (const q of quarters) {
    const last = years[years.length - 1];
    if (last && last.label === String(q.year)) last.widthPct += q.widthPct;
    else years.push({ label: String(q.year), startPct: q.startPct, widthPct: q.widthPct });
  }
  const today = startOfDay(now);
  const todayPct = today >= start && today < end ? at(today) : null;
  return {
    start,
    end,
    years,
    quarters: quarters.map(({ label, startPct, widthPct }) => ({ label, startPct, widthPct })),
    todayPct,
  };
}

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/**
 * Where an item sits on the scale: a bar from its start to the end of its end
 * day, or a point when it has one date only. Null when it has none.
 */
export function timelinePosition(
  model: TimelineModel,
  span: TimelineSpan,
): { startPct: number; widthPct: number } | { atPct: number } | null {
  const s = toLocalDate(span.start ?? null);
  const e = toLocalDate(span.end ?? null);
  const total = dayNumber(model.end) - dayNumber(model.start);
  const at = (d: Date, plusDays = 0) => ((dayNumber(d) + plusDays - dayNumber(model.start)) / total) * 100;
  if (s && e) {
    const [a, b] = s <= e ? [s, e] : [e, s];
    return { startPct: at(a), widthPct: at(b, 1) - at(a) };
  }
  const only = s ?? e;
  return only ? { atPct: at(only) } : null;
}

/** The today line, when today is on the scale. */
function todayLine(model: TimelineModel): string {
  return model.todayPct === null
    ? ""
    : `<span class="pdf-tl-today" style="inset-inline-start:${pctText(model.todayPct)};background:${STATUS_COLORS.error}"></span>`;
}

/** Beyond this many quarters the scale labels them by digit only. */
export const COMPACT_QUARTERS_OVER = 8;

/** The scale header: a row of years over a row of quarters, and the today line. */
export function timelineScale(model: TimelineModel): string {
  // Past two years "Q1" no longer fits a quarter's width: the digit alone does.
  const quarters =
    model.quarters.length > COMPACT_QUARTERS_OVER
      ? model.quarters.map((q) => ({ ...q, label: q.label.replace("Q", "") }))
      : model.quarters;
  const cells = (list: TimelineScaleCell[], cls: string) =>
    list
      .map(
        (c) =>
          `<span class="${cls}" style="inset-inline-start:${pctText(c.startPct)};width:${pctText(c.widthPct)}">${escapeHtml(c.label)}</span>`,
      )
      .join("");
  return (
    `<div class="pdf-tl-scale"><div class="pdf-tl-years">${cells(model.years, "pdf-tl-year")}</div>` +
    `<div class="pdf-tl-quarters">${cells(quarters, "pdf-tl-quarter")}${todayLine(model)}</div></div>`
  );
}

export type TimelineKind =
  | { kind: "package"; completion: number; milestone: boolean }
  | { kind: "task"; status: string };

/**
 * One row's lane: a work package's light track filled to its completion, a
 * task's bar in its status colour filled to the status's progress, a diamond
 * for a milestone, a dot for an item with one date only, nothing for an item
 * with none; the today line runs through every lane.
 */
/**
 * The scale drawn through a row: a rule at every year boundary and a fainter
 * one at every other quarter boundary, so a bar's dates read off the header.
 */
export function timelineGrid(model: TimelineModel): string {
  return model.quarters
    .filter((q) => q.startPct > 0)
    .map(
      (q) =>
        `<span class="pdf-tl-grid ${q.label === "Q1" ? "pdf-tl-grid-y" : "pdf-tl-grid-q"}" style="inset-inline-start:${pctText(q.startPct)}"></span>`,
    )
    .join("");
}

export function timelineLane(model: TimelineModel, span: TimelineSpan, item: TimelineKind): string {
  const pos = timelinePosition(model, span);
  const colors =
    item.kind === "package"
      ? { bar: brand.primaryLight, progress: brand.primary }
      : taskBarColors(item.status);
  const progress = item.kind === "package" ? item.completion : percentFromStatus(item.status);
  let mark = "";
  if (item.kind === "package" && item.milestone) {
    // A milestone is a moment: its date (the end, else the start).
    const at = timelinePosition(model, { start: span.end || span.start });
    if (at && "atPct" in at) {
      mark = `<span class="pdf-tl-milestone" style="inset-inline-start:${pctText(at.atPct)};background:${brand.primary}"></span>`;
    }
  } else if (pos && "atPct" in pos) {
    mark = `<span class="pdf-tl-point" style="inset-inline-start:${pctText(pos.atPct)};background:${colors.progress}"></span>`;
  } else if (pos && "startPct" in pos) {
    const fill = Math.min(Math.max(progress, 0), 100);
    mark =
      `<span class="pdf-tl-bar" style="inset-inline-start:${pctText(pos.startPct)};width:${pctText(pos.widthPct)};background:${colors.bar}">` +
      `<span class="pdf-tl-fill" style="width:${pctText(fill)};background:${colors.progress}"></span></span>`;
  }
  return `<div class="pdf-tl-lane">${timelineGrid(model)}${mark}${todayLine(model)}</div>`;
}
