/**
 * The one read of a document's discussion and the view state around it,
 * held by `DocumentSidePanel` so the Discussion panel and the section
 * markers on the page share them: which revisions are read (`scope`), the
 * threads (`useDocumentDiscussion`, re-read on `refreshKey`, on focus and
 * after every write), and the section filter. The filter is the view's for
 * the open document: it empties when another document or another
 * notification's thread (`focusThreadId`) is opened. It lives here, not in
 * the panel, so a section marker can set it while the panel is closed.
 */
import { useState, type Dispatch, type SetStateAction } from "react";

import type { DocumentOwner } from "@/types";
import type { DiscussionScope } from "./discussionModel";
import { useDocumentDiscussion, type DiscussionApi } from "./useDocumentDiscussion";

export interface DiscussionView {
  discussion: DiscussionApi;
  scope: DiscussionScope;
  setScope: (scope: DiscussionScope) => void;
  /** The section keys the list is filtered to; empty is no filter. */
  filter: string[];
  setFilter: Dispatch<SetStateAction<string[]>>;
}

export function useDiscussionView(
  owner: DocumentOwner | null,
  { focusThreadId, refreshKey }: { focusThreadId?: string | null; refreshKey?: string | number },
): DiscussionView {
  const [scope, setScope] = useState<DiscussionScope>("document");
  const discussion = useDocumentDiscussion(owner, { scope, refetchKey: refreshKey });

  const [filter, setFilter] = useState<string[]>([]);
  const filterScope = `${owner?.kind}:${owner?.id}:${focusThreadId ?? ""}`;
  const [filterFor, setFilterFor] = useState(filterScope);
  if (filterFor !== filterScope) {
    setFilterFor(filterScope);
    setFilter([]);
  }

  return { discussion, scope, setScope, filter, setFilter };
}
