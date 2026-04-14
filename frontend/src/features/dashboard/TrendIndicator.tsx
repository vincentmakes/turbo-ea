import Box from "@mui/material/Box";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import { useTheme } from "@mui/material/styles";
import { useTranslation } from "react-i18next";
import MaterialSymbol from "@/components/MaterialSymbol";

interface Props {
  /** Signed % change vs the comparison snapshot, or null if unavailable. */
  deltaPct: number | null;
  /**
   * Signed absolute change (e.g. +5 new cards). When provided and non-zero it
   * is shown next to the percentage, e.g. "+10.2% (+5)". Pass null to hide.
   */
  deltaAbs?: number | null;
  /**
   * Formatter for the absolute delta. Defaults to signed integer ("+5"), but
   * percentage KPIs can use e.g. (n) => `${n > 0 ? "+" : ""}${n.toFixed(1)} pts`.
   */
  formatAbs?: (value: number) => string;
  /** Which direction is "good" for this KPI — used to color the indicator. */
  goodDirection: "up" | "down";
  /** Window the comparison spans (actual snapshot age in days). */
  comparisonDays: number;
  /**
   * When false, the backend doesn't yet have a comparable snapshot so we
   * render a muted placeholder instead of an arrow.
   */
  snapshotAvailable?: boolean;
}

const FLAT_THRESHOLD = 0.5;

const defaultFormatAbs = (value: number): string => {
  const sign = value > 0 ? "+" : "";
  // Integer counts stay as integers; floats (like avg_data_quality) keep one decimal.
  const formatted = Number.isInteger(value) ? value.toString() : value.toFixed(1);
  return `${sign}${formatted}`;
};

/**
 * Small indicator rendered under a Dashboard KPI tile showing how the value
 * has changed vs the comparison snapshot. Renders a muted "collecting data"
 * hint on fresh installs where no comparable snapshot exists yet.
 */
export default function TrendIndicator({
  deltaPct,
  deltaAbs = null,
  formatAbs = defaultFormatAbs,
  goodDirection,
  comparisonDays,
  snapshotAvailable = true,
}: Props) {
  const theme = useTheme();
  const { t } = useTranslation("common");

  const windowLabel = t("dashboard.trend.vsDays", { count: comparisonDays });

  // No history yet — show a muted hint so users know trends are coming.
  if (!snapshotAvailable || deltaPct === null || deltaPct === undefined) {
    return (
      <Tooltip title={t("dashboard.trend.collecting")} arrow>
        <Box sx={{ display: "flex", flexDirection: "column", mt: 0.5 }}>
          <Typography variant="caption" color="text.secondary">
            {t("dashboard.trend.collecting")}
          </Typography>
        </Box>
      </Tooltip>
    );
  }

  const isFlat = Math.abs(deltaPct) < FLAT_THRESHOLD;
  const isUp = deltaPct > 0;

  let icon: string;
  let color: string;
  if (isFlat) {
    icon = "trending_flat";
    color = theme.palette.text.secondary;
  } else {
    icon = isUp ? "trending_up" : "trending_down";
    const isImprovement = (isUp && goodDirection === "up") || (!isUp && goodDirection === "down");
    color = isImprovement ? theme.palette.success.main : theme.palette.error.main;
  }

  const sign = deltaPct > 0 ? "+" : "";
  const pctLabel = isFlat ? t("dashboard.trend.flat") : `${sign}${deltaPct.toFixed(1)}%`;
  const absLabel = deltaAbs !== null && deltaAbs !== undefined && !isFlat ? formatAbs(deltaAbs) : "";

  return (
    <Box sx={{ display: "flex", flexDirection: "column", mt: 0.5 }}>
      <Box sx={{ display: "inline-flex", alignItems: "center", gap: 0.5 }}>
        <MaterialSymbol icon={icon} size={16} color={color} />
        <Typography variant="caption" sx={{ color, fontWeight: 600 }}>
          {pctLabel}
        </Typography>
        {absLabel && (
          <Typography variant="caption" sx={{ color, fontWeight: 500 }}>
            ({absLabel})
          </Typography>
        )}
      </Box>
      <Typography variant="caption" color="text.secondary" sx={{ lineHeight: 1.2 }}>
        {windowLabel}
      </Typography>
    </Box>
  );
}
