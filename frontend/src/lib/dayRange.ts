/**
 * dayRange — turn a date picker's `YYYY-MM-DD` values into the inclusive
 * `since` / `until` ISO bounds a log query takes.
 *
 * The picker value names a day on the viewer's own calendar, so each one is
 * parsed as a LOCAL date from its components. `new Date("YYYY-MM-DD")` would
 * read it as UTC midnight instead, and any local `setHours` applied after that
 * lands on the wrong day for everyone east or west of UTC.
 */

const DAY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Local-midnight `Date` for a `YYYY-MM-DD` value, or `null` when malformed. */
function parseLocalDay(value: string | undefined): Date | null {
  const match = DAY_RE.exec((value ?? "").trim());
  if (!match) return null;
  const [y, m, d] = match.slice(1).map(Number);
  const date = new Date(y, m - 1, d);
  // Reject overflowed values ("2026-02-31" would roll into March).
  if (date.getFullYear() !== y || date.getMonth() !== m - 1 || date.getDate() !== d) {
    return null;
  }
  return date;
}

/**
 * `since` is the start (00:00:00.000) of `dateFrom` and `until` the end
 * (23:59:59.999) of `dateTo`, both in local time, so both picked days are
 * inclusive. An empty or malformed value contributes no key.
 */
export function dayRangeParams(
  dateFrom?: string,
  dateTo?: string,
): { since?: string; until?: string } {
  const out: { since?: string; until?: string } = {};
  const start = parseLocalDay(dateFrom);
  if (start) out.since = start.toISOString();
  const end = parseLocalDay(dateTo);
  if (end) {
    end.setHours(23, 59, 59, 999);
    out.until = end.toISOString();
  }
  return out;
}
