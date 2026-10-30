/**
 * useGamificationEnabled — module-level singleton that caches whether saves
 * that raise a card's data-quality score play the reward animation (animated
 * score pill, flying "+X%", sticky score bar). Same pattern as
 * useSponsorButtonEnabled. Off by default: an administrator turns it on in
 * Admin → Settings → General → Modules. The value is primed by
 * `primeBootstrap()`; the GET below is the fallback.
 */
import { useState, useEffect } from "react";
import { api } from "@/api/client";

let _cached: boolean | null = null;
let _inflight: Promise<void> | null = null;
let _listeners: Array<(v: boolean) => void> = [];

function _notify(v: boolean) {
  _cached = v;
  _listeners.forEach((fn) => fn(v));
}

/**
 * Prime or update the cache from outside the hook (`/settings/bootstrap` on
 * boot, the admin toggle after a save) so every mounted consumer follows.
 */
export function invalidateGamificationEnabled(v: boolean) {
  _notify(v);
}

function _fetch(): Promise<void> {
  if (_inflight) return _inflight;
  _inflight = (async () => {
    try {
      const res = await api.get<{ enabled: boolean }>("/settings/gamification-enabled");
      _notify(res.enabled === true);
    } catch {
      // Stay off when the read fails: the animation is an opt-in extra.
      if (_cached === null) _notify(false);
    }
  })().finally(() => {
    _inflight = null;
  });
  return _inflight;
}

/** `true` once an administrator has turned the gamified data quality on. */
export function useGamificationEnabled(): boolean {
  const [enabled, setEnabled] = useState<boolean>(_cached ?? false);

  useEffect(() => {
    const listener = (v: boolean) => setEnabled(v);
    _listeners.push(listener);
    if (_cached === null) {
      _fetch();
    } else {
      setEnabled(_cached);
    }
    return () => {
      _listeners = _listeners.filter((fn) => fn !== listener);
    };
  }, []);

  return enabled;
}
