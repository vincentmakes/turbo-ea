/**
 * Theme-aware Recharts chrome — the single source of truth for how charts
 * look in Turbo EA (grid, axis ticks, tooltip), matching the conventions the
 * core reports use (OverviewTab, DataQualityReport). Spread the pieces into
 * Recharts elements:
 *
 *   const { axisTick, gridStroke, tooltipProps } = useChartTheme();
 *   <CartesianGrid strokeDasharray="3 3" stroke={gridStroke} />
 *   <XAxis tick={axisTick} tickLine={false} />
 *   <Tooltip {...tooltipProps} />
 *
 * Also exposed to UI extensions on `window.TurboEA.sdk.useChartTheme`
 * (UI SDK 1.9) so extension charts cannot drift from core's look — pair it
 * with `sdk.loadRecharts()` and token colors instead of hand-rolling chart
 * chrome.
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
