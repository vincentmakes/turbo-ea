import {
  hasStartedByDate,
  isAliveAtDate,
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

/** How a card's presence in the landscape changes between today and the selected date. */
export type TimelineChange = "arriving" | "retiring";

/**
 * Classify a card against a *future* target date, so a dependency view can show
 * the planned transformation rather than just its end state:
 *  - "arriving" — not in the landscape today, but in it at `dateMs`.
 *  - "retiring" — in the landscape today, retired by `dateMs`.
 *
 * Returns null for a past or same-day target: travelling backwards shows the
 * landscape as it stood, and nothing about the past is a plan, so badging it
 * "arriving"/"retiring" would read backwards.
 */
export function classifyTimelineChange(
  lifecycle: Lifecycle,
  todayMs: number,
  dateMs: number,
): TimelineChange | null {
  if (dateMs <= todayMs) return null;
  const aliveToday = isAliveAtDate(lifecycle, todayMs);
  const aliveThen = isAliveAtDate(lifecycle, dateMs);
  if (!aliveToday && aliveThen) return "arriving";
  if (aliveToday && !aliveThen) return "retiring";
  return null;
}

export interface TimelineVisibility {
  /** Keep cards that retire between today and the viewed date. On by default:
   *  what a transformation *removes* is half of what the view is for. */
  showRetiring: boolean;
}

/**
 * Whether a card belongs on a graph drawn as of `dateMs`, for the purposes of
 * time travel only.
 *
 * Deliberately narrow: it answers "has this started yet" and "did the user ask
 * to hide what retires in this window", and nothing else. Whether a card that
 * was *already* end of life before the window opened is worth drawing is a
 * different question, owned by whichever view is rendering (the Layered
 * Dependency View has its own toggle for it) — so this must not filter on
 * end-of-life status or the two would fight.
 */
export function isVisibleAtDate(
  lifecycle: Lifecycle,
  todayMs: number,
  dateMs: number,
  { showRetiring }: TimelineVisibility,
): boolean {
  if (!hasStartedByDate(lifecycle, dateMs)) return false;
  if (showRetiring) return true;
  return classifyTimelineChange(lifecycle, todayMs, dateMs) !== "retiring";
}

export interface TimelineMilestone {
  /** Epoch ms at which the change takes effect. */
  value: number;
  /** How many cards enter the landscape on this date. */
  appearing: number;
  /** How many leave it. */
  disappearing: number;
}

/**
 * Every date at which the landscape changes shape — cards entering or leaving —
 * so a timeline can mark where the interesting moments are instead of leaving
 * the user to find them by dragging.
 *
 * The rule is derived from `isAliveAtDate` on purpose: a card enters when its
 * earliest lifecycle date arrives (the moment `hasStartedByDate` flips true) and
 * leaves on its `endOfLife`. Both sides compare with `<=` on the same epoch
 * values, so jumping the slider to a milestone lands on the first day the change
 * is *in effect* — the arriving card is present, the departing one is gone.
 *
 * A card whose end of life is at or before its earliest date is never alive at
 * all and contributes nothing: marking it would advertise an arrival and a
 * departure on a day it was never there.
 */
export function computeTimelineMilestones(lifecycles: Lifecycle[]): TimelineMilestone[] {
  const byDate = new Map<number, TimelineMilestone>();
  const bump = (value: number, key: "appearing" | "disappearing") => {
    const entry = byDate.get(value) ?? { value, appearing: 0, disappearing: 0 };
    entry[key] += 1;
    byDate.set(value, entry);
  };

  for (const lc of lifecycles) {
    if (!lc) continue;
    const dates = LIFECYCLE_PHASES.map((phase) => parseDate(lc[phase])).filter(
      (d): d is number => d != null,
    );
    if (dates.length === 0) continue;

    const start = Math.min(...dates);
    const eol = parseDate(lc.endOfLife);
    if (eol != null && eol <= start) continue;

    bump(start, "appearing");
    if (eol != null) bump(eol, "disappearing");
  }

  return [...byDate.values()].sort((a, b) => a.value - b.value);
}
