import { useEffect, useRef, useState } from "react";
import { FILL_MS } from "./scoreGain";

/** Ease-out cubic: fast start, gentle landing. */
export function easeOutCubic(p: number): number {
  return 1 - Math.pow(1 - p, 3);
}

/**
 * The number to show while `target` rises: a `requestAnimationFrame` tween from
 * the value on screen to `target` over `FILL_MS`, starting after `delayMs`.
 *
 * Only a rise counts up; a drop (and anything while `enabled` is false) shows
 * the new value at once. A new target mid-tween starts from wherever the count
 * had got to. The pending frame is cancelled on unmount.
 */
export function useAnimatedNumber(target: number, enabled: boolean, delayMs = 0): number {
  const [display, setDisplay] = useState(target);
  const shown = useRef(target);

  useEffect(() => {
    const from = shown.current;
    if (!enabled || target <= from) {
      shown.current = target;
      setDisplay(target);
      return;
    }
    let raf = 0;
    let start: number | null = null;
    const step = (now: number) => {
      if (start === null) start = now + delayMs;
      const p = Math.max(0, Math.min(1, (now - start) / FILL_MS));
      const v = p >= 1 ? target : from + (target - from) * easeOutCubic(p);
      shown.current = v;
      setDisplay(v);
      if (p < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target, enabled, delayMs]);

  return enabled ? display : target;
}
