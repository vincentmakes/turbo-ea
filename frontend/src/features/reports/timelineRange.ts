import { LIFECYCLE_PHASES, isAliveAtDate, parseDate } from "./portfolioHelpers";
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
