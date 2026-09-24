import { describe, it, expect } from "vitest";
import type { TFunction } from "i18next";
import { fiscalYearLabel, fiscalYearOfMs, fiscalYearStartMs } from "./fiscalYear";

// Echo the key and its values so the test pins which form is chosen.
const t = ((key: string, opts: Record<string, unknown>) =>
  `${key} ${JSON.stringify(opts)}`) as unknown as TFunction;

describe("fiscalYearStartMs", () => {
  it("is 1 January of the year itself on a January start", () => {
    expect(fiscalYearStartMs(2026, 1)).toBe(new Date(2026, 0, 1).getTime());
  });

  it("opens in the year before on any other start month", () => {
    expect(fiscalYearStartMs(2026, 10)).toBe(new Date(2025, 9, 1).getTime());
    expect(fiscalYearStartMs(2026, 4)).toBe(new Date(2025, 3, 1).getTime());
  });

  it("falls back to a January start for an invalid month", () => {
    expect(fiscalYearStartMs(2026, 0)).toBe(new Date(2026, 0, 1).getTime());
    expect(fiscalYearStartMs(2026, 13)).toBe(new Date(2026, 0, 1).getTime());
  });

  it("is exactly one fiscal year apart between consecutive years", () => {
    const a = new Date(fiscalYearStartMs(2027, 7));
    const b = new Date(fiscalYearStartMs(2028, 7));
    expect(b.getFullYear() - a.getFullYear()).toBe(1);
    expect([a.getMonth(), a.getDate()]).toEqual([6, 1]);
  });
});

describe("fiscalYearOfMs", () => {
  it("round-trips every start month", () => {
    for (let start = 1; start <= 12; start++) {
      for (const fy of [2019, 2026, 2031]) {
        expect(fiscalYearOfMs(fiscalYearStartMs(fy, start), start)).toBe(fy);
      }
    }
  });

  it("names a year after the calendar year it ends in", () => {
    expect(fiscalYearOfMs(new Date(2025, 9, 15).getTime(), 10)).toBe(2026);
    expect(fiscalYearOfMs(new Date(2025, 8, 30).getTime(), 10)).toBe(2025);
    expect(fiscalYearOfMs(new Date(2025, 11, 31).getTime(), 1)).toBe(2025);
  });
});

describe("fiscalYearLabel", () => {
  it("names a calendar fiscal year by its year alone", () => {
    expect(fiscalYearLabel(2026, 1, t)).toBe('common:fiscalYear.single {"year":2026}');
  });

  it("names a straddling fiscal year by both years", () => {
    expect(fiscalYearLabel(2026, 10, t)).toBe('common:fiscalYear.span {"from":2025,"to":2026}');
  });
});
