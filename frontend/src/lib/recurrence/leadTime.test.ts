import { describe, expect, it } from "vitest";
import { activationDate, defaultLeadTimeDays } from "./leadTime";

describe("defaultLeadTimeDays", () => {
  it("returns 0 for one-shot tasks", () => {
    // No roll-forward to gate, so the lead time is meaningless.
    expect(defaultLeadTimeDays("none", 1)).toBe(0);
  });

  it("matches the backend smart defaults at canonical intervals", () => {
    // These numbers MUST stay in sync with the backend
    // `default_lead_time_days` helper — the dialog uses them to suggest
    // the same value the server would have picked.
    expect(defaultLeadTimeDays("days", 30)).toBe(1);
    expect(defaultLeadTimeDays("weeks", 4)).toBe(2);
    expect(defaultLeadTimeDays("months", 6)).toBe(7);
    expect(defaultLeadTimeDays("years", 1)).toBe(14);
  });

  it("caps the lead so it never overlaps the previous cycle", () => {
    // Daily (every day) → cap floor(1 / 2) = 0.
    expect(defaultLeadTimeDays("days", 1)).toBe(0);
    expect(defaultLeadTimeDays("days", 2)).toBe(1);
    // Weekly (every week) → cap floor(7 / 2) = 3, default 2 wins.
    expect(defaultLeadTimeDays("weeks", 1)).toBe(2);
  });

  it("uses per-unit default for long intervals where cap is plenty", () => {
    expect(defaultLeadTimeDays("years", 5)).toBe(14);
    expect(defaultLeadTimeDays("months", 6)).toBe(7);
  });

  it("returns 0 for non-positive intervals", () => {
    expect(defaultLeadTimeDays("days", 0)).toBe(0);
    expect(defaultLeadTimeDays("months", -1)).toBe(0);
  });
});

describe("activationDate", () => {
  it("subtracts lead_time_days from due_date as a calendar date", () => {
    expect(activationDate("2026-11-15", 7)).toBe("2026-11-08");
    expect(activationDate("2026-11-15", 14)).toBe("2026-11-01");
  });

  it("handles month boundaries correctly", () => {
    // 2026-03-05 − 7 days = 2026-02-26.
    expect(activationDate("2026-03-05", 7)).toBe("2026-02-26");
  });

  it("returns the due date itself when lead is 0", () => {
    expect(activationDate("2026-11-15", 0)).toBe("2026-11-15");
  });

  it("clamps negative leads to 0 so the window never inverts", () => {
    expect(activationDate("2026-11-15", -3)).toBe("2026-11-15");
  });

  it("returns null when due_date is missing or malformed", () => {
    expect(activationDate(null, 7)).toBeNull();
    expect(activationDate("not-a-date", 7)).toBeNull();
  });
});
