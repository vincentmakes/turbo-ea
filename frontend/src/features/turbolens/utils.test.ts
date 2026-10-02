import { describe, it, expect } from "vitest";

import i18n from "@/i18n";
import {
  ARCHITECT_STEPS,
  TYPE_COLORS,
  approachColor,
  complianceDecisionColor,
  complianceStatusColor,
  effortColor,
  formatCost,
  phaseToStepIndex,
  priorityColor,
  severityChipColor,
  severityColor,
  severityIcon,
  statusColor,
  typeChipColor,
  urgencyColor,
  vendorTypeColor,
} from "./utils";

describe("formatCost", () => {
  it.each([
    [0, "0"],
    [1, "1"],
    [999, "999"],
    // Below the K threshold the value is rounded to a whole number.
    [999.4, "999"],
    [1_000, "1K"],
    [1_499, "1K"],
    [1_500, "2K"],
    [12_345, "12K"],
    [1_000_000, "1.0M"],
    [1_050_000, "1.1M"],
    [2_500_000, "2.5M"],
    // No higher unit: billions stay in millions.
    [1_250_000_000, "1250.0M"],
  ])("formats %s as %s", (value, expected) => {
    expect(formatCost(value)).toBe(expected);
  });

  it("rounds 999,999 into the K band rather than promoting it to M (current behaviour)", () => {
    // The thresholds compare the raw value, so anything just under a million
    // still renders in K — as "1000K", not "1.0M".
    expect(formatCost(999_999)).toBe("1000K");
    expect(formatCost(999_500)).toBe("1000K");
  });

  it("rounds a value just under 1,000 to a whole number, which reads as 1000", () => {
    // Same edge one band down: 999.6 is below the K threshold, so it is not
    // scaled, and toFixed(0) carries it to "1000".
    expect(formatCost(999.6)).toBe("1000");
  });

  it("never scales a negative value (current behaviour)", () => {
    // The thresholds are `>=` comparisons, so a negative cost is printed raw.
    expect(formatCost(-5)).toBe("-5");
    expect(formatCost(-2_000)).toBe("-2000");
    expect(formatCost(-3_000_000)).toBe("-3000000");
  });

  it("passes NaN through as the string NaN (current behaviour)", () => {
    expect(formatCost(Number.NaN)).toBe("NaN");
  });
});

describe("chip colour mappers", () => {
  it.each([
    ["confirmed", "success"],
    ["dismissed", "default"],
    ["investigating", "warning"],
    ["pending", "info"],
    ["open", "info"],
    ["resolved", "success"],
    ["completed", "success"],
    ["failed", "error"],
    ["running", "warning"],
    ["anything-else", "default"],
    ["", "default"],
  ])("statusColor(%s) → %s", (status, expected) => {
    expect(statusColor(status)).toBe(expected);
  });

  it.each([
    ["critical", "error"],
    ["high", "error"],
    ["medium", "warning"],
    ["low", "info"],
    ["none", "default"],
  ])("priorityColor(%s) → %s", (priority, expected) => {
    expect(priorityColor(priority)).toBe(expected);
  });

  it.each([
    ["high", "error"],
    ["medium", "warning"],
    ["low", "success"],
    ["unknown", "default"],
  ])("effortColor(%s) → %s", (effort, expected) => {
    expect(effortColor(effort)).toBe(expected);
  });

  it.each([
    ["vendor", "primary"],
    ["product", "secondary"],
    ["platform", "info"],
    ["module", "warning"],
    ["unknown", "default"],
    ["service", "default"],
  ])("vendorTypeColor(%s) → %s", (vendorType, expected) => {
    expect(vendorTypeColor(vendorType)).toBe(expected);
  });

  it.each([
    ["buy", "info"],
    ["build", "primary"],
    ["extend", "warning"],
    ["reuse", "success"],
    ["hybrid", "default"],
  ])("approachColor(%s) → %s", (approach, expected) => {
    expect(approachColor(approach)).toBe(expected);
  });

  it("is case-sensitive: an upper-cased key is not recognised", () => {
    expect(statusColor("Confirmed")).toBe("default");
    expect(priorityColor("HIGH")).toBe("default");
    expect(approachColor("Buy")).toBe("default");
  });
});

describe("architecture result helpers", () => {
  it("exposes one hex colour per result type", () => {
    expect(Object.keys(TYPE_COLORS).sort()).toEqual(["existing", "new", "recommended"]);
    for (const hex of Object.values(TYPE_COLORS)) expect(hex).toMatch(/^#[0-9a-f]{6}$/);
  });

  it.each([
    ["existing", "success"],
    ["new", "primary"],
    ["recommended", "warning"],
    // Anything unrecognised falls into the "recommended" bucket.
    ["", "warning"],
    ["retired", "warning"],
  ])("typeChipColor(%s) → %s", (tp, expected) => {
    expect(typeChipColor(tp)).toBe(expected);
  });

  it.each([
    ["critical", "error"],
    ["high", "warning"],
    ["medium", "default"],
    ["low", "default"],
    [undefined, "default"],
  ])("urgencyColor(%s) → %s", (urgency, expected) => {
    expect(urgencyColor(urgency)).toBe(expected);
  });

  it.each([
    ["high", "error", "#d32f2f"],
    ["medium", "warning", "#ed6c02"],
    ["low", "check_circle", "#2e7d32"],
    [undefined, "check_circle", "#2e7d32"],
    ["critical", "check_circle", "#2e7d32"],
  ])("severity %s renders icon %s in colour %s", (severity, icon, colour) => {
    // Icon and colour are two views of the same three-way split, so a severity
    // can never pair the error glyph with the success tone.
    expect(severityIcon(severity)).toBe(icon);
    expect(severityColor(severity)).toBe(colour);
  });
});

describe("ARCHITECT_STEPS", () => {
  it("lists the seven wizard steps in order, each owning one phase", () => {
    expect(ARCHITECT_STEPS.map((s) => s.key)).toEqual([
      "requirements",
      "business_fit",
      "technical_fit",
      "solution_options",
      "product_selection",
      "dependencies",
      "target",
    ]);
    expect(ARCHITECT_STEPS.map((s) => s.phases)).toEqual([[0], [1], [2], [3], [3.5], [4], [5]]);
  });

  it("owns every phase exactly once", () => {
    const phases = ARCHITECT_STEPS.flatMap((s) => [...s.phases]);
    expect(new Set(phases).size).toBe(phases.length);
  });

  it("has a stepper label for every step key", () => {
    // The wizard renders `t(`turbolens_architect_step_${key}`)` from the admin
    // namespace; a step without a label would show its raw key.
    for (const step of ARCHITECT_STEPS) {
      const key = `turbolens_architect_step_${step.key}`;
      expect(i18n.exists(key, { ns: "admin" })).toBe(true);
      expect(i18n.t(key, { ns: "admin" })).not.toBe(key);
    }
  });

  it.each([
    [0, 0],
    [1, 1],
    [2, 2],
    [3, 3],
    [3.5, 4],
    [4, 5],
    [5, 6],
  ])("phaseToStepIndex(%s) → %s", (phase, index) => {
    expect(phaseToStepIndex(phase)).toBe(index);
    // Round-trips: the step at that index owns the phase.
    expect(ARCHITECT_STEPS[index].phases).toContain(phase);
  });

  it("falls back to the first step for a phase no step owns", () => {
    expect(phaseToStepIndex(-1)).toBe(0);
    expect(phaseToStepIndex(6)).toBe(0);
    expect(phaseToStepIndex(4.5)).toBe(0);
    expect(phaseToStepIndex(Number.NaN)).toBe(0);
  });
});

describe("compliance colour helpers", () => {
  it.each([
    ["critical", "error"],
    ["high", "error"],
    ["medium", "warning"],
    ["low", "info"],
    ["info", "info"],
    ["unknown", "default"],
    ["", "default"],
  ])("severityChipColor(%s) → %s", (severity, expected) => {
    expect(severityChipColor(severity)).toBe(expected);
  });

  it.each([
    ["compliant", "success"],
    ["partial", "warning"],
    ["non_compliant", "error"],
    ["not_applicable", "default"],
    ["review_needed", "info"],
    ["pending", "default"],
  ])("complianceStatusColor(%s) → %s", (status, expected) => {
    expect(complianceStatusColor(status)).toBe(expected);
  });

  it.each([
    ["new", "info"],
    ["in_review", "warning"],
    ["mitigated", "primary"],
    ["verified", "success"],
    ["risk_tracked", "error"],
    ["accepted", "success"],
    ["not_applicable", "default"],
    ["closed", "default"],
  ])("complianceDecisionColor(%s) → %s", (decision, expected) => {
    expect(complianceDecisionColor(decision)).toBe(expected);
  });
});
