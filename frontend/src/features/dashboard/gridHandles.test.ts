import { describe, expect, it } from "vitest";
import { createTheme } from "@mui/material/styles";
import { handleStyles } from "./gridHandles";

/* eslint-disable @typescript-eslint/no-explicit-any -- sx rules are plain objects here */

const light = createTheme({ palette: { mode: "light" } });
const dark = createTheme({ palette: { mode: "dark" } });
const HANDLE = "& .react-grid-item > .react-resizable-handle";
const TOUCH = { touchAction: "none", WebkitUserSelect: "none", userSelect: "none" };

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
    const keys = allKeys(handleStyles(light, true));
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
