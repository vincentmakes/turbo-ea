import { describe, expect, it } from "vitest";

import {
  MAX_STALENESS_BY_UNIT,
  matchStalenessPreset,
  parseStalenessWindow,
  stalenessCutoffDate,
} from "./staleness";

/** 25 Aug 2026, 14:30 UTC — the same instant the backend unit tests pin. */
const NOW = new Date(Date.UTC(2026, 7, 25, 14, 30));

const ymd = (d: Date) => [d.getFullYear(), d.getMonth() + 1, d.getDate()];

describe("stalenessCutoffDate — days", () => {
  it("subtracts whole days", () => {
    expect(ymd(stalenessCutoffDate({ value: 30, unit: "days" }, NOW))).toEqual([2026, 7, 26]);
  });

  it("crosses a month boundary", () => {
    expect(ymd(stalenessCutoffDate({ value: 90, unit: "days" }, NOW))).toEqual([2026, 5, 27]);
  });
});

describe("stalenessCutoffDate — months are calendar months", () => {
  it("lands on the same day of month", () => {
    expect(ymd(stalenessCutoffDate({ value: 6, unit: "months" }, NOW))).toEqual([2026, 2, 25]);
  });

  it("crosses a year boundary", () => {
    expect(ymd(stalenessCutoffDate({ value: 12, unit: "months" }, NOW))).toEqual([2025, 8, 25]);
  });

  it("clamps the day into a shorter target month", () => {
    const now = new Date(Date.UTC(2026, 2, 31, 9, 0)); // 31 Mar 2026
    expect(ymd(stalenessCutoffDate({ value: 1, unit: "months" }, now))).toEqual([2026, 2, 28]);
  });

  it("clamps into a leap February", () => {
    const now = new Date(Date.UTC(2028, 2, 31, 9, 0)); // 31 Mar 2028
    expect(ymd(stalenessCutoffDate({ value: 1, unit: "months" }, now))).toEqual([2028, 2, 29]);
  });

  it("is not a 30-day approximation", () => {
    const asMonths = stalenessCutoffDate({ value: 1, unit: "months" }, NOW);
    const asDays = stalenessCutoffDate({ value: 30, unit: "days" }, NOW);
    expect(ymd(asMonths)).not.toEqual(ymd(asDays));
  });

  it("reads the UTC calendar day, not the local one", () => {
    // 23:30 UTC — a viewer in UTC+13 is already on the 26th locally, but the
    // server will subtract from the 25th, and the caption must say so.
    const lateUtc = new Date(Date.UTC(2026, 7, 25, 23, 30));
    expect(ymd(stalenessCutoffDate({ value: 6, unit: "months" }, lateUtc))).toEqual([2026, 2, 25]);
  });
});

describe("parseStalenessWindow", () => {
  it("accepts a well-formed window", () => {
    expect(parseStalenessWindow({ value: 90, unit: "days" })).toEqual({ value: 90, unit: "days" });
  });

  it("accepts a value exactly at the per-unit cap", () => {
    expect(parseStalenessWindow({ value: MAX_STALENESS_BY_UNIT.months, unit: "months" })).not.toBeNull();
  });

  it.each([
    ["null", null],
    ["undefined", undefined],
    ["a string", "6 months"],
    ["an array", []],
    ["an empty object", {}],
    ["a missing unit", { value: 6 }],
    ["a missing value", { unit: "months" }],
    ["zero", { value: 0, unit: "days" }],
    ["a negative value", { value: -5, unit: "days" }],
    ["a fractional value", { value: 90.5, unit: "days" }],
    ["a numeric string", { value: "90", unit: "days" }],
    ["a boolean", { value: true, unit: "days" }],
    ["an unknown unit", { value: 6, unit: "weeks" }],
    ["an over-cap value", { value: 10_000, unit: "days" }],
  ])("rejects %s", (_label, raw) => {
    expect(parseStalenessWindow(raw)).toBeNull();
  });
});

describe("matchStalenessPreset", () => {
  it("maps null to Any", () => {
    expect(matchStalenessPreset(null)).toBe("any");
  });

  it("recognises each preset", () => {
    expect(matchStalenessPreset({ value: 30, unit: "days" })).toBe("d30");
    expect(matchStalenessPreset({ value: 90, unit: "days" })).toBe("d90");
    expect(matchStalenessPreset({ value: 6, unit: "months" })).toBe("m6");
    expect(matchStalenessPreset({ value: 12, unit: "months" })).toBe("m12");
  });

  it("falls back to custom for an off-preset window", () => {
    expect(matchStalenessPreset({ value: 45, unit: "days" })).toBe("custom");
    // Same duration, different unit — still custom, because the picker must
    // restore the unit the admin actually chose.
    expect(matchStalenessPreset({ value: 1, unit: "months" })).toBe("custom");
  });
});
