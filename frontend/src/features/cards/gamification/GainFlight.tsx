/**
 * The "+X%" that flies from the section a save came from to the health bar —
 * an RPG health gain — and, for a loss, the "−X%" that flies off the bar back
 * to the section where the data was cleared.
 *
 * Mounted by the card page (keyed by the change's `nonce`) when gamified data
 * quality is on and the change carries an `originAnchor`. On mount it measures
 * the section's header row (24 px below its top edge, at the centre of its
 * right third, where the edit pencil and Save sit) and the centre of
 * `targetEl` (the pill, or the sticky bar's figure while it is open), then
 * portals a fixed-position orb into `document.body` and moves it along a
 * quadratic arc with the Web Animations API over a fixed `FLIGHT_MS` — the
 * arc and the distance scale, never the duration, so the choreography stays
 * predictable. A gain trails two fainter copies (a comet tail); a loss flies
 * alone and fades over its last 30 %.
 *
 * The gain's orb landing is the **impact**: `onImpact(nonce)` fires, and the
 * pill and the sticky bar start their fill, count-up, flash and burst. A loss
 * calls it on arrival at the section too, though nothing waits for it. No
 * origin element or reduced motion: `onImpact` at once and no orb. No target
 * yet — the sticky bar is still sliding in, so it has not handed over its
 * figure — waits up to `TARGET_WAIT_MS` for one, then gives up the same way.
 * Without `Element.prototype.animate` (jsdom) a `FLIGHT_MS` timer stands in.
 */
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Box from "@mui/material/Box";
import { STATUS_COLORS } from "@/theme/tokens";
import {
  EASE_STANDARD,
  FLIGHT_MS,
  centrePoint,
  changeLabel,
  flightKeyframes,
  originPoint,
  type FlightPoint,
  type ScoreGain,
} from "./scoreGain";
import { useReducedMotion } from "./useReducedMotion";

/** Above the sticky score bar (1090) and the app bar (1100). */
export const GAIN_FLIGHT_Z_INDEX = 1200;
/** How long a flight waits for a target that is not there yet (the sticky bar
 * slides in over 225 ms) before it gives up and reports the impact at once. */
export const TARGET_WAIT_MS = 500;
/** The gain's comet tail, drawn behind the orb: each copy's opacity and lag. */
export const FLIGHT_TRAIL = [
  { opacity: 0.55, delay: 60 },
  { opacity: 0.3, delay: 120 },
] as const;

interface FlightPath {
  from: FlightPoint;
  to: FlightPoint;
}

export function GainFlight({
  gain,
  targetEl,
  onImpact,
}: {
  gain: ScoreGain;
  /** The bar the orb lands on (a gain) or leaves from (a loss). */
  targetEl: HTMLElement | null;
  onImpact: (nonce: number) => void;
}) {
  const reduced = useReducedMotion();
  const [path, setPath] = useState<FlightPath | null>(null);
  const [done, setDone] = useState(false);
  const orbRef = useRef<HTMLDivElement | null>(null);
  const trailRefs = useRef<(HTMLDivElement | null)[]>([]);
  const onImpactRef = useRef(onImpact);
  useEffect(() => {
    onImpactRef.current = onImpact;
  }, [onImpact]);
  const loss = gain.direction === "loss";

  // Measure once, before the first paint. Keyed by the nonce, so a new change
  // is a new mount. A missing target is waited for (the sticky bar hands its
  // figure over only once it has slid in); a missing origin is not.
  const measuredRef = useRef(false);
  useLayoutEffect(() => {
    if (measuredRef.current) return;
    const origin = gain.originAnchor ? document.getElementById(gain.originAnchor) : null;
    const giveUp = () => {
      measuredRef.current = true;
      onImpactRef.current(gain.nonce);
      setDone(true);
    };
    if (!origin || reduced) {
      giveUp();
      return;
    }
    if (!targetEl) {
      const id = setTimeout(giveUp, TARGET_WAIT_MS);
      return () => clearTimeout(id);
    }
    measuredRef.current = true;
    const section = originPoint(origin.getBoundingClientRect());
    const bar = centrePoint(targetEl.getBoundingClientRect());
    setPath(loss ? { from: bar, to: section } : { from: section, to: bar });
  }, [gain.originAnchor, gain.nonce, loss, reduced, targetEl]);

  useLayoutEffect(() => {
    const orb = orbRef.current;
    if (!path || !orb) return;
    const land = () => onImpactRef.current(gain.nonce);
    if (typeof orb.animate !== "function") {
      const id = setTimeout(() => {
        land();
        setDone(true);
      }, FLIGHT_MS);
      return () => clearTimeout(id);
    }
    const timing: KeyframeAnimationOptions = {
      duration: FLIGHT_MS,
      easing: EASE_STANDARD,
      fill: "forwards",
    };
    const main = orb.animate(flightKeyframes(path.from, path.to, gain.direction), timing);
    const trails = loss
      ? []
      : FLIGHT_TRAIL.flatMap((trail, i) => {
          const el = trailRefs.current[i];
          if (!el) return [];
          // `both`: a copy waits on the first frame, under the orb, until its lag is over.
          return [
            el.animate(flightKeyframes(path.from, path.to, "gain", trail.opacity), {
              ...timing,
              delay: trail.delay,
              fill: "both",
            }),
          ];
        });
    let flying = 1 + trails.length;
    const landed = () => {
      flying -= 1;
      if (flying === 0) setDone(true);
    };
    main.onfinish = () => {
      land();
      landed();
    };
    trails.forEach((a) => {
      a.onfinish = landed;
    });
    return () => {
      main.cancel();
      trails.forEach((a) => a.cancel());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path]);

  if (done || !path) return null;

  const colour = loss ? STATUS_COLORS.error : STATUS_COLORS.success;
  const label = changeLabel(gain);
  const start = flightKeyframes(path.from, path.to, gain.direction)[0];
  const orb = (
    testId: string,
    opacity: number,
    ref: (el: HTMLDivElement | null) => void,
    key?: number,
  ) => (
    <Box
      key={key}
      ref={ref}
      aria-hidden
      data-testid={testId}
      style={{ transform: String(start.transform), opacity }}
      sx={{
        position: "fixed",
        left: 0,
        top: 0,
        zIndex: GAIN_FLIGHT_Z_INDEX,
        pointerEvents: "none",
        px: 1,
        py: 0.25,
        borderRadius: "999px",
        bgcolor: colour,
        color: "common.white",
        fontSize: "0.8rem",
        fontWeight: 800,
        lineHeight: 1.4,
        whiteSpace: "nowrap",
        boxShadow: `0 0 14px 4px ${colour}`,
        willChange: "transform, opacity",
      }}
    >
      {label}
    </Box>
  );

  return createPortal(
    <>
      {/* Faintest first, so each copy paints under the one ahead of it. */}
      {!loss &&
        FLIGHT_TRAIL.map((trail, i) => ({ trail, i }))
          .reverse()
          .map(({ trail, i }) =>
            orb("gain-flight-trail", trail.opacity, (el) => {
              trailRefs.current[i] = el;
            }, i),
          )}
      {orb("gain-flight-orb", 1, (el) => {
        orbRef.current = el;
      })}
    </>,
    document.body,
  );
}

export default GainFlight;
