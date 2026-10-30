/**
 * The one place a gain — or a loss — is announced to assistive tech.
 *
 * A live region only announces changes to content it already had: a `status`
 * element that mounts together with its text is often read as nothing at all.
 * So this stays mounted (empty) for as long as the pill animates, receives the
 * announcement when a gain plays, and clears itself once the burst is over so
 * an identical gain on the next save is announced again.
 *
 * Rendered by the pill alone — the sticky score bar plays the same gain
 * visually but never announces it, or a reader would hear every gain twice.
 */
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import Box from "@mui/material/Box";
import {
  ANNOUNCEMENT_LINGER_MS,
  burstLifetime,
  gainAnnouncement,
  type ScoreGain,
} from "./scoreGain";
import { useReducedMotion } from "./useReducedMotion";

/** Read by screen readers, invisible on screen. */
const visuallyHidden = {
  position: "absolute",
  width: 1,
  height: 1,
  overflow: "hidden",
  clip: "rect(0 0 0 0)",
  whiteSpace: "nowrap",
  border: 0,
  m: "-1px",
  p: 0,
} as const;

export function GainLiveRegion({ gain }: { gain: ScoreGain | null }) {
  const { t } = useTranslation("cards");
  const reduced = useReducedMotion();
  const [text, setText] = useState("");

  useEffect(() => {
    if (!gain) return;
    setText(gainAnnouncement(gain, t));
    const id = setTimeout(() => setText(""), burstLifetime(gain, reduced) + ANNOUNCEMENT_LINGER_MS);
    return () => clearTimeout(id);
  }, [gain, reduced, t]);

  return (
    <Box
      component="span"
      role="status"
      aria-live="polite"
      data-testid="score-gain-announcement"
      sx={visuallyHidden}
    >
      {text}
    </Box>
  );
}

export default GainLiveRegion;
