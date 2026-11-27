import { describe, expect, it } from "vitest";
import { axisPct, axisTicks, fitAxis, MIN_SEGMENT_PCT, phaseSegments } from "./lifecycleBar";

const D = (s: string) => Date.parse(s);
/** A 100-day axis starting 2030-01-01, so a day is exactly 1%. */
const AXIS = { min: D("2030-01-01"), range: 100 * 86400000 };
/** The UTC calendar day `n` days into the axis, as a stored date. */
const day = (n: number) => {
  const d = new Date(AXIS.min + n * 86400000);
  const pad = (v: number) => String(v).padStart(2, "0");
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
};

describe("axisPct", () => {
  it("is the share of the axis elapsed, outside 0–100 too", () => {
    expect(axisPct(AXIS.min, AXIS)).toBe(0);
    expect(axisPct(AXIS.min + AXIS.range, AXIS)).toBe(100);
    expect(axisPct(D(day(25)), AXIS)).toBeCloseTo(25, 9);
    expect(axisPct(D(day(-10)), AXIS)).toBeCloseTo(-10, 9);
  });
});

describe("phaseSegments", () => {
  it("runs each dated phase to the next DATED one, skipping a blank phase", () => {
    const { segments, eolPct } = phaseSegments(
      { plan: day(10), active: day(30), phaseOut: day(60), endOfLife: day(80) },
      AXIS,
    );
    expect(segments.map((s) => s.phase)).toEqual(["plan", "active", "phaseOut"]);
    expect(segments[0].left).toBeCloseTo(10, 9);
    expect(segments[0].width).toBeCloseTo(20, 9);
    expect(segments[1].left).toBeCloseTo(30, 9);
    expect(segments[1].width).toBeCloseTo(30, 9);
    expect(segments[2].left).toBeCloseTo(60, 9);
    expect(segments[2].width).toBeCloseTo(20, 9);
    expect(eolPct).toBeCloseTo(80, 9);
  });

  it("runs the last phase to the end of the axis and has no pin without End of Life", () => {
    const { segments, eolPct } = phaseSegments({ active: day(40) }, AXIS);
    expect(segments).toHaveLength(1);
    expect(segments[0].left).toBeCloseTo(40, 9);
    expect(segments[0].width).toBeCloseTo(60, 9);
    expect(eolPct).toBeNull();
  });

  it("keeps a sliver for a zero-length phase", () => {
    const { segments } = phaseSegments({ phaseIn: day(20), active: day(20) }, AXIS);
    expect(segments[0]).toEqual({ phase: "phaseIn", left: expect.any(Number), width: MIN_SEGMENT_PCT });
    expect(MIN_SEGMENT_PCT).toBe(0.5);
    // A phase just longer than the sliver keeps its own width.
    const wider = phaseSegments({ phaseIn: day(20), active: day(21) }, AXIS);
    expect(wider.segments[0].width).toBeCloseTo(1, 9);
  });

  it("draws only a pin for a lifecycle with End of Life alone", () => {
    expect(phaseSegments({ endOfLife: day(5) }, AXIS)).toEqual({
      segments: [],
      eolPct: expect.closeTo(5, 9),
    });
  });

  it("ignores empty, unparsable and missing values", () => {
    expect(phaseSegments({ plan: "", active: "not a date" }, AXIS)).toEqual({
      segments: [],
      eolPct: null,
    });
    expect(phaseSegments(undefined, AXIS)).toEqual({ segments: [], eolPct: null });
    // An unparsable later phase does not end the one before it.
    const { segments } = phaseSegments({ active: day(50), phaseOut: "x" }, AXIS);
    expect(segments[0].width).toBeCloseTo(50, 9);
  });
});

describe("fitAxis", () => {
  const TODAY = D("2026-07-01");

  it("is the whole year of today when nothing is dated", () => {
    expect(fitAxis([], TODAY)).toEqual({
      min: D("2026-01-01"),
      range: D("2027-01-01") - D("2026-01-01"),
    });
    expect(fitAxis([undefined, {}], TODAY)).toEqual(fitAxis([], TODAY));
  });

  it("widens to whole years around every date and today", () => {
    const a = fitAxis(
      [{ plan: "2024-03-15", endOfLife: "2029-02-01" }, { active: "2025-05-05", phaseOut: "bad" }],
      TODAY,
    );
    expect(a.min).toBe(D("2024-01-01"));
    expect(a.min + a.range).toBe(D("2030-01-01"));
  });

  it("reaches back or forward to today when every date lies on one side", () => {
    const past = fitAxis([{ active: "2020-06-01" }], TODAY);
    expect(past.min).toBe(D("2020-01-01"));
    expect(past.min + past.range).toBe(D("2027-01-01"));
    const future = fitAxis([{ plan: "2031-06-01" }], TODAY);
    expect(future.min).toBe(D("2026-01-01"));
    expect(future.min + future.range).toBe(D("2032-01-01"));
  });

  it("puts a date on 1 January inside, not at the edge of a year it does not need", () => {
    const a = fitAxis([{ active: "2026-01-01" }], TODAY);
    expect(a.min).toBe(D("2026-01-01"));
    expect(a.min + a.range).toBe(D("2027-01-01"));
  });
});

describe("axisTicks", () => {
  const span = (from: string, to: string) => ({ min: D(from), range: D(to) - D(from) });

  it("ticks every 1 January inside the axis, both ends included", () => {
    const ticks = axisTicks(span("2024-01-01", "2027-01-01"), 10);
    expect(ticks.map((t) => t.label)).toEqual(["2024", "2025", "2026", "2027"]);
    expect(ticks[0].pct).toBe(0);
    expect(ticks[3].pct).toBe(100);
    expect(ticks[1].pct).toBeCloseTo(
      ((D("2025-01-01") - D("2024-01-01")) / (D("2027-01-01") - D("2024-01-01"))) * 100,
      9,
    );
  });

  it("leaves out a 1 January before the axis starts", () => {
    expect(axisTicks(span("2024-06-01", "2026-03-01"), 10).map((t) => t.label)).toEqual([
      "2025",
      "2026",
    ]);
  });

  it("thins to at most maxTicks, counting from the first year", () => {
    const axis = span("2020-01-01", "2030-01-01"); // 11 years
    expect(axisTicks(axis, 4).map((t) => t.label)).toEqual(["2020", "2023", "2026", "2029"]);
    expect(axisTicks(axis, 6).map((t) => t.label)).toEqual(["2020", "2022", "2024", "2026", "2028", "2030"]);
    expect(axisTicks(axis, 11)).toHaveLength(11);
    // A budget under one still draws one tick, never none.
    expect(axisTicks(span("2024-01-01", "2025-01-01"), 0).map((t) => t.label)).toEqual(["2024"]);
  });
});
