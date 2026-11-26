/**
 * A relation's own lifecycle, read on a date.
 *
 * A relation carries the same five phases a card does (`plan`, `phaseIn`,
 * `active`, `phaseOut`, `endOfLife`); an empty map means "always in effect".
 * Whether it is in effect is NOT a second rule: it is `isAliveAtDate`, the rule
 * the time-travel reports apply to cards (`lib/lifecycleAtDate.ts`), which the
 * backend mirrors for every count, flag, formula and completeness score.
 *
 * Every client surface that has to agree with those server numbers — card
 * detail's relation rows and group counts, the diagram's expand — classifies
 * through here, at `todayLifecycleMs()`.
 */
import { PHASES } from "@/lib/lifecyclePhases";
import {
  hasStartedByDate,
  isRetiredByDate,
  parseDate,
  type Lifecycle,
} from "@/lib/lifecycleAtDate";

/** Where a relation stands on a date. */
export type RelationLifecycleState = "inEffect" | "planned" | "ended";

/**
 * Today on the scale `parseDate` reads a stored `YYYY-MM-DD` on: UTC midnight
 * of the current **UTC** calendar day.
 *
 * The UTC day, not the viewer's local one, because the server cannot follow a
 * per-user day: every count it computes about relations — the orphaned flag,
 * the relation summary, the data-quality score, formulas, the dashboards —
 * uses the UTC day (`_utc_today` in `backend/app/services/lifecycle.py`), and
 * the time-travel reports already compare against UTC-midnight dates. Reading
 * the local day here made a relation ending "tomorrow" (UTC) read as ended on
 * card detail in a zone ahead of UTC late in its evening, while the server's
 * numbers on the same page still counted it. Truncating to the day (rather
 * than comparing an instant such as `Date.now()`) keeps "ends on the 1st"
 * meaning the whole of the 1st.
 */
export function todayLifecycleMs(now: Date = new Date()): number {
  return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
}

/**
 * Where `lifecycle` stands at `dateMs`. Ended wins over planned: a relation
 * whose end date has arrived is over, whatever its start dates say — exactly
 * as `isAliveAtDate` reads it.
 */
export function relationLifecycleState(
  lifecycle: Lifecycle,
  dateMs: number,
): RelationLifecycleState {
  if (isRetiredByDate(lifecycle, dateMs)) return "ended";
  if (!hasStartedByDate(lifecycle, dateMs)) return "planned";
  return "inEffect";
}

/** Whether the relation counts at `dateMs` (today when omitted). */
export function isRelationInEffect(lifecycle: Lifecycle, dateMs: number = todayLifecycleMs()): boolean {
  return relationLifecycleState(lifecycle, dateMs) === "inEffect";
}

/** Whether the relation carries any phase date at all. */
export function hasLifecycleDates(lifecycle: Lifecycle): boolean {
  return PHASES.some((p) => !!lifecycle?.[p]);
}

/**
 * The map to send: the five phases only, empty values dropped. An empty
 * result clears the relation's lifecycle, which is what a fully blanked
 * editor means.
 */
export function cleanRelationLifecycle(
  draft: Record<string, string | null | undefined> | null | undefined,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const p of PHASES) {
    const v = draft?.[p];
    if (typeof v === "string" && v.trim()) out[p] = v.trim();
  }
  return out;
}

/** What a relation row says about its dates — `null` when there is nothing to say. */
export type RelationPhaseNote =
  /** Not started; `date` is when it comes into effect, absent when no `active` date is set. */
  | { kind: "planned"; date?: string }
  /** In effect, with an end date still ahead. */
  | { kind: "until"; date: string }
  /** Its end date has arrived. */
  | { kind: "ended"; date: string };

/**
 * The note a relation row carries at `dateMs`. An undated relation, or one in
 * effect with no end in sight, is "active by default" and says nothing.
 */
export function relationPhaseNote(
  lifecycle: Lifecycle,
  dateMs: number = todayLifecycleMs(),
): RelationPhaseNote | null {
  const state = relationLifecycleState(lifecycle, dateMs);
  if (state === "ended") return { kind: "ended", date: lifecycle!.endOfLife };
  if (state === "planned") {
    const active = lifecycle?.active;
    return active && parseDate(active) != null
      ? { kind: "planned", date: active }
      : { kind: "planned" };
  }
  const end = lifecycle?.endOfLife;
  if (end && parseDate(end) != null) return { kind: "until", date: end };
  return null;
}
