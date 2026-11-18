/**
 * useLicenseCatalogue — module-level singleton caching the license catalogue
 * (metrics with their types, archived ones included).
 *
 * Inflight-promise pattern (CLAUDE.md): components mounting in the same tick
 * share one request. `invalidateLicenseCatalogue()` (the metamodel dialog calls
 * it after every write) starts a NEW request that supersedes the inflight one;
 * a generation counter lets only the newest response land. A failed fetch
 * leaves the cache `null` so the next mount retries, and tells listeners `[]`.
 * `enabled=false` defers the fetch (a dialog that is mounted but closed).
 */
import { useCallback, useEffect, useState } from "react";
import { api } from "@/api/client";
import type { LicenseMetricItem } from "@/types";

const PATH = "/metamodel/license-metrics";

let _cache: LicenseMetricItem[] | null = null;
let _inflight: Promise<void> | null = null;
let _generation = 0;
const _listeners = new Set<(m: LicenseMetricItem[] | null, failed: boolean) => void>();

function _notify(m: LicenseMetricItem[] | null, failed: boolean) {
  for (const fn of _listeners) fn(m, failed);
}

function _fetch(force = false): Promise<void> {
  if (_inflight && !force) return _inflight;
  const generation = ++_generation;
  const request: Promise<void> = api
    .get<LicenseMetricItem[]>(PATH)
    .then((r) => {
      if (generation !== _generation) return;
      _cache = Array.isArray(r) ? r : [];
      _notify(_cache, false);
    })
    .catch(() => {
      if (generation !== _generation) return;
      // A first load leaves the cache null so the next mount retries; a refresh keeps the old list.
      _notify(_cache ?? [], true);
    })
    .finally(() => {
      if (_inflight === request) _inflight = null;
    });
  _inflight = request;
  return request;
}

/** Fetch again, superseding any request in flight. */
export function invalidateLicenseCatalogue(): Promise<void> {
  return _fetch(true);
}

export function useLicenseCatalogue(enabled = true) {
  const [metrics, setMetrics] = useState<LicenseMetricItem[] | null>(_cache);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const listener = (m: LicenseMetricItem[] | null, f: boolean) => {
      setMetrics(m);
      setFailed(f);
    };
    _listeners.add(listener);
    if (enabled) {
      if (_cache) setMetrics(_cache);
      else void _fetch();
    }
    return () => {
      _listeners.delete(listener);
    };
  }, [enabled]);

  const reload = useCallback(() => {
    void invalidateLicenseCatalogue();
  }, []);

  return { metrics: metrics ?? [], loading: enabled && metrics === null, failed, reload };
}
