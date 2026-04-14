import Box from "@mui/material/Box";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import { useTheme } from "@mui/material/styles";
import { useTranslation } from "react-i18next";
import MaterialSymbol from "@/components/MaterialSymbol";

interface Props {
  /** Signed % change vs the comparison snapshot, or null if unavailable. */
  deltaPct: number | null;
  /** Which direction is "good" for this KPI — used to color the indicator. */
  goodDirection: "up" | "down";
  /** Window the comparison spans, e.g. 30 days. */
  comparisonDays: number;
}

const FLAT_THRESHOLD = 0.5;

/**
 * Small inline chip showing a KPI's trend versus the previous period.
 * Renders nothing when no comparison snapshot is available (cold start).
 */
export default function TrendIndicator({ deltaPct, goodDirection, comparisonDays }: Props) {
  const theme = useTheme();
  const { t } = useTranslation("common");

  if (deltaPct === null || deltaPct === undefined) return null;

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
  const label = isFlat ? t("dashboard.trend.flat") : `${sign}${deltaPct.toFixed(1)}%`;
  const tooltipLabel = t("dashboard.trend.vsDays", { count: comparisonDays });

  return (
    <Tooltip title={tooltipLabel} arrow>
      <Box
        sx={{ display: "inline-flex", alignItems: "center", gap: 0.25, mt: 0.5 }}
        aria-label={`${label} ${tooltipLabel}`}
      >
        <MaterialSymbol icon={icon} size={16} color={color} />
        <Typography variant="caption" sx={{ color, fontWeight: 600 }}>
          {label}
        </Typography>
        <Typography variant="caption" color="text.secondary" sx={{ ml: 0.5 }}>
          {tooltipLabel}
        </Typography>
      </Box>
    </Tooltip>
  );
}
