/**
 * Unsent comments, held in memory for the visit: the new-thread composer, a
 * reply and an edit in progress outlive the panel that shows them (closing
 * and reopening it, switching tabs, the layout crossing the `lg` width). Not
 * persisted: a reload starts empty. Keys are per document (`draftKey`), so
 * another document's composer never shows this one's text.
 */
import type { DocumentOwner } from "@/types";

export interface CommentDraft {
  body: string;
  /** The section a new thread is tagged to. */
  section?: string;
}

const drafts = new Map<string, CommentDraft>();

/** The draft slot of one composer: the new thread, a reply to a thread, an edit of a comment. */
export function draftKey(
  owner: DocumentOwner,
  slot: { kind: "new" } | { kind: "reply"; threadId: string } | { kind: "edit"; commentId: string },
): string {
  const tail = slot.kind === "new" ? "new" : slot.kind === "reply" ? `reply:${slot.threadId}` : `edit:${slot.commentId}`;
  return `${owner.kind}:${owner.id}:${tail}`;
}

export function readDraft(key: string): CommentDraft | undefined {
  return drafts.get(key);
}

export function writeDraft(key: string, draft: CommentDraft): void {
  drafts.set(key, draft);
}

export function clearDraft(key: string): void {
  drafts.delete(key);
}

/** For tests: forget every draft. */
export function clearAllDrafts(): void {
  drafts.clear();
}
