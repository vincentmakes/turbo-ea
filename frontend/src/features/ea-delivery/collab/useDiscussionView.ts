/**
 * The one read of a document's discussion and the view state around it,
 * held by `DocumentSidePanel` so the Discussion panel and the section
 * markers on the page share them: which revisions are read (`scope`), the
 * threads (`useDocumentDiscussion`, re-read on `refreshKey`, on focus and
 * after every write), the section filter and whether resolved threads are
 * unfolded. Both are the view's for the open document: they reset when
 * another document or another notification's thread (`focusThreadId`) is
 * opened. They live here, not in the panel, so a section marker can set them
 * while the panel is closed.
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
  /** Whether the resolved threads of the revision shown are unfolded. */
  showResolved: boolean;
  setShowResolved: Dispatch<SetStateAction<boolean>>;
}

export function useDiscussionView(
  owner: DocumentOwner | null,
  { focusThreadId, refreshKey }: { focusThreadId?: string | null; refreshKey?: string | number },
): DiscussionView {
  const [scope, setScope] = useState<DiscussionScope>("document");
  const discussion = useDocumentDiscussion(owner, { scope, refetchKey: refreshKey });

  const [filter, setFilter] = useState<string[]>([]);
  const [showResolved, setShowResolved] = useState(false);
  const filterScope = `${owner?.kind}:${owner?.id}:${focusThreadId ?? ""}`;
  const [filterFor, setFilterFor] = useState(filterScope);
  if (filterFor !== filterScope) {
    setFilterFor(filterScope);
    setFilter([]);
    setShowResolved(false);
  }

  return { discussion, scope, setScope, filter, setFilter, showResolved, setShowResolved };
}
