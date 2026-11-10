/**
 * A document's timeline (`GET /{adr|soaw}/{id}/history`), one page at a time:
 * the first page is read again when the window regains focus and after a
 * restore, "Load more" appends the next page.
 */
import { useCallback, useState } from "react";

import { api, isAbortError } from "@/api/client";
import { useApiQuery } from "@/hooks/useApiQuery";
import { useLatestRequest } from "@/hooks/useLatestRequest";
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

export function useDocumentHistory(owner: DocumentOwner | null, refetchKey?: string | number): HistoryApi {
  const query = useApiQuery<DocumentHistoryPage>(owner ? historyPath(owner, 1) : null, { refetchKey });
  const { data, refetch } = query;
  // Later pages, held against the first page they follow: a re-read of the
  // first page starts the list over.
  const [more, setMore] = useState<{ base: DocumentHistoryPage; pages: number; entries: DocumentHistoryEntry[] } | null>(
    null,
  );
  const [loadingMore, setLoadingMore] = useState(false);
  const { run } = useLatestRequest();
  const extra = more && more.base === data ? more : null;
  const entries = data ? appendPage(data.entries ?? [], extra?.entries ?? []) : [];

  useRefetchOnFocus(refetch, owner !== null);

  const loadMore = useCallback(() => {
    if (!owner || !data) return;
    const next = (extra?.pages ?? 1) + 1;
    void run(async ({ signal, isCurrent }) => {
      setLoadingMore(true);
      try {
        const page = await api.get<DocumentHistoryPage>(historyPath(owner, next), { signal });
        if (!isCurrent()) return;
        setMore({ base: data, pages: next, entries: appendPage(extra?.entries ?? [], page.entries) });
      } catch (err) {
        if (!isCurrent() || isAbortError(err)) return;
      } finally {
        if (isCurrent()) setLoadingMore(false);
      }
    });
  }, [owner, data, extra, run]);

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
