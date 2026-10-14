import { describe, expect, it } from "vitest";
import { dayRangeParams } from "./dayRange";

// Every assertion reads the result back in LOCAL time, so the suite holds in
// whatever timezone it runs in — which is the whole point of the helper.
describe("dayRangeParams", () => {
  it("starts `since` at local midnight of the picked day", () => {
    const { since } = dayRangeParams("2026-03-15");
    expect(since).toBeDefined();
    const d = new Date(since!);
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(2);
    expect(d.getDate()).toBe(15);
    expect(d.getHours()).toBe(0);
    expect(d.getMinutes()).toBe(0);
    expect(d.getSeconds()).toBe(0);
    expect(d.getMilliseconds()).toBe(0);
  });

  it("ends `until` at the last millisecond of the picked local day", () => {
    const { until } = dayRangeParams(undefined, "2026-03-15");
    expect(until).toBeDefined();
    const d = new Date(until!);
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(2);
    expect(d.getDate()).toBe(15);
    expect(d.getHours()).toBe(23);
    expect(d.getMinutes()).toBe(59);
    expect(d.getSeconds()).toBe(59);
    expect(d.getMilliseconds()).toBe(999);
  });

  it("matches a date built from local components", () => {
    const { since, until } = dayRangeParams("2026-01-01", "2026-12-31");
    expect(since).toBe(new Date(2026, 0, 1).toISOString());
    expect(until).toBe(new Date(2026, 11, 31, 23, 59, 59, 999).toISOString());
  });

  it("spans one whole day when both ends are the same day", () => {
    const { since, until } = dayRangeParams("2026-06-10", "2026-06-10");
    const span = new Date(until!).getTime() - new Date(since!).getTime();
    // 24h minus 1ms, give or take an hour on a DST changeover day.
    expect(span).toBeGreaterThanOrEqual(23 * 3600_000 - 1);
    expect(span).toBeLessThanOrEqual(25 * 3600_000 - 1);
    expect(new Date(since!).getDate()).toBe(10);
    expect(new Date(until!).getDate()).toBe(10);
  });

  it("returns only the key whose value was given", () => {
    expect(Object.keys(dayRangeParams("2026-06-10"))).toEqual(["since"]);
    expect(Object.keys(dayRangeParams(undefined, "2026-06-10"))).toEqual(["until"]);
    expect(Object.keys(dayRangeParams("", "2026-06-10"))).toEqual(["until"]);
  });

  it("ignores empty and malformed values", () => {
    expect(dayRangeParams()).toEqual({});
    expect(dayRangeParams("", "")).toEqual({});
    expect(dayRangeParams("not-a-date", "2026/06/10")).toEqual({});
    expect(dayRangeParams("2026-6-1", "20260610")).toEqual({});
    expect(dayRangeParams("2026-02-31", "2026-13-01")).toEqual({});
  });

  it("tolerates surrounding whitespace", () => {
    expect(dayRangeParams(" 2026-06-10 ").since).toBe(new Date(2026, 5, 10).toISOString());
  });
});
