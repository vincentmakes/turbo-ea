import { describe, expect, it } from "vitest";
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
