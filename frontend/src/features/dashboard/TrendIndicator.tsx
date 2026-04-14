import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import { useTheme } from "@mui/material/styles";
import MaterialSymbol from "@/components/MaterialSymbol";

interface Props {
  /** Signed % change vs the comparison snapshot, or null when no baseline exists. */
  deltaPct: number | null;
  /**
   * Signed absolute change (e.g. +5 new cards). Omit (or pass undefined) to
   * hide the parenthesised "(+N)" suffix — useful for percentage KPIs where
   * the point-change isn't a meaningful additional signal. Null is treated
   * the same as undefined (no baseline yet).
   */
  deltaAbs?: number | null;
  /**
   * Formatter for the absolute delta. Defaults to signed integer / 1-decimal
   * float. Percentage KPIs can override to append " pts" etc.
   */
  formatAbs?: (value: number) => string;
  /** Which direction is "good" for this KPI — used to color the indicator. */
  goodDirection: "up" | "down";
}

const defaultFormatAbs = (value: number): string => {
  // Prefix non-negative values with "+" so the baseline reads "+0" and
  // deltas read consistently ("+5", "-3") regardless of sign.
  const sign = value >= 0 ? "+" : "";
  const formatted = Number.isInteger(value) ? value.toString() : value.toFixed(1);
  return `${sign}${formatted}`;
};

/**
 * Small inline delta indicator rendered in the top-right of a Dashboard KPI
 * tile. Always renders a concrete value — "+0.0%" in a muted colour on a
 * fresh install with no baseline, and a coloured up/down arrow whenever any
 * movement has occurred (including small counts like +1 that produce <1 %
 * change on a large base).
 */
export default function TrendIndicator({
  deltaPct,
  deltaAbs,
  formatAbs = defaultFormatAbs,
  goodDirection,
}: Props) {
  const theme = useTheme();

  const pct = deltaPct ?? 0;
  const abs = deltaAbs ?? 0;
  const showAbs = deltaAbs !== undefined && deltaAbs !== null;

  // Flat only when nothing has actually moved. Direction is driven by abs
  // first (integer count is ground truth), falling back to pct for
  // percentage-only KPIs like avg_data_quality.
  const isFlat = abs === 0 && pct === 0;
  const signFromAbs = abs !== 0 ? Math.sign(abs) : 0;
  const signFromPct = pct !== 0 ? Math.sign(pct) : 0;
  const direction = signFromAbs !== 0 ? signFromAbs : signFromPct;

  let icon: string;
  let color: string;
  if (isFlat || direction === 0) {
    icon = "trending_flat";
    color = theme.palette.text.secondary;
  } else {
    const isUp = direction > 0;
    icon = isUp ? "trending_up" : "trending_down";
    const isImprovement = (isUp && goodDirection === "up") || (!isUp && goodDirection === "down");
    color = isImprovement ? theme.palette.success.main : theme.palette.error.main;
  }

  const pctSign = pct >= 0 ? "+" : "";
  const pctLabel = `${pctSign}${pct.toFixed(1)}%`;

  return (
    <Box sx={{ display: "inline-flex", alignItems: "center", gap: 0.5 }}>
      <MaterialSymbol icon={icon} size={16} color={color} />
      <Typography variant="caption" sx={{ color, fontWeight: 600 }}>
        {pctLabel}
      </Typography>
      {showAbs && (
        <Typography variant="caption" sx={{ color, fontWeight: 500 }}>
          ({formatAbs(abs)})
        </Typography>
      )}
    </Box>
  );
}
