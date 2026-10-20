import { describe, it, expect } from "vitest";
import {
  fmtQuarter,
  fmtMonthYear,
  fmtK,
  magnitude,
  costPair,
  compactAmount,
  getQuarters,
} from "./ppmPortfolioFormat";

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

describe("magnitude", () => {
  it("reads a figure in millions, thousands or as it is, sign ignored", () => {
    expect(magnitude(0)).toBe("");
    expect(magnitude(999)).toBe("");
    expect(magnitude(1_000)).toBe("k");
    expect(magnitude(999_999)).toBe("k");
    expect(magnitude(1_000_000)).toBe("M");
    expect(magnitude(-2_000_000)).toBe("M");
  });
});

describe("fmtK", () => {
  it("renders the digits of a figure in the scale it is given", () => {
    expect(fmtK(0, "")).toBe("0");
    expect(fmtK(12.4, "")).toBe("12");
    expect(fmtK(1_000, "k")).toBe("1");
    expect(fmtK(578_000, "k")).toBe("578");
    expect(fmtK(1_500_000, "M")).toBe("1.5");
    expect(fmtK(-2_000_000, "M")).toBe("-2.0");
  });

  it("keeps a smaller figure in the shared scale rather than its own", () => {
    expect(fmtK(773_000, "M")).toBe("0.8");
    expect(fmtK(250, "k")).toBe("0");
  });
});

describe("costPair", () => {
  it("keeps the bare currency for small figures", () => {
    expect(costPair(250, 500, "EUR")).toEqual({ actualText: "250", plannedText: "500", unit: "EUR" });
    expect(costPair(0, 0, "EUR")).toEqual({ actualText: "0", plannedText: "0", unit: "EUR" });
  });

  it("switches both figures to thousands once either side reaches a thousand", () => {
    expect(costPair(578, 1_350, "CHF")).toEqual({ actualText: "1", plannedText: "1", unit: "kCHF" });
    expect(costPair(2_000, 500, "CHF")).toEqual({ actualText: "2", plannedText: "1", unit: "kCHF" });
  });

  it("reads both figures in millions, with one unit, once either side reaches a million", () => {
    // The board used to render these as "1.5M/2.1M kCHF" and "773/1.4M kCHF".
    expect(costPair(1_500_000, 2_100_000, "CHF")).toEqual({
      actualText: "1.5",
      plannedText: "2.1",
      unit: "MCHF",
    });
    expect(costPair(773_000, 1_400_000, "CHF")).toEqual({
      actualText: "0.8",
      plannedText: "1.4",
      unit: "MCHF",
    });
  });

  it("takes the scale from the larger magnitude whichever side it is on", () => {
    expect(costPair(3_000_000, 400, "USD").unit).toBe("MUSD");
    expect(costPair(-3_000_000, 400, "USD").unit).toBe("MUSD");
  });
});

describe("compactAmount", () => {
  const exact = (v: number) => `CHF ${v}`;

  it("leaves a figure below a thousand to the exact formatter", () => {
    expect(compactAmount(0, "CHF", exact)).toBe("CHF 0");
    expect(compactAmount(999, "CHF", exact)).toBe("CHF 999");
    expect(compactAmount(-999, "CHF", exact)).toBe("CHF -999");
  });

  it("renders thousands with one decimal in the k unit", () => {
    expect(compactAmount(1_000, "CHF", exact)).toBe("1 kCHF");
    expect(compactAmount(1_170, "USD", exact)).toBe("1.2 kUSD");
    expect(compactAmount(-3_600, "USD", exact)).toBe("-3.6 kUSD");
    expect(compactAmount(999_949, "CHF", exact)).toBe("999.9 kCHF");
  });

  it("renders millions with one decimal in the M unit", () => {
    expect(compactAmount(1_000_000, "CHF", exact)).toBe("1 MCHF");
    expect(compactAmount(5_710_000, "CHF", exact)).toBe("5.7 MCHF");
    expect(compactAmount(-2_050_000, "EUR", exact)).toBe("-2.1 MEUR");
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
