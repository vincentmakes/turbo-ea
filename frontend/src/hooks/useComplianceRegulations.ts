/**
 * useComplianceRegulations — module-level singleton that caches the
 * admin-managed list of compliance regulations.
 *
 * The list is fetched once from `/metamodel/compliance-regulations` and
 * shared across all consumers. `primeBootstrap()` pushes the value in
 * after auth so the first paint of the Security tab and the manual
 * finding dialog don't trigger an extra round-trip.
 *
 * Follows the inflight-promise pattern (CLAUDE.md §"Boot-time singleton
 * hooks must use the inflight-promise pattern"): the fetch helper
 * checks the cache *and* the inflight slot before issuing a new request,
 * so several components mounting in the same tick share one network
 * call instead of racing.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "@/api/client";
import type { ComplianceRegulation } from "@/types";

let _cached: ComplianceRegulation[] | null = null;
let _inflight: Promise<void> | null = null;
let _listeners: Array<(v: ComplianceRegulation[]) => void> = [];

function _notify(v: ComplianceRegulation[]) {
  _cached = v;
  _listeners.forEach((fn) => fn(v));
}

/**
 * Prime the cache from outside the hook (e.g. `/settings/bootstrap` on
 * app boot, or after an admin save in `RegulationsAdmin`).
 */
export function invalidateComplianceRegulations(v: ComplianceRegulation[]) {
  _notify(v);
}

function _fetch(): Promise<void> {
  if (_inflight) return _inflight;
  _inflight = (async () => {
    try {
      const list = await api.get<ComplianceRegulation[]>(
        "/metamodel/compliance-regulations",
      );
      _notify(Array.isArray(list) ? list : []);
    } catch {
      if (_cached === null) _notify([]);
    }
  })().finally(() => {
    _inflight = null;
  });
  return _inflight;
}

export function useComplianceRegulations() {
  const [regulations, setRegulations] = useState<ComplianceRegulation[]>(
    _cached ?? [],
  );
  const [loaded, setLoaded] = useState<boolean>(_cached !== null);

  useEffect(() => {
    const listener = (v: ComplianceRegulation[]) => {
      setRegulations(v);
      setLoaded(true);
    };
    _listeners.push(listener);
    if (_cached === null) {
      _fetch();
    } else {
      setRegulations(_cached);
      setLoaded(true);
    }
    return () => {
      _listeners = _listeners.filter((fn) => fn !== listener);
    };
  }, []);

  const enabled = useMemo(
    () => regulations.filter((r) => r.is_enabled),
    [regulations],
  );

  const byKey = useMemo(() => {
    const map: Record<string, ComplianceRegulation> = {};
    for (const r of regulations) map[r.key] = r;
    return map;
  }, [regulations]);

  // Re-fetch without dropping the cache first: a refetch that fails keeps
  // the list every consumer already shows instead of blanking it.
  const refresh = useCallback(() => _fetch(), []);

  return { regulations, enabled, byKey, loaded, refresh };
}
