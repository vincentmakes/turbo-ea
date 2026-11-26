/**
 * "Is this lifecycle in effect on a date?" — the one client-side rule.
 *
 * A leaf on purpose: the time-travel reports, card detail's relation rows and
 * the diagram's expansion all ask the same question, and `lib` modules must
 * not import from a feature. The rule used to live in
 * `features/reports/portfolioHelpers.ts`, which still re-exports every name
 * here so existing imports (and the extension SDK's `loadTimeline`, which
 * resolves `timelineRange` through it) are unchanged.
 *
 * The backend mirrors it exactly (`lifecycle_in_effect` /
 * `lifecycle_in_effect_sql` in `backend/app/services/lifecycle.py`), which is
 * what lets a relation's chip on card detail agree with the counts, flags and
 * completeness score the server computes.
 */

export function parseDate(s: string | undefined): number | null {
  // An absent or empty value is an invalid date like any other unparsable one.
  const t = s === undefined ? NaN : Date.parse(s);
  return isNaN(t) ? null : t;
}

/** A bare lifecycle map (`plan`/`phaseIn`/`active`/`phaseOut`/`endOfLife` → ISO date). */
export type Lifecycle = Record<string, string> | undefined;

/**
 * Whether the card is in the landscape at `dateMs` — i.e. its go-live date has
 * arrived.
 *
 * A card enters on its `active` date and not before. The timeline's go-live
 * marks sit on `active`, so taking the EARLIEST start phase as the birthday
 * made a card with `plan 2027 / active 2029` appear in 2027 — two years before
 * the mark that announces it, on a date carrying no mark at all.
 *
 * With no `active` date the card never went live:
 *  - carrying a `plan`/`phaseIn` date makes it upcoming, so it shows only when
 *    planned cards are previewed;
 *  - carrying neither leaves it no birthday to miss, so it counts as started.
 *    That fail-open branch is what keeps undated landscape furniture visible,
 *    and what keeps a card holding only `phaseOut`/`endOfLife` (the shape the
 *    endoflife.date mass-link writes) from being invisible its entire life —
 *    it must already exist to be phasing out.
 */
export function hasStartedByDate(lifecycle: Lifecycle, dateMs: number): boolean {
  const active = parseDate(lifecycle?.active);
  if (active != null) return active <= dateMs;
  // The phases that say a card is MEANT to go live but has not done so yet.
  return !["plan", "phaseIn"].some((p) => parseDate(lifecycle?.[p]) != null);
}

/** Whether the card has reached end of life by `dateMs` (inclusive). */
export function isRetiredByDate(lifecycle: Lifecycle, dateMs: number): boolean {
  const eol = parseDate(lifecycle?.endOfLife);
  return eol != null && eol <= dateMs;
}

/** Whether the card is part of the landscape at `dateMs`: born, not yet retired. */
export function isAliveAtDate(lifecycle: Lifecycle, dateMs: number): boolean {
  return hasStartedByDate(lifecycle, dateMs) && !isRetiredByDate(lifecycle, dateMs);
}
