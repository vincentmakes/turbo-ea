import { describe, expect, it } from "vitest";
import { alpha, createTheme } from "@mui/material/styles";
import { handleStyles } from "./gridHandles";

/* eslint-disable @typescript-eslint/no-explicit-any -- sx rules are plain objects here */

const theme = createTheme({ palette: { primary: { main: "#1976d2" } } });
const HANDLE = "& .react-grid-item > .react-resizable-handle";

describe("handleStyles", () => {
  it("adds no handle rules outside customize mode", () => {
    expect(handleStyles(theme, false)).toEqual({});
  });

  it("lets a touch on any handle resize or move instead of scrolling, without selecting text", () => {
    const sx = handleStyles(theme, true) as any;
    expect(sx[HANDLE]).toEqual({
      opacity: 1,
      touchAction: "none",
      WebkitUserSelect: "none",
      userSelect: "none",
      backgroundImage: "none",
      padding: 0,
    });
    expect(sx["& .dashboard-widget-drag-handle"]).toEqual({ touchAction: "none" });
  });

  it("draws a 28 px translucent corner above the edges", () => {
    const corner = (handleStyles(theme, true) as any)[`${HANDLE}.react-resizable-handle-se`];
    expect(corner).toMatchObject({
      width: 28,
      height: 28,
      right: 0,
      bottom: 0,
      borderRadius: 1,
      zIndex: 2,
      cursor: "se-resize",
      backgroundColor: alpha("#1976d2", 0.18),
    });
    expect(corner["&:hover, &:active"]).toEqual({ backgroundColor: alpha("#1976d2", 0.35) });
    expect(corner["&::after"]).toEqual({ borderColor: "#1976d2" });
  });

  it("turns the right and bottom handles into full-length 12 px bars", () => {
    const sx = handleStyles(theme, true) as any;
    const right = sx[`${HANDLE}.react-resizable-handle-e`];
    const bottom = sx[`${HANDLE}.react-resizable-handle-s`];
    expect(right).toMatchObject({
      top: 0,
      right: 0,
      height: "100%",
      width: 12,
      marginTop: 0,
      transform: "none",
      cursor: "ew-resize",
      backgroundColor: alpha("#1976d2", 0.08),
    });
    expect(bottom).toMatchObject({
      left: 0,
      bottom: 0,
      width: "100%",
      height: 12,
      marginLeft: 0,
      transform: "none",
      cursor: "ns-resize",
      backgroundColor: alpha("#1976d2", 0.08),
    });
    for (const edge of [right, bottom]) {
      expect(edge["&:hover, &:active"]).toEqual({ backgroundColor: alpha("#1976d2", 0.2) });
      expect(edge["&::after"]).toEqual({ display: "none" });
    }
  });
});
