import { describe, it, expect } from "vitest";
import { formatRecurrence } from "./recurrenceLabel";

// Stub t() — returns the key plus interpolated count so we can assert
// without pulling in i18next.
const t = (key: string, options?: Record<string, unknown>): string => {
  if (options && options.count !== undefined) return `${key}:${options.count}`;
  return key;
};

describe("formatRecurrence", () => {
  it("returns the one-shot key for unit=none", () => {
    expect(formatRecurrence("none", 1, t)).toBe("risks.tasks.recurrence.oneShot");
    // Interval is ignored when unit is none.
    expect(formatRecurrence("none", 5, t)).toBe("risks.tasks.recurrence.oneShot");
  });

  it("uses the _one form when interval is 1", () => {
    expect(formatRecurrence("days", 1, t)).toBe("risks.tasks.recurrence.days_one");
    expect(formatRecurrence("weeks", 1, t)).toBe("risks.tasks.recurrence.weeks_one");
    expect(formatRecurrence("months", 1, t)).toBe("risks.tasks.recurrence.months_one");
    expect(formatRecurrence("years", 1, t)).toBe("risks.tasks.recurrence.years_one");
  });

  it("uses the _other form with interpolated count when interval > 1", () => {
    expect(formatRecurrence("months", 6, t)).toBe("risks.tasks.recurrence.months_other:6");
    expect(formatRecurrence("weeks", 2, t)).toBe("risks.tasks.recurrence.weeks_other:2");
    expect(formatRecurrence("years", 3, t)).toBe("risks.tasks.recurrence.years_other:3");
  });

  it("clamps non-positive intervals to 1", () => {
    expect(formatRecurrence("days", 0, t)).toBe("risks.tasks.recurrence.days_one");
    expect(formatRecurrence("weeks", -3, t)).toBe("risks.tasks.recurrence.weeks_one");
  });

  it("honours a custom keyPrefix (recurring todos)", () => {
    expect(formatRecurrence("none", 1, t, "todos.recurrence")).toBe("todos.recurrence.oneShot");
    expect(formatRecurrence("months", 1, t, "todos.recurrence")).toBe(
      "todos.recurrence.months_one",
    );
    expect(formatRecurrence("months", 6, t, "todos.recurrence")).toBe(
      "todos.recurrence.months_other:6",
    );
  });
});
