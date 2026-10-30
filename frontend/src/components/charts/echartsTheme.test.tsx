import { describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { renderHook } from "@testing-library/react";
import { ThemeProvider } from "@mui/material/styles";
import { buildTheme } from "@/theme";
import { CHART_CATEGORICAL, CHART_SEQUENTIAL, surface } from "@/theme/tokens";

vi.mock("@/hooks/useIsRtl", () => import("@/test/hooks").then((m) => m.useIsRtlModule()));
import { hookState } from "@/test/hooks";
import { useEChartsTheme } from "./echartsTheme";

function wrapper(mode: "light" | "dark") {
  return ({ children }: { children: ReactNode }) => <ThemeProvider theme={buildTheme(mode)}>{children}</ThemeProvider>;
}

describe("useEChartsTheme", () => {
  it("takes text, divider and paper from the light theme and the light hues", () => {
    hookState.isRtl = false;
    const { result } = renderHook(() => useEChartsTheme(), { wrapper: wrapper("light") });
    expect(result.current.mode).toBe("light");
    expect(result.current.surface).toBe(surface.light.paper);
    expect(result.current.categorical).toBe(CHART_CATEGORICAL.light);
    expect(result.current.sequential).toBe(CHART_SEQUENTIAL.light);
    expect(result.current.isRtl).toBe(false);
  });

  it("selects the dark steps in dark mode and reports RTL", () => {
    hookState.isRtl = true;
    const { result } = renderHook(() => useEChartsTheme(), { wrapper: wrapper("dark") });
    expect(result.current.mode).toBe("dark");
    expect(result.current.surface).toBe(surface.dark.paper);
    expect(result.current.categorical).toBe(CHART_CATEGORICAL.dark);
    expect(result.current.sequential).toBe(CHART_SEQUENTIAL.dark);
    expect(result.current.isRtl).toBe(true);
    hookState.isRtl = false;
  });
});
