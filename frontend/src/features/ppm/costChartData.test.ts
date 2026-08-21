import { describe, it, expect, beforeEach } from "vitest";
import {
  bucketFor,
  fiscalYearFor,
  fiscalYearMonths,
  monthKey,
  availableFiscalYears,
  fiscalYearOptions,
  projectMonthRange,
  countUndated,
  budgetTotals,
  buildCumulativeSeries,
} from "./costChartData";
import {
  loadCostChartPrefs,
  saveCostChartPrefs,
  resolveFiscalYear,
  DEFAULT_COST_CHART_PREFS,
} from "./costChartPrefs";
import type { PpmCostLine, PpmBudgetLine } from "@/types";

const PREFS_KEY = "turboea.ppm.costcharts.prefs";

function cost(
  date: string | null,
  category: string,
  actual: number,
): PpmCostLine {
  return {
    id: `${date}-${category}-${actual}`,
    initiative_id: "i1",
    description: "x",
    category: category as PpmCostLine["category"],
    planned: 0,
    actual,
    date,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
  };
}

function budget(
  fiscal_year: number,
  category: string,
  amount: number,
): PpmBudgetLine {
  return {
    id: `${fiscal_year}-${category}`,
    initiative_id: "i1",
    fiscal_year,
    category: category as PpmBudgetLine["category"],
    amount,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
  };
}

describe("bucketFor", () => {
  it("maps capex and opex case-insensitively, trimming whitespace", () => {
    expect(bucketFor("capex")).toBe("capex");
    expect(bucketFor(" OpEx ")).toBe("opex");
  });

  it("returns null for anything else, so it counts only toward totals", () => {
    // `category` is free text at the DB level, so imported rows can hold
    // anything — mirrors `_bucket_for` on the backend.
    expect(bucketFor("contingency")).toBeNull();
    expect(bucketFor("")).toBeNull();
    expect(bucketFor(null)).toBeNull();
  });
});

describe("fiscalYearFor", () => {
  it("equals the calendar year with a January start", () => {
    expect(fiscalYearFor("2026-01-01", 1)).toBe(2026);
    expect(fiscalYearFor("2026-12-31", 1)).toBe(2026);
  });

  // Pins the backend convention in calculation_ppm.py: a fiscal year is named
  // after the year it *ends* in.
  it("names an October fiscal year after the year it ends in", () => {
    expect(fiscalYearFor("2025-10-15", 10)).toBe(2026);
    expect(fiscalYearFor("2025-09-30", 10)).toBe(2025);
    expect(fiscalYearFor("2026-09-30", 10)).toBe(2026);
    expect(fiscalYearFor("2026-10-01", 10)).toBe(2027);
  });

  it("returns null for a missing or unparseable date", () => {
    expect(fiscalYearFor(null, 1)).toBeNull();
    expect(fiscalYearFor("", 1)).toBeNull();
    expect(fiscalYearFor("not-a-date", 1)).toBeNull();
  });

  it("does not shift across a month boundary via the local timezone", () => {
    // A bare YYYY-MM-DD parsed with `new Date()` is UTC midnight, which is the
    // previous month in any negative-offset zone.
    expect(fiscalYearFor("2026-01-01", 1)).toBe(2026);
    expect(monthKey({ year: 2026, month: 1 })).toBe("2026-01");
  });
});

describe("fiscalYearMonths", () => {
  it("runs January to December for a January start", () => {
    const months = fiscalYearMonths(2026, 1);
    expect(months).toHaveLength(12);
    expect(months[0]).toEqual({ year: 2026, month: 1 });
    expect(months[11]).toEqual({ year: 2026, month: 12 });
  });

  it("runs October of the prior year to September for an October start", () => {
    const months = fiscalYearMonths(2026, 10);
    expect(months).toHaveLength(12);
    expect(months[0]).toEqual({ year: 2025, month: 10 });
    expect(months[2]).toEqual({ year: 2025, month: 12 });
    expect(months[3]).toEqual({ year: 2026, month: 1 });
    expect(months[11]).toEqual({ year: 2026, month: 9 });
  });

  it("falls back to a calendar year for an out-of-range start month", () => {
    expect(fiscalYearMonths(2026, 0)[0]).toEqual({ year: 2026, month: 1 });
    expect(fiscalYearMonths(2026, 13)[0]).toEqual({ year: 2026, month: 1 });
  });
});

describe("availableFiscalYears", () => {
  it("unions budget years with years derived from cost dates, ascending", () => {
    const years = availableFiscalYears(
      [cost("2024-03-01", "capex", 10), cost("2026-05-01", "opex", 10)],
      [budget(2025, "capex", 100)],
      1,
    );
    expect(years).toEqual([2024, 2025, 2026]);
  });

  it("ignores undated cost lines", () => {
    expect(availableFiscalYears([cost(null, "capex", 10)], [], 1)).toEqual([]);
  });

  it("respects a non-January start month", () => {
    // October 2025 already belongs to FY2026.
    expect(availableFiscalYears([cost("2025-10-01", "capex", 10)], [], 10)).toEqual([2026]);
  });
});

describe("fiscalYearOptions", () => {
  it("lists years newest first", () => {
    expect(fiscalYearOptions([2024, 2025, 2026, 2027], 2026)).toEqual([
      2027, 2026, 2025, 2024,
    ]);
  });

  it("keeps the current year in its chronological slot, not pinned to the top", () => {
    // The picker used to render the current year first and the rest in order,
    // so the list broke sequence after its first entry.
    expect(fiscalYearOptions([2024, 2025, 2026, 2027], 2025)[0]).toBe(2027);
  });

  it("includes the current year even when it carries no data", () => {
    expect(fiscalYearOptions([2024, 2027], 2026)).toEqual([2027, 2026, 2024]);
  });

  it("does not duplicate the current year", () => {
    expect(fiscalYearOptions([2026], 2026)).toEqual([2026]);
  });

  it("sorts numerically rather than lexicographically", () => {
    expect(fiscalYearOptions([2030, 2009, 2100], 2026)).toEqual([
      2100, 2030, 2026, 2009,
    ]);
  });

  it("offers the current year alone when there is no data at all", () => {
    expect(fiscalYearOptions([], 2026)).toEqual([2026]);
  });
});

describe("projectMonthRange", () => {
  it("spans first to last dated cost line inclusive, filling gaps", () => {
    const range = projectMonthRange([
      cost("2026-03-10", "capex", 1),
      cost("2025-12-01", "opex", 1),
    ]);
    expect(range[0]).toEqual({ year: 2025, month: 12 });
    expect(range[range.length - 1]).toEqual({ year: 2026, month: 3 });
    expect(range).toHaveLength(4);
  });

  it("is empty when no cost line carries a date", () => {
    expect(projectMonthRange([cost(null, "capex", 5)])).toEqual([]);
    expect(projectMonthRange([])).toEqual([]);
  });
});

describe("countUndated", () => {
  it("counts only cost lines with no usable date", () => {
    expect(
      countUndated([cost(null, "capex", 1), cost("", "opex", 1), cost("2026-01-01", "capex", 1)]),
    ).toBe(2);
  });
});

describe("budgetTotals", () => {
  const lines = [
    budget(2026, "capex", 100),
    budget(2026, "opex", 40),
    budget(2027, "capex", 7),
    budget(2026, "contingency", 5),
  ];

  it("filters to a single fiscal year", () => {
    expect(budgetTotals(lines, 2026)).toEqual({ capex: 100, opex: 40, total: 145 });
  });

  it("sums every year when asked for all", () => {
    expect(budgetTotals(lines, "all")).toEqual({ capex: 107, opex: 40, total: 152 });
  });

  it("counts an unrecognised category toward the total only", () => {
    expect(budgetTotals([budget(2026, "contingency", 5)], 2026)).toEqual({
      capex: 0,
      opex: 0,
      total: 5,
    });
  });
});

describe("buildCumulativeSeries", () => {
  const months = fiscalYearMonths(2026, 1);

  it("accumulates month over month and stays flat where there is no spend", () => {
    const series = buildCumulativeSeries({
      costLines: [cost("2026-01-15", "capex", 100), cost("2026-03-01", "capex", 50)],
      months,
      today: new Date("2026-12-15T00:00:00Z"),
    });
    expect(series[0].capex).toBe(100);
    // February has no spend: cumulative holds, it does not drop back to zero.
    expect(series[1].capex).toBe(100);
    expect(series[2].capex).toBe(150);
    expect(series[11].capex).toBe(150);
  });

  it("keeps capex and opex in separate running sums", () => {
    const series = buildCumulativeSeries({
      costLines: [cost("2026-01-10", "capex", 100), cost("2026-01-20", "opex", 30)],
      months,
      today: new Date("2026-06-15T00:00:00Z"),
    });
    expect(series[0].capex).toBe(100);
    expect(series[0].opex).toBe(30);
    expect(series[0].total).toBe(130);
  });

  it("counts a non-capex/opex category toward the total only", () => {
    const series = buildCumulativeSeries({
      costLines: [cost("2026-01-10", "contingency", 25)],
      months,
      today: new Date("2026-06-15T00:00:00Z"),
    });
    expect(series[0].capex).toBe(0);
    expect(series[0].opex).toBe(0);
    expect(series[0].total).toBe(25);
  });

  it("stops at the current month within the current fiscal year", () => {
    const series = buildCumulativeSeries({
      costLines: [cost("2026-01-15", "capex", 100)],
      months,
      today: new Date("2026-04-10T00:00:00Z"),
    });
    // Through April the line is drawn...
    expect(series[3].capex).toBe(100);
    // ...and every later month is absent rather than a flat tail to December.
    expect(series[4].capex).toBeNull();
    expect(series[11].total).toBeNull();
  });

  it("draws all twelve months of a completed past year", () => {
    const series = buildCumulativeSeries({
      costLines: [cost("2026-02-01", "capex", 10)],
      months,
      today: new Date("2028-05-01T00:00:00Z"),
    });
    expect(series.every((p) => p.capex !== null)).toBe(true);
    expect(series[11].capex).toBe(10);
  });

  it("draws nothing for a fiscal year entirely in the future", () => {
    const series = buildCumulativeSeries({
      costLines: [],
      months,
      today: new Date("2020-05-01T00:00:00Z"),
    });
    expect(series.every((p) => p.capex === null)).toBe(true);
  });

  it("still plots a future-dated cost line rather than hiding it", () => {
    const series = buildCumulativeSeries({
      costLines: [cost("2026-01-10", "capex", 10), cost("2026-09-01", "capex", 90)],
      months,
      today: new Date("2026-03-01T00:00:00Z"),
    });
    expect(series[8].capex).toBe(100);
    // The line ends at that point, not at December.
    expect(series[9].capex).toBeNull();
  });

  it("excludes undated cost lines from the series", () => {
    const series = buildCumulativeSeries({
      costLines: [cost("2026-01-10", "capex", 10), cost(null, "capex", 999)],
      months,
      today: new Date("2026-12-01T00:00:00Z"),
    });
    expect(series[11].capex).toBe(10);
  });

  it("ignores cost lines outside the month range", () => {
    const series = buildCumulativeSeries({
      costLines: [cost("2024-05-01", "capex", 500), cost("2026-01-10", "capex", 10)],
      months,
      today: new Date("2026-12-01T00:00:00Z"),
    });
    expect(series[11].capex).toBe(10);
  });

  it("returns nothing for an empty month range", () => {
    expect(
      buildCumulativeSeries({ costLines: [], months: [], today: new Date() }),
    ).toEqual([]);
  });
});

describe("cost chart prefs", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("returns defaults with nothing stored", () => {
    expect(loadCostChartPrefs()).toEqual(DEFAULT_COST_CHART_PREFS);
  });

  it("returns defaults on corrupt storage rather than throwing", () => {
    localStorage.setItem(PREFS_KEY, "{not json");
    expect(loadCostChartPrefs()).toEqual(DEFAULT_COST_CHART_PREFS);
  });

  it("round-trips a saved selection", () => {
    saveCostChartPrefs({ fiscalYear: 2024, expanded: false });
    expect(loadCostChartPrefs()).toEqual({ fiscalYear: 2024, expanded: false });
  });

  it("ignores a stale key from an older build", () => {
    // The CapEx/OpEx toggle was removed; prefs written by the previous build
    // still carry `series` and must load rather than throw.
    localStorage.setItem(
      PREFS_KEY,
      JSON.stringify({ series: "opex", fiscalYear: 2024, expanded: false }),
    );
    expect(loadCostChartPrefs()).toEqual({ fiscalYear: 2024, expanded: false });
  });

  it("falls back on a nonsense fiscal year", () => {
    localStorage.setItem(PREFS_KEY, JSON.stringify({ fiscalYear: "last-tuesday" }));
    expect(loadCostChartPrefs().fiscalYear).toBe("current");
  });
});

describe("resolveFiscalYear", () => {
  it("resolves current to the fiscal year containing today", () => {
    expect(resolveFiscalYear("current", [2024, 2026], 2026)).toBe(2026);
  });

  it("passes all through untouched", () => {
    expect(resolveFiscalYear("all", [2024], 2026)).toBe("all");
  });

  it("keeps a stored year that this initiative has data for", () => {
    expect(resolveFiscalYear(2024, [2024, 2026], 2026)).toBe(2024);
  });

  it("falls back to the current year when the stored one has no data here", () => {
    // A preference carried over from another project must self-heal rather
    // than render an empty chart.
    expect(resolveFiscalYear(2019, [2024, 2026], 2026)).toBe(2026);
  });
});
