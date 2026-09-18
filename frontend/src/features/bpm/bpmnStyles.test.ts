import { describe, it, expect } from "vitest";

import {
  BPMN_ICON_COLOR,
  PROPERTIES_PANEL_DARK_TOKENS,
  bpmnCanvasSx,
  bpmnPropertiesPanelSx,
} from "./bpmnStyles";

describe("bpmnCanvasSx", () => {
  it("pins the context pad icon color so it stays visible in dark mode (#770)", () => {
    expect(bpmnCanvasSx["& .djs-context-pad .entry"]).toEqual({ color: BPMN_ICON_COLOR });
  });

  it("pins the replace/append popup menu color (same white-background bug)", () => {
    // The create/append-anything menus render inside `.djs-popup` too, so this
    // one rule is what keeps them legible in dark mode.
    expect(bpmnCanvasSx["& .djs-popup .djs-popup-body"]).toEqual({ color: BPMN_ICON_COLOR });
  });

  it("uses a dark glyph color (the boxes/panels behind them are always white)", () => {
    // hsl(225, 10%, 15%) — low lightness => dark. Guards against an accidental
    // light value that would reintroduce white-on-white.
    expect(BPMN_ICON_COLOR).toMatch(/^hsl\(\s*225,\s*10%,\s*15%\s*\)$/);
  });
});

describe("bpmnPropertiesPanelSx", () => {
  const selector = "& .bio-theme-parent, & .bio-properties-panel";

  it("leaves the panel's own light tokens alone in light mode", () => {
    expect(bpmnPropertiesPanelSx("light")[selector]).toEqual({});
  });

  it("overrides the surface, text and border tokens in dark mode", () => {
    const tokens = bpmnPropertiesPanelSx("dark")[selector] as Record<string, string>;
    expect(tokens).toBe(PROPERTIES_PANEL_DARK_TOKENS);
    for (const key of ["--bio-surface", "--bio-text", "--bio-border", "--bio-border-input"]) {
      expect(tokens[key], key).toBeTruthy();
    }
  });

  it("only ever sets --bio-* tokens (never a raw CSS property)", () => {
    for (const key of Object.keys(PROPERTIES_PANEL_DARK_TOKENS)) {
      expect(key.startsWith("--bio-"), key).toBe(true);
    }
  });

  it("keeps the dark surface dark and the dark text light", () => {
    // A swapped pair would be as unreadable as the bug the override exists for.
    expect(PROPERTIES_PANEL_DARK_TOKENS["--bio-surface"]).toMatch(/^#[0-3]/);
    expect(PROPERTIES_PANEL_DARK_TOKENS["--bio-text"]).toMatch(/9\d%\)$/);
  });
});
