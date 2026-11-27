/**
 * Where a lifecycle's phases sit on a time axis — the geometry of the phase
 * bar the Lifecycle report draws, shared with the card page's relation
 * lifecycles panel so both read one rule.
 *
 * Pure: no React, no theme. Positions are percentages of the axis, so the
 * caller places them with `left` / `width` and right-to-left mirroring keeps
 * working through the theme's stylis plugin.
 */
import { PHASES, type LifecyclePhase } from "@/lib/lifecyclePhases";

/** A time axis: its first instant and its length, both in epoch ms. */
export interface BarAxis {
  min: number;
  range: number;
}

/** One phase drawn as a bar: from its own date to the next dated phase. */
export interface PhaseSegment {
  phase: LifecyclePhase;
  left: number;
  width: number;
}

export interface PhaseBarLayout {
  segments: PhaseSegment[];
  /** End of Life is a pin at its date, not a bar; `null` when unset. */
  eolPct: number | null;
}

/** A phase shorter than this (in % of the axis) keeps a sliver, so it stays visible. */
export const MIN_SEGMENT_PCT = 0.5;

/** A date's epoch ms, or `null` for anything that is not a parsable string. */
function parseDate(s: unknown): number | null {
  if (typeof s !== "string" || !s) return null;
  const d = new Date(s).getTime();
  return isNaN(d) ? null : d;
}

/** Where `ms` falls on the axis, in % (may lie outside 0–100). */
export function axisPct(ms: number, axis: BarAxis): number {
  return ((ms - axis.min) / axis.range) * 100;
}

/**
 * The phase bars of one lifecycle. Each dated phase runs to the next phase
 * that is dated (an unset phase in between is skipped); the last one runs to
 * the end of the axis. End of Life is returned as a pin position.
 */
export function phaseSegments(
  lifecycle: Record<string, string | undefined> | undefined,
  axis: BarAxis,
): PhaseBarLayout {
  const segments: PhaseSegment[] = [];
  let eolPct: number | null = null;
  const lc = lifecycle ?? {};
  const axisMax = axis.min + axis.range;
  for (let i = 0; i < PHASES.length; i++) {
    const start = parseDate(lc[PHASES[i]]);
    if (!start) continue;
    if (PHASES[i] === "endOfLife") {
      eolPct = axisPct(start, axis);
      continue;
    }
    const nextPhaseStart = PHASES.slice(i + 1)
      .map((p) => parseDate(lc[p]))
      .find((d) => d != null);
    const end = nextPhaseStart ?? axisMax;
    const left = axisPct(start, axis);
    const width = Math.max(((end - start) / axis.range) * 100, MIN_SEGMENT_PCT);
    segments.push({ phase: PHASES[i], left, width });
  }
  return { segments, eolPct };
}

const utcNewYear = (year: number) => Date.UTC(year, 0, 1);

/**
 * The axis that holds every dated phase of `lifecycles` and today, widened to
 * whole calendar years (UTC): from 1 January of the earliest year to 1 January
 * after the latest. So there is always at least a year of axis, and an
 * open-ended last phase visibly runs on past its date.
 */
export function fitAxis(
  lifecycles: ReadonlyArray<Record<string, string | undefined> | undefined>,
  todayMs: number,
): BarAxis {
  let lo = todayMs;
  let hi = todayMs;
  for (const lc of lifecycles) {
    for (const p of PHASES) {
      const d = parseDate(lc?.[p]);
      if (d == null) continue;
      lo = Math.min(lo, d);
      hi = Math.max(hi, d);
    }
  }
  const min = utcNewYear(new Date(lo).getUTCFullYear());
  const max = utcNewYear(new Date(hi).getUTCFullYear() + 1);
  return { min, range: max - min };
}

export interface AxisTick {
  label: string;
  pct: number;
}

/**
 * Year ticks (1 January, UTC) inside the axis, thinned to at most
 * `maxTicks` by taking every n-th year counted from the first.
 */
export function axisTicks(axis: BarAxis, maxTicks: number): AxisTick[] {
  const max = axis.min + axis.range;
  const years: number[] = [];
  for (let y = new Date(axis.min).getUTCFullYear(); utcNewYear(y) <= max; y++) {
    if (utcNewYear(y) >= axis.min) years.push(y);
  }
  const step = Math.max(1, Math.ceil(years.length / Math.max(1, maxTicks)));
  return years
    .filter((_, i) => i % step === 0)
    .map((y) => ({ label: String(y), pct: axisPct(utcNewYear(y), axis) }));
}
