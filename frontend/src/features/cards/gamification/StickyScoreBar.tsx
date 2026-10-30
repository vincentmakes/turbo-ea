/**
 * The slim score bar that follows the reader down a card page once its header
 * (and the pill in it) has scrolled away. Gamified data quality only: the page
 * mounts it while the admin toggle is on, and slides it in and out with the
 * header's visibility.
 *
 * Fixed under the 64 px app bar, at `zIndex` 1090 — below the app bar (1100)
 * and the impersonation banner (1099). It plays a gain exactly as the pill
 * does, through the same `ScoreBar` and `ScoreGainBurst`: while it is open its
 * figure (`onFigureRef`) is where a gain's orb lands, so a gain with an origin
 * waits for `impactNonce`, then flashes, haloes, glows and shines. A loss
 * drains the bar, counts down and dims the figure, as on the pill.
 *
 * The figure is handed over only once the bar has finished sliding in, and
 * taken back (`null`) as it starts sliding out: measured mid-slide it sits
 * above the viewport, and an orb aimed there flies off the top of the page.
 */
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import Box from "@mui/material/Box";
import Slide from "@mui/material/Slide";
import Typography from "@mui/material/Typography";
import { bandColor } from "@/lib/dataQualityBands";
import { STATUS_COLORS } from "@/theme/tokens";
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
  impactNonce = null,
  onFigureRef,
}: {
  open: boolean;
  name: string;
  value: number;
  gain: ScoreGain | null;
  /** The nonce of the last gain whose orb has landed (`GainFlight`'s `onImpact`). */
  impactNonce?: number | null;
  /** Receives the figure's box, the orb's landing target while the bar is open. */
  onFigureRef?: (el: HTMLElement | null) => void;
}) {
  const { t } = useTranslation("cards");
  const reduced = useReducedMotion();
  const v = Math.max(0, Math.min(100, Math.round(value)));
  const color = bandColor(v);
  const loss = gain?.direction === "loss";
  const flying = !!gain && !loss && !!gain.originAnchor && !reduced;
  const landed = flying && impactNonce === gain.nonce;
  const waiting = flying && !landed;
  const shown = Math.round(
    useAnimatedNumber(
      waiting ? Math.max(0, Math.min(100, Math.round(gain.from))) : v,
      !reduced,
      flying || loss ? 0 : GHOST_HOLD_MS,
      loss,
    ),
  );
  const showBurst = !!gain && (loss ? reduced || !gain.originAnchor : !waiting);

  // The figure's box, handed over once the Slide has entered and withdrawn as
  // it starts to leave or when the bar unmounts. Under reduced motion the orb
  // never flies, so the figure is handed over as soon as it exists.
  const [figure, setFigure] = useState<HTMLElement | null>(null);
  const [entered, setEntered] = useState(false);
  const ready = entered || reduced;
  useEffect(() => {
    if (!onFigureRef) return;
    onFigureRef(ready ? figure : null);
    return () => onFigureRef(null);
  }, [figure, onFigureRef, ready]);

  return (
    <Slide
      direction="down"
      in={open}
      mountOnEnter
      unmountOnExit
      appear={!reduced}
      onEntered={() => setEntered(true)}
      onExit={() => setEntered(false)}
    >
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
            ghostColor={loss ? STATUS_COLORS.error : undefined}
            fillOn={flying ? landed : undefined}
            shineKey={landed ? gain.nonce : null}
            height={10}
            radius={5}
            sx={{ flex: 1, minWidth: 48 }}
          />
          <Box
            ref={setFigure}
            data-testid="sticky-score-figure"
            className={landed ? "dq-impact" : undefined}
            sx={{ position: "relative", display: "inline-flex", flexShrink: 0, borderRadius: "4px" }}
          >
            <Typography
              key={loss && !reduced ? `dim-${gain.nonce}` : "figure"}
              variant="caption"
              fontWeight={700}
              data-testid="sticky-score-value"
              className={loss && !reduced ? "dq-dim" : undefined}
              sx={{ color, minWidth: 36, textAlign: "right" }}
            >
              {shown}%
            </Typography>
            {landed && (
              <>
                <Box
                  key={`flash-${gain.nonce}`}
                  aria-hidden
                  data-testid="sticky-score-flash"
                  className="dq-flash"
                  sx={{
                    position: "absolute",
                    inset: 0,
                    borderRadius: "4px",
                    bgcolor: "common.white",
                    opacity: 0,
                    pointerEvents: "none",
                  }}
                />
                <Box
                  key={`halo-${gain.nonce}`}
                  aria-hidden
                  data-testid="sticky-score-halo"
                  className="dq-halo"
                  sx={{
                    position: "absolute",
                    inset: 0,
                    borderRadius: "4px",
                    border: `2px solid ${bandColor(gain.to)}`,
                    opacity: 0,
                    pointerEvents: "none",
                  }}
                />
                <Box
                  key={`impact-glow-${gain.nonce}`}
                  aria-hidden
                  data-testid="sticky-score-impact-glow"
                  className="dq-impact-glow"
                  sx={{
                    position: "absolute",
                    inset: 0,
                    borderRadius: "4px",
                    // Static shadow; only the opacity animates.
                    boxShadow: `0 0 18px 2px ${bandColor(gain.to)}`,
                    opacity: 0,
                    pointerEvents: "none",
                  }}
                />
              </>
            )}
            {showBurst && <ScoreGainBurst key={gain.nonce} gain={gain} placement="inline" />}
          </Box>
        </Box>
      </Box>
    </Slide>
  );
}

export default StickyScoreBar;
