import { useState, useMemo } from "react";
import type { PrintParam } from "@/features/reports/ReportShell";

function isSameDay(a: number, b: number): boolean {
  const da = new Date(a);
  const db = new Date(b);
  return (
    da.getFullYear() === db.getFullYear() &&
    da.getMonth() === db.getMonth() &&
    da.getDate() === db.getDate()
  );
}

/**
 * Reusable timeline / "time travel" state for reports.
 *
 * Handles:
 * - Timeline slider state (defaults to today)
 * - Smart persistence: returns `undefined` when the date is today
 *   so that reopening tomorrow defaults to the new "today"
 * - Print param: returns a PrintParam only when time-traveling
 * - Reset: snaps back to today
 */
export function useTimeline() {
  const todayMs = useMemo(() => Date.now(), []);
  const [timelineDate, setTimelineDate] = useState(todayMs);

  /** Whether the user has time-traveled away from today. */
  const isTimeTraveling = !isSameDay(timelineDate, todayMs);

  /** Value to persist in saved config — undefined when on "today". */
  const persistValue = isTimeTraveling ? timelineDate : undefined;

  /** PrintParam to include in report print header, or null. */
  const printParam: PrintParam | null = isTimeTraveling
    ? {
        label: "Time travel",
        value: new Date(timelineDate).toLocaleDateString("en-US", {
          year: "numeric",
          month: "short",
          day: "numeric",
        }),
      }
    : null;

  /** Restore from saved config (call from consumeConfig handler). */
  const restore = (saved: number | undefined | null) => {
    if (saved != null) setTimelineDate(saved);
  };

  /** Reset timeline to today. */
  const reset = () => setTimelineDate(todayMs);

  return {
    timelineDate,
    setTimelineDate,
    todayMs,
    isTimeTraveling,
    persistValue,
    printParam,
    restore,
    reset,
  };
}
