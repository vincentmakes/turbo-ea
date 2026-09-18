/**
 * Shared bpmn-js canvas style overrides for the BPMN modeler.
 *
 * bpmn-js ships only its stock light-theme stylesheet. A few UI surfaces —
 * the context pad and the replace/append popup menu — render their icons on a
 * *fixed white* background but set no explicit icon color, so the glyphs
 * inherit the cascading `color`. In dark mode MUI's CssBaseline makes the body
 * text light, which turns those glyphs white-on-white (invisible). Pinning an
 * explicit dark color reproduces the correct light-mode rendering in both
 * modes. See issue #770.
 *
 * The create/append-anything menus (`bpmn-js-create-append-anything`) render
 * inside the very same `.djs-popup` / `.djs-context-pad` surfaces, so the two
 * pins below cover them too — no per-package rule is needed.
 */

// Matches bpmn-js's own `--palette-entry-color` (hsl(225, 10%, 15%)) so the
// context-pad icons line up with the left palette. The boxes/panels behind
// these glyphs are always white, so a dark glyph is correct in either theme.
export const BPMN_ICON_COLOR = "hsl(225, 10%, 15%)";

export const bpmnCanvasSx = {
  "& .bjs-powered-by": { display: "none" },
  // Context pad icons sit on fixed white boxes — pin the color (#770).
  "& .djs-context-pad .entry": { color: BPMN_ICON_COLOR },
  // Replace/append popup menu shares the same white-background inheritance bug.
  "& .djs-popup .djs-popup-body": { color: BPMN_ICON_COLOR },
} as const;

/**
 * Dark-mode overrides for `@bpmn-io/properties-panel`.
 *
 * The panel's stylesheet is built entirely on `--bio-*` semantic tokens
 * declared on `.bio-theme-parent` — and it declares light values only, with
 * no `prefers-color-scheme` or data-attribute variant. Redefining the surface,
 * text and border tokens on the container the panel is attached to is the
 * sanctioned way to re-theme it (the file header says as much: "allow
 * overrides with an alternative theme"). Only the tokens that read wrong on
 * a dark page are overridden; the danger/warning/focus tokens are contrast
 * colours that work on either surface.
 */
export const PROPERTIES_PANEL_DARK_TOKENS = {
  "--bio-surface": "#1e1e1e",
  "--bio-surface-overlay": "#1e1e1e",
  "--bio-surface-subtle": "#232323",
  "--bio-surface-medium": "#2a2a2a",
  "--bio-surface-strong": "#333333",
  "--bio-surface-inverted": "#e0e0e0",
  "--bio-text": "hsl(0, 0%, 92%)",
  "--bio-text-subtle": "hsl(0, 0%, 72%)",
  "--bio-text-subtlest": "hsl(0, 0%, 58%)",
  "--bio-text-on-inverted": "hsl(0, 0%, 12%)",
  "--bio-border": "hsl(0, 0%, 32%)",
  "--bio-border-subtle": "hsl(0, 0%, 26%)",
  "--bio-border-disabled": "hsl(0, 0%, 22%)",
  "--bio-border-input": "hsl(0, 0%, 38%)",
  "--bio-primary-surface": "hsl(205, 60%, 18%)",
  "--bio-primary-surface-strong": "hsl(205, 60%, 26%)",
  "--bio-danger-surface": "hsl(360, 50%, 22%)",
  "--bio-danger-surface-subtle": "hsl(360, 40%, 16%)",
  "--bio-warning-surface": "hsl(38, 50%, 18%)",
  "--bio-shadow": "hsla(0, 0%, 0%, 60%)",
  "--bio-shadow-subtle": "hsla(0, 0%, 0%, 35%)",
} as const;

/** `sx` for the box the properties panel is attached to. */
export function bpmnPropertiesPanelSx(mode: "light" | "dark") {
  return {
    height: "100%",
    overflow: "auto",
    // The panel's own root class carries the token defaults; the overrides
    // are set one level up so they win by specificity and inheritance both.
    "& .bio-theme-parent, & .bio-properties-panel": mode === "dark" ? PROPERTIES_PANEL_DARK_TOKENS : {},
  } as const;
}
