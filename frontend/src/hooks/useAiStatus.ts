/**
 * useAiStatus — module-level singleton that caches the result of /ai/status so
 * the four components that gate AI UI (CardDetailSidePanel, CreateCardDialog,
 * CardDetail, PortfolioReport) share one fetch instead of each firing their
 * own. Same pattern as useTurboLensReady / useBpmEnabled.
 */
import { useState, useEffect, useCallback } from "react";
import { api } from "@/api/client";
import type { AiStatus } from "@/types";

const _default: AiStatus = {
  enabled: false,
  configured: false,
  provider_type: undefined,
  enabled_types: [],
  running_models: [],
  model: undefined,
  portfolio_insights_enabled: false,
};

let _cached: AiStatus | null = null;
let _inflight: Promise<void> | null = null;
let _listeners: Array<(v: AiStatus) => void> = [];

function _notify(v: AiStatus) {
  _cached = v;
  _listeners.forEach((fn) => fn(v));
}

/**
 * Prime the cache from outside the hook (e.g. after AiAdmin saves a change).
 * Pass an explicit value to stamp it, or no arg to clear + refetch.
 */
export function invalidateAiStatus(v?: AiStatus) {
  if (v !== undefined) {
    _notify(v);
  } else {
    _cached = null;
    _fetch();
  }
}

function _fetch(): Promise<void> {
  if (_inflight) return _inflight;
  _inflight = (async () => {
    try {
      const res = await api.get<AiStatus>("/ai/status");
      _notify(res);
    } catch {
      if (_cached === null) _notify(_default);
    }
  })().finally(() => {
    _inflight = null;
  });
  return _inflight;
}

/**
 * Whether the "Suggest with AI" affordance should be offered for a card type.
 *
 * An **empty** `enabled_types` means "no per-type restriction", i.e. every type
 * is enabled — that is what the backend enforces in `POST /ai/suggest`
 * (`if ai_cfg["enabled_types"] and type_key not in …`) and what the Admin →
 * Settings → AI helper text promises ("Leave all unchecked to enable for all
 * types"). A bare `enabled_types.includes(type)` is always false on an empty
 * list and so hid the button on every card (#962); the three call sites go
 * through this helper so they cannot drift from the backend again.
 */
export function aiSuggestEnabledFor(
  status: AiStatus,
  typeKey: string | null | undefined,
): boolean {
  if (!status.enabled || !status.configured || !typeKey) return false;
  return status.enabled_types.length === 0 || status.enabled_types.includes(typeKey);
}

export function useAiStatus() {
  const [status, setStatus] = useState<AiStatus>(_cached ?? _default);
  const [loaded, setLoaded] = useState<boolean>(_cached !== null);

  useEffect(() => {
    const listener = (v: AiStatus) => {
      setStatus(v);
      setLoaded(true);
    };
    _listeners.push(listener);
    if (_cached === null) {
      _fetch();
    } else {
      setStatus(_cached);
      setLoaded(true);
    }
    return () => {
      _listeners = _listeners.filter((fn) => fn !== listener);
    };
  }, []);

  const invalidate = useCallback((newVal?: AiStatus) => {
    invalidateAiStatus(newVal);
  }, []);

  return { aiStatus: status, aiStatusLoaded: loaded, invalidateAiStatus: invalidate };
}
