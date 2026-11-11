/**
 * A document's discussion: the threads (`GET /{adr|soaw}/{id}/comments`), read
 * again when the window regains focus, when `refetchKey` changes (a review
 * action on the page) and after every write, and the writes
 * themselves. Each write applies the server's reply to the list at once (so
 * the change shows before the re-read lands) through the pure helpers of
 * `discussionModel`.
 */
import { useCallback, useEffect, useMemo, useState } from "react";

import { api } from "@/api/client";
import { useApiQuery } from "@/hooks/useApiQuery";
import type { DocumentDiscussion, DocumentOwner, DocumentThread, DocumentThreadWrite } from "@/types";
import {
  applyThread,
  discussionPath,
  markDeleted,
  newCommentBody,
  threadPaths,
  type DiscussionScope,
} from "./discussionModel";

/** Calls `refetch` whenever the window regains focus. */
export function useRefetchOnFocus(refetch: () => void, enabled = true): void {
  useEffect(() => {
    if (!enabled) return;
    window.addEventListener("focus", refetch);
    return () => window.removeEventListener("focus", refetch);
  }, [refetch, enabled]);
}

export interface DiscussionApi {
  discussion: DocumentDiscussion | undefined;
  threads: DocumentThread[];
  loading: boolean;
  error: Error | null;
  refetch: () => void;
  /** Start a thread (`section`) or reply to one (`thread`). */
  post: (body: string, opts: { section?: string; thread?: DocumentThread }) => Promise<DocumentThreadWrite>;
  edit: (thread: DocumentThread, commentId: string, body: string) => Promise<DocumentThreadWrite>;
  remove: (thread: DocumentThread, commentId: string) => Promise<void>;
  resolve: (thread: DocumentThread) => Promise<void>;
  reopen: (thread: DocumentThread) => Promise<void>;
}

export function useDocumentDiscussion(
  owner: DocumentOwner | null,
  { scope, refetchKey }: { scope: DiscussionScope; refetchKey?: string | number },
): DiscussionApi {
  const query = useApiQuery<DocumentDiscussion>(owner ? discussionPath(owner, scope) : null, { refetchKey });
  const { data, refetch } = query;
  // Writes applied on top of the payload they were made against; a newer
  // payload (the re-read after the write) replaces them.
  const [patched, setPatched] = useState<{ base: DocumentDiscussion; threads: DocumentThread[] } | null>(null);
  const threads = useMemo(
    () => (patched && patched.base === data ? patched.threads : (data?.threads ?? [])),
    [patched, data],
  );

  useRefetchOnFocus(refetch, owner !== null);

  const update = useCallback(
    (change: (threads: DocumentThread[]) => DocumentThread[]) => {
      if (data) setPatched({ base: data, threads: change(threads) });
      refetch();
    },
    [data, threads, refetch],
  );

  const post = useCallback(
    async (body: string, opts: { section?: string; thread?: DocumentThread }) => {
      if (!owner) throw new Error("no document");
      const path = opts.thread ? threadPaths(owner, opts.thread).replies : discussionPath(owner, "document");
      const reply = await api.post<DocumentThreadWrite>(
        path,
        newCommentBody(body, { section: opts.section, parentId: opts.thread?.id }),
      );
      update((list) => applyThread(list, reply));
      return reply;
    },
    [owner, update],
  );

  const edit = useCallback(
    async (thread: DocumentThread, commentId: string, body: string) => {
      if (!owner) throw new Error("no document");
      const reply = await api.patch<DocumentThreadWrite>(threadPaths(owner, thread).comment(commentId), { body });
      update((list) => applyThread(list, reply));
      return reply;
    },
    [owner, update],
  );

  const remove = useCallback(
    async (thread: DocumentThread, commentId: string) => {
      if (!owner) throw new Error("no document");
      await api.delete(threadPaths(owner, thread).comment(commentId));
      update((list) => markDeleted(list, commentId));
    },
    [owner, update],
  );

  const setResolved = useCallback(
    async (thread: DocumentThread, resolved: boolean) => {
      if (!owner) throw new Error("no document");
      const paths = threadPaths(owner, thread);
      const reply = await api.post<DocumentThread>(resolved ? paths.resolve : paths.reopen, {});
      update((list) => applyThread(list, reply));
    },
    [owner, update],
  );

  return {
    discussion: data,
    threads,
    loading: query.loading,
    error: query.error,
    refetch,
    post,
    edit,
    remove,
    resolve: (thread) => setResolved(thread, true),
    reopen: (thread) => setResolved(thread, false),
  };
}
