/**
 * Design tokens other modules build on. Each test reads a fresh load of the
 * module: the tokens are built while the file loads, and the copy every other
 * test imports was loaded outside any test.
 */
import { describe, it, expect, vi, afterEach } from "vitest";

async function freshTokens() {
  vi.resetModules();
  return import("./tokens");
}

afterEach(() => {
  vi.resetModules();
});

describe("compliance finding lifecycle", () => {
  it("runs new → in review → mitigated → verified, with three side branches", async () => {
    const t = await freshTokens();
    expect(t.COMPLIANCE_LIFECYCLE_MAIN_PATH).toEqual(["new", "in_review", "mitigated", "verified"]);
    expect(t.COMPLIANCE_LIFECYCLE_SIDE_BRANCHES).toEqual([
      "risk_tracked",
      "accepted",
      "not_applicable",
    ]);
  });

  it("gives every state on either path a colour, and no state a second place", async () => {
    const t = await freshTokens();
    const states = [...t.COMPLIANCE_LIFECYCLE_MAIN_PATH, ...t.COMPLIANCE_LIFECYCLE_SIDE_BRANCHES];
    expect(new Set(states).size).toBe(states.length);
    expect(states.sort()).toEqual(Object.keys(t.COMPLIANCE_LIFECYCLE_COLORS).sort());
  });
});

describe("colour tokens", () => {
  it("are all hex colours", async () => {
    const t = await freshTokens();
    const groups = {
      STATUS_COLORS: t.STATUS_COLORS,
      SEVERITY_COLORS: t.SEVERITY_COLORS,
      COMPLIANCE_LIFECYCLE_COLORS: t.COMPLIANCE_LIFECYCLE_COLORS,
      CARD_TYPE_COLORS: t.CARD_TYPE_COLORS,
      LAYER_COLORS: t.LAYER_COLORS,
    };
    for (const [name, group] of Object.entries(groups)) {
      for (const [key, value] of Object.entries(group)) {
        expect(value, `${name}.${key}`).toMatch(/^#[0-9a-f]{6}$/i);
      }
    }
    for (const c of t.CATEGORICAL_COLORS) expect(c).toMatch(/^#[0-9a-f]{6}$/i);
  });

  it("name the four EA layers", async () => {
    const t = await freshTokens();
    expect(Object.keys(t.LAYER_COLORS)).toEqual([
      "Strategy & Transformation",
      "Business Architecture",
      "Application & Data",
      "Technical Architecture",
    ]);
  });
});
