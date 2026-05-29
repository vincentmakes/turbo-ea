/**
 * Format a recurrence rule for display.
 *
 * Returns a translation-aware human label like "One-shot",
 * "Every week", or "Every 6 months". The caller passes a translation
 * function `t` already bound to the right namespace, plus an optional
 * `keyPrefix` so the same helper serves both the Risk Mitigation Tasks
 * UI (`risks.tasks.recurrence`, the default) and recurring card todos
 * (`todos.recurrence`). Pure (no react-i18next dependency) and
 * unit-testable.
 */
import type { RecurrenceUnit } from "@/types";

type TFn = (key: string, options?: Record<string, unknown>) => string;

export function formatRecurrence(
  unit: RecurrenceUnit,
  interval: number,
  t: TFn,
  keyPrefix = "risks.tasks.recurrence",
): string {
  if (unit === "none") {
    return t(`${keyPrefix}.oneShot`);
  }
  const count = Math.max(1, interval);
  if (count === 1) {
    return t(`${keyPrefix}.${unit}_one`);
  }
  return t(`${keyPrefix}.${unit}_other`, { count });
}

export const RECURRENCE_UNIT_OPTIONS: RecurrenceUnit[] = [
  "days",
  "weeks",
  "months",
  "years",
];
