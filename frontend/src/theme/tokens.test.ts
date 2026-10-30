/**
 * Design tokens other modules build on. Each test reads a fresh load of the
 * module: the tokens are built while the file loads, and the copy every other
 * test imports was loaded outside any test.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, it, expect, vi, afterEach } from "vitest";
import { describeSourceScan } from "@/test/sourceScan";

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
      BPM_ASSESSMENT_COLORS: t.BPM_ASSESSMENT_COLORS,
      BPMN_ELEMENT_COLORS: t.BPMN_ELEMENT_COLORS,
      BPM_PROCESS_TYPE_COLORS: t.BPM_PROCESS_TYPE_COLORS,
      PRINT_COLORS: t.PRINT_COLORS,
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

  it("give each of the five BPM assessment dimensions its own hue", async () => {
    const t = await freshTokens();
    expect(Object.keys(t.BPM_ASSESSMENT_COLORS)).toEqual([
      "overall_score",
      "efficiency",
      "effectiveness",
      "compliance",
      "automation",
    ]);
    const hues = Object.values(t.BPM_ASSESSMENT_COLORS);
    expect(new Set(hues).size).toBe(hues.length);
  });

  it("draw the overall assessment score in the brand blue", async () => {
    const t = await freshTokens();
    expect(t.BPM_ASSESSMENT_COLORS.overall_score).toBe(t.brand.primary);
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

describe("BPM tokens", () => {
  const CSS_COLOUR = /^(#[0-9a-f]{6}|rgba?\([\d.,\s]+\)|hsla?\([\d.,%\s]+\))$/i;

  it("are all valid hex, rgb() or hsl() colours", async () => {
    const t = await freshTokens();
    const singles = {
      BPM_UNSET_COLOR: t.BPM_UNSET_COLOR,
      BPM_CALLED_PROCESS_COLOR: t.BPM_CALLED_PROCESS_COLOR,
      BPM_HIGHLIGHT_FILL: t.BPM_HIGHLIGHT_FILL,
      BPM_MESSAGE_FLOW_COLOR: t.BPM_MESSAGE_FLOW_COLOR,
      BPM_FLOW_ACCENT_COLOR: t.BPM_FLOW_ACCENT_COLOR,
      BPM_AUTOMATED_STEP_TINT: t.BPM_AUTOMATED_STEP_TINT,
      EOL_WARNING_COLOR: t.EOL_WARNING_COLOR,
    };
    for (const [name, value] of Object.entries(singles)) expect(value, name).toMatch(/^#[0-9a-f]{6}$/i);
    expect(t.BPM_LINK_DOT_OUTLINE).toMatch(CSS_COLOUR);
    for (const [key, value] of Object.entries(t.BPMN_DARK_THEME)) {
      expect(key.startsWith("--bio-"), key).toBe(true);
      expect(value, key).toMatch(CSS_COLOUR);
    }
  });

  it("keep the values the BPM screens have always rendered", async () => {
    const t = await freshTokens();
    expect(t.BPMN_ELEMENT_COLORS).toEqual({
      task: "#1976d2",
      service: "#7b1fa2",
      script: "#00695c",
      rule: "#e65100",
      messaging: "#0097a7",
      manual: "#795548",
      subprocess: "#512da8",
      gateway: "#f57c00",
      start: "#2e7d32",
      end: "#c62828",
      data: "#774fcc",
      unknown: "#999999",
    });
    expect(t.BPM_UNSET_COLOR).toBe("#bdbdbd");
    expect(t.BPM_CALLED_PROCESS_COLOR).toBe("#028f00");
    expect(t.BPM_CALLED_PROCESS_COLOR).toBe(t.CARD_TYPE_COLORS.BusinessProcess);
    expect(t.BPM_HIGHLIGHT_FILL).toBe("#e8f5e9");
    expect(t.BPM_FLOW_ACCENT_COLOR).toBe("#7b1fa2");
    expect(t.BPM_AUTOMATED_STEP_TINT).toBe("#7e57c2");
    expect(t.EOL_WARNING_COLOR).toBe("#e65100");
    expect(t.BPM_LINK_DOT_OUTLINE).toBe("rgba(0,0,0,0.25)");
    // Mirrors seed.py PROCESS_TYPE_OPTIONS.
    expect(t.BPM_PROCESS_TYPE_COLORS).toEqual({ core: "#1976d2", support: "#607d8b", management: "#9c27b0" });
    expect(t.PRINT_COLORS).toEqual({
      text: "#333333",
      muted: "#888888",
      rule: "#dddddd",
      panel: "#f5f5f5",
      control: "#cccccc",
      paper: "#ffffff",
      // The document print's own inks, as `DOCUMENT_PRINT_CSS` always drew them.
      heading: "#1a1a2e",
      ink: "#222222",
      subheading: "#444444",
      inkSecondary: "#666666",
      ruleLight: "#e0e0e0",
      panelLight: "#fafafa",
      success: "#2e7d32",
      successLight: "#66bb6a",
      successPale: "#f1f8e9",
      successTint: "#e8f5e9",
      warning: "#ed6c02",
    });
    expect(t.BPMN_DARK_THEME["--bio-surface"]).toBe("#1e1e1e");
    expect(t.BPMN_DARK_THEME["--bio-surface-strong"]).toBe("#333333");
  });

  it("pin the element and process-type hues as literals, not as other tokens' values", async () => {
    const t = await freshTokens();
    // The BPMN icon palette and the seeded process-type colours: their own values, so a
    // brand / severity / RAG / card-type token can be re-tuned without repainting them.
    expect(t.BPMN_ELEMENT_COLORS.task).toBe("#1976d2");
    expect(t.BPMN_ELEMENT_COLORS.rule).toBe("#e65100");
    expect(t.BPMN_ELEMENT_COLORS.gateway).toBe("#f57c00");
    expect(t.BPMN_ELEMENT_COLORS.start).toBe("#2e7d32");
    expect(t.BPM_PROCESS_TYPE_COLORS.core).toBe("#1976d2");
  });

  it("reuse the shared tokens where the hue and the meaning match", async () => {
    const t = await freshTokens();
    // A data-object reference IS a DataObject card.
    expect(t.BPMN_ELEMENT_COLORS.data).toBe(t.CARD_TYPE_COLORS.DataObject);
    expect(t.BPM_MESSAGE_FLOW_COLOR).toBe(t.BPMN_ELEMENT_COLORS.messaging);
    expect(t.BPMN_DARK_THEME["--bio-surface"]).toBe(t.surface.dark.paper);
    expect(t.BPMN_DARK_THEME["--bio-surface-overlay"]).toBe(t.surface.dark.paper);
  });
});

// The static card-type fallbacks stand in for the seeded types wherever the
// metamodel is not loaded, so each must be the colour `seed.py` gives that
// type. `BusinessProcess` drifted to an older palette's orange (#e65100) for
// months before anyone compared the two.
describeSourceScan("card-type fallbacks match the seeded card types", () => {
  const SEED_FILE = path.resolve(__dirname, "../../../backend/app/services/seed.py");

  /** `{ TypeKey: "#rrggbb" }` for every seeded card type, read off `seed.py` as text. */
  function seededTypeColors(): Record<string, string> {
    const text = fs.readFileSync(SEED_FILE, "utf-8");
    const colors: Record<string, string> = {};
    // A card type entry opens with its key and names its colour a few lines on.
    const entry = /"key": "([A-Z]\w+)",\n(?:[^\n]*\n){0,6}?\s*"color": "(#[0-9a-fA-F]{6})"/g;
    for (const m of text.matchAll(entry)) colors[m[1]] = m[2].toLowerCase();
    return colors;
  }

  it("gives every seeded card type the colour the seed gives it", async () => {
    const t = await freshTokens();
    const seeded = seededTypeColors();
    const compared = Object.keys(t.CARD_TYPE_COLORS).filter((key) => key in seeded);
    expect(compared.length).toBeGreaterThanOrEqual(13);
    for (const key of compared) {
      expect({ [key]: t.CARD_TYPE_COLORS[key as keyof typeof t.CARD_TYPE_COLORS] }).toEqual({ [key]: seeded[key] });
    }
  });
});
