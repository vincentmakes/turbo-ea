import { describe, it, expect } from "vitest";
import {
  addDays,
  addMonths,
  dayNumber,
  firstDayOfWeek,
  fullDateLabel,
  isValidIso,
  monthGrid,
  monthTitle,
  outOfRange,
  todayIso,
  weekdayLabels,
} from "./calendarGrid";

const hasWeekData = (() => {
  const loc = new Intl.Locale("de-DE") as Intl.Locale & {
    getWeekInfo?: () => unknown;
    weekInfo?: unknown;
  };
  return typeof loc.getWeekInfo === "function" || loc.weekInfo !== undefined;
})();

describe("firstDayOfWeek", () => {
  it.runIf(hasWeekData)("comes from the locale's week data", () => {
    expect(firstDayOfWeek("de-DE")).toBe(1);
    expect(firstDayOfWeek("en-US")).toBe(0);
  });

  it("falls back to Monday for an unusable locale", () => {
    expect(firstDayOfWeek("not a locale!")).toBe(1);
  });
});

describe("monthGrid", () => {
  it("always returns 42 days starting on the requested weekday", () => {
    const monday = monthGrid(2026, 8, 1); // September 2026 starts on a Tuesday
    expect(monday).toHaveLength(42);
    expect(monday[0]).toBe("2026-08-31");
    expect(monday).toContain("2026-09-30");

    const sunday = monthGrid(2026, 8, 0);
    expect(sunday[0]).toBe("2026-08-30");
  });

  it("rolls over the year", () => {
    const grid = monthGrid(2026, 11, 1);
    expect(grid).toContain("2026-12-31");
    expect(grid[41] > "2026-12-31").toBe(true);
    expect(grid[41].startsWith("2027-01")).toBe(true);
  });

  it("handles leap-year February", () => {
    expect(monthGrid(2028, 1, 1)).toContain("2028-02-29");
    expect(monthGrid(2027, 1, 1)).not.toContain("2027-02-29");
  });
});

describe("date arithmetic", () => {
  it("adds days across month and year ends", () => {
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
  });

  it("clamps the day when adding months", () => {
    expect(addMonths("2026-01-31", 1)).toBe("2026-02-28");
    expect(addMonths("2028-01-31", 1)).toBe("2028-02-29");
    expect(addMonths("2026-03-15", -12)).toBe("2025-03-15");
  });

  it("builds today from the viewer's local calendar day, not UTC", () => {
    // 23:30 local on 23 Sept is still 23 Sept whatever the UTC offset.
    expect(todayIso(new Date(2026, 8, 23, 23, 30))).toBe("2026-09-23");
  });

  it("validates ISO dates", () => {
    expect(isValidIso("2026-02-28")).toBe(true);
    expect(isValidIso("2026-02-30")).toBe(false);
    expect(isValidIso("23.09.2026")).toBe(false);
  });

  it("checks the optional range", () => {
    expect(outOfRange("2026-01-01", "2026-02-01")).toBe(true);
    expect(outOfRange("2026-03-01", undefined, "2026-02-01")).toBe(true);
    expect(outOfRange("2026-02-01", "2026-02-01", "2026-02-01")).toBe(false);
    expect(outOfRange("2026-02-01")).toBe(false);
  });
});

describe("labels come from Intl, not from code", () => {
  it("orders weekday headers from the first day", () => {
    expect(weekdayLabels("en-US", 1).map((l) => l.long)[0]).toBe("Monday");
    expect(weekdayLabels("en-US", 0).map((l) => l.long)[0]).toBe("Sunday");
    expect(weekdayLabels("de-DE", 1)[0].long).toBe("Montag");
  });

  it("names the month in the given language", () => {
    expect(monthTitle("en", 2026, 8)).toBe("September 2026");
    expect(monthTitle("de", 2026, 8)).toBe("September 2026");
    expect(monthTitle("fr", 2026, 8)).toBe("septembre 2026");
  });

  it("labels days fully for screen readers, without timezone drift", () => {
    expect(fullDateLabel("en-US", "2026-09-23")).toBe("Wednesday, September 23, 2026");
    expect(dayNumber("en", "2026-09-01")).toBe("1");
  });
});
