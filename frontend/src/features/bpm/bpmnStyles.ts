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

import { BPMN_DARK_THEME, brand } from "@/theme/tokens";

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
 * colours that work on either surface. The values are the `BPMN_DARK_THEME`
 * design tokens.
 */
export const PROPERTIES_PANEL_DARK_TOKENS = BPMN_DARK_THEME;

/**
 * The "Linked cards" rows (`CalledProcessEntry.ts`, `CardLinkEntry.ts`) are
 * Turbo EA's own, so their buttons and organization chips have no stock class
 * to borrow — only the row label does. Built on the panel's `--bio-*` tokens,
 * so they follow the light / dark overrides above for free.
 */
const CALLED_PROCESS_ENTRY_SX = {
  "& .turboea-called-process-value": {
    fontSize: "13px",
    lineHeight: 1.4,
    color: "var(--bio-text)",
    margin: "2px 0 6px",
    wordBreak: "break-word",
  },
  "& .turboea-called-process-empty, & .turboea-called-process-foreign": {
    color: "var(--bio-text-subtle)",
    fontStyle: "italic",
  },
  "& .turboea-called-process-list": {
    display: "flex",
    flexWrap: "wrap",
    gap: "4px",
    margin: "2px 0 6px",
  },
  "& .turboea-called-process-chip": {
    fontSize: "12px",
    lineHeight: 1.5,
    padding: "1px 7px",
    borderRadius: "10px",
    background: "var(--bio-surface-subtle)",
    border: "1px solid var(--bio-border-subtle)",
    color: "var(--bio-text)",
  },
  "& .turboea-called-process-actions": { display: "flex", gap: "6px", flexWrap: "wrap" },
  "& .turboea-called-process-button": {
    font: "inherit",
    fontSize: "12px",
    padding: "3px 8px",
    borderRadius: "3px",
    border: "1px solid var(--bio-border-input)",
    background: "var(--bio-surface)",
    color: "var(--bio-text)",
    cursor: "pointer",
    "&:hover": { background: "var(--bio-surface-subtle)" },
  },
  "& .turboea-called-process-choose": {
    borderColor: `var(--bio-primary, ${brand.primary})`,
    color: `var(--bio-primary, ${brand.primary})`,
  },
} as const;

/** `sx` for the box the properties panel is attached to. */
export function bpmnPropertiesPanelSx(mode: "light" | "dark") {
  return {
    height: "100%",
    overflow: "auto",
    // The panel's own root class carries the token defaults; the overrides
    // are set one level up so they win by specificity and inheritance both.
    "& .bio-theme-parent, & .bio-properties-panel": mode === "dark" ? PROPERTIES_PANEL_DARK_TOKENS : {},
    ...CALLED_PROCESS_ENTRY_SX,
  } as const;
}
