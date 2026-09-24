/**
 * Pure calendar helpers for DateField's themed calendar (#1142).
 *
 * Everything works on ISO `yyyy-mm-dd` strings and UTC arithmetic, so no
 * timezone can shift a day, and every piece of locale knowledge — the first
 * day of the week, month and weekday names — comes from `Intl`, never from a
 * table in code.
 */

/** JS weekday index: 0 = Sunday … 6 = Saturday. */
export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6;

function utc(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

/** ISO date of a UTC `Date`. */
export function isoOf(date: Date): string {
  const y = String(date.getUTCFullYear()).padStart(4, "0");
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** Today's date in the viewer's own timezone, as ISO. */
export function todayIso(now: Date = new Date()): string {
  return isoOf(new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())));
}

export function isValidIso(iso: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return false;
  return isoOf(utc(iso)) === iso;
}

export function addDays(iso: string, days: number): string {
  const date = utc(iso);
  date.setUTCDate(date.getUTCDate() + days);
  return isoOf(date);
}

/** Moves by whole months, clamping the day (31 Jan + 1 month → 28/29 Feb). */
export function addMonths(iso: string, months: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const first = new Date(Date.UTC(y, m - 1 + months, 1));
  const lastDay = new Date(
    Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0),
  ).getUTCDate();
  first.setUTCDate(Math.min(d, lastDay));
  return isoOf(first);
}

export function weekdayOf(iso: string): Weekday {
  return utc(iso).getUTCDay() as Weekday;
}

/** Year and 0-based month of an ISO date. */
export function yearMonthOf(iso: string): { year: number; month: number } {
  const [y, m] = iso.split("-").map(Number);
  return { year: y, month: m - 1 };
}

/**
 * The first day of the week for a locale, from its CLDR week data
 * (`Intl.Locale#getWeekInfo()`, or the older `weekInfo` accessor). Where the
 * runtime has no week data, falls back to Monday (ISO 8601) rather than to a
 * per-country table in code.
 */
export function firstDayOfWeek(locale: string | undefined): Weekday {
  try {
    const loc = new Intl.Locale(locale ?? "und") as Intl.Locale & {
      getWeekInfo?: () => { firstDay?: number };
      weekInfo?: { firstDay?: number };
    };
    const info = typeof loc.getWeekInfo === "function" ? loc.getWeekInfo() : loc.weekInfo;
    const firstDay = info?.firstDay; // 1 = Monday … 7 = Sunday
    if (typeof firstDay === "number" && firstDay >= 1 && firstDay <= 7) {
      return (firstDay % 7) as Weekday;
    }
  } catch {
    // Unknown locale: fall through.
  }
  return 1;
}

/**
 * The 6 × 7 ISO dates shown for a month, starting on `firstDay` and padded
 * with the neighbouring months' days — always 42, so the calendar never
 * changes height from one month to the next.
 */
export function monthGrid(year: number, month: number, firstDay: Weekday): string[] {
  const first = isoOf(new Date(Date.UTC(year, month, 1)));
  const lead = (weekdayOf(first) - firstDay + 7) % 7;
  const start = addDays(first, -lead);
  return Array.from({ length: 42 }, (_, i) => addDays(start, i));
}

// 2023-01-01 was a Sunday: offsetting from it gives any weekday.
const SUNDAY = Date.UTC(2023, 0, 1);

export interface WeekdayLabel {
  short: string;
  long: string;
}

/** Weekday column headers in display order, e.g. `M T W …` / `Monday …`. */
export function weekdayLabels(locale: string | undefined, firstDay: Weekday): WeekdayLabel[] {
  const short = new Intl.DateTimeFormat(locale, { weekday: "narrow", timeZone: "UTC" });
  const long = new Intl.DateTimeFormat(locale, { weekday: "long", timeZone: "UTC" });
  return Array.from({ length: 7 }, (_, i) => {
    const day = new Date(SUNDAY + ((firstDay + i) % 7) * 86_400_000);
    return { short: short.format(day), long: long.format(day) };
  });
}

/** The calendar header, e.g. "September 2026" / "September 2026" / "2026年9月". */
export function monthTitle(locale: string | undefined, year: number, month: number): string {
  return new Intl.DateTimeFormat(locale, {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(year, month, 1)));
}

/** A day's full spoken name, for its `aria-label`. */
export function fullDateLabel(locale: string | undefined, iso: string): string {
  return new Intl.DateTimeFormat(locale, { dateStyle: "full", timeZone: "UTC" }).format(utc(iso));
}

/** Day-of-month number for a cell, in the locale's digits. */
export function dayNumber(locale: string | undefined, iso: string): string {
  return new Intl.DateTimeFormat(locale, { day: "numeric", timeZone: "UTC" }).format(utc(iso));
}

/** Whether `iso` falls outside the optional `[min, max]` range (ISO compares lexically). */
export function outOfRange(iso: string, min?: string, max?: string): boolean {
  return (!!min && isValidIso(min) && iso < min) || (!!max && isValidIso(max) && iso > max);
}
