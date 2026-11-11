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

/** The key a thread is filtered under: its section, or General when it has none. */
export function threadSectionKey(thread: Pick<DocumentThread, "section">): string {
  return thread.section || GENERAL_SECTION;
}

/** Up to this many sections, the composer shows every one as a chip (a decision's four). */
export const SECTION_CHIPS_ALL_MAX = 6;

/**
 * The chips a new thread's composer offers, General left out (no chip chosen
 * is a general thread). A short list is shown whole; a long one (a SoAW's)
 * shows the sections already used in this discussion and the chosen one, in
 * document order, and keeps the rest behind "More…".
 */
export function composerSectionChips(
  sections: readonly SectionOption[],
  used: readonly (string | null)[],
  chosen: string,
): { chips: SectionOption[]; more: SectionOption[] } {
  const taggable = sections.filter((s) => s.key !== GENERAL_SECTION);
  if (taggable.length <= SECTION_CHIPS_ALL_MAX) return { chips: taggable, more: [] };
  const usedKeys = new Set(used);
  const shown = (s: SectionOption) => usedKeys.has(s.key) || s.key === chosen;
  return { chips: taggable.filter(shown), more: taggable.filter((s) => !shown(s)) };
}

/**
 * Whether the filter is one section that none of `threads` (every thread
 * read, any revision, resolved or not) is tagged to: the list then says the
 * section has no discussion yet rather than that nothing matches.
 */
export function sectionWithoutThreads(
  threads: readonly Pick<DocumentThread, "section">[],
  active: readonly string[],
): boolean {
  if (active.length !== 1) return false;
  const [key] = active;
  return !threads.some((thread) => threadSectionKey(thread) === key);
}

/** One chip of the discussion's filter row. */
export interface SectionFilterChip {
  key: string;
  label: string;
  /** The threads listed under it. */
  count: number;
  active: boolean;
}

/**
 * The filter row over the threads listed (`threads`: every revision shown,
 * resolved ones only while they are unfolded): one chip per section with a
 * thread, in the document's section order, then sections the document no
 * longer has ("Removed section"); a General chip when untagged and tagged
 * threads are both listed. No chip at all when no listed thread has a
 * section. A chip that is on stays, at 0, so it can be turned off.
 */
export function sectionFilterChips(
  threads: readonly Pick<DocumentThread, "section">[],
  sections: readonly SectionOption[],
  active: readonly string[],
  t: Translate,
): SectionFilterChip[] {
  const counts = new Map<string, number>();
  for (const thread of threads) {
    const key = threadSectionKey(thread);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const general = counts.get(GENERAL_SECTION) ?? 0;
  const tagged = threads.length - general;
  const on = new Set(active);
  const keys = new Set([GENERAL_SECTION, ...sections.map((s) => s.key), ...counts.keys(), ...active]);
  const chips: SectionFilterChip[] = [];
  for (const key of keys) {
    const count = counts.get(key) ?? 0;
    const listed = key === GENERAL_SECTION ? general > 0 && tagged > 0 : count > 0;
    if (!listed && !on.has(key)) continue;
    const label =
      key === GENERAL_SECTION
        ? t("collab.discussion.section.general")
        : (sections.find((s) => s.key === key)?.label ?? t("collab.discussion.section.removed"));
    chips.push({ key, label, count, active: on.has(key) });
  }
  return chips;
}

/** The filter with `key` turned on, or off when it was on. */
export function toggleFilterKey(active: readonly string[], key: string): string[] {
  return active.includes(key) ? active.filter((k) => k !== key) : [...active, key];
}

/** The filter with `key` turned on (a thread's own section chip). */
export function addFilterKey(active: readonly string[], key: string): string[] {
  return active.includes(key) ? [...active] : [...active, key];
}

/**
 * The threads the filter lets through: all of them with no filter, else those
 * whose section is on (any of them), and always the thread a notification
 * points at (`keepId`).
 */
export function applySectionFilter<T extends Pick<DocumentThread, "id" | "section">>(
  threads: readonly T[],
  active: readonly string[],
  keepId?: string | null,
): T[] {
  if (active.length === 0) return [...threads];
  const on = new Set(active);
  return threads.filter((th) => on.has(threadSectionKey(th)) || (keepId != null && th.id === keepId));
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

/**
 * A thread whose first comment is deleted is closed: its replies stay, but it
 * takes no reply and cannot be resolved or reopened (the server answers 409).
 */
export function threadClosed(thread: Pick<DocumentThread, "deleted">): boolean {
  return thread.deleted;
}

/** Whether a thread still has a comment that is not deleted (its first or a reply). */
export function hasLiveComment(thread: Pick<DocumentThread, "deleted" | "replies">): boolean {
  return !thread.deleted || thread.replies.some((reply) => !reply.deleted);
}

/** The open threads of the revision on screen (the panel's badge). */
export function openCount(threads: readonly DocumentThread[], currentDocId: string): number {
  return threads.filter((th) => th.revision_id === currentDocId && isOpenThread(th)).length;
}

/** How many threads a section has on the document shown, and how many of them are open. */
export interface SectionThreadCount {
  open: number;
  total: number;
}

/**
 * Whether opening the Discussion from a section's marker unfolds the
 * resolved threads: when the section has threads and none is open (the muted
 * marker), so the reader sees the discussion the marker announced.
 */
export function markerUnfoldsResolved(count: SectionThreadCount | undefined): boolean {
  return count !== undefined && count.total > 0 && count.open === 0;
}

/**
 * The section markers' counts: for each of the document's sections (`sections`)
 * that has a thread on the revision shown (`currentDocId`), its open threads
 * and all its threads. Earlier revisions' threads, General (untagged) threads,
 * deleted threads and signing notes are not counted, and a tag naming a
 * section the document no longer has gets no entry.
 */
export function sectionThreadCounts(
  threads: readonly DocumentThread[],
  currentDocId: string,
  sections: readonly SectionOption[],
): Record<string, SectionThreadCount> {
  const known = new Set(sections.map((s) => s.key));
  known.delete(GENERAL_SECTION);
  // No prototype: a section key can never land on an inherited property.
  const counts: Record<string, SectionThreadCount> = Object.create(null);
  for (const thread of threads) {
    if (thread.revision_id !== currentDocId || thread.deleted || thread.kind === "sign_note") continue;
    const key = thread.section;
    if (!key || !known.has(key)) continue;
    const entry = (counts[key] ??= { open: 0, total: 0 });
    entry.total += 1;
    if (isOpenThread(thread)) entry.open += 1;
  }
  return counts;
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

/**
 * Whether a comment's body is empty (no text and no mention).
 *
 * The text is read from an inert parsed document, never by stripping tags
 * with a regular expression: one pass of a tag pattern can leave markup
 * behind (`<scr<script>ipt>`), and what is left would be unsafe the day it is
 * reused as a string. A document from `DOMParser` runs no script and loads
 * nothing. An element's `textContent` is never null and `trim()` drops the
 * non-breaking space with the rest of the white space.
 */
export function isBlankHtml(html: string): boolean {
  if (html.includes('data-type="mention"')) return false;
  const { body } = new DOMParser().parseFromString(html, "text/html");
  return (body.textContent as string).trim() === "";
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
