import {
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
  /** How many cards reach their `active` date — go live — on it. */
  activating: number;
  /** How many reach their `endOfLife` — retire — on it. */
  disappearing: number;
}

/**
 * The dates a transformation actually turns on: when cards go live and when
 * they retire. Two kinds, deliberately — plan and phase-in dates are milestones
 * on paper, not changes to the landscape you are looking at, and marking them
 * buried the two that matter.
 *
 * Both sides compare with `<=` on the same epoch values as the graph filter, so
 * jumping the slider to a mark lands on the first day the change is *in
 * effect* — the card that goes live is active, the one that retires is gone.
 */
export function computeTimelineMilestones(lifecycles: Lifecycle[]): TimelineMilestone[] {
  const byDate = new Map<number, TimelineMilestone>();
  const bump = (value: number, key: "activating" | "disappearing") => {
    const entry = byDate.get(value) ?? { value, activating: 0, disappearing: 0 };
    entry[key] += 1;
    byDate.set(value, entry);
  };

  for (const lc of lifecycles) {
    if (!lc) continue;
    const active = parseDate(lc.active);
    const eol = parseDate(lc.endOfLife);
    // Never alive: retired at or before it went live. Marking either end would
    // advertise a change on a day nothing happened.
    if (active != null && eol != null && eol <= active) continue;

    if (active != null) bump(active, "activating");
    if (eol != null) bump(eol, "disappearing");
  }

  return [...byDate.values()].sort((a, b) => a.value - b.value);
}

/** A card whose presence changes at a transition mark. */
export interface TimelineChangeCard {
  id: string;
  name: string;
  /** `activating` reaches its `active` date in the span, `disappearing` its
   *  `endOfLife`. Same two kinds the mark's two bars stand for. */
  kind: "activating" | "disappearing";
}

/**
 * Which cards change across a mark's span — what the mark above them counts,
 * named.
 *
 * Deliberately mirrors `computeTimelineMilestones` rule for rule, including the
 * never-alive skip: a pill must never name a card at a date that carries no
 * mark, and the two drifting apart is exactly how this feature has broken
 * before. `from`/`to` are inclusive so they agree with the graph filter's `<=`.
 */
export function cardsChangingBetween(
  cards: { id: string; name: string; lifecycle?: Lifecycle }[],
  from: number,
  to: number,
): TimelineChangeCard[] {
  const out: TimelineChangeCard[] = [];
  for (const card of cards) {
    const active = parseDate(card.lifecycle?.active);
    const eol = parseDate(card.lifecycle?.endOfLife);
    if (active != null && eol != null && eol <= active) continue;

    // A card can do both inside one merged cluster; the retirement is the later
    // fact, so it names the pill (the pulse colour picks the same winner).
    let kind: TimelineChangeCard["kind"] | null = null;
    if (active != null && active >= from && active <= to) kind = "activating";
    if (eol != null && eol >= from && eol <= to) kind = "disappearing";
    if (kind) out.push({ id: card.id, name: card.name, kind });
  }
  // Going live before retiring, matching the order of the mark's own two bars.
  return out.sort((a, b) =>
    a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === "activating" ? -1 : 1,
  );
}

/**
 * Cards IMPACTED by the transformation in a way that would otherwise be
 * invisible: linked to a card that retires between today and the viewed date
 * but is currently hidden (persist toggled off). While the retired card is on
 * the canvas — ghosted, with dashed red edges — the story is already told and
 * a badge on every neighbour is pure spam: centre on a retiring card and the
 * whole canvas would light up amber. The badge exists to carry the
 * information the hidden ghost can no longer carry, nothing more.
 *
 * Window-scoped on purpose: a dependency lost years before today is history,
 * not this transformation's impact — without the window, one long-dead hub
 * card badges half the landscape forever.
 *
 * Direction is deliberately ignored: the dependency graph is walked undirected
 * everywhere else in the report. Structural parameter types (not GNode) so the
 * layout module can depend on this one without a cycle.
 */
export function computeImpactedIds(
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
  const impacted = new Set<string>();
  for (const e of edges) {
    if (severs(e.source) && survives(e.target)) impacted.add(e.target);
    if (severs(e.target) && survives(e.source)) impacted.add(e.source);
  }
  return impacted;
}
