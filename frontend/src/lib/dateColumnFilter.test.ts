import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { compareDateFilter, dateColumnFilterDef } from "./dateColumnFilter";

describe("compareDateFilter", () => {
  const filter = new Date(2026, 3, 15); // 2026-04-15 local midnight

  it("returns negative when the cell date is before the filter date", () => {
    expect(compareDateFilter(filter, "2026-04-14T23:00:00Z")).toBeLessThan(0);
    expect(compareDateFilter(filter, "2026-01-01")).toBeLessThan(0);
  });

  it("returns positive when the cell date is after the filter date", () => {
    expect(compareDateFilter(filter, "2026-04-16T01:00:00Z")).toBeGreaterThan(0);
    expect(compareDateFilter(filter, "2026-12-31")).toBeGreaterThan(0);
  });

  it("returns 0 for the same day regardless of time component", () => {
    expect(compareDateFilter(filter, "2026-04-15T00:00:00")).toBe(0);
    expect(compareDateFilter(filter, "2026-04-15T18:30:00")).toBe(0);
    expect(compareDateFilter(filter, "2026-04-15")).toBe(0);
  });

  it("treats blank / unparseable cell values as before every filter date", () => {
    expect(compareDateFilter(filter, "")).toBeLessThan(0);
    expect(compareDateFilter(filter, null)).toBeLessThan(0);
    expect(compareDateFilter(filter, undefined)).toBeLessThan(0);
    expect(compareDateFilter(filter, "not-a-date")).toBeLessThan(0);
  });

  it("exposes a reusable column definition wired to the comparator", () => {
    expect(dateColumnFilterDef.filter).toBe("agDateColumnFilter");
    expect(dateColumnFilterDef.filterParams.comparator).toBe(compareDateFilter);
  });

  it("includes a reset button so the filter can be cleared per column", () => {
    // Guards the merge-vs-replace pitfall: a column's own filterParams replaces
    // the grid default's, so the reset button must be declared here too.
    expect(dateColumnFilterDef.filterParams.buttons).toContain("reset");
  });
});

/** See `src/lib/dates.test.ts` for the mechanism. */
function withTimeZone(tz: string) {
  beforeAll(() => vi.stubEnv("TZ", tz));
  afterAll(() => vi.unstubAllEnvs());
}

describe("compareDateFilter west of UTC", () => {
  withTimeZone("America/Los_Angeles");

  it("matches a date-only cell on its own calendar day", () => {
    // Built inside the test body, not at collection time: `beforeAll` has not
    // stubbed the zone yet while the `describe` callback runs, so a `Date`
    // hoisted out of here would be constructed in the runner's own zone and
    // the assertion would pass vacuously.
    const filter = new Date(2026, 3, 15); // 2026-04-15 local midnight
    // Before the fix "2026-04-15" parsed as UTC midnight = 14 Apr 17:00 local,
    // so filtering the Inventory / Decisions grid for the 15th matched the
    // 16th instead (#1016, same root cause).
    expect(compareDateFilter(filter, "2026-04-15")).toBe(0);
    expect(compareDateFilter(filter, "2026-04-14")).toBeLessThan(0);
    expect(compareDateFilter(filter, "2026-04-16")).toBeGreaterThan(0);
  });
});
