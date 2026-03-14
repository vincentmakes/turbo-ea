/**
 * useArchLensReady — module-level singleton that caches whether ArchLens is
 * ready to use (AI configured with commercial provider + connection synced).
 * Same pattern as useBpmEnabled / usePpmEnabled.
 */
import { useState, useEffect, useCallback } from "react";
import { api } from "@/api/client";
import type { ArchLensStatus } from "@/features/archlens/utils";

let _cached: ArchLensStatus | null = null;
const _listeners = new Set<(v: ArchLensStatus) => void>();

const _default: ArchLensStatus = {
  ai_configured: false,
  ready: false,
};

function _notify(v: ArchLensStatus) {
  _cached = v;
  _listeners.forEach((fn) => fn(v));
}

async function _fetch() {
  try {
    const res = await api.get<ArchLensStatus>("/archlens/status");
    _notify(res);
  } catch {
    // default to not ready if fetch fails (user may lack permission)
    if (_cached === null) _notify(_default);
  }
}

export function useArchLensReady() {
  const [status, setStatus] = useState<ArchLensStatus>(_cached ?? _default);

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
    archLensReady: status.ready,
    archLensAiConfigured: status.ai_configured,
    invalidateArchLens: invalidate,
  };
}
