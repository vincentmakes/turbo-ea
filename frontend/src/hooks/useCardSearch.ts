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
      // Only a duplicate scroll-sentinel `loadMore` may be dropped. Dropping a
      // *filter* change was a bug: the request was discarded and never retried,
      // so the picker kept showing results for the query the user had already
      // replaced. A fresh page-1 request supersedes instead — the token check
      // below discards whichever response loses.
      if (append && inflight.current) return;
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
        // Only the winner owns the flags — a superseded request settling first
        // must not report "idle" while the current one is still running.
        if (token === requestToken.current) {
          setLoading(false);
          inflight.current = false;
        }
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

/** Keep paging until at least this many pickable rows are on offer. */
const FILL_MIN_VISIBLE = 20;
/** Hard stop, so an exclude-everything case can't walk the whole catalogue. */
const FILL_PAGE_CAP = 10;

/**
 * Keep fetching pages while client-side exclusions leave too few rows to pick
 * from (discussion #918).
 *
 * Callers hide cards *after* paging — already-linked cards, ancestors, self —
 * so excluded rows consume page slots: a card already linked to 200 of 223
 * Organizations pulls back a full page and shows almost nothing. Returns true
 * while it is still walking pages, so the caller can say "loading" rather than
 * "no results".
 *
 * Inert when nothing is excluded: a page that reports `hasMore` always yields
 * at least `pageSize` rows, so the condition never holds.
 */
export function useFillVisible({
  enabled,
  loading,
  hasMore,
  visible,
  pageSize,
  loadMore,
  resetKey,
}: {
  enabled: boolean;
  loading: boolean;
  hasMore: boolean;
  /** Rows actually on offer after the caller's own filtering. */
  visible: number;
  pageSize: number;
  loadMore: () => void;
  /** Changing this restarts the page budget (a new query deserves a fresh one). */
  resetKey: unknown;
}): boolean {
  const minVisible = Math.min(FILL_MIN_VISIBLE, pageSize);
  const pagesFetched = useRef(0);

  useEffect(() => {
    pagesFetched.current = 0;
  }, [resetKey, enabled]);

  useEffect(() => {
    if (!enabled || loading || !hasMore) return;
    if (visible >= minVisible) return;
    if (pagesFetched.current >= FILL_PAGE_CAP) return;
    pagesFetched.current += 1;
    loadMore();
  }, [enabled, loading, hasMore, visible, minVisible, loadMore]);

  return visible < minVisible && hasMore && pagesFetched.current < FILL_PAGE_CAP;
}
