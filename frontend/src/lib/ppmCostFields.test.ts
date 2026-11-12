import { describe, expect, it } from "vitest";
import { PPM_ACTUAL_FIELD, PPM_BUDGET_FIELD, PPM_COST_FIELDS, isPpmCostField } from "./ppmCostFields";

describe("ppmCostFields", () => {
  it("names the two Initiative fields the PPM lines feed", () => {
    expect(PPM_BUDGET_FIELD).toBe("costBudget");
    expect(PPM_ACTUAL_FIELD).toBe("costActual");
    expect(PPM_COST_FIELDS).toEqual(["costBudget", "costActual"]);
  });

  it("is true for those fields on an Initiative only", () => {
    expect(isPpmCostField("Initiative", "costBudget")).toBe(true);
    expect(isPpmCostField("Initiative", "costActual")).toBe(true);
    expect(isPpmCostField("Initiative", "costTotalAnnual")).toBe(false);
    expect(isPpmCostField("Application", "costBudget")).toBe(false);
    expect(isPpmCostField("initiative", "costBudget")).toBe(false);
    expect(isPpmCostField(null, "costBudget")).toBe(false);
    expect(isPpmCostField(undefined, "costActual")).toBe(false);
  });
});
