/**
 * useCardTypeCategories — module-level singleton caching the card type
 * category registry (the EA layers: Strategy & Transformation → … → Technical
 * Architecture, plus any an admin created).
 *
 * The list is fetched once from `/metamodel/categories`, in layer order, and
 * shared by every surface that groups or draws by layer (the inventory filter
 * sidebar, the metamodel admin and graph, the Layered Dependency View).
 * `primeBootstrap()` pushes it in after sign-in so none of them pays a
 * round-trip. An admin write re-fetches it through `refresh()`, or primes it
 * with `invalidateCardTypeCategories` when the write returned the full list.
 *
 * Inflight-promise pattern (CLAUDE.md): the fetch helper checks the cache and
 * the inflight slot before starting a request, so components mounting in the
 * same tick share one call.
 */
import { useCallback, useEffect, useState } from "react";
import { api } from "@/api/client";
import { orderCategories } from "@/lib/cardTypeOrder";
import type { CardTypeCategory } from "@/types";

let _cached: CardTypeCategory[] | null = null;
let _inflight: Promise<void> | null = null;
// Bumped by every fetch and every prime: only the newest one may land, so a
// request that started before an admin write cannot overwrite what the write
// fetched (or primed) after it.
let _generation = 0;
let _listeners: Array<(v: CardTypeCategory[]) => void> = [];

function _notify(v: CardTypeCategory[]) {
  _cached = orderCategories(v);
  const snapshot = _cached;
  _listeners.forEach((fn) => fn(snapshot));
}

/**
 * Prime the cache from outside the hook — `/settings/bootstrap` on boot, or
 * the full list an admin write returned (`PUT /metamodel/categories/order`).
 */
export function invalidateCardTypeCategories(v: CardTypeCategory[]) {
  _generation += 1;
  _notify(Array.isArray(v) ? v : []);
}

/**
 * Fetch the registry. Without `force` an inflight request is shared (the
 * mount path); with it a new request starts and supersedes the inflight one
 * (the post-write path). A failed fetch leaves the cache as it was — still
 * `null` when nothing ever loaded — so the next mount retries instead of
 * pinning an empty registry for the session.
 */
function _fetch(force = false): Promise<void> {
  if (_inflight && !force) return _inflight;
  const generation = ++_generation;
  const request = (async () => {
    try {
      const list = await api.get<CardTypeCategory[]>("/metamodel/categories");
      if (generation === _generation) _notify(Array.isArray(list) ? list : []);
    } catch {
      // Keep whatever is cached; consumers keep rendering it (or `[]`).
    }
  })().finally(() => {
    if (_inflight === request) _inflight = null;
  });
  _inflight = request;
  return request;
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

  /**
   * Re-fetch from the server. Every admin write that does not return the
   * whole list calls this rather than patching a local copy, which may be
   * stale or still empty.
   */
  const refresh = useCallback(() => _fetch(true), []);

  return { categories, loaded, refresh };
}
