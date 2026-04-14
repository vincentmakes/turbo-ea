import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import { useTheme } from "@mui/material/styles";
import MaterialSymbol from "@/components/MaterialSymbol";

interface Props {
  /** Signed % change vs the comparison snapshot, or null when no baseline exists. */
  deltaPct: number | null;
  /** Signed absolute change (e.g. +5 new cards). Null when no baseline exists. */
  deltaAbs?: number | null;
  /**
   * Formatter for the absolute delta. Defaults to signed integer / 1-decimal
   * float. Percentage KPIs can override to append " pts" etc.
   */
  formatAbs?: (value: number) => string;
  /** Which direction is "good" for this KPI — used to color the indicator. */
  goodDirection: "up" | "down";
}

const FLAT_THRESHOLD = 0.5;

const defaultFormatAbs = (value: number): string => {
  // Prefix non-negative values with "+" so the baseline reads "+0" and
  // deltas read consistently ("+5", "-3") regardless of sign.
  const sign = value >= 0 ? "+" : "";
  const formatted = Number.isInteger(value) ? value.toString() : value.toFixed(1);
  return `${sign}${formatted}`;
};

/**
 * Small inline delta indicator rendered under a Dashboard KPI value. Follows
 * the dashboard-metric convention of always showing a value (0 % / +0 when
 * no change, coloured arrow when the metric is moving) instead of disappearing
 * or rendering a "collecting data" placeholder per tile.
 */
export default function TrendIndicator({
  deltaPct,
  deltaAbs = null,
  formatAbs = defaultFormatAbs,
  goodDirection,
}: Props) {
  const theme = useTheme();

  // Treat missing data as zero so the indicator always renders a concrete
  // value — visually consistent across tiles whether the metric is stable,
  // moving, or we don't yet have a historical baseline.
  const pct = deltaPct ?? 0;
  const abs = deltaAbs ?? 0;
  const isFlat = Math.abs(pct) < FLAT_THRESHOLD;

  let icon: string;
  let color: string;
  if (isFlat) {
    icon = "trending_flat";
    color = theme.palette.text.secondary;
  } else {
    const isUp = pct > 0;
    icon = isUp ? "trending_up" : "trending_down";
    const isImprovement = (isUp && goodDirection === "up") || (!isUp && goodDirection === "down");
    color = isImprovement ? theme.palette.success.main : theme.palette.error.main;
  }

  // Non-negative values get a "+" prefix so the baseline reads "+0.0%".
  const pctSign = pct >= 0 ? "+" : "";
  const pctLabel = `${pctSign}${pct.toFixed(1)}%`;
  const absLabel = formatAbs(abs);

  return (
    <Box sx={{ display: "inline-flex", alignItems: "center", gap: 0.5, mt: 0.5 }}>
      <MaterialSymbol icon={icon} size={16} color={color} />
      <Typography variant="caption" sx={{ color, fontWeight: 600 }}>
        {pctLabel}
      </Typography>
      <Typography variant="caption" sx={{ color, fontWeight: 500 }}>
        ({absLabel})
      </Typography>
    </Box>
  );
}
