/**
 * usePpmEnabled — module-level singleton that caches whether the PPM feature
 * is enabled. Same pattern as useBpmEnabled.
 */
import { useState, useEffect, useCallback } from "react";
import { api } from "@/api/client";

let _cached: boolean | null = null;
let _listeners: Array<(v: boolean) => void> = [];

function _notify(v: boolean) {
  _cached = v;
  _listeners.forEach((fn) => fn(v));
}

async function _fetch() {
  try {
    const res = await api.get<{ enabled: boolean }>("/settings/ppm-enabled");
    _notify(res.enabled);
  } catch {
    // default to false (opt-in) if fetch fails
    if (_cached === null) _notify(false);
  }
}

export function usePpmEnabled() {
  const [enabled, setEnabled] = useState<boolean>(_cached ?? false);

  useEffect(() => {
    _listeners.push(setEnabled);
    if (_cached === null) _fetch();
    else setEnabled(_cached);
    return () => {
      _listeners = _listeners.filter((fn) => fn !== setEnabled);
    };
  }, []);

  const invalidate = useCallback((newVal?: boolean) => {
    if (newVal !== undefined) {
      _notify(newVal);
    } else {
      _cached = null;
      _fetch();
    }
  }, []);

  return { ppmEnabled: enabled, invalidatePpm: invalidate };
}
