import { describe, expect, it } from "vitest";
import { renderHook } from "@testing-library/react";
import { createElement } from "react";
import { ThemeProvider, createTheme } from "@mui/material/styles";

import { useChartTheme } from "./useChartTheme";

function themed(mode: "light" | "dark") {
  const theme = createTheme({ palette: { mode } });
  return ({ children }: { children: React.ReactNode }) =>
    createElement(ThemeProvider, { theme }, children);
}

describe("useChartTheme", () => {
  it("derives chart chrome from the active theme palette", () => {
    const { result } = renderHook(() => useChartTheme(), { wrapper: themed("light") });
    expect(result.current.axisTick.fontSize).toBe(12);
    expect(result.current.axisTick.fill).toBeTruthy();
    expect(result.current.gridStroke).toBeTruthy();
    expect(result.current.tooltipProps.contentStyle.backgroundColor).toBeTruthy();
  });

  it("changes with the theme mode (dark tooltip is not paper-white)", () => {
    const light = renderHook(() => useChartTheme(), { wrapper: themed("light") });
    const dark = renderHook(() => useChartTheme(), { wrapper: themed("dark") });
    expect(dark.result.current.tooltipProps.contentStyle.backgroundColor).not.toBe(
      light.result.current.tooltipProps.contentStyle.backgroundColor,
    );
  });

  it("returns a stable reference across re-renders with the same theme", () => {
    const { result, rerender } = renderHook(() => useChartTheme(), { wrapper: themed("light") });
    const first = result.current;
    rerender();
    expect(result.current).toBe(first);
  });
});
