/**
 * Design tokens other modules build on. Each test reads a fresh load of the
 * module: the tokens are built while the file loads, and the copy every other
 * test imports was loaded outside any test.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, it, expect, vi, afterEach } from "vitest";
import { describeSourceScan } from "@/test/sourceScan";
import { PHASES } from "@/lib/lifecyclePhases";

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
      LIFECYCLE_PHASE_COLORS: t.LIFECYCLE_PHASE_COLORS,
      FIELD_TYPE_COLORS: t.FIELD_TYPE_COLORS,
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

  it("keep the white label on the Cost report's tiles", async () => {
    const t = await freshTokens();
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

const HEX = /^#[0-9a-f]{6}$/i;

describe("lifecycle phase colours", () => {
  it("colour every lifecycle phase, and only those, in phase order", async () => {
    const t = await freshTokens();
    expect(Object.keys(t.LIFECYCLE_PHASE_COLORS)).toEqual([...PHASES]);
  });

  it("are the card detail set, with end of life in red 700", async () => {
    const t = await freshTokens();
    expect(t.LIFECYCLE_PHASE_COLORS).toEqual({
      plan: "#9e9e9e",
      phaseIn: "#1976d2",
      active: "#2e7d32",
      phaseOut: "#ed6c02",
      endOfLife: "#d32f2f",
    });
    const hues = Object.values(t.LIFECYCLE_PHASE_COLORS);
    expect(new Set(hues).size).toBe(hues.length);
  });
});

describe("admin picker presets", () => {
  it("offer twelve distinct role colours, starting at the brand blue", async () => {
    const t = await freshTokens();
    expect(t.ROLE_COLOR_PRESETS).toEqual([
      "#1976d2",
      "#388e3c",
      "#d32f2f",
      "#f57c00",
      "#7b1fa2",
      "#0097a7",
      "#c2185b",
      "#5d4037",
      "#455a64",
      "#303f9f",
      "#00796b",
      "#afb42b",
    ]);
    expect(new Set(t.ROLE_COLOR_PRESETS).size).toBe(12);
    for (const c of t.ROLE_COLOR_PRESETS) expect(c).toMatch(HEX);
  });

  it("give each built-in field type but multiline text its own chip hue, and a grey for the rest", async () => {
    const t = await freshTokens();
    expect(t.FIELD_TYPE_COLORS).toEqual({
      text: "#1976d2",
      number: "#7b1fa2",
      cost: "#e65100",
      boolean: "#2e7d32",
      date: "#c2185b",
      url: "#0277bd",
      single_select: "#00838f",
      multiple_select: "#4527a0",
      percentage: "#00695c",
      other: "#616161",
    });
    const hues = Object.values(t.FIELD_TYPE_COLORS);
    expect(new Set(hues).size).toBe(hues.length);
  });
});

describe("PPM Gantt colours", () => {
  it("give each task status four bar shades", async () => {
    const t = await freshTokens();
    expect(Object.keys(t.PPM_GANTT_COLORS)).toEqual(["todo", "in_progress", "done", "blocked"]);
    for (const [status, shades] of Object.entries(t.PPM_GANTT_COLORS)) {
      expect(Object.keys(shades), status).toEqual(["bar", "progress", "barSelected", "progressSelected"]);
      for (const [part, value] of Object.entries(shades)) expect(value, `${status}.${part}`).toMatch(HEX);
    }
  });

  it("keep the shades the Gantt has always drawn", async () => {
    const t = await freshTokens();
    expect(t.PPM_GANTT_COLORS).toEqual({
      todo: { bar: "#9e9e9e", progress: "#757575", barSelected: "#757575", progressSelected: "#616161" },
      in_progress: { bar: "#90caf9", progress: "#1976d2", barSelected: "#1565c0", progressSelected: "#1976d2" },
      done: { bar: "#a5d6a7", progress: "#2e7d32", barSelected: "#1b5e20", progressSelected: "#2e7d32" },
      blocked: { bar: "#d32f2f", progress: "#c62828", barSelected: "#b71c1c", progressSelected: "#c62828" },
    });
  });

  it("darken a selected bar, so a selection reads on every status", async () => {
    const t = await freshTokens();
    for (const [status, shades] of Object.entries(t.PPM_GANTT_COLORS)) {
      expect(shades.barSelected, status).not.toBe(shades.bar);
    }
  });
});

describe("PPM cost colours", () => {
  it("draw CapEx in the brand blue and OpEx in MUI's default secondary purple, per mode", async () => {
    const t = await freshTokens();
    const { createTheme } = await import("@mui/material/styles");
    for (const mode of ["light", "dark"] as const) {
      const palette = createTheme({ palette: { mode, primary: { main: t.brand.primary } } }).palette;
      expect(t.PPM_COST_COLORS[mode], mode).toEqual({
        capex: palette.primary.main,
        opex: palette.secondary.main,
      });
    }
    expect(t.PPM_COST_COLORS.light.opex).toBe("#9c27b0");
    expect(t.PPM_COST_COLORS.dark.opex).toBe("#ce93d8");
  });
});

describe("heatmap ramp", () => {
  it("runs ten distinct hex steps per mode", async () => {
    const t = await freshTokens();
    for (const mode of ["light", "dark"] as const) {
      const steps = t.HEATMAP_RAMP[mode];
      expect(steps, mode).toHaveLength(10);
      expect(new Set(steps).size, mode).toBe(10);
      for (const c of steps) expect(c, mode).toMatch(HEX);
    }
  });

  it("keeps the Matrix report's blue steps, from blue 50 to blue 900 in light mode", async () => {
    const t = await freshTokens();
    expect(t.HEATMAP_RAMP).toEqual({
      light: ["#e3f2fd", "#bbdefb", "#90caf9", "#64b5f6", "#42a5f5", "#2196f3", "#1e88e5", "#1976d2", "#1565c0", "#0d47a1"],
      dark: ["#0d2137", "#0d3054", "#0a3d6e", "#0d4a88", "#10579e", "#1565c0", "#1976d2", "#1e88e5", "#2196f3", "#42a5f5"],
    });
  });
});

describe("status chip colours", () => {
  it("pair a pale fill with dark text for each verdict", async () => {
    const t = await freshTokens();
    expect(t.STATUS_CHIP_COLORS).toEqual({
      success: { fill: "#e8f5e9", text: "#2e7d32" },
      warning: { fill: "#fff3e0", text: "#e65100" },
      error: { fill: "#ffebee", text: "#c62828" },
    });
    for (const { fill, text } of Object.values(t.STATUS_CHIP_COLORS)) expect(fill).not.toBe(text);
  });
});

describe("surface shadows", () => {
  it("keep the sticky-bar hairline and the hover lift", async () => {
    const t = await freshTokens();
    expect(t.SURFACE_SHADOW).toEqual({
      sticky: "0 1px 3px rgba(0, 0, 0, 0.06)",
      hover: "0 4px 20px rgba(0, 0, 0, 0.1)",
    });
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
      rule: "#e0e0e0",
      panel: "#f5f5f5",
      control: "#cccccc",
      paper: "#ffffff",
      // The document print's own inks, as `DOCUMENT_PRINT_CSS` always drew them.
      heading: "#1a1a2e",
      ink: "#212121",
      subheading: "#444444",
      inkSecondary: "#616161",
      ruleLight: "#e0e0e0",
      panelLight: "#fafbfc",
      success: "#2e7d32",
      successLight: "#66bb6a",
      successPale: "#e8f5e9",
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

describe("third-party brand colours", () => {
  it("draw each sign-in provider's mark in its published colours", async () => {
    const t = await freshTokens();
    expect(t.THIRD_PARTY_BRAND).toEqual({
      microsoft: { red: "#f25022", green: "#7fba00", blue: "#00a4ef", yellow: "#ffb900" },
      google: { blue: "#4285f4", green: "#34a853", yellow: "#fbbc05", red: "#ea4335" },
      okta: { blue: "#007dc1" },
    });
  });

  it("are lower-case #rrggbb literals, none borrowed from the app palette", async () => {
    const t = await freshTokens();
    const appPalette = new Set<string>([
      ...Object.values(t.STATUS_COLORS),
      ...Object.values(t.CARD_TYPE_COLORS),
      ...t.CATEGORICAL_COLORS,
      t.brand.primary,
    ]);
    for (const [provider, colours] of Object.entries(t.THIRD_PARTY_BRAND)) {
      for (const [name, value] of Object.entries(colours)) {
        expect(value, `${provider}.${name}`).toMatch(/^#[0-9a-f]{6}$/);
        expect(appPalette.has(value), `${provider}.${name}`).toBe(false);
      }
    }
  });
});

describe("strong warning colour", () => {
  it("is orange 800, MUI's default warning, darker than the theme's own warning hue", async () => {
    const t = await freshTokens();
    expect(t.WARNING_STRONG_COLOR).toBe("#ed6c02");
    expect(t.WARNING_STRONG_COLOR).not.toBe(t.STATUS_COLORS.warning);
    expect(t.WARNING_STRONG_COLOR).not.toBe(t.RAG_COLORS.amber);
  });
});

describe("medal colours", () => {
  it("rank gold, silver and bronze, each with a fill and a darker label", async () => {
    const t = await freshTokens();
    expect(t.MEDAL_COLORS).toEqual({
      gold: { fill: "#ffd700", text: "#b8860b" },
      silver: { fill: "#bdbdbd", text: "#757575" },
      bronze: { fill: "#cd7f32", text: "#8b4513" },
    });
  });

  it("are lower-case #rrggbb literals, none a status colour", async () => {
    const t = await freshTokens();
    const status = new Set<string>(Object.values(t.STATUS_COLORS));
    for (const [medal, { fill, text }] of Object.entries(t.MEDAL_COLORS)) {
      for (const value of [fill, text]) {
        expect(value, medal).toMatch(/^#[0-9a-f]{6}$/);
        expect(status.has(value), medal).toBe(false);
      }
      expect(fill, medal).not.toBe(text);
    }
  });
});

describe("deliverable colours", () => {
  it("give the SoAW its orange 900 and borrow the ADR and diagram hues from their namesakes", async () => {
    const t = await freshTokens();
    expect(t.DELIVERABLE_COLORS).toEqual({
      soaw: "#e65100",
      adr: t.STATUS_COLORS.info,
      diagram: t.CARD_TYPE_COLORS.Application,
    });
    expect(new Set(Object.values(t.DELIVERABLE_COLORS)).size).toBe(3);
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
    const text = fs.readFileSync(SEED_FILE, "utf-8").replace(/\r\n/g, "\n");
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

// Eight pairs of near-identical values (CIEDE2000 ΔE < 5, same role) were merged
// into one value each, so the palette shrank from 135 to 127 hex values. These pin
// the survivors: a revert that brings a near-duplicate back fails here.
describe("merged near-duplicate colours", () => {
  it("draw near-black ink and the BPMN panel's subtle dark surface in grey 900, the charcoal navbar", async () => {
    const t = await freshTokens();
    const charcoal = t.NAVBAR_PRESETS.find((p) => p.key === "charcoal")!.bg;
    expect(charcoal).toBe("#212121");
    expect(t.PRINT_COLORS.ink).toBe(charcoal);
    expect(t.BPMN_DARK_THEME["--bio-surface-subtle"]).toBe(charcoal);
  });

  it("use MUI's default warning orange for every orange 800", async () => {
    const t = await freshTokens();
    for (const value of [
      t.NOTIFICATION_TYPE_COLORS.extension_update_available,
      t.NOTIFICATION_TYPE_COLORS.card_updated,
      t.TIMELINE_COLORS.reset,
      t.CATEGORICAL_COLORS[3],
      t.DASHBOARD_KPI_COLORS.noStakeholders,
      t.LIFECYCLE_PHASE_COLORS.phaseOut,
      t.PRINT_COLORS.warning,
    ]) {
      expect(value).toBe(t.WARNING_STRONG_COLOR);
    }
  });

  it("give the print pages one rule grey, the light page background and the green 50 tint", async () => {
    const t = await freshTokens();
    expect(t.PRINT_COLORS.rule).toBe(t.PRINT_COLORS.ruleLight);
    expect(t.PRINT_COLORS.panelLight).toBe(t.surface.light.default);
    expect(t.PRINT_COLORS.successPale).toBe(t.PRINT_COLORS.successTint);
    expect(t.PRINT_COLORS.successTint).toBe(t.STATUS_CHIP_COLORS.success.fill);
  });

  it("use grey 700 for the field-type fallback chip and secondary print ink", async () => {
    const t = await freshTokens();
    expect(t.FIELD_TYPE_COLORS.other).toBe(t.PPM_GANTT_COLORS.todo.progressSelected);
    expect(t.PRINT_COLORS.inkSecondary).toBe(t.FIELD_TYPE_COLORS.other);
  });

  it("draw the green KPI accents in the theme's success green", async () => {
    const t = await freshTokens();
    for (const key of ["completion", "todos", "activeUsers", "qualityGood"] as const) {
      expect(t.DASHBOARD_KPI_COLORS[key], key).toBe(t.STATUS_COLORS.success);
    }
  });
});

// A role alias names a value another feature owns, for a screen whose meaning is not
// that feature's. It adds no colour: each one IS its source.
describe("role aliases", () => {
  it("REPORT_ICON_COLORS takes its hues from the field-type chips", async () => {
    const t = await freshTokens();
    expect(t.REPORT_ICON_COLORS).toEqual({
      dataQuality: t.FIELD_TYPE_COLORS.percentage,
      costDriver: t.FIELD_TYPE_COLORS.cost,
      privateReport: t.FIELD_TYPE_COLORS.other,
    });
  });

  it("FAVORITE_COLOR is the Favourites KPI tile's amber", async () => {
    const t = await freshTokens();
    expect(t.FAVORITE_COLOR).toBe(t.DASHBOARD_KPI_COLORS.favorites);
  });

  it("UNSET_VALUE_COLOR is the Process Navigator's no-value grey", async () => {
    const t = await freshTokens();
    expect(t.UNSET_VALUE_COLOR).toBe(t.BPM_UNSET_COLOR);
  });

  it("SCREEN_INK takes its inks from the print palette", async () => {
    const t = await freshTokens();
    expect(t.SCREEN_INK).toEqual({
      onLightFill: t.PRINT_COLORS.text,
      onDark: t.PRINT_COLORS.control,
      secondary: t.PRINT_COLORS.inkSecondary,
      muted: t.PRINT_COLORS.muted,
      rule: t.PRINT_COLORS.control,
      ruleDark: t.PRINT_COLORS.subheading,
      paper: t.PRINT_COLORS.paper,
    });
  });

  it("MATRIX_DIAGONAL_COLOR is the multiple-select chip's deep purple 800", async () => {
    const t = await freshTokens();
    expect(t.MATRIX_DIAGONAL_COLOR).toBe(t.FIELD_TYPE_COLORS.multiple_select);
    expect(t.MATRIX_DIAGONAL_COLOR).toBe("#4527a0");
  });
});
