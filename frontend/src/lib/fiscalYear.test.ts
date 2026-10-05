import { describe, it, expect } from "vitest";
import type { TFunction } from "i18next";
import { fiscalYearLabel } from "./fiscalYear";

// Echo the key and its values so the test pins which form is chosen.
const t = ((key: string, opts: Record<string, unknown>) =>
  `${key} ${JSON.stringify(opts)}`) as unknown as TFunction;

describe("fiscalYearLabel", () => {
  it("names a calendar fiscal year by its year alone", () => {
    expect(fiscalYearLabel(2026, 1, t)).toBe('common:fiscalYear.single {"year":2026}');
  });

  it("names a straddling fiscal year by both years", () => {
    expect(fiscalYearLabel(2026, 10, t)).toBe('common:fiscalYear.span {"from":2025,"to":2026}');
  });

  it.each([2, 7, 12])("names a year starting in month %i by both years", (start) => {
    expect(fiscalYearLabel(2026, start, t)).toBe('common:fiscalYear.span {"from":2025,"to":2026}');
  });

  it.each([0, 13, -1, 1.5, Number.NaN])(
    "falls back to the calendar form for an invalid start month (%s)",
    (start) => {
      expect(fiscalYearLabel(2026, start, t)).toBe('common:fiscalYear.single {"year":2026}');
    },
  );
});
