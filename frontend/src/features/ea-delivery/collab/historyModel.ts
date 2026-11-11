/**
 * Pure rules behind a document's History view (`DocumentHistoryDialog`): how
 * each timeline step reads and which icon it carries, which steps hold a
 * saved version, which version is selected, what a restore names as its
 * source, and which two versions a comparison shows. Kept out of the components so each rule has a direct
 * test.
 */
import type {
  DocumentHistoryEntry,
  DocumentHistoryKind,
  DocumentOwner,
  SoAWSectionData,
  SoawVersionSection,
  VersionPerson,
} from "@/types";
import type { Translate } from "../decisionStanding";
import { problemMessage } from "../decisionProblems";

/** The label key and icon of each step of the timeline. */
const KINDS: Record<DocumentHistoryKind, { key: string; icon: string }> = {
  created: { key: "collab.history.kind.created", icon: "add_circle" },
  baseline: { key: "collab.history.kind.baseline", icon: "inventory_2" },
  save: { key: "collab.history.kind.save", icon: "save" },
  restored: { key: "collab.history.kind.restored", icon: "restore" },
  revised: { key: "collab.history.kind.revised", icon: "content_copy" },
  sent_for_review: { key: "collab.history.kind.sentForReview", icon: "send" },
  signature: { key: "collab.history.kind.signature", icon: "draw" },
  signed: { key: "collab.history.kind.signed", icon: "verified" },
  rejected: { key: "collab.history.kind.rejected", icon: "block" },
  recalled: { key: "collab.history.kind.recalled", icon: "undo" },
  recorded: { key: "collab.history.kind.recorded", icon: "history_edu" },
};

/** A step this client does not know yet (a newer server). */
const UNKNOWN = { key: "collab.history.kind.unknown", icon: "radio_button_unchecked" };

function kindOf(kind: string): { key: string; icon: string } {
  return Object.prototype.hasOwnProperty.call(KINDS, kind)
    ? KINDS[kind as DocumentHistoryKind]
    : UNKNOWN;
}

/** The translation key naming a timeline step. */
export function timelineLabelKey(kind: string): string {
  return kindOf(kind).key;
}

/** The Material Symbol of a timeline step. */
export function timelineIcon(kind: string): string {
  return kindOf(kind).icon;
}

/** Who took a step: the account's name, the kept name, or "Unknown person". */
export function actorName(entry: Pick<DocumentHistoryEntry, "actor" | "actor_name">, t: Translate): string {
  return entry.actor?.display_name || entry.actor_name || t("collab.history.unknownActor");
}

/** "Saved, 12 Nov 2026 10:30": a step as a version picker names it. */
export function entryTitle(
  entry: Pick<DocumentHistoryEntry, "kind" | "created_at">,
  t: Translate,
  formatDateTime: (iso: string) => string,
): string {
  return t("collab.history.entryTitle", {
    what: t(timelineLabelKey(entry.kind)),
    date: formatDateTime(entry.created_at),
  });
}

/**
 * The version a `restored` row brought back: the server's `restored_from`,
 * else (an older payload) the loaded row its note names. Null for any other
 * row, or a source that is gone or not loaded. The note itself is an id and
 * is never shown.
 */
export function restoredSource(
  entry: Pick<DocumentHistoryEntry, "kind" | "note" | "restored_from">,
  entries: readonly DocumentHistoryEntry[],
): { id: string; created_at: string } | null {
  if (entry.kind !== "restored") return null;
  if (entry.restored_from) return entry.restored_from;
  if (!entry.note) return null;
  return entries.find((e) => e.id === entry.note) ?? null;
}

/**
 * What a row's note line says: a rejection's reason, a signing note, the
 * version a restore brought back. Null when there is nothing to add.
 */
export function entryNote(
  entry: DocumentHistoryEntry,
  entries: readonly DocumentHistoryEntry[],
  t: Translate,
  formatDateTime: (iso: string) => string,
): string | null {
  if (entry.kind === "restored") {
    const source = restoredSource(entry, entries);
    return source
      ? t("collab.history.restoredFrom", { date: formatDateTime(source.created_at) })
      : t("collab.history.restoredFromEarlier");
  }
  if (entry.kind === "rejected") {
    return entry.note ? t("collab.history.reason", { note: entry.note }) : t("collab.history.noReason");
  }
  if (entry.kind === "signature" && entry.note) return t("collab.history.signNote", { note: entry.note });
  return null;
}

/** The rows that hold a saved version (they can be viewed and compared). */
export function contentEntries(entries: readonly DocumentHistoryEntry[]): DocumentHistoryEntry[] {
  return entries.filter((e) => e.has_content);
}

/** Rows newest first; rows written at the same instant keep the server's order. */
export function newestFirst(entries: readonly DocumentHistoryEntry[]): DocumentHistoryEntry[] {
  return entries
    .map((entry, index) => ({ entry, index }))
    .sort((a, b) => {
      const byTime = Date.parse(b.entry.created_at) - Date.parse(a.entry.created_at);
      return byTime !== 0 ? byTime : a.index - b.index;
    })
    .map(({ entry }) => entry);
}

/** Two versions to compare: `from` is the older, `to` the newer. */
export interface ComparePair {
  from: string;
  to: string;
}

/**
 * Which two versions "Compare" opens on: the selected version against the
 * one saved before it; the oldest version against the one after it. Null
 * when fewer than two versions are loaded.
 */
export function defaultComparePair(
  selectedId: string,
  entries: readonly DocumentHistoryEntry[],
): ComparePair | null {
  // Oldest first.
  const versions = newestFirst(contentEntries(entries)).reverse();
  if (versions.length < 2) return null;
  const at = versions.findIndex((e) => e.id === selectedId);
  if (at === -1) return null;
  if (at === 0) return { from: versions[0].id, to: versions[1].id };
  return { from: versions[at - 1].id, to: versions[at].id };
}

/**
 * The version the History view shows: the one picked in the timeline while it
 * is still loaded and holds a version, else the newest version. Null when no
 * loaded row holds one.
 */
export function selectedVersion(
  pickedId: string | null,
  entries: readonly DocumentHistoryEntry[],
): DocumentHistoryEntry | null {
  const versions = newestFirst(contentEntries(entries));
  return versions.find((e) => e.id === pickedId) ?? versions[0] ?? null;
}

/** The versions the selected one can be compared with, newest first (itself left out). */
export function compareOptions(
  selectedId: string,
  entries: readonly DocumentHistoryEntry[],
): DocumentHistoryEntry[] {
  return newestFirst(contentEntries(entries)).filter((e) => e.id !== selectedId);
}

/**
 * The two versions "Changes" shows for the selected one: against the version
 * picked to compare with (older to newer, whichever is which) while it is
 * still offered, else against the default (`defaultComparePair`). Null when
 * there is nothing to compare with.
 */
export function comparePairFor(
  selectedId: string,
  compareWith: string | null,
  entries: readonly DocumentHistoryEntry[],
): ComparePair | null {
  if (compareWith && compareOptions(selectedId, entries).some((e) => e.id === compareWith)) {
    return orderPair(selectedId, compareWith, entries);
  }
  return defaultComparePair(selectedId, entries);
}

/** What "Changes" shows for the selected version. */
export type ChangesView =
  | { kind: "pair"; pair: ComparePair }
  /** The selected version is the oldest loaded one and earlier rows are on pages not read yet. */
  | { kind: "earlierNotLoaded" }
  /** No other version exists. */
  | { kind: "onlyOne" };

/**
 * What "Changes" shows for the selected version (`comparePairFor`), knowing
 * whether earlier rows exist that are not loaded yet (`hasMore`): the oldest
 * loaded version is compared with the one after it only once the whole
 * timeline is loaded, never while the version before it may be on a page not
 * read yet; and "the only saved version" is said only when there is nothing
 * earlier to load. A version picked to compare with is always honoured.
 */
export function changesView(
  selectedId: string,
  compareWith: string | null,
  entries: readonly DocumentHistoryEntry[],
  hasMore: boolean,
): ChangesView {
  const picked = compareWith !== null && compareOptions(selectedId, entries).some((e) => e.id === compareWith);
  const oldest = newestFirst(contentEntries(entries)).pop();
  if (!picked && hasMore && oldest?.id === selectedId) return { kind: "earlierNotLoaded" };
  const pair = comparePairFor(selectedId, compareWith, entries);
  return pair ? { kind: "pair", pair } : { kind: "onlyOne" };
}

/** The other version of a pair: what the "Compare with" picker shows for the selected one. */
export function otherSide(selectedId: string, pair: ComparePair): string {
  return pair.from === selectedId ? pair.to : pair.from;
}

/** Two picked versions in time order, whichever was picked first. */
export function orderPair(a: string, b: string, entries: readonly DocumentHistoryEntry[]): ComparePair {
  const time = (id: string) => {
    const e = entries.find((x) => x.id === id);
    return e ? Date.parse(e.created_at) : 0;
  };
  return time(a) <= time(b) ? { from: a, to: b } : { from: b, to: a };
}

/** Rows per timeline page. */
export const HISTORY_PAGE_SIZE = 20;

/** `GET` path of one timeline page (1-based). */
export function historyPath(owner: DocumentOwner, page: number): string {
  return `/${owner.kind}/${owner.id}/history?page=${page}&page_size=${HISTORY_PAGE_SIZE}`;
}

/** `GET` path of one saved version. */
export function versionPath(owner: DocumentOwner, entryId: string): string {
  return `/${owner.kind}/${owner.id}/history/${entryId}`;
}

/** `POST` path restoring one saved version. */
export function restorePath(owner: DocumentOwner, entryId: string): string {
  return `/${owner.kind}/${owner.id}/history/${entryId}/restore`;
}

/** Restore is offered on a saved version of a draft, to a reader the server allows. */
export function canRestore(canRestoreFlag: boolean, status: string, entry: Pick<DocumentHistoryEntry, "has_content">): boolean {
  return canRestoreFlag && status === "draft" && entry.has_content;
}

/** Rows of a later page, after the ones held, without repeating any (a row written meanwhile shifts pages). */
export function appendPage(
  held: readonly DocumentHistoryEntry[],
  page: readonly DocumentHistoryEntry[],
): DocumentHistoryEntry[] {
  const ids = new Set(held.map((e) => e.id));
  return [...held, ...page.filter((e) => !ids.has(e.id))];
}

/**
 * The message for a refused restore: the document left draft meanwhile, a
 * restored date the server refuses (by its problem code), else the server's
 * words or a generic failure.
 */
export function restoreErrorMessage(err: unknown, t: Translate): string {
  const detail = (err as { detail?: unknown } | null)?.detail as { error?: unknown } | null | undefined;
  if (detail && typeof detail === "object" && detail.error === "not_draft") {
    return t("collab.history.restoreNotDraft");
  }
  const problems = problemMessage(err, t);
  if (problems) return problems;
  return err instanceof Error && err.message ? err.message : t("collab.history.restoreFailed");
}

/** A saved SoAW's sections split as the preview renders them: template sections, and custom ones with their titles. */
export function splitSoawSections(sections: Record<string, SoawVersionSection> | null | undefined): {
  template: Record<string, SoAWSectionData>;
  custom: { id: string; title: string; content: string; insertAfter: string }[];
} {
  const template: Record<string, SoAWSectionData> = {};
  const custom: { id: string; title: string; content: string; insertAfter: string }[] = [];
  for (const [key, value] of Object.entries(sections ?? {})) {
    if (key.startsWith("custom_")) {
      custom.push({ id: key, title: value.title ?? key, content: value.content ?? "", insertAfter: value.insertAfter ?? "" });
    } else {
      template[key] = value;
    }
  }
  return { template, custom };
}


/** A version's people as one line of names (a free-text name kept as `name` by older rows included). */
export function peopleLine(people: readonly VersionPerson[] | null | undefined): string {
  return (people ?? [])
    .map((p) => p.display_name || (p as { name?: string }).name || "")
    .filter(Boolean)
    .join(", ");
}
