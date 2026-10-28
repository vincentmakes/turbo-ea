/**
 * Theme-aware ECharts chrome for the dashboard widgets — the ECharts twin of
 * `useChartTheme` (Recharts). Text, axis, grid and tooltip colours come from
 * the MUI theme so dark mode is a selected palette, not a flip; categorical
 * and sequential hues come from `theme/tokens.ts`.
 */
import { useMemo } from "react";
import { useTheme } from "@mui/material/styles";
import { useIsRtl } from "@/hooks/useIsRtl";
import { CHART_CATEGORICAL, CHART_SEQUENTIAL, typography } from "@/theme/tokens";

export interface EChartsChrome {
  mode: "light" | "dark";
  fontFamily: string;
  textPrimary: string;
  textSecondary: string;
  /** Axis lines and the grid's split lines — recessive. */
  divider: string;
  /** The paper the chart sits on (gaps between fills use it). */
  surface: string;
  /** Hover band behind a hovered category. */
  hover: string;
  tooltipBackground: string;
  /** Fixed-order categorical hues for this mode. */
  categorical: readonly string[];
  /** Sequential ramp ends (low → high) for this mode. */
  sequential: readonly [string, string];
}

export interface EChartsThemeValue extends EChartsChrome {
  isRtl: boolean;
}

export function buildEChartsChrome(palette: {
  mode: "light" | "dark";
  text: { primary: string; secondary: string };
  divider: string;
  background: { paper: string };
  action: { hover: string };
}): EChartsChrome {
  const mode = palette.mode === "dark" ? "dark" : "light";
  return {
    mode,
    fontFamily: typography.fontFamily,
    textPrimary: palette.text.primary,
    textSecondary: palette.text.secondary,
    divider: palette.divider,
    surface: palette.background.paper,
    hover: palette.action.hover,
    tooltipBackground: palette.background.paper,
    categorical: CHART_CATEGORICAL[mode],
    sequential: CHART_SEQUENTIAL[mode],
  };
}

/** The chrome for the current MUI theme, plus the live RTL flag. */
export function useEChartsTheme(): EChartsThemeValue {
  const theme = useTheme();
  const isRtl = useIsRtl();
  return useMemo(
    () => ({ ...buildEChartsChrome(theme.palette), isRtl }),
    [theme, isRtl],
  );
}
