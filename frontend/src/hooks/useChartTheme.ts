/**
 * DEPRECATED since UI SDK 1.32, removed at UI SDK 2.0 — chart with
 * `sdk.loadECharts()` instead: its `useEChartsTheme` + `chrome` helpers are
 * what core's dashboards and reports are drawn with
 * (`frontend/src/components/charts/`).
 *
 * Theme-aware Recharts chrome (grid, axis ticks, tooltip). Spread the pieces
 * into Recharts elements:
 *
 *   const { axisTick, gridStroke, tooltipProps } = useChartTheme();
 *   <CartesianGrid strokeDasharray="3 3" stroke={gridStroke} />
 *   <XAxis tick={axisTick} tickLine={false} />
 *   <Tooltip {...tooltipProps} />
 *
 * Kept only because UI extensions reach it on
 * `window.TurboEA.sdk.useChartTheme` (UI SDK 1.9, paired with the equally
 * deprecated `sdk.loadRecharts()`) until UI SDK 2.0; no core chart uses it
 * any more.
 */

import { useTheme } from "@mui/material/styles";
import { useMemo } from "react";

export interface ChartTheme {
  /** Axis tick style: `<XAxis tick={axisTick} tickLine={false} />`. */
  axisTick: { fontSize: number; fill: string };
  /** Grid line color: `<CartesianGrid strokeDasharray="3 3" stroke={gridStroke} />`. */
  gridStroke: string;
  /** Spread into `<Tooltip {...tooltipProps} />` (cursor + panel styling). */
  tooltipProps: {
    cursor: { fill: string };
    contentStyle: {
      backgroundColor: string;
      borderColor: string;
      color: string;
    };
  };
}

/**
 * @deprecated Since UI SDK 1.32; removed at UI SDK 2.0. Use
 * `sdk.loadECharts()` → `useEChartsTheme` + `chrome`.
 */
export function useChartTheme(): ChartTheme {
  const theme = useTheme();
  return useMemo(
    () => ({
      axisTick: { fontSize: 12, fill: theme.palette.text.secondary },
      gridStroke: theme.palette.divider,
      tooltipProps: {
        cursor: { fill: theme.palette.action.hover },
        contentStyle: {
          backgroundColor: theme.palette.background.paper,
          borderColor: theme.palette.divider,
          color: theme.palette.text.primary,
        },
      },
    }),
    [theme],
  );
}
