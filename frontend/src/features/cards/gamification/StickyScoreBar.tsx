/**
 * The slim score bar that follows the reader down a card page once its header
 * (and the pill in it) has scrolled away. Gamified data quality only: the page
 * mounts it while the admin toggle is on, and slides it in and out with the
 * header's visibility.
 *
 * Fixed under the 64 px app bar, at `zIndex` 1090 — below the app bar (1100)
 * and the impersonation banner (1099). It plays a gain exactly as the pill
 * does, through the same `ScoreBar` and `ScoreGainBurst`.
 */
import { useTranslation } from "react-i18next";
import Box from "@mui/material/Box";
import Slide from "@mui/material/Slide";
import Typography from "@mui/material/Typography";
import { bandColor } from "@/lib/dataQualityBands";
import { GHOST_HOLD_MS, type ScoreGain } from "./scoreGain";
import { ScoreBar } from "./ScoreBar";
import { ScoreGainBurst } from "./ScoreGainBurst";
import { APP_BAR_OFFSET } from "./useHeaderOffscreen";
import { useAnimatedNumber } from "./useAnimatedNumber";
import { useReducedMotion } from "./useReducedMotion";

export const STICKY_SCORE_BAR_Z_INDEX = 1090;

export function StickyScoreBar({
  open,
  name,
  value,
  gain,
}: {
  open: boolean;
  name: string;
  value: number;
  gain: ScoreGain | null;
}) {
  const { t } = useTranslation("cards");
  const reduced = useReducedMotion();
  const v = Math.max(0, Math.min(100, Math.round(value)));
  const color = bandColor(v);
  const shown = Math.round(useAnimatedNumber(v, !reduced, GHOST_HOLD_MS));

  return (
    <Slide direction="down" in={open} mountOnEnter unmountOnExit appear={!reduced}>
      <Box
        data-testid="sticky-score-bar"
        role="region"
        aria-label={t("dataQuality.stickyBarLabel")}
        sx={{
          position: "fixed",
          top: APP_BAR_OFFSET,
          left: 0,
          right: 0,
          zIndex: STICKY_SCORE_BAR_Z_INDEX,
          bgcolor: "background.paper",
          borderBottom: 1,
          borderColor: "divider",
          px: { xs: 2, sm: 3 },
          py: 0.75,
        }}
      >
        <Box
          sx={{
            maxWidth: 960,
            mx: "auto",
            display: "flex",
            alignItems: "center",
            gap: 1.5,
          }}
        >
          <Typography
            variant="body2"
            fontWeight={600}
            noWrap
            sx={{ minWidth: 0, flex: "0 1 auto", maxWidth: "40%" }}
          >
            {name}
          </Typography>
          <ScoreBar
            value={v}
            color={color}
            animate
            ghostFrom={gain?.from ?? null}
            height={10}
            radius={5}
            sx={{ flex: 1, minWidth: 48 }}
          />
          <Box sx={{ position: "relative", display: "inline-flex", flexShrink: 0 }}>
            <Typography
              variant="caption"
              fontWeight={700}
              data-testid="sticky-score-value"
              sx={{ color, minWidth: 36, textAlign: "right" }}
            >
              {shown}%
            </Typography>
            {gain && <ScoreGainBurst key={gain.nonce} gain={gain} placement="inline" />}
          </Box>
        </Box>
      </Box>
    </Slide>
  );
}

export default StickyScoreBar;
