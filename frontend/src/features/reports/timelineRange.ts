import {
  earliestStartDate,
  hasStartedByDate,
  isAliveAtDate,
  isRetiredByDate,
  LIFECYCLE_PHASES,
  parseDate,
} from "./portfolioHelpers";
import type { Lifecycle } from "./portfolioHelpers";

const ONE_YEAR_MS = 365.25 * 86_400_000;

export interface TimelineRange {
  dateRange: { min: number; max: number };
  yearMarks: { value: number; label: string }[];
  hasLifecycleData: boolean;
}

/**
 * Slider bounds and year ticks for a report's "time travel" control, derived
 * from the lifecycle dates actually present in the data.
 *
 * Shared by every timeline-bearing report (Portfolio, Capability Map,
 * Dependencies) so they scale their sliders identically — the padding and the
 * "no lifecycle data anywhere" fallback used to be copy-pasted per report.
 *
 * `hasLifecycleData` is false when nothing in the payload carries a lifecycle
 * date; callers hide the slider entirely in that case, since a landscape with
 * no dates looks the same at every point in time.
 */
export function computeTimelineRange(
  lifecycles: Lifecycle[],
  todayMs: number,
): TimelineRange {
  let minD = Infinity;
  let maxD = -Infinity;
  let hasLifecycleData = false;

  for (const lc of lifecycles) {
    if (!lc) continue;
    for (const p of LIFECYCLE_PHASES) {
      const d = parseDate(lc[p]);
      if (d == null) continue;
      minD = Math.min(minD, d);
      maxD = Math.max(maxD, d);
      hasLifecycleData = true;
    }
  }

  if (!hasLifecycleData)
    return {
      dateRange: { min: todayMs - 3 * ONE_YEAR_MS, max: todayMs + 3 * ONE_YEAR_MS },
      yearMarks: [],
      hasLifecycleData: false,
    };

  minD -= ONE_YEAR_MS;
  maxD += ONE_YEAR_MS;

  const yearMarks: { value: number; label: string }[] = [];
  const startYear = new Date(minD).getFullYear();
  const endYear = new Date(maxD).getFullYear();
  for (let y = startYear; y <= endYear + 1; y++) {
    const v = new Date(y, 0, 1).getTime();
    if (v >= minD && v <= maxD) yearMarks.push({ value: v, label: String(y) });
  }

  return { dateRange: { min: minD, max: maxD }, yearMarks, hasLifecycleData: true };
}

/** How a card presents at the selected date, relative to the timeline. */
export type TimelineChange = "arriving" | "retired" | "planned";

/**
 * Classify a card at a target date:
 *  - "retired" — the card's end of life is at or before `dateMs`, whenever that
 *    was. Retirement is a state, not a window: a card dead since 2015 is
 *    retired at 2026 and at 2035 alike, so a persisted retired card stays
 *    ghosted and badged at every later date.
 *  - "planned" — the card has not started by `dateMs`: it will only appear
 *    later on the timeline. The mirror of "retired", equally stateful — a card
 *    starting in 2028 is planned at 2026 and at 2020 alike, so a previewed
 *    planned card is ghosted and badged at every earlier date.
 *  - "arriving" — live at a *future* `dateMs` but not in the landscape today:
 *    the transformation's own additions. Window-based and forward-only.
 */
export function classifyTimelineChange(
  lifecycle: Lifecycle,
  todayMs: number,
  dateMs: number,
): TimelineChange | null {
  if (isRetiredByDate(lifecycle, dateMs)) return "retired";
  if (!hasStartedByDate(lifecycle, dateMs)) return "planned";
  if (dateMs > todayMs && !isAliveAtDate(lifecycle, todayMs) && isAliveAtDate(lifecycle, dateMs))
    return "arriving";
  return null;
}

export interface TimelineVisibility {
  /** Keep retired cards on the diagram — ghosted and badged — at any date after
   *  their retirement. On by default: what a transformation *removes* is half
   *  of what the view is for. Off shows only the cards alive on the date. */
  persistRetired: boolean;
  /** Show cards that have not started yet — ghosted and badged — at any date
   *  before their start, so a past or present view can preview what is coming.
   *  Off by default: today's landscape stays today's landscape. */
  previewPlanned: boolean;
}

/**
 * Whether a card belongs on a graph drawn as of `dateMs`: alive at the date,
 * or kept by one of the two toggles — retired cards persisting after their end,
 * planned cards previewed before their start.
 */
export function isVisibleAtDate(
  lifecycle: Lifecycle,
  dateMs: number,
  { persistRetired, previewPlanned }: TimelineVisibility,
): boolean {
  if (!hasStartedByDate(lifecycle, dateMs)) return previewPlanned;
  return persistRetired || !isRetiredByDate(lifecycle, dateMs);
}

export interface TimelineMilestone {
  /** Epoch ms at which the change takes effect. */
  value: number;
  /** How many cards enter the landscape on this date. */
  appearing: number;
  /** How many cards already on the canvas go live (reach `active`) on it. */
  activating: number;
  /** How many leave it. */
  disappearing: number;
}

/**
 * Every date at which the landscape changes shape — cards entering or leaving —
 * so a timeline can mark where the interesting moments are instead of leaving
 * the user to find them by dragging.
 *
 * The rule is derived from the same helpers as the graph filter on purpose: a
 * card enters when its earliest start-phase date arrives (the moment
 * `hasStartedByDate` flips true) and leaves on its `endOfLife`. Both sides
 * compare with `<=` on the same epoch values, so jumping the slider to a
 * milestone lands on the first day the change is *in effect* — the arriving
 * card is present, the departing one is retired.
 */
export function computeTimelineMilestones(lifecycles: Lifecycle[]): TimelineMilestone[] {
  const byDate = new Map<number, TimelineMilestone>();
  const bump = (value: number, key: "appearing" | "activating" | "disappearing") => {
    const entry = byDate.get(value) ?? { value, appearing: 0, activating: 0, disappearing: 0 };
    entry[key] += 1;
    byDate.set(value, entry);
  };

  for (const lc of lifecycles) {
    if (!lc) continue;
    const start = earliestStartDate(lc);
    const eol = parseDate(lc.endOfLife);
    // Never alive: born at or after its own end of life — marking it would
    // advertise an arrival and a departure on a day it was never there.
    if (start != null && eol != null && eol <= start) continue;

    // A card with no start-phase date is treated as always present (same rule
    // as hasStartedByDate), so only its retirement is a transition.
    if (start != null) bump(start, "appearing");
    // Go-live: a card that enters the canvas at its plan/phaseIn date changes
    // again when `active` arrives — the lifecycle dot turns green. That is the
    // date a transformation viewer actually steers by, so it gets its own
    // mark; when active IS the earliest date, the appearing mark covers it.
    const active = parseDate(lc.active);
    if (
      active != null &&
      start != null &&
      active > start &&
      (eol == null || active < eol)
    )
      bump(active, "activating");
    if (eol != null) bump(eol, "disappearing");
  }

  return [...byDate.values()].sort((a, b) => a.value - b.value);
}

/**
 * Cards whose broken dependency would otherwise be INVISIBLE: linked to a card
 * that retires between today and the viewed date but is currently hidden
 * (persist toggled off). While the retired card is on the canvas — ghosted,
 * with dashed red edges — the story is already told and a badge on every
 * neighbour is pure spam: centre on a retiring card and the whole canvas
 * would light up amber. The badge exists to carry the information the hidden
 * ghost can no longer carry, nothing more.
 *
 * Window-scoped on purpose: a dependency lost years before today is history,
 * not this transformation's impact — without the window, one long-dead hub
 * card badges half the landscape forever.
 *
 * Direction is deliberately ignored: the dependency graph is walked undirected
 * everywhere else in the report. Structural parameter types (not GNode) so the
 * layout module can depend on this one without a cycle.
 */
export function computeAtRiskIds(
  nodes: { id: string; lifecycle?: Record<string, string> }[],
  edges: { source: string; target: string }[],
  todayMs: number,
  dateMs: number,
  /** Ids currently displayed — a visible retired card tells its own story. */
  displayedIds: Set<string>,
): Set<string> {
  if (dateMs <= todayMs) return new Set();
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const severs = (id: string): boolean => {
    const n = byId.get(id);
    return (
      !!n &&
      !displayedIds.has(id) &&
      isRetiredByDate(n.lifecycle, dateMs) &&
      !isRetiredByDate(n.lifecycle, todayMs)
    );
  };
  const survives = (id: string): boolean => {
    const n = byId.get(id);
    return !!n && !isRetiredByDate(n.lifecycle, dateMs);
  };
  const atRisk = new Set<string>();
  for (const e of edges) {
    if (severs(e.source) && survives(e.target)) atRisk.add(e.target);
    if (severs(e.target) && survives(e.source)) atRisk.add(e.source);
  }
  return atRisk;
}
