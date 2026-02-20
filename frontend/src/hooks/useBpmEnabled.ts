/**
 * useBpmEnabled — module-level singleton that caches whether the BPM feature
 * is enabled. Similar pattern to useCurrency.
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
    const res = await api.get<{ enabled: boolean }>("/settings/bpm-enabled");
    _notify(res.enabled);
  } catch {
    // default to true if fetch fails
    if (_cached === null) _notify(true);
  }
}

export function useBpmEnabled() {
  const [enabled, setEnabled] = useState<boolean>(_cached ?? true);

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

  return { bpmEnabled: enabled, invalidateBpm: invalidate };
}
