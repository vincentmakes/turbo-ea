/**
 * The data-quality bar shared by the score pill and the sticky score bar, so
 * the two always move the same way.
 *
 * Both fills are full-width layers scaled with `transform: scaleX(value/100)`
 * from the start edge — compositor-only, no layout per frame. While a gain
 * plays (`animate` and a `ghostFrom` below `value`):
 *
 * - the **ghost** (`ghostColor`, the band colour by default, at 35 %) is at
 *   the new score at once, so the size of the gain is readable before anything
 *   moves;
 * - the **fill** holds at the old score, then grows into the ghost over
 *   `FILL_MS` with the standard-decelerate easing. Without `fillOn` the hold is
 *   `GHOST_HOLD_MS`; with `fillOn` (a gain flying in from the saved section)
 *   the fill holds for as long as `fillOn` is false — until the orb lands —
 *   and then grows with no delay.
 *
 * While a loss plays (`ghostFrom` above `value`) the bar **drains**: the fill
 * shrinks to the new score over `FILL_MS` at once, and the ghost
 * (`ghostColor`, the error colour by default) holds at the old score for
 * `GHOST_HOLD_MS` before shrinking after it, so the lost width shows in red
 * for a moment. `fillOn` does not hold a loss: points leave at launch.
 *
 * Anything else — no change, `animate` off, reduced motion — sets the fill
 * without a transition, and no ghost is drawn.
 *
 * The motion is **armed one paint late**: on the render that brings the change
 * the layers stay at the old score, and only after two animation frames do
 * they get the new score with their transitions. A save re-renders the whole
 * card page, and a transition that starts in the same style commit as that
 * heavy render is clocked from the commit, not from the first painted frame —
 * it came out late and compressed into a jump in the browser. Painting the old
 * score first gives the hold and the fill their full durations.
 */
import { useEffect, useState } from "react";
import Box from "@mui/material/Box";
import { alpha, type SxProps, type Theme } from "@mui/material/styles";
import { STATUS_COLORS } from "@/theme/tokens";
import { EASE_DECELERATE, FILL_MS, GHOST_HOLD_MS } from "./scoreGain";
import { useReducedMotion } from "./useReducedMotion";

export interface ScoreBarProps {
  /** 0–100. */
  value: number;
  /** The band colour (`bandColor(value)`). */
  color: string;
  animate?: boolean;
  /** The score before the change being played; omit when nothing is playing. */
  ghostFrom?: number | null;
  /** The ghost's colour; defaults to `color` for a gain, the error colour for a loss. */
  ghostColor?: string;
  /** Hold a gain's fill until this turns true (the orb's impact); omit for the
   * fixed `GHOST_HOLD_MS` hold. */
  fillOn?: boolean;
  height?: number | string;
  /** Corner radius; a number is pixels. */
  radius?: number | string;
  /** Paint a track behind the fill (off for the pill, which has its own border). */
  track?: boolean;
  /** Sweep a shine across the bar; each new value replays it (the impact's nonce). */
  shineKey?: number | null;
  sx?: SxProps<Theme>;
}

/**
 * The impact's light sweep: a 40 %-wide white-to-transparent band crossing its
 * (positioned, clipped) parent once, `transform` only. Starts off the start
 * edge, so it shows nothing where the animation is switched off.
 */
export function ImpactShine({ testId }: { testId: string }) {
  return (
    <Box
      component="span"
      aria-hidden
      data-testid={testId}
      className="dq-shine"
      sx={{
        position: "absolute",
        top: 0,
        bottom: 0,
        left: 0,
        width: "40%",
        background: (theme) =>
          `linear-gradient(90deg, transparent, ${alpha(theme.palette.common.white, 0.8)}, transparent)`,
        transform: "translateX(-100%)",
        pointerEvents: "none",
      }}
    />
  );
}

const clamp = (v: number) => Math.max(0, Math.min(100, v));

export function ScoreBar({
  value,
  color,
  animate = false,
  ghostFrom = null,
  ghostColor,
  fillOn,
  height = 8,
  radius = 4,
  track = true,
  shineKey = null,
  sx,
}: ScoreBarProps) {
  const reduced = useReducedMotion();
  const v = clamp(value);
  const moving = animate && !reduced && ghostFrom !== null;
  const rising = moving && (ghostFrom as number) < v;
  const draining = moving && (ghostFrom as number) > v;
  const playing = rising || draining;
  // A gain waiting for its orb to land: the ghost shows, the fill holds.
  const armable = playing && !(rising && fillOn === false);
  // The change the layers have been armed for (its `ghostFrom`), or null while
  // the old score is still being painted.
  const [armedFor, setArmedFor] = useState<number | null>(null);
  useEffect(() => {
    if (!armable) {
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
  }, [armable, ghostFrom, v]);
  const armed = armable && armedFor === ghostFrom;
  const old = clamp(ghostFrom ?? v);
  const fillScale = playing && !armed ? old : v;
  const ghostScale = rising || armed ? v : old;
  const fillDelay = rising && fillOn === undefined ? GHOST_HOLD_MS : 0;
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
          sx={{
            ...layer,
            bgcolor: ghostColor ?? (draining ? STATUS_COLORS.error : color),
            opacity: 0.35,
            transform: `scaleX(${ghostScale / 100})`,
            transition: draining
              ? `transform ${FILL_MS}ms ${EASE_DECELERATE} ${GHOST_HOLD_MS}ms`
              : "none",
          }}
        />
      )}
      <Box
        data-testid="score-bar-fill"
        className="dq-fill"
        sx={{
          ...layer,
          transform: `scaleX(${fillScale / 100})`,
          transition: playing
            ? `transform ${FILL_MS}ms ${EASE_DECELERATE} ${fillDelay}ms`
            : "none",
        }}
      />
      {shineKey !== null && !reduced && <ImpactShine key={shineKey} testId="score-bar-shine" />}
    </Box>
  );
}

export default ScoreBar;
