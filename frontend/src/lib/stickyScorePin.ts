/**
 * Whether the reader pinned the sticky data-quality score bar on card pages
 * (TurboRPG mode). A per-browser convenience, so it lives in `localStorage`;
 * every access is guarded — storage can be blocked, full or absent (a private
 * window, a preview) — and anything unreadable reads as not pinned.
 *
 * `useStickyScorePin()` shares the value between the bar's pin button and the
 * card page that decides whether the bar is open.
 */
import { useCallback, useSyncExternalStore } from "react";

export const STICKY_SCORE_PIN_KEY = "turboea_dq_sticky_pinned";

export function readPinned(): boolean {
  try {
    return window.localStorage.getItem(STICKY_SCORE_PIN_KEY) === "true";
  } catch {
    return false;
  }
}

const listeners = new Set<() => void>();

export function writePinned(pinned: boolean): void {
  try {
    if (pinned) window.localStorage.setItem(STICKY_SCORE_PIN_KEY, "true");
    else window.localStorage.removeItem(STICKY_SCORE_PIN_KEY);
  } catch {
    // Storage refused the write: the pin simply does not stick.
  }
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

const notPinned = () => false;

export function useStickyScorePin(): [boolean, (pinned: boolean) => void] {
  const pinned = useSyncExternalStore(subscribe, readPinned, notPinned);
  const setPinned = useCallback((next: boolean) => writePinned(next), []);
  return [pinned, setPinned];
}
