/**
 * A document's timeline (`GET /{adr|soaw}/{id}/history`), one page at a time:
 * the first page is read again when the window regains focus and after a
 * restore, "Load more" appends the next page.
 *
 * A re-read of the first page keeps the pages already loaded: when it starts
 * with the same row (and the total is unchanged) nothing moved, and the held
 * pages stay as they are; otherwise the same number of pages is read again.
 * Until then the held rows stay on screen, so the list (and an open Compare
 * dialog's choices) never collapses to the first page.
 */
import { useCallback, useState } from "react";

import { api, isAbortError } from "@/api/client";
import { useApiQuery } from "@/hooks/useApiQuery";
import { useAbortableEffect, useLatestRequest } from "@/hooks/useLatestRequest";
import type { DocumentHistoryEntry, DocumentHistoryPage, DocumentOwner } from "@/types";
import { appendPage, historyPath, restorePath } from "./historyModel";
import { useRefetchOnFocus } from "./useDocumentDiscussion";

export interface HistoryApi {
  page: DocumentHistoryPage | undefined;
  entries: DocumentHistoryEntry[];
  loading: boolean;
  loadingMore: boolean;
  error: Error | null;
  hasMore: boolean;
  loadMore: () => void;
  refetch: () => void;
  /** POST the restore; resolves to the document detail the server returns. */
  restore: <D>(entryId: string) => Promise<D>;
}

/** Two reads of the first page show the same timeline (nothing was added). */
function sameTimeline(a: DocumentHistoryPage, b: DocumentHistoryPage): boolean {
  return a.total === b.total && (a.entries ?? [])[0]?.id === (b.entries ?? [])[0]?.id;
}

interface HeldPages {
  /** The document they belong to. */
  key: string;
  /** The first page they were read after. */
  base: DocumentHistoryPage;
  /** The last page number held. */
  pages: number;
  entries: DocumentHistoryEntry[];
}

export function useDocumentHistory(owner: DocumentOwner | null, refetchKey?: string | number): HistoryApi {
  const query = useApiQuery<DocumentHistoryPage>(owner ? historyPath(owner, 1) : null, { refetchKey });
  const { data, refetch } = query;
  const key = owner ? `${owner.kind}:${owner.id}` : "";
  // Pages 2.. loaded with "Load more", for this document.
  const [more, setMore] = useState<HeldPages | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const { run } = useLatestRequest();
  const held = more && more.key === key ? more : null;
  const entries = data ? appendPage(data.entries ?? [], held?.entries ?? []) : [];

  useRefetchOnFocus(refetch, owner !== null);

  // The first page was read again: keep the held pages in step with it.
  useAbortableEffect(
    async ({ signal, isCurrent }) => {
      if (!owner || !data || !held || held.base === data) return;
      if (sameTimeline(held.base, data)) {
        setMore({ ...held, base: data });
        return;
      }
      try {
        let rows: DocumentHistoryEntry[] = [];
        for (let page = 2; page <= held.pages; page += 1) {
          const next = await api.get<DocumentHistoryPage>(historyPath(owner, page), { signal });
          if (!isCurrent()) return;
          rows = appendPage(rows, next.entries ?? []);
        }
        setMore({ key, base: data, pages: held.pages, entries: rows });
      } catch (err) {
        if (!isCurrent() || isAbortError(err)) return;
        // The held rows stay; "Load more" can try again.
      }
    },
    [data],
  );

  const loadMore = useCallback(() => {
    if (!owner || !data) return;
    const next = (held?.pages ?? 1) + 1;
    void run(async ({ signal, isCurrent }) => {
      setLoadingMore(true);
      try {
        const page = await api.get<DocumentHistoryPage>(historyPath(owner, next), { signal });
        if (!isCurrent()) return;
        setMore({ key, base: data, pages: next, entries: appendPage(held?.entries ?? [], page.entries) });
      } catch (err) {
        if (!isCurrent() || isAbortError(err)) return;
      } finally {
        if (isCurrent()) setLoadingMore(false);
      }
    });
  }, [owner, key, data, held, run]);

  const restore = useCallback(
    async <D,>(entryId: string): Promise<D> => {
      if (!owner) throw new Error("no document");
      const detail = await api.post<D>(restorePath(owner, entryId), {});
      refetch();
      return detail;
    },
    [owner, refetch],
  );

  return {
    page: data,
    entries,
    loading: query.loading,
    loadingMore,
    error: query.error,
    hasMore: data ? entries.length < data.total : false,
    loadMore,
    refetch,
    restore,
  };
}
