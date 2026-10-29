import { describe, expect, it } from "vitest";
import { alpha, createTheme } from "@mui/material/styles";
import { handleStyles } from "./gridHandles";

/* eslint-disable @typescript-eslint/no-explicit-any -- sx rules are plain objects here */

const light = createTheme({ palette: { mode: "light" } });
const dark = createTheme({ palette: { mode: "dark" } });
const HANDLE = "& .react-grid-item > .react-resizable-handle";
const TOUCH = { touchAction: "none", WebkitUserSelect: "none", userSelect: "none" };
const PLACEHOLDER = "& .react-grid-item.react-grid-placeholder";
const DRAGGING = "& .react-grid-item.react-draggable-dragging";

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
    const sx = handleStyles(light, true);
    const handleRules = Object.fromEntries(
      Object.entries(sx).filter(([selector]) => selector !== PLACEHOLDER && selector !== DRAGGING),
    );
    const keys = allKeys(handleRules);
    for (const banned of ["backgroundColor", "width", "height", "transform", "cursor", "zIndex", "padding"]) {
      expect(keys, banned).not.toContain(banned);
    }
  });

  it("recolours the corner mark from the theme so it shows in dark mode", () => {
    for (const theme of [light, dark]) {
      const corner = (handleStyles(theme, true) as any)[`${HANDLE}.react-resizable-handle-se`];
      expect(corner).toEqual({ "&::after": { borderColor: theme.palette.text.secondary } });
    }
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

  it("always shows the handles where there is no hover, and only there", () => {
    const sx = handleStyles(light, true) as any;
    expect(sx["@media (hover: none)"]).toEqual({ [HANDLE]: { opacity: 1 } });
    expect(sx[HANDLE]).not.toHaveProperty("opacity");
  });
});

describe("handleStyles: landing area and dragged widget", () => {
  it("marks where a widget lands with a rounded, dotted primary outline on a faint primary fill", () => {
    for (const theme of [light, dark]) {
      expect((handleStyles(theme, true) as any)[PLACEHOLDER]).toEqual({
        backgroundColor: alpha(theme.palette.primary.main, 0.08),
        border: `2px dotted ${theme.palette.primary.main}`,
        borderRadius: theme.shape.borderRadius,
        opacity: 1,
        boxSizing: "border-box",
      });
    }
  });

  it("keeps the library's placeholder stacking and transition", () => {
    const keys = allKeys((handleStyles(light, true) as any)[PLACEHOLDER]);
    for (const kept of ["zIndex", "transition", "transitionDuration"]) expect(keys).not.toContain(kept);
  });

  it("lifts the widget being dragged above its resting shadow, with rounded corners", () => {
    const sx = handleStyles(light, true) as any;
    expect(sx[DRAGGING]).toEqual({ boxShadow: light.shadows[8], borderRadius: light.shape.borderRadius });
    expect(sx[DRAGGING].boxShadow).not.toBe(light.shadows[3]);
  });

  it("follows the theme's shape", () => {
    const round = createTheme({ shape: { borderRadius: 12 } });
    const sx = handleStyles(round, true) as any;
    expect(sx[PLACEHOLDER].borderRadius).toBe(12);
    expect(sx[DRAGGING].borderRadius).toBe(12);
  });

  it("styles neither outside customize mode", () => {
    const sx = handleStyles(light, false) as any;
    expect(sx[PLACEHOLDER]).toBeUndefined();
    expect(sx[DRAGGING]).toBeUndefined();
  });
});
