import { describe, it, expect } from "vitest";
import { lifecycleOrderIssues } from "./lifecyclePhases";

describe("lifecycleOrderIssues", () => {
  it("finds nothing for an empty or in-order lifecycle", () => {
    expect(lifecycleOrderIssues(undefined)).toEqual({});
    expect(lifecycleOrderIssues({})).toEqual({});
    expect(
      lifecycleOrderIssues({
        plan: "2024-01-01",
        phaseIn: "2024-06-01",
        active: "2025-01-01",
        phaseOut: "2030-01-01",
        endOfLife: "2031-01-01",
      }),
    ).toEqual({});
  });

  it("accepts equal dates", () => {
    expect(lifecycleOrderIssues({ phaseOut: "2030-01-01", endOfLife: "2030-01-01" })).toEqual({});
  });

  it("flags Phase Out after End of Life", () => {
    expect(lifecycleOrderIssues({ phaseOut: "2031-06-01", endOfLife: "2031-01-01" })).toEqual({
      phaseOut: "endOfLife",
    });
  });

  it("finds a conflict across a blank phase", () => {
    expect(lifecycleOrderIssues({ phaseIn: "2026-01-01", active: "", phaseOut: "2025-01-01" })).toEqual({
      phaseIn: "phaseOut",
    });
  });

  it("reports every out-of-order phase against its first conflicting later phase", () => {
    expect(
      lifecycleOrderIssues({
        plan: "2030-01-01",
        phaseIn: "2029-01-01",
        active: "2028-01-01",
        endOfLife: "2027-01-01",
      }),
    ).toEqual({ plan: "phaseIn", phaseIn: "active", active: "endOfLife" });
  });

  it("ignores values that are not ISO dates and unknown keys", () => {
    expect(
      lifecycleOrderIssues({ phaseOut: "2031-06-01", endOfLife: "soon", other: "2000-01-01" }),
    ).toEqual({});
  });
});
