import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/api/client";
import type { Card, CardListResponse } from "@/types";

interface Options {
  /** Card type keys to filter by. Empty array = no type filter (returns all types). */
  types: string[];
  /** Search query (matched against name + description). */
  search: string;
  /** When false, the hook clears state and skips fetching. */
  enabled: boolean;
  /** Page size. Defaults to 1000 — fits the vast majority of installs in a single round-trip. */
  pageSize?: number;
}

interface State {
  items: Card[];
  total: number;
  loading: boolean;
  /** True when items.length < total — i.e. there's at least one more page to fetch. */
  hasMore: boolean;
  /** Fetch the next page and append to items. No-op while loading or when hasMore is false. */
  loadMore: () => void;
}

/**
 * Paginated card search shared by the diagram Insert-Cards dialog and the
 * diagram editor's left card sidebar. Fixes #569 — both call-sites
 * previously hard-capped at 200 results with no way to reach the rest,
 * and the dialog filtered multi-type selections client-side over an
 * unfiltered backend page, dropping arbitrary cards.
 *
 * Behaviour:
 *   - Resets and refetches page 1 when `types`, `search`, or `enabled` change.
 *   - `loadMore()` appends the next page; safe to call from a scroll
 *     sentinel — guards against concurrent calls via an inflight ref.
 *   - Total comes from the backend so the UI can show "Showing X of Y".
 */
export function useCardSearch({ types, search, enabled, pageSize = 1000 }: Options): State {
  const [items, setItems] = useState<Card[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);
  // Token guards against stale responses landing after a filter change.
  const requestToken = useRef(0);
  const inflight = useRef(false);

  // Stable key for filter dependency; types array identity isn't.
  const typeKey = [...types].sort().join(",");
  const trimmedSearch = search.trim();

  const fetchPage = useCallback(
    async (pageNum: number, append: boolean) => {
      if (inflight.current) return;
      inflight.current = true;
      const token = ++requestToken.current;
      setLoading(true);
      try {
        const params = new URLSearchParams({
          page: String(pageNum),
          page_size: String(pageSize),
        });
        if (typeKey) params.set("type", typeKey);
        if (trimmedSearch) params.set("search", trimmedSearch);
        const response = await api.get<CardListResponse>(`/cards?${params.toString()}`);
        if (token !== requestToken.current) return; // stale
        const respItems = response.items ?? [];
        setTotal(response.total ?? respItems.length);
        setItems((prev) => {
          if (!append) return respItems;
          // Dedup by id — the backend can in theory shift between pages
          // if cards are created while paginating.
          const seen = new Set(prev.map((c) => c.id));
          const fresh = respItems.filter((c) => !seen.has(c.id));
          return prev.concat(fresh);
        });
      } catch {
        if (token !== requestToken.current) return;
        if (!append) {
          setItems([]);
          setTotal(0);
        }
      } finally {
        if (token === requestToken.current) setLoading(false);
        inflight.current = false;
      }
    },
    [typeKey, trimmedSearch, pageSize],
  );

  // Reset + refetch page 1 when filters change.
  useEffect(() => {
    if (!enabled) {
      requestToken.current += 1; // invalidate any in-flight
      setItems([]);
      setTotal(0);
      setPage(1);
      setLoading(false);
      return;
    }
    setPage(1);
    fetchPage(1, false);
  }, [enabled, fetchPage]);

  const hasMore = enabled && items.length < total;

  const loadMore = useCallback(() => {
    if (!enabled || loading || !hasMore) return;
    const next = page + 1;
    setPage(next);
    fetchPage(next, true);
  }, [enabled, loading, hasMore, page, fetchPage]);

  return { items, total, loading, hasMore, loadMore };
}
