import { describe, it, expect } from "vitest";
import { classifyTimelineChange, computeTimelineRange } from "./timelineRange";

const ms = (iso: string) => new Date(iso).getTime();
const YEAR = 365.25 * 86_400_000;
const TODAY = ms("2026-06-15");

describe("computeTimelineRange", () => {
  it("reports no lifecycle data for an empty list", () => {
    const r = computeTimelineRange([], TODAY);
    expect(r.hasLifecycleData).toBe(false);
    expect(r.yearMarks).toEqual([]);
    expect(r.dateRange.min).toBe(TODAY - 3 * YEAR);
    expect(r.dateRange.max).toBe(TODAY + 3 * YEAR);
  });

  it("ignores undefined lifecycles and empty maps", () => {
    expect(computeTimelineRange([undefined, {}], TODAY).hasLifecycleData).toBe(false);
  });

  it("pads the observed span by a year on each side", () => {
    const r = computeTimelineRange(
      [{ active: "2020-01-01" }, { endOfLife: "2030-01-01" }],
      TODAY,
    );
    expect(r.hasLifecycleData).toBe(true);
    expect(r.dateRange.min).toBe(ms("2020-01-01") - YEAR);
    expect(r.dateRange.max).toBe(ms("2030-01-01") + YEAR);
  });

  it("emits one mark per January 1 inside the padded range", () => {
    const r = computeTimelineRange([{ active: "2024-06-01" }, { endOfLife: "2026-06-01" }], TODAY);
    expect(r.yearMarks.map((m) => m.label)).toEqual(["2024", "2025", "2026", "2027"]);
  });

  it("spans every phase key, not just active", () => {
    const r = computeTimelineRange([{ plan: "2019-03-01", phaseOut: "2028-09-01" }], TODAY);
    expect(r.dateRange.min).toBe(ms("2019-03-01") - YEAR);
    expect(r.dateRange.max).toBe(ms("2028-09-01") + YEAR);
  });

  it("skips unparseable dates", () => {
    expect(computeTimelineRange([{ active: "not-a-date" }], TODAY).hasLifecycleData).toBe(false);
  });
});

describe("classifyTimelineChange", () => {
  const future = ms("2028-01-01");

  it("flags a card that starts after today but before the target date", () => {
    expect(classifyTimelineChange({ plan: "2027-01-01" }, TODAY, future)).toBe("arriving");
  });

  it("flags a card that retires before the target date", () => {
    expect(
      classifyTimelineChange({ active: "2020-01-01", endOfLife: "2027-01-01" }, TODAY, future),
    ).toBe("retiring");
  });

  it("returns null for a card that is unchanged across the window", () => {
    expect(classifyTimelineChange({ active: "2020-01-01" }, TODAY, future)).toBeNull();
  });

  it("returns null for a card with no lifecycle dates", () => {
    expect(classifyTimelineChange(undefined, TODAY, future)).toBeNull();
    expect(classifyTimelineChange({}, TODAY, future)).toBeNull();
  });

  it("returns null for a card absent at both ends of the window", () => {
    // Retired long ago — gone today, still gone later. Nothing changes.
    expect(
      classifyTimelineChange({ active: "2010-01-01", endOfLife: "2015-01-01" }, TODAY, future),
    ).toBeNull();
    // Planned beyond the target date — not here today, not here then either.
    expect(classifyTimelineChange({ plan: "2035-01-01" }, TODAY, future)).toBeNull();
  });

  it("classifies nothing when travelling to the past or to today", () => {
    const past = ms("2020-01-01");
    expect(classifyTimelineChange({ plan: "2027-01-01" }, TODAY, past)).toBeNull();
    expect(classifyTimelineChange({ endOfLife: "2019-01-01" }, TODAY, past)).toBeNull();
    expect(classifyTimelineChange({ plan: "2027-01-01" }, TODAY, TODAY)).toBeNull();
  });

  it("ignores a card that both arrives and retires inside the window", () => {
    // Absent at both ends of the window, so neither badge would be true at the
    // date being shown — it is simply not in that landscape.
    expect(
      classifyTimelineChange({ plan: "2027-01-01", endOfLife: "2027-06-01" }, TODAY, future),
    ).toBeNull();
  });
});
