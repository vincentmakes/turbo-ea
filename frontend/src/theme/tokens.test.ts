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
      BOOLEAN_COLORS: t.BOOLEAN_COLORS,
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
    // Matches the backend's default for a category created without a colour.
    expect(t.DEFAULT_LAYER_COLOR).toBe("#999999");
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

describe("dashboard chart tokens", () => {
  it("give each mode the same number of fixed-order categorical hues, at most eight", async () => {
    const t = await freshTokens();
    expect(t.CHART_CATEGORICAL.light.length).toBe(t.CHART_CATEGORICAL.dark.length);
    expect(t.CHART_CATEGORICAL.light.length).toBeLessThanOrEqual(8);
    for (const mode of ["light", "dark"] as const) {
      const hues = t.CHART_CATEGORICAL[mode];
      expect(new Set(hues).size).toBe(hues.length);
      for (const c of [...hues, ...t.CHART_SEQUENTIAL[mode]]) expect(c, mode).toMatch(/^#[0-9a-f]{6}$/i);
      expect(t.CHART_SEQUENTIAL[mode]).toHaveLength(2);
    }
  });

  it("run the heatmap ramp up to the brand blue in each mode", async () => {
    const t = await freshTokens();
    expect(t.CHART_SEQUENTIAL.light[1]).toBe(t.brand.primary);
    expect(t.CHART_SEQUENTIAL.dark[1]).toBe(t.brand.primaryLight);
    // The low end is a paler step of the same blue in light mode, a deeper one in dark mode.
    expect(t.CHART_SEQUENTIAL.light[0]).not.toBe(t.CHART_SEQUENTIAL.light[1]);
    expect(t.CHART_SEQUENTIAL.dark[0]).not.toBe(t.CHART_SEQUENTIAL.dark[1]);
  });

  it("keep status hues out of the categorical palette", async () => {
    const t = await freshTokens();
    const status = new Set<string>(Object.values(t.STATUS_COLORS));
    for (const c of [...t.CHART_CATEGORICAL.light, ...t.CHART_CATEGORICAL.dark]) expect(status.has(c)).toBe(false);
  });

  it("keep the Cost report's ten-blue treemap ramp and the white label on its tiles", async () => {
    const t = await freshTokens();
    expect(t.COST_TREEMAP_COLORS).toEqual([
      "#1565c0",
      "#1976d2",
      "#1e88e5",
      "#2196f3",
      "#42a5f5",
      "#64b5f6",
      "#90caf9",
      "#bbdefb",
      "#0d47a1",
      "#1565c0",
    ]);
    expect(t.CHART_LABEL_ON_DARK).toBe("#ffffff");
    expect(t.CHART_LABEL_ON_DARK_MUTED).toBe("rgba(255,255,255,0.8)");
  });

  it("name every homepage KPI accent as a hex colour", async () => {
    const t = await freshTokens();
    for (const [key, value] of Object.entries(t.DASHBOARD_KPI_COLORS)) {
      expect(value, key).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });
});
