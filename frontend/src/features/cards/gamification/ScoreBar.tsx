/**
 * The data-quality bar shared by the score pill and the sticky score bar, so
 * the two always move the same way.
 *
 * Both fills are full-width layers scaled with `transform: scaleX(value/100)`
 * from the start edge — compositor-only, no layout per frame. While a gain
 * plays (`animate` and a `ghostFrom` below `value`):
 *
 * - the **ghost** (the band colour at 35 %) is at the new score at once, so the
 *   size of the gain is readable before anything moves;
 * - the **fill** holds at the old score for `GHOST_HOLD_MS`, then grows into
 *   the ghost over `FILL_MS` with the standard-decelerate easing.
 *
 * Anything else — no gain, a drop, `animate` off, reduced motion — sets the
 * fill without a transition, and no ghost is drawn.
 *
 * The fill is **armed one paint late**: on the render that brings the gain it
 * stays at the old score, and only after two animation frames does it get the
 * new score with its transition. A save re-renders the whole card page, and a
 * transition that starts in the same style commit as that heavy render is
 * clocked from the commit, not from the first painted frame — it came out late
 * and compressed into a jump in the browser. Painting the old score first
 * gives the hold and the fill their full durations.
 */
import { useEffect, useState } from "react";
import Box from "@mui/material/Box";
import type { SxProps, Theme } from "@mui/material/styles";
import { EASE_DECELERATE, FILL_MS, GHOST_HOLD_MS } from "./scoreGain";
import { useReducedMotion } from "./useReducedMotion";

export interface ScoreBarProps {
  /** 0–100. */
  value: number;
  /** The band colour (`bandColor(value)`). */
  color: string;
  animate?: boolean;
  /** The score before the gain being played; omit when nothing is playing. */
  ghostFrom?: number | null;
  height?: number | string;
  /** Corner radius; a number is pixels. */
  radius?: number | string;
  /** Paint a track behind the fill (off for the pill, which has its own border). */
  track?: boolean;
  sx?: SxProps<Theme>;
}

const clamp = (v: number) => Math.max(0, Math.min(100, v));

export function ScoreBar({
  value,
  color,
  animate = false,
  ghostFrom = null,
  height = 8,
  radius = 4,
  track = true,
  sx,
}: ScoreBarProps) {
  const reduced = useReducedMotion();
  const v = clamp(value);
  const playing = animate && !reduced && ghostFrom !== null && ghostFrom < v;
  // The gain the fill has been armed for (its `ghostFrom`), or null while the
  // old score is still being painted.
  const [armedFor, setArmedFor] = useState<number | null>(null);
  useEffect(() => {
    if (!playing) {
      setArmedFor(null);
      return;
    }
    let second = 0;
    const first = requestAnimationFrame(() => {
      second = requestAnimationFrame(() => setArmedFor(ghostFrom));
    });
    return () => {
      cancelAnimationFrame(first);
      cancelAnimationFrame(second);
    };
  }, [playing, ghostFrom, v]);
  const fillScale = playing && armedFor !== ghostFrom ? clamp(ghostFrom as number) : v;
  const layer = {
    position: "absolute",
    top: 0,
    bottom: 0,
    left: 0,
    width: "100%",
    transformOrigin: "left",
    bgcolor: color,
  } as const;

  return (
    <Box
      data-testid="score-bar"
      sx={[
        {
          position: "relative",
          overflow: "hidden",
          height,
          // A number is pixels, not theme spacing units.
          borderRadius: typeof radius === "number" ? `${radius}px` : radius,
          bgcolor: track ? "action.hover" : "transparent",
        },
        ...(Array.isArray(sx) ? sx : [sx]),
      ]}
    >
      {playing && (
        <Box
          data-testid="score-bar-ghost"
          sx={{ ...layer, opacity: 0.35, transform: `scaleX(${v / 100})` }}
        />
      )}
      <Box
        data-testid="score-bar-fill"
        className="dq-fill"
        sx={{
          ...layer,
          transform: `scaleX(${fillScale / 100})`,
          transition: playing
            ? `transform ${FILL_MS}ms ${EASE_DECELERATE} ${GHOST_HOLD_MS}ms`
            : "none",
        }}
      />
    </Box>
  );
}

export default ScoreBar;
