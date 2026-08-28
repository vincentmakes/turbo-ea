import { describe, it, expect } from "vitest";
import { fmtQuarter, fmtMonthYear, fmtK, costUnit, getQuarters } from "./ppmPortfolioFormat";

describe("fmtQuarter", () => {
  it("maps each month to its calendar quarter", () => {
    expect(fmtQuarter("2026-01-15")).toBe("Q1'26");
    expect(fmtQuarter("2026-03-31")).toBe("Q1'26");
    expect(fmtQuarter("2026-04-01")).toBe("Q2'26");
    expect(fmtQuarter("2026-12-31")).toBe("Q4'26");
  });

  it("renders an em-dash for a missing or unparseable date", () => {
    expect(fmtQuarter(null)).toBe("—");
    expect(fmtQuarter("")).toBe("—");
  });

  it("parses date-only strings locally, not as UTC (#1016)", () => {
    // Parsed as UTC and rendered locally, a Jan 1 date slips into Q4 of the
    // previous year for anyone west of Greenwich.
    expect(fmtQuarter("2026-01-01")).toBe("Q1'26");
  });
});

describe("fmtMonthYear", () => {
  it("formats as short-month and two-digit year", () => {
    expect(fmtMonthYear("2026-02-01")).toBe("Feb-26");
    expect(fmtMonthYear("2025-11-30")).toBe("Nov-25");
  });

  it("renders an em-dash for an unparseable date", () => {
    expect(fmtMonthYear("")).toBe("—");
  });
});

describe("fmtK", () => {
  it("leaves values below a thousand alone", () => {
    expect(fmtK(0)).toBe("0");
    expect(fmtK(999)).toBe("999");
    expect(fmtK(12.4)).toBe("12");
  });

  it("renders thousands as a rounded count of thousands", () => {
    expect(fmtK(1_000)).toBe("1");
    expect(fmtK(578_000)).toBe("578");
  });

  it("renders millions with one decimal", () => {
    expect(fmtK(1_500_000)).toBe("1.5M");
    expect(fmtK(-2_000_000)).toBe("-2.0M");
  });
});

describe("costUnit", () => {
  it("switches to the thousands unit once either side reaches a thousand", () => {
    expect(costUnit(1_350, 578, "CHF")).toBe("kCHF");
    expect(costUnit(500, 2_000, "CHF")).toBe("kCHF");
  });

  it("keeps the bare currency for small figures", () => {
    expect(costUnit(500, 250, "EUR")).toBe("EUR");
    expect(costUnit(0, 0, "EUR")).toBe("EUR");
  });
});

describe("getQuarters", () => {
  it("emits one entry per distinct quarter, in order and without duplicates", () => {
    const labels = getQuarters(new Date(2026, 0, 1), 12).map((q) => q.label);
    expect(labels.slice(0, 4)).toEqual(["Q1'26", "Q2'26", "Q3'26", "Q4'26"]);
    expect(new Set(labels).size).toBe(labels.length);
  });

  it("spans the year boundary", () => {
    const labels = getQuarters(new Date(2025, 9, 1), 6).map((q) => q.label);
    expect(labels[0]).toBe("Q4'25");
    expect(labels).toContain("Q1'26");
  });

  it("covers the board's 20-quarter window", () => {
    // The board asks for 20 months of quarters starting six months back; the
    // count is what the sticky header lays its columns out against.
    const labels = getQuarters(new Date(2026, 0, 1), 20).map((q) => q.label);
    expect(labels[0]).toBe("Q1'26");
    expect(labels.length).toBeGreaterThanOrEqual(7);
  });

  it("gives each quarter its true first and last day", () => {
    const [q1] = getQuarters(new Date(2026, 0, 1), 3);
    expect(q1.start.getMonth()).toBe(0);
    expect(q1.start.getDate()).toBe(1);
    expect(q1.end.getMonth()).toBe(2);
    expect(q1.end.getDate()).toBe(31);
  });
});
