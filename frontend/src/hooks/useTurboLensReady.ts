/**
 * useTurboLensReady — module-level singleton that caches whether TurboLens is
 * ready to use (AI configured with commercial provider + connection synced).
 * Same pattern as useBpmEnabled / usePpmEnabled.
 */
import { useState, useEffect, useCallback } from "react";
import { api } from "@/api/client";
import type { TurboLensStatus } from "@/features/turbolens/utils";

let _cached: TurboLensStatus | null = null;
const _listeners = new Set<(v: TurboLensStatus) => void>();

const _default: TurboLensStatus = {
  ai_configured: false,
  ready: false,
};

function _notify(v: TurboLensStatus) {
  _cached = v;
  _listeners.forEach((fn) => fn(v));
}

async function _fetch() {
  try {
    const res = await api.get<TurboLensStatus>("/turbolens/status");
    _notify(res);
  } catch {
    // default to not ready if fetch fails (user may lack permission)
    if (_cached === null) _notify(_default);
  }
}

export function useTurboLensReady() {
  const [status, setStatus] = useState<TurboLensStatus>(_cached ?? _default);

  useEffect(() => {
    _listeners.add(setStatus);
    if (_cached === null) _fetch();
    else setStatus(_cached);
    return () => {
      _listeners.delete(setStatus);
    };
  }, []);

  const invalidate = useCallback(() => {
    _cached = null;
    _fetch();
  }, []);

  return {
    turboLensReady: status.ready,
    turboLensAiConfigured: status.ai_configured,
    invalidateTurboLens: invalidate,
  };
}
