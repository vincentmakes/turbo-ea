/**
 * Pure rules behind a document's discussion (`DiscussionPanel`): which
 * sections a thread may be tagged to and how a tag reads, how threads group
 * by revision, what counts as open, which route each action goes to, and how
 * the list changes after a write. Kept out of the components so each rule has
 * a direct test.
 */
import type {
  DocumentComment,
  DocumentKind,
  DocumentOwner,
  DocumentThread,
} from "@/types";
import { escapeHtml } from "@/lib/escapeHtml";
import type { Translate } from "../decisionStanding";

/** The tag a thread carries when it is about the document as a whole. */
export const GENERAL_SECTION = "general";

/** `scope=document`: this revision's threads; `chain`: every revision's. */
export type DiscussionScope = "document" | "chain";

/** A section a thread can be tagged to. */
export interface SectionOption {
  key: string;
  label: string;
}

/** A decision's sections, in the order the decision shows them. */
const DECISION_SECTIONS: readonly [string, string][] = [
  ["context", "adr.context"],
  ["decision", "adr.decision"],
  ["alternatives_considered", "adr.alternativesConsidered"],
  ["consequences", "adr.consequences"],
];

/**
 * The sections of a SoAW, as `{key, label}`: the template's sections in
 * template order, then the document's own (`custom_*`) sections under their
 * titles. `templateDefs` is `getTemplateSections()` (translated titles).
 */
export function soawSectionOptions(
  templateDefs: readonly { id: string; title: string }[],
  sections: Record<string, object> | null | undefined,
): SectionOption[] {
  const out: SectionOption[] = templateDefs.map((d) => ({ key: d.id, label: d.title }));
  for (const [key, value] of Object.entries(sections ?? {})) {
    const title = (value as { title?: unknown }).title;
    if (key.startsWith("custom_")) out.push({ key, label: typeof title === "string" && title ? title : key });
  }
  return out;
}

/**
 * What the composer's section select offers: "General" first, then the
 * decision's four sections, or the SoAW's sections as given.
 */
export function sectionOptions(
  kind: DocumentKind,
  t: Translate,
  soawSections: readonly SectionOption[] = [],
): SectionOption[] {
  const general = { key: GENERAL_SECTION, label: t("collab.discussion.section.general") };
  if (kind === "adr") {
    return [general, ...DECISION_SECTIONS.map(([key, label]) => ({ key, label: t(label) }))];
  }
  return [general, ...soawSections];
}

/**
 * The label of a thread's section tag: none for an untagged thread, the
 * section's title when it is still there, "Removed section" for a tag naming
 * a section the document no longer has (a deleted custom SoAW section).
 */
export function sectionLabel(
  section: string | null,
  options: readonly SectionOption[],
  t: Translate,
): string | null {
  if (!section) return null;
  const found = options.find((o) => o.key === section);
  return found ? found.label : t("collab.discussion.section.removed");
}

/** Threads of one earlier revision, under a "Rev N" header. */
export interface RevisionGroup {
  revisionId: string;
  revisionNumber: number;
  threads: DocumentThread[];
}

export interface GroupedThreads {
  /** The threads of the revision on screen, in server order. */
  current: DocumentThread[];
  /** Earlier revisions' threads, one group per revision, in chain order. */
  earlier: RevisionGroup[];
}

/** This revision's threads first, then each other revision's under its own header. */
export function groupThreads(threads: readonly DocumentThread[], currentDocId: string): GroupedThreads {
  const current: DocumentThread[] = [];
  const earlier: RevisionGroup[] = [];
  for (const thread of threads) {
    if (thread.revision_id === currentDocId) {
      current.push(thread);
      continue;
    }
    let group = earlier.find((g) => g.revisionId === thread.revision_id);
    if (!group) {
      group = { revisionId: thread.revision_id, revisionNumber: thread.revision_number, threads: [] };
      earlier.push(group);
    }
    group.threads.push(thread);
  }
  return { current, earlier };
}

/** A thread that still asks for attention: not resolved, not deleted, not a signing note. */
export function isOpenThread(thread: DocumentThread): boolean {
  return thread.resolved_at === null && !thread.deleted && thread.kind !== "sign_note";
}

/** The open threads of the revision on screen (the panel's badge). */
export function openCount(threads: readonly DocumentThread[], currentDocId: string): number {
  return threads.filter((th) => th.revision_id === currentDocId && isOpenThread(th)).length;
}

/**
 * Split a revision's threads: those shown at once, and the resolved ones kept
 * behind a toggle. A signing note is never hidden (it has nothing to resolve).
 */
export function splitResolved(threads: readonly DocumentThread[]): {
  shown: DocumentThread[];
  resolved: DocumentThread[];
} {
  const shown: DocumentThread[] = [];
  const resolved: DocumentThread[] = [];
  for (const thread of threads) {
    if (thread.resolved_at !== null && thread.kind !== "sign_note") resolved.push(thread);
    else shown.push(thread);
  }
  return { shown, resolved };
}

/** `GET` path of a document's discussion. */
export function discussionPath(owner: DocumentOwner, scope: DiscussionScope): string {
  const base = `/${owner.kind}/${owner.id}/comments`;
  return scope === "chain" ? `${base}?scope=chain` : base;
}

/** Where each action on a thread goes. */
export interface ThreadPaths {
  /** POST a reply. */
  replies: string;
  resolve: string;
  reopen: string;
  /** PATCH / DELETE one comment of the thread (the thread itself or a reply). */
  comment: (commentId: string) => string;
}

/**
 * The routes for a thread, built on the revision it belongs to: a comment of
 * an earlier revision answers 404 on the current revision's path.
 */
export function threadPaths(owner: DocumentOwner, thread: Pick<DocumentThread, "id" | "revision_id">): ThreadPaths {
  const base = `/${owner.kind}/${thread.revision_id}/comments`;
  return {
    replies: base,
    resolve: `${base}/${thread.id}/resolve`,
    reopen: `${base}/${thread.id}/reopen`,
    comment: (commentId: string) => `${base}/${commentId}`,
  };
}

/** The body of a new thread or a reply: no section on a reply (it inherits its thread's). */
export function newCommentBody(
  body: string,
  opts: { section?: string | null; parentId?: string | null },
): { body: string; section?: string; parent_id?: string } {
  if (opts.parentId) return { body, parent_id: opts.parentId };
  if (opts.section && opts.section !== GENERAL_SECTION) return { body, section: opts.section };
  return { body };
}

/** The list with `updated` in place of the thread of the same id, or appended when new. */
export function applyThread(threads: readonly DocumentThread[], updated: DocumentThread): DocumentThread[] {
  // A write's reply also names who a mention could not notify: not part of the thread.
  const thread = { ...updated } as DocumentThread & { unnotified_mentions?: unknown };
  delete thread.unnotified_mentions;
  const index = threads.findIndex((th) => th.id === thread.id);
  if (index === -1) return [...threads, thread];
  return threads.map((th, i) => (i === index ? thread : th));
}

/** A comment as a deleted one reads: no body, its replies kept. */
function asDeleted<C extends DocumentComment>(comment: C): C {
  return { ...comment, body: "", deleted: true, can: { edit: false, delete: false, resolve: false } };
}

/** The list after `commentId` (a thread or a reply) was deleted: it stays as a placeholder. */
export function markDeleted(threads: readonly DocumentThread[], commentId: string): DocumentThread[] {
  return threads.map((th) => {
    if (th.id === commentId) return asDeleted(th);
    if (!th.replies.some((r) => r.id === commentId)) return th;
    return { ...th, replies: th.replies.map((r) => (r.id === commentId ? asDeleted(r) : r)) };
  });
}

/** A comment's HTML with every `<ol>` tag bare (the server escapes any attribute on it). */
export function plainListTags(html: string): string {
  return html.replace(/<ol\b[^>]*>/g, "<ol>");
}

/** Whether a comment's body is empty (no text and no mention), after tags are dropped. */
export function isBlankHtml(html: string): boolean {
  if (html.includes('data-type="mention"')) return false;
  return html.replace(/<[^>]*>/g, "").replace(/&nbsp;/g, " ").trim() === "";
}

/**
 * The HTML a comment shows: a rejection with no reason reads "No reason
 * given", escaped into a paragraph.
 */
export function rejectionBodyOrFallback(comment: Pick<DocumentComment, "kind" | "body">, fallback: string): string {
  if (comment.kind === "rejection" && isBlankHtml(comment.body)) return `<p>${escapeHtml(fallback)}</p>`;
  return comment.body;
}

/** The name a comment is signed with. */
export function authorName(comment: Pick<DocumentComment, "author" | "author_name">, unknown: string): string {
  return comment.author?.display_name || comment.author_name || unknown;
}

/** The message to show for a refused write: the server's own words, else `fallback`. */
export function writeErrorMessage(err: unknown, fallback: string): string {
  return err instanceof Error && err.message ? err.message : fallback;
}

/** The longest rejection reason the server accepts. */
export const REJECT_REASON_MAX = 4000;

/** The longest signing note the server accepts. */
export const SIGN_NOTE_MAX = 2000;

/**
 * The body of a sign request: a decision takes the note as `comment`, a SoAW
 * as `note`; with no note a decision sends `{}` and a SoAW no body at all.
 */
export function signBody(kind: DocumentKind, note: string): Record<string, string> | undefined {
  const text = note.trim();
  if (kind === "adr") return text ? { comment: text } : {};
  return text ? { note: text } : undefined;
}
