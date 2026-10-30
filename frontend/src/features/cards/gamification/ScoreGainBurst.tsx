/**
 * What a change looks like for a moment: a "+X%" that rises and fades over its
 * anchor, and — for a milestone only — 14 confetti particles and a caption. A
 * loss is the same float as "−X%" in the error colour, and never celebrates.
 * The gain is announced to assistive tech by the pill's persistent
 * `GainLiveRegion`, not here: a status element that mounts with its text is
 * often not read at all.
 *
 * With reduced motion it is a static chip — success "+X%" (and the caption,
 * for a milestone), or error "−X%" for a loss — for two seconds: no movement,
 * no particles.
 *
 * Render it inside a positioned box, keyed by the gain's `nonce`; it covers
 * that box without taking pointer events and unmounts itself when done.
 */
import { useEffect, useState, type CSSProperties } from "react";
import { useTranslation } from "react-i18next";
import Box from "@mui/material/Box";
import Chip from "@mui/material/Chip";
import type { SxProps, Theme } from "@mui/material/styles";
import { STATUS_COLORS } from "@/theme/tokens";
import {
  CONFETTI_COUNT,
  burstLifetime,
  changeLabel,
  confettiParticle,
  type ScoreGain,
} from "./scoreGain";
import { useDqMotionStyles } from "./useDqMotionStyles";
import { useReducedMotion } from "./useReducedMotion";

export function ScoreGainBurst({
  gain,
  placement = "above",
  sx,
}: {
  gain: ScoreGain;
  /** Where the "+X%" starts: above the anchor, or on it (the sticky bar, which
   * has the app bar right above it). */
  placement?: "above" | "inline";
  sx?: SxProps<Theme>;
}) {
  const { t } = useTranslation("cards");
  const reduced = useReducedMotion();
  useDqMotionStyles();
  const [done, setDone] = useState(false);

  const lifetime = burstLifetime(gain, reduced);
  useEffect(() => {
    const id = setTimeout(() => setDone(true), lifetime);
    return () => clearTimeout(id);
  }, [lifetime]);

  if (done) return null;

  const loss = gain.direction === "loss";
  const label = changeLabel(gain);
  const milestone = loss ? null : gain.milestone;
  const caption =
    milestone === "perfect"
      ? t("dataQuality.milestonePerfect")
      : milestone === "complete"
        ? t("dataQuality.milestoneComplete")
        : null;

  return (
    <Box
      data-testid="score-gain-burst"
      sx={[
        {
          position: "absolute",
          inset: 0,
          pointerEvents: "none",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          overflow: "visible",
          zIndex: 2,
        },
        ...(Array.isArray(sx) ? sx : [sx]),
      ]}
    >
      {reduced ? (
        <Box
          aria-hidden
          sx={{
            position: "absolute",
            ...(placement === "above"
              ? { bottom: "100%", mb: 0.5 }
              : { right: "100%", mr: 1 }),
            display: "flex",
            alignItems: "center",
            gap: 0.5,
            whiteSpace: "nowrap",
          }}
        >
          <Chip
            data-testid="score-gain-chip"
            size="small"
            color={loss ? "error" : "success"}
            label={label}
          />
          {caption && (
            <Box component="span" sx={{ fontSize: "0.75rem", fontWeight: 700, color: "success.main" }}>
              {caption}
            </Box>
          )}
        </Box>
      ) : (
        <>
          <Box
            aria-hidden
            data-testid="score-gain-float"
            className="dq-float"
            component="span"
            sx={{
              position: "absolute",
              ...(placement === "above" && { bottom: "100%" }),
              fontSize: "0.8rem",
              fontWeight: 800,
              color: loss ? STATUS_COLORS.error : STATUS_COLORS.success,
              whiteSpace: "nowrap",
              opacity: 0,
            }}
          >
            {label}
          </Box>
          {caption && (
            <Box
              aria-hidden
              data-testid="score-gain-caption"
              className="dq-caption"
              component="span"
              sx={{
                position: "absolute",
                top: "100%",
                mt: 0.5,
                fontSize: "0.75rem",
                fontWeight: 700,
                color: "success.main",
                whiteSpace: "nowrap",
                opacity: 0,
              }}
            >
              {caption}
            </Box>
          )}
          {milestone &&
            Array.from({ length: CONFETTI_COUNT }, (_, i) => {
              const p = confettiParticle(i);
              return (
                <Box
                  key={i}
                  aria-hidden
                  component="span"
                  data-testid="score-gain-confetti"
                  className="dq-confetti"
                  style={
                    {
                      "--dx": `${p.dx}px`,
                      "--dy": `${p.dy}px`,
                      "--rot": `${p.rotate}deg`,
                    } as CSSProperties
                  }
                  sx={{
                    position: "absolute",
                    width: 6,
                    height: 6,
                    borderRadius: "1px",
                    bgcolor: p.color,
                    opacity: 0,
                  }}
                />
              );
            })}
        </>
      )}
    </Box>
  );
}

export default ScoreGainBurst;
