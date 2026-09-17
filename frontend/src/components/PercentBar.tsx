/**
 * A small determinate progress bar with its percentage beside it — the one
 * rendering of "N out of 100" in the app.
 *
 * The card-list portal, the inventory grid and the Data Quality report each
 * drew their own `LinearProgress` + caption for the data-quality score, and
 * the `percentage` field type (2.142.0, #1111) needed the same picture again
 * on card detail, in the grid and in portals. One leaf component keeps the
 * geometry identical everywhere; the *colour* stays the caller's — data
 * quality passes its band colour, a plain percentage field passes nothing and
 * gets the theme primary, because a percentage is a quantity, not a verdict.
 *
 * Deliberately a leaf (MUI only, no feature imports) so it can be re-exported
 * on the extension UI SDK without a module cycle.
 */

import Box from "@mui/material/Box";
import LinearProgress from "@mui/material/LinearProgress";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import { brand } from "@/theme/tokens";

export interface PercentBarProps {
  /** 0–100. `null`/`undefined` read as 0; anything outside is clamped. */
  value: number | null | undefined;
  /** Bar colour; defaults to the theme primary. */
  color?: string;
  /** Bar width — a number of pixels or any CSS width. Defaults to 60. */
  width?: number | string;
  /** Bar height in pixels; the radius follows. Defaults to 4. */
  height?: number;
  /** Track colour behind the fill. */
  trackColor?: string;
  /** Show the rounded percentage next to the bar. Defaults to true. */
  showLabel?: boolean;
  /** Optional tooltip over the whole bar + label. */
  tooltip?: string;
  /** Caption size / weight / colour for the label. */
  labelSx?: Record<string, unknown>;
}

/** The number a `PercentBar` draws: rounded, clamped to 0–100, blank → 0. */
export function percentValue(value: number | null | undefined): number {
  const n = typeof value === "number" && Number.isFinite(value) ? value : Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.min(100, Math.max(0, Math.round(n)));
}

export function PercentBar({
  value,
  color = brand.primary,
  width = 60,
  height = 4,
  trackColor = "action.selected",
  showLabel = true,
  tooltip,
  labelSx,
}: PercentBarProps) {
  const v = percentValue(value);
  const label = `${v}%`;
  const bar = (
    <Box
      component="span"
      role="img"
      aria-label={tooltip ?? label}
      sx={{ display: "inline-flex", alignItems: "center", gap: 1, maxWidth: "100%" }}
    >
      <LinearProgress
        variant="determinate"
        value={v}
        sx={{
          width,
          flexShrink: 0,
          height,
          borderRadius: height / 2,
          bgcolor: trackColor,
          "& .MuiLinearProgress-bar": { bgcolor: color, borderRadius: height / 2 },
        }}
      />
      {showLabel && (
        <Typography
          component="span"
          variant="caption"
          sx={{ minWidth: 32, textAlign: "right", fontVariantNumeric: "tabular-nums", ...labelSx }}
        >
          {label}
        </Typography>
      )}
    </Box>
  );
  return tooltip ? <Tooltip title={tooltip}>{bar}</Tooltip> : bar;
}

export default PercentBar;
