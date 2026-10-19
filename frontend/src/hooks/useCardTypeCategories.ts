/**
 * useCardTypeCategories — module-level singleton caching the card type
 * category registry (the EA layers: Strategy & Transformation → … → Technical
 * Architecture, plus any an admin created).
 *
 * The list is fetched once from `/metamodel/categories`, in layer order, and
 * shared by every surface that groups or draws by layer (the inventory filter
 * sidebar, the metamodel admin and graph, the Layered Dependency View).
 * `primeBootstrap()` pushes it in after sign-in so none of them pays a
 * round-trip; an admin save re-primes it through
 * `invalidateCardTypeCategories`.
 *
 * Inflight-promise pattern (CLAUDE.md): the fetch helper checks the cache and
 * the inflight slot before starting a request, so components mounting in the
 * same tick share one call.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "@/api/client";
import type { CardTypeCategory } from "@/types";

let _cached: CardTypeCategory[] | null = null;
let _inflight: Promise<void> | null = null;
let _listeners: Array<(v: CardTypeCategory[]) => void> = [];

/** `rows` in layer order: `sort_order`, then label. Never mutates the input. */
export function sortCategories(rows: CardTypeCategory[]): CardTypeCategory[] {
  return [...rows].sort(
    (a, b) => a.sort_order - b.sort_order || a.label.localeCompare(b.label),
  );
}

function _notify(v: CardTypeCategory[]) {
  _cached = sortCategories(v);
  const snapshot = _cached;
  _listeners.forEach((fn) => fn(snapshot));
}

/**
 * Prime the cache from outside the hook — `/settings/bootstrap` on boot, or
 * the list an admin write returned.
 */
export function invalidateCardTypeCategories(v: CardTypeCategory[]) {
  _notify(Array.isArray(v) ? v : []);
}

function _fetch(): Promise<void> {
  if (_inflight) return _inflight;
  _inflight = (async () => {
    try {
      const list = await api.get<CardTypeCategory[]>("/metamodel/categories");
      _notify(Array.isArray(list) ? list : []);
    } catch {
      if (_cached === null) _notify([]);
    }
  })().finally(() => {
    _inflight = null;
  });
  return _inflight;
}

export function useCardTypeCategories() {
  const [categories, setCategories] = useState<CardTypeCategory[]>(
    _cached ?? [],
  );
  const [loaded, setLoaded] = useState<boolean>(_cached !== null);

  useEffect(() => {
    const listener = (v: CardTypeCategory[]) => {
      setCategories(v);
      setLoaded(true);
    };
    _listeners.push(listener);
    if (_cached === null) {
      _fetch();
    } else {
      setCategories(_cached);
      setLoaded(true);
    }
    return () => {
      _listeners = _listeners.filter((fn) => fn !== listener);
    };
  }, []);

  /** Lookup by key. */
  const byKey = useMemo(() => {
    const map: Record<string, CardTypeCategory> = {};
    for (const c of categories) map[c.key] = c;
    return map;
  }, [categories]);

  /** Re-fetch from the server (after a write that returned no list). */
  const refresh = useCallback(() => {
    _cached = null;
    return _fetch();
  }, []);

  return { categories, byKey, loaded, refresh };
}
