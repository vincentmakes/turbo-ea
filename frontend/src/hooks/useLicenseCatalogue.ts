import { useCallback, useEffect, useState } from "react";
import { api } from "@/api/client";
import type { LicenseMetricItem } from "@/types";

const PATH = "/metamodel/license-metrics";

let _cache: LicenseMetricItem[] | null = null;
let _inflight: Promise<void> | null = null;
const _listeners = new Set<(m: LicenseMetricItem[]) => void>();

function _fetchOnce(): Promise<void> {
  if (_cache) return Promise.resolve();
  if (_inflight) return _inflight;
  _inflight = api
    .get<LicenseMetricItem[]>(PATH)
    .then((r) => {
      _cache = Array.isArray(r) ? r : [];
      for (const fn of _listeners) fn(_cache);
    })
    .catch(() => {
      // An empty catalogue: the pickers show nothing rather than the page failing.
      _cache = [];
      for (const fn of _listeners) fn(_cache);
    })
    .finally(() => {
      _inflight = null;
    });
  return _inflight;
}

/** Drop the cache and fetch again; the metamodel dialog calls it after every write. */
export function invalidateLicenseCatalogue(): Promise<void> {
  _cache = null;
  return _fetchOnce();
}

/** The license catalogue (metrics with their types, archived ones included). */
/** `enabled=false` defers the fetch (a dialog that is mounted but closed). */
export function useLicenseCatalogue(enabled = true) {
  const [metrics, setMetrics] = useState<LicenseMetricItem[] | null>(_cache);

  useEffect(() => {
    _listeners.add(setMetrics);
    if (enabled) void _fetchOnce();
    return () => {
      _listeners.delete(setMetrics);
    };
  }, [enabled]);

  const reload = useCallback(() => {
    void invalidateLicenseCatalogue();
  }, []);

  return { metrics: metrics ?? [], loading: metrics === null, reload };
}
