/**
 * Calendar-day helpers — the one place that knows a date-only string is a
 * calendar day, not an instant.
 *
 * Two JavaScript traps produce the same off-by-one-day bug, and both have hit
 * this app:
 *
 *  1. **Parsing.** Per ECMA-262 a bare `YYYY-MM-DD` parses as **UTC** midnight,
 *     but every accessor we then read it with — `getDate`, `getMonth`,
 *     `getFullYear`, `toLocaleString` — is **local**. West of UTC the two
 *     disagree, so `new Date("2026-08-27").getDate()` is `26` in Los Angeles
 *     and a PPM status report saved for the 27th rendered as the 26th (#1016).
 *     Longer ISO strings are *not* affected — `…T10:00:00Z` carries an offset
 *     and `…T10:00:00` is defined as local — so only the bare date-only form
 *     may be reinterpreted. `parseIsoDate` anchors its pattern with `$` to say
 *     exactly that: a prefix match would silently discard the time off a
 *     `created_at`.
 *
 *  2. **Formatting.** `new Date().toISOString().slice(0, 10)` is today's date
 *     in **UTC**. For a user in UTC-7 it is already tomorrow from 17:00, so
 *     "today" defaults pre-filled tomorrow and overdue comparisons flagged the
 *     wrong day.
 *
 * Three private, near-identical copies of the parsing fix had grown in
 * `PpmGanttTab`, `costChartData` and `MyTodosSection` before this file existed.
 * Use these helpers instead of `new Date(isoString)` or
 * `toISOString().slice(0, 10)` anywhere a **calendar day** is meant — the same
 * "one shared helper so it cannot be reintroduced by copy-paste" posture as
 * `components/DateField.tsx` (#865).
 *
 * These helpers change the *timezone* and nothing else: `parseIsoDate` accepts
 * exactly the strings `new Date` accepts and rolls impossible days over the
 * same way, so no value that renders today starts rendering blank.
 */

/** ECMA-262's date-only grammar. Anchored — a string carrying a time must not
 *  match, or `toLocalDate` would truncate every timestamp it is handed. */
const ISO_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * A date-only `YYYY-MM-DD` string as **local** midnight, or `null` when the
 * value is absent or is not a bare date. A full timestamp returns `null` here
 * by design — use `toLocalDate` when the input may be either.
 */
export function parseIsoDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const m = ISO_DATE_RE.exec(value);
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  // Out-of-grammar values (month 13, day 00) are Invalid Date for `new Date`
  // too, so rejecting them keeps the two in step. In-grammar impossible days
  // (2026-02-31) roll forward, exactly as `new Date` rolls them.
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return new Date(year, month - 1, day, 0, 0, 0, 0);
}

/**
 * Any API date value as a `Date`, or `null` when absent / unparseable.
 *
 * Date-only strings become **local** midnight, so the local getters read back
 * the calendar day that was stored. Everything else — full ISO timestamps,
 * epoch numbers, `Date` instances — goes through `new Date` unchanged.
 */
export function toLocalDate(
  value: Date | string | number | null | undefined,
): Date | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "string") {
    const dateOnly = parseIsoDate(value);
    if (dateOnly) return dateOnly;
  }
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** A `Date`'s **local** calendar day as `YYYY-MM-DD`. */
export function toIsoDate(d: Date): string {
  const y = String(d.getFullYear()).padStart(4, "0");
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/**
 * Today as `YYYY-MM-DD` in the **user's** timezone — the replacement for
 * `new Date().toISOString().slice(0, 10)`.
 *
 * Use it for "today" form defaults and for overdue / lifecycle-phase
 * comparisons: once both sides are local `YYYY-MM-DD`, plain string comparison
 * (`due_date < todayIsoDate()`) is correct and allocation-free.
 */
export function todayIsoDate(now: Date = new Date()): string {
  return toIsoDate(now);
}

/** A copy of `d` snapped to local midnight, for day-granularity comparisons. */
export function startOfLocalDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);
}
