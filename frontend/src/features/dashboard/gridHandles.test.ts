import { describe, expect, it } from "vitest";
import { alpha, createTheme } from "@mui/material/styles";
import { CARD_SHADOW } from "@/theme/tokens";
import { handleStyles } from "./gridHandles";

/* eslint-disable @typescript-eslint/no-explicit-any -- sx rules are plain objects here */

const light = createTheme({ palette: { mode: "light" } });
const dark = createTheme({ palette: { mode: "dark" } });
const HANDLE = "& .react-grid-item > .react-resizable-handle";
const TOUCH = { touchAction: "none", WebkitUserSelect: "none", userSelect: "none" };
const PLACEHOLDER = "& .react-grid-item.react-grid-placeholder";
const DRAGGING = "& .react-grid-item.react-draggable-dragging";
const CORNER = `${HANDLE}.react-resizable-handle-se`;

/** Every key at any depth of an sx object. */
function allKeys(rules: Record<string, unknown>): string[] {
  return Object.entries(rules).flatMap(([key, value]) =>
    value && typeof value === "object" ? [key, ...allKeys(value as Record<string, unknown>)] : [key],
  );
}

describe("handleStyles", () => {
  it("adds no handle rules outside customize mode", () => {
    expect(handleStyles(light, false)).toEqual({});
  });

  it("lets a touch on any handle resize or move instead of scrolling, without selecting text", () => {
    const sx = handleStyles(light, true) as any;
    expect(sx[HANDLE]).toEqual(TOUCH);
    expect(sx["& .dashboard-widget-drag-handle"]).toEqual(TOUCH);
  });

  it("leaves the library's handle sizes, positions, colours and cursors alone", () => {
    const sx = handleStyles(light, true) as Record<string, Record<string, unknown>>;
    const handleRules = Object.fromEntries(
      Object.entries(sx).filter(([selector]) => selector !== PLACEHOLDER && selector !== DRAGGING),
    );
    // The handles' own keys, and the edge marks'. The corner mark (`::after`
    // of the corner handle) is the one thing resized on purpose.
    const corner = handleRules[CORNER];
    const keys = allKeys({
      ...handleRules,
      [CORNER]: Object.fromEntries(Object.entries(corner).filter(([key]) => key !== "&::after")),
    });
    for (const banned of ["backgroundColor", "width", "height", "transform", "cursor", "zIndex", "padding"]) {
      expect(keys, banned).not.toContain(banned);
    }
    // The mark resizes, but the handle around it keeps its place and cursor.
    expect(Object.keys(corner["&::after"] as object).sort()).toEqual(
      ["borderColor", "bottom", "height", "right", "width"].sort(),
    );
  });

  it("always shows the corner handle, with one larger mark in the theme's disabled text colour", () => {
    for (const theme of [light, dark]) {
      const corner = (handleStyles(theme, true) as any)[CORNER];
      expect(corner).toEqual({
        opacity: 1,
        // react-resizable's own background glyph goes, or the corner shows two marks.
        backgroundImage: "none",
        "&::after": { width: 8, height: 8, right: 4, bottom: 4, borderColor: theme.palette.text.disabled },
      });
    }
    expect(light.palette.text.disabled).not.toBe(dark.palette.text.disabled);
  });

  it("keeps the right and bottom edges grabbable but draws no mark on them", () => {
    const sx = handleStyles(light, true) as any;
    for (const edge of ["e", "s"]) {
      expect(sx[`${HANDLE}.react-resizable-handle-${edge}`]).toEqual({
        backgroundImage: "none",
        "&::after": { display: "none" },
      });
    }
  });

  it("needs no hover-less rule now that the corner always shows", () => {
    const sx = handleStyles(light, true) as any;
    expect(Object.keys(sx).filter((key) => key.startsWith("@media"))).toEqual([]);
    // The edges draw no mark, so they are not revealed either.
    expect(sx[HANDLE]).not.toHaveProperty("opacity");
    expect(sx[`${HANDLE}.react-resizable-handle-e`]).not.toHaveProperty("opacity");
    expect(sx[`${HANDLE}.react-resizable-handle-s`]).not.toHaveProperty("opacity");
  });
});

describe("handleStyles: landing area and dragged widget", () => {
  it("marks where a widget lands with the card's corners, a 1 px dotted primary outline and a faint fill", () => {
    const purple = createTheme({ palette: { primary: { main: "#7b1fa2" } } });
    for (const theme of [light, dark, purple]) {
      expect((handleStyles(theme, true) as any)[PLACEHOLDER]).toEqual({
        backgroundColor: alpha(theme.palette.primary.main, 0.06),
        border: `1px dotted ${theme.palette.primary.main}`,
        borderRadius: 1,
        opacity: 1,
        boxSizing: "border-box",
      });
    }
  });

  it("keeps the library's placeholder stacking and transition", () => {
    const keys = allKeys((handleStyles(light, true) as any)[PLACEHOLDER]);
    for (const kept of ["zIndex", "transition", "transitionDuration"]) expect(keys).not.toContain(kept);
  });

  it("lifts the widget being dragged above its resting shadow, with the card's corners", () => {
    for (const theme of [light, dark]) {
      const sx = handleStyles(theme, true) as any;
      expect(sx[DRAGGING]).toEqual({ boxShadow: CARD_SHADOW.lifted, borderRadius: 1 });
    }
    expect(CARD_SHADOW.lifted).not.toBe(CARD_SHADOW.soft);
  });

  it("gives the landing area and the dragged widget one theme radius in sx units, never the radius in px", () => {
    // A number in `sx` is multiplied by the theme radius: `theme.shape.borderRadius`
    // (4) would come out at 16 px against the card's 4 px.
    const round = createTheme({ shape: { borderRadius: 12 } });
    const sx = handleStyles(round, true) as any;
    expect(sx[PLACEHOLDER].borderRadius).toBe(1);
    expect(sx[DRAGGING].borderRadius).toBe(1);
  });

  it("styles neither, nor the corner, outside customize mode", () => {
    for (const theme of [light, dark]) {
      const sx = handleStyles(theme, false) as any;
      expect(sx[PLACEHOLDER]).toBeUndefined();
      expect(sx[DRAGGING]).toBeUndefined();
      expect(sx[CORNER]).toBeUndefined();
    }
  });
});
