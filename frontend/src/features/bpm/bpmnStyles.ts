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
