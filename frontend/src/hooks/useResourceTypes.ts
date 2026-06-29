/**
 * useResourceTypes — module-level singleton that caches the admin-managed
 * link types & file categories shown on a card's Resources tab.
 *
 * The list is fetched once from `/metamodel/resource-types` and shared across
 * all consumers. `primeBootstrap()` pushes the value in after auth so the
 * first paint of the Resources tab doesn't trigger an extra round-trip.
 *
 * Follows the inflight-promise pattern (CLAUDE.md §"Boot-time singleton
 * hooks must use the inflight-promise pattern"): the fetch helper checks the
 * cache *and* the inflight slot before issuing a new request, so several
 * components mounting in the same tick share one network call.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "@/api/client";
import type { ResourceType } from "@/types";

let _cached: ResourceType[] | null = null;
let _inflight: Promise<void> | null = null;
let _listeners: Array<(v: ResourceType[]) => void> = [];

function _notify(v: ResourceType[]) {
  _cached = v;
  _listeners.forEach((fn) => fn(v));
}

/**
 * Prime the cache from outside the hook (e.g. `/settings/bootstrap` on app
 * boot, or after an admin save in `ResourceTypesAdmin`).
 */
export function invalidateResourceTypes(v: ResourceType[]) {
  _notify(v);
}

function _fetch(): Promise<void> {
  if (_inflight) return _inflight;
  _inflight = (async () => {
    try {
      const list = await api.get<ResourceType[]>("/metamodel/resource-types");
      _notify(Array.isArray(list) ? list : []);
    } catch {
      if (_cached === null) _notify([]);
    }
  })().finally(() => {
    _inflight = null;
  });
  return _inflight;
}

function _sortByOrder(rows: ResourceType[]): ResourceType[] {
  return [...rows].sort(
    (a, b) => a.sort_order - b.sort_order || a.label.localeCompare(b.label),
  );
}

export function useResourceTypes() {
  const [resourceTypes, setResourceTypes] = useState<ResourceType[]>(
    _cached ?? [],
  );
  const [loaded, setLoaded] = useState<boolean>(_cached !== null);

  useEffect(() => {
    const listener = (v: ResourceType[]) => {
      setResourceTypes(v);
      setLoaded(true);
    };
    _listeners.push(listener);
    if (_cached === null) {
      _fetch();
    } else {
      setResourceTypes(_cached);
      setLoaded(true);
    }
    return () => {
      _listeners = _listeners.filter((fn) => fn !== listener);
    };
  }, []);

  /** Enabled link types, ordered. */
  const linkTypes = useMemo(
    () =>
      _sortByOrder(
        resourceTypes.filter((r) => r.kind === "link_type" && r.is_enabled),
      ),
    [resourceTypes],
  );

  /** Enabled file categories, ordered. */
  const fileCategories = useMemo(
    () =>
      _sortByOrder(
        resourceTypes.filter(
          (r) => r.kind === "file_category" && r.is_enabled,
        ),
      ),
    [resourceTypes],
  );

  /** Lookup keyed `${kind}:${key}` across *all* rows (incl. disabled). */
  const byKindKey = useMemo(() => {
    const map: Record<string, ResourceType> = {};
    for (const r of resourceTypes) map[`${r.kind}:${r.key}`] = r;
    return map;
  }, [resourceTypes]);

  const refresh = useCallback(() => {
    _cached = null;
    return _fetch();
  }, []);

  return { resourceTypes, linkTypes, fileCategories, byKindKey, loaded, refresh };
}
