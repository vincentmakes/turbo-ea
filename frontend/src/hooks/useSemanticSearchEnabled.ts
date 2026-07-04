/**
 * useSemanticSearchEnabled — module-level singleton that caches whether semantic
 * card search is available (an embedding provider is enabled). Same pattern as
 * useBpmEnabled. The only source of truth is /settings/bootstrap, so the
 * standalone fetch fallback simply defaults to false (feature off) until the
 * bootstrap primer pushes the real value in via invalidateSemanticSearchEnabled.
 */
import { useState, useEffect, useCallback } from "react";

let _cached: boolean | null = null;
let _listeners: Array<(v: boolean) => void> = [];

function _notify(v: boolean) {
  _cached = v;
  _listeners.forEach((fn) => fn(v));
}

/** Prime the cache from /settings/bootstrap on app boot. */
export function invalidateSemanticSearchEnabled(v: boolean) {
  _notify(v);
}

export function useSemanticSearchEnabled() {
  const [enabled, setEnabled] = useState<boolean>(_cached ?? false);

  useEffect(() => {
    const listener = (v: boolean) => setEnabled(v);
    _listeners.push(listener);
    if (_cached !== null) setEnabled(_cached);
    return () => {
      _listeners = _listeners.filter((fn) => fn !== listener);
    };
  }, []);

  const invalidate = useCallback((newVal: boolean) => _notify(newVal), []);

  return { semanticSearchEnabled: enabled, invalidateSemanticSearchEnabled: invalidate };
}
