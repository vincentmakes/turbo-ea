/**
 * Mirror of the backend `default_lead_time_days` helper in
 * `app/services/recurrence.py`. Used by the recurrence dialogs (risk
 * mitigation tasks and recurring card todos) to suggest a sensible
 * default when the user toggles recurrence on or changes the unit /
 * interval — the value the server would have picked if no
 * `lead_time_days` was supplied.
 *
 * Picked so the assignee gets a useful reminder window without sitting
 * on an open Todo for the bulk of the cycle. Capped at half the cycle
 * in days so daily / fortnightly tasks don't get a window that overlaps
 * the previous cycle.
 */
import type { RecurrenceUnit } from "@/types";

const LEAD_TIME_DEFAULT_BY_UNIT: Record<RecurrenceUnit, number> = {
  none: 0,
  days: 1,
  weeks: 2,
  months: 7,
  years: 14,
};

const DAYS_IN_UNIT: Partial<Record<RecurrenceUnit, number>> = {
  days: 1,
  weeks: 7,
  months: 30,
  years: 365,
};

export function defaultLeadTimeDays(unit: RecurrenceUnit, interval: number): number {
  if (unit === "none" || interval < 1) return 0;
  const base = LEAD_TIME_DEFAULT_BY_UNIT[unit] ?? 0;
  const daysPerUnit = DAYS_IN_UNIT[unit] ?? 0;
  if (daysPerUnit === 0) return 0;
  // Cap: floor(interval × days-per-unit / 2). Floor for "days" keeps
  // single-day cycles at 0 lead (no overlap possible); other units get
  // a floor of 1 day so a "very short interval" still ends up with at
  // least a 1-day window when the base would dwarf the cap.
  const rawCap = Math.floor((interval * daysPerUnit) / 2);
  const cap = unit === "days" ? Math.max(0, rawCap) : Math.max(1, rawCap);
  return Math.min(base, cap);
}

/**
 * Translation-aware label for when a scheduled cycle activates: returns
 * the future date when `due_date - lead_time_days` lands. Used in the
 * tasks panel + history list to show "Activates 2026-11-08" alongside
 * a scheduled cycle. Pure — caller supplies the ISO `due_date` string.
 *
 * Returns null when the due date is missing so the caller can skip the
 * line entirely (rather than render a misleading "Activates: —").
 */
export function activationDate(dueDate: string | null, leadTimeDays: number): string | null {
  if (!dueDate) return null;
  // Parse as a calendar date — using Date(year, month-1, day) avoids
  // the time-zone footgun where `new Date("2026-11-15")` is interpreted
  // as UTC midnight and rendered locally.
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dueDate);
  if (!m) return null;
  const due = new Date(
    Number(m[1]),
    Number(m[2]) - 1,
    Number(m[3]),
  );
  due.setDate(due.getDate() - Math.max(0, leadTimeDays));
  const yyyy = due.getFullYear();
  const mm = String(due.getMonth() + 1).padStart(2, "0");
  const dd = String(due.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}
