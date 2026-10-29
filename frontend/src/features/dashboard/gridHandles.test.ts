import { describe, expect, it } from "vitest";
import { createTheme } from "@mui/material/styles";
import { gridDots, handleStyles } from "./gridHandles";

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

describe("gridDots", () => {
  const COLOR = "rgba(0,0,0,0.35)";

  /** Where the first whole dot sits on each axis: the tile offset plus half a tile, wrapped into one pitch. */
  function firstDot(sx: Record<string, unknown>): [number, number] {
    const size = String(sx.backgroundSize).split(" ").map(parseFloat);
    const position = String(sx.backgroundPosition).split(" ").map(parseFloat);
    return [0, 1].map((axis) => {
      const pitch = size[axis];
      return (((position[axis] + pitch / 2) % pitch) + pitch) % pitch;
    }) as [number, number];
  }

  it("repeats a dot of the given colour every column and row pitch", () => {
    const sx = gridDots(1280, 12, [16, 16], 60, COLOR);
    expect(sx).toEqual({
      backgroundImage: `radial-gradient(circle, ${COLOR} 1px, transparent 1.5px)`,
      backgroundSize: "108px 76px",
      backgroundPosition: "-62px -46px",
    });
  });

  it("puts the first dot in the middle of the first gutter crossing", () => {
    // 1280 px on 12 columns: 92 px columns, so the first gutter runs 92–108 px.
    expect(firstDot(gridDots(1280, 12, [16, 16], 60, COLOR))).toEqual([100, 68]);
  });

  it("keeps a fractional pitch instead of rounding it", () => {
    const sx = gridDots(1000, 12, [16, 16], 60, COLOR);
    expect(sx.backgroundSize).toBe(`${1016 / 12}px 76px`);
    const [x] = firstDot(sx);
    // colWidth = (1000 - 16 * 11) / 12; the first gutter's middle is 8 px past it.
    expect(x).toBeCloseTo((1000 - 16 * 11) / 12 + 8, 9);
  });

  it("follows the margins and the row height", () => {
    const sx = gridDots(1200, 6, [10, 20], 40, COLOR);
    expect(sx.backgroundSize).toBe("201.66666666666666px 60px");
    expect(firstDot(sx)).toEqual([(1200 - 50) / 6 + 5, 50]);
  });
});
