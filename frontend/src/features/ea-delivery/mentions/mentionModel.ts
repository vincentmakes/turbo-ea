/**
 * Pure rules behind mentions in the rich-text editor: what a mention node
 * carries, how its span is written, how the "@" popup groups and ranks what it
 * offers, how the arrow keys move through it, where a chip leads, and which
 * mentioned cards are not linked yet. Kept apart from the editor and the popup
 * so each rule is a small tested function.
 *
 * The span grammar is the server's (`mention_service.py`); see
 * `@/lib/mentionHtml` for the reader-side states.
 */
import { filterAndRankDecisions } from "@/components/DecisionPicker";
import { cardSearchRank, type RankableCard } from "@/lib/searchRank";
import {
  asMentionKind,
  mentionsIn,
  type MentionKind,
  type MentionLabels,
} from "@/lib/mentionHtml";
import type { ArchitectureDecision, CardType, SubtypeDef } from "@/types";
import { decisionHref } from "../DecisionBanners";
import { decisionRefLabel, type Translate } from "../decisionStanding";

/** What a mention node holds. */
export interface MentionAttrs {
  kind: MentionKind | null;
  /** The target; null on a restricted mention, which carries a token instead. */
  id: string | null;
  /** Opaque server token standing for a target the reader may not see. */
  token: string | null;
  /** The name the server filled in (no leading "@"); "" when it has none. */
  label: string;
  restricted: boolean;
  missing: boolean;
  archived: boolean;
}

/** One row of the "@" popup; picking it inserts a mention with these attrs. */
export interface MentionItem {
  kind: MentionKind;
  id: string;
  label: string;
  /** A second line: a person's e-mail. */
  secondary?: string;
  /**
   * A card row: its type and subtype keys (resolved to labels at render), its
   * parent's id, and the parent's name once it is known (`withParentNames`).
   */
  card?: { type: string; subtype?: string | null; parentId?: string | null; parentName?: string };
  /** A decision row: its reference, its title and what its state chip shows. */
  decision?: {
    reference: string;
    title: string;
    status: ArchitectureDecision["status"];
    standing?: ArchitectureDecision["standing"];
    recorded_at?: string | null;
  };
}

/** What insert needs of a pick: the mention node's identity and its text. */
export type MentionPick = Pick<MentionItem, "kind" | "id" | "label">;

/**
 * What the document around an editor knows: its linked cards and its people
 * (signatories, decision makers and participants who are users). The "@"
 * popup lists them first.
 */
export interface MentionContext {
  linkedCardIds?: string[];
  priorityUserIds?: string[];
}

/** One titled block of the popup. */
export interface MentionGroup {
  kind: MentionKind;
  items: MentionItem[];
}

/** Rows offered per group. */
export const MENTION_GROUP_LIMIT = 8;

const GROUP_ORDER: readonly MentionKind[] = ["card", "decision", "user"];

// --- the span ----------------------------------------------------------------

/** A mention node's attributes, read from its span (editor parse, preview click). */
export function mentionAttrsFromElement(el: Element): MentionAttrs {
  const kind = asMentionKind(el.getAttribute("data-kind"));
  const text = el.textContent ?? "";
  return {
    kind,
    id: el.getAttribute("data-id") || null,
    token: el.getAttribute("data-token") || null,
    label: kind === "decision" ? text : text.replace(/^@/, ""),
    restricted: el.getAttribute("data-restricted") === "true",
    missing: el.getAttribute("data-missing") === "true",
    archived: el.getAttribute("data-archived") === "true",
  };
}

/**
 * The span's attributes in the server's canonical order (type, kind, id, then
 * the reader states), so a document loaded and saved again is byte-stable. A
 * restricted mention is written back exactly as it came: kind, the flag and
 * the token, never an id.
 */
export function mentionSpanAttributes(attrs: MentionAttrs): Record<string, string> {
  const out: Record<string, string> = { "data-type": "mention" };
  if (attrs.kind) out["data-kind"] = attrs.kind;
  if (attrs.id) out["data-id"] = attrs.id;
  if (attrs.restricted) out["data-restricted"] = "true";
  if (attrs.token) out["data-token"] = attrs.token;
  if (attrs.missing) out["data-missing"] = "true";
  if (attrs.archived) out["data-archived"] = "true";
  return out;
}

/**
 * The span's text: "@Name" for a person or card, the reference and title for
 * a decision (as the server writes it), nothing for a restricted or missing
 * mention (the reader's language fills those in at display time).
 */
export function mentionText(attrs: MentionAttrs): string {
  if (attrs.restricted || attrs.missing || !attrs.label) return "";
  return attrs.kind === "decision" ? attrs.label : `@${attrs.label}`;
}

/**
 * What a chip shows in the editor: the span's text, or the reader's words for
 * a restricted or missing mention ("Restricted card", "Deleted decision").
 */
export function mentionChipText(attrs: MentionAttrs, labels: MentionLabels): string {
  const kind = attrs.kind ?? "other";
  if (attrs.restricted) return labels.restricted[kind];
  if (attrs.missing) return labels.missing[kind];
  return mentionText(attrs) || "@";
}

/** Where a chip leads, or null when it leads nowhere (restricted, gone, a person). */
export function mentionHref(
  attrs: Pick<MentionAttrs, "kind" | "id" | "restricted" | "missing">,
): string | null {
  if (!attrs.id || attrs.restricted || attrs.missing) return null;
  if (attrs.kind === "card") return `/cards/${attrs.id}`;
  if (attrs.kind === "decision") return decisionHref(attrs.id);
  return null;
}

/** Where a click or key on rendered stored text leads: the mention span it hit, if any. */
export function mentionHrefFromTarget(target: EventTarget | null): string | null {
  if (!(target instanceof Element)) return null;
  const span = target.closest("span[data-type='mention']");
  return span ? mentionHref(mentionAttrsFromElement(span)) : null;
}

// --- the popup ---------------------------------------------------------------

/**
 * A comparator that ranks on the raw query exactly as `compareByRank` does
 * (exact, starts-with, starts-a-word, contains; a non-match last) and, within
 * one tier, puts the preferred rows first, alphabetical after that. It never
 * reorders across tiers. With an empty query every row is in one tier.
 */
export function comparePreferred<T>(
  query: string,
  rankable: (row: T) => RankableCard,
  preferred: (row: T) => boolean,
): (a: T, b: T) => number {
  const q = query.trim();
  const tier = (row: T) => {
    const r = cardSearchRank(rankable(row), q);
    return r < 0 ? Number.MAX_SAFE_INTEGER : r;
  };
  return (a, b) => {
    const diff = tier(a) - tier(b);
    if (diff !== 0) return diff;
    const pa = preferred(a);
    if (pa !== preferred(b)) return pa ? -1 : 1;
    return rankable(a).name.localeCompare(rankable(b).name, undefined, { sensitivity: "base" });
  };
}

type CardRow = {
  id: string;
  name: string;
  type: string;
  alias?: string | null;
  subtype?: string | null;
  parent_id?: string | null;
};

/**
 * Cards ranked on the raw query (name and alias, as `CardPicker` ranks them).
 *
 * `linked` are the document's linked cards, fetched by id. With an empty
 * query they come first (alphabetical), then the server's page in its own
 * order without them; with a query they join the candidates and come first
 * within their rank tier.
 */
export function cardMentionItems(
  cards: CardRow[],
  query: string,
  linked: CardRow[] = [],
): MentionItem[] {
  const q = query.trim();
  const linkedIds = new Set(linked.map((c) => c.id));
  const isLinked = (c: CardRow) => linkedIds.has(c.id);
  const byName = comparePreferred<CardRow>("", (c) => c, isLinked);
  let ranked: CardRow[];
  if (!q) {
    ranked = [...linked].sort(byName).concat(cards.filter((c) => !isLinked(c)));
  } else {
    ranked = linked
      .concat(cards.filter((c) => !isLinked(c)))
      .filter((c) => cardSearchRank(c, q) >= 0)
      .sort(comparePreferred<CardRow>(q, (c) => c, isLinked));
  }
  return ranked.slice(0, MENTION_GROUP_LIMIT).map((c) => ({
    kind: "card",
    id: c.id,
    label: c.name,
    card: { type: c.type, subtype: c.subtype ?? null, parentId: c.parent_id ?? null },
  }));
}

/** Decisions ranked on the raw query, labelled "ADR-012 · Rev 2 Title" as the server labels them. */
export function decisionMentionItems(
  rows: ArchitectureDecision[],
  query: string,
  t: Translate,
): MentionItem[] {
  return filterAndRankDecisions(rows, query)
    .slice(0, MENTION_GROUP_LIMIT)
    .map((row) => decisionMentionItem(row, t));
}

/** One decision as a row and a pick: "ADR-012 · Rev 2 Title". */
export function decisionMentionItem(row: ArchitectureDecision, t: Translate): MentionItem {
  const reference = decisionRefLabel(row, t);
  return {
    kind: "decision",
    id: row.id,
    label: `${reference} ${row.title}`,
    decision: {
      reference,
      title: row.title,
      status: row.status,
      standing: row.standing ?? null,
      recorded_at: row.recorded_at ?? null,
    },
  };
}

/**
 * People ranked on the raw query, by name with the e-mail as an equal alias;
 * the document's people (`priorityIds`) first within a tier, alphabetical
 * after that. With an empty query: the document's people, then everyone else.
 */
export function userMentionItems(
  users: { id: string; display_name: string; email: string }[],
  query: string,
  priorityIds: Iterable<string> = [],
): MentionItem[] {
  const q = query.trim();
  const priority = new Set(priorityIds);
  type Person = { id: string; display_name: string; email: string };
  const rankable = (u: Person) => ({ name: u.display_name, alias: u.email });
  const ranked = (q ? users.filter((u) => cardSearchRank(rankable(u), q) >= 0) : [...users]).sort(
    comparePreferred<Person>(q, rankable, (u) => priority.has(u.id)),
  );
  return ranked
    .slice(0, MENTION_GROUP_LIMIT)
    .map((u) => ({ kind: "user", id: u.id, label: u.display_name, secondary: u.email }));
}

/**
 * What a card row shows beside its name: its type's colour and icon, and
 * "Type · Subtype" (the subtype only when it has one the type defines). A
 * type the metamodel does not offer shows nothing: never its key.
 */
export function cardRowMeta(
  card: { type: string; subtype?: string | null; parentName?: string },
  type: Pick<CardType, "key" | "label" | "color" | "icon" | "subtypes"> | undefined,
  typeLabel: (type: Pick<CardType, "key" | "label" | "color" | "icon" | "subtypes">) => string,
  subtypeLabel: (subtype: SubtypeDef) => string,
  inParent: (name: string) => string = (name) => name,
): { color: string | null; icon: string | null; detail: string } {
  const parent = card.parentName ? inParent(card.parentName) : "";
  if (!type) return { color: null, icon: null, detail: parent };
  const sub = card.subtype ? type.subtypes?.find((s) => s.key === card.subtype) : undefined;
  return {
    color: type.color,
    icon: type.icon,
    detail: [typeLabel(type), sub ? subtypeLabel(sub) : "", parent].filter(Boolean).join(" · "),
  };
}

/**
 * The parents the card rows name and whose names are not known yet
 * (`known` holds a name, or null for a parent that is withheld or failed to
 * load), each once, in row order.
 */
export function parentIdsToFetch(items: readonly MentionItem[], known: ReadonlyMap<string, string | null>): string[] {
  const ids: string[] = [];
  for (const item of items) {
    const id = item.card?.parentId;
    if (id && !known.has(id) && !ids.includes(id)) ids.push(id);
  }
  return ids;
}

/** The rows with each card's parent name filled in where it is known; nothing else moves. */
export function withParentNames(items: readonly MentionItem[], known: ReadonlyMap<string, string | null>): MentionItem[] {
  return items.map((item) => {
    const name = item.card?.parentId ? known.get(item.card.parentId) : undefined;
    return name && item.card ? { ...item, card: { ...item.card, parentName: name } } : item;
  });
}

/**
 * The document's people a comment's "@" lists first: its signatories, and its
 * decision makers and participants who are users (a free-text name has no
 * account to mention). Deduplicated, in that order.
 */
export function documentPeopleIds(doc: {
  signatories?: { user_id: string }[] | null;
  decision_makers?: { user_id: string | null }[] | null;
  participants?: { user_id: string | null }[] | null;
}): string[] {
  const ids = [
    ...(doc.signatories ?? []).map((s) => s.user_id),
    ...(doc.decision_makers ?? []).map((p) => p.user_id),
    ...(doc.participants ?? []).map((p) => p.user_id),
  ];
  return Array.from(new Set(ids.filter((id): id is string => Boolean(id))));
}

/** The non-empty groups, cards first, then decisions, then people. */
export function groupMentionItems(byKind: Partial<Record<MentionKind, MentionItem[]>>): MentionGroup[] {
  return GROUP_ORDER.flatMap((kind) => {
    const items = byKind[kind] ?? [];
    return items.length > 0 ? [{ kind, items }] : [];
  });
}

/** Every row of the popup in display order: what the arrow keys walk. */
export function flattenGroups(groups: MentionGroup[]): MentionItem[] {
  return groups.flatMap((g) => g.items);
}

/**
 * The highlighted row after a key: ArrowDown and ArrowUp wrap around, any
 * other key keeps it. -1 when there is nothing to highlight.
 */
export function nextIndex(current: number, count: number, key: string): number {
  if (count <= 0) return -1;
  if (key === "ArrowDown") return current < 0 ? 0 : (current + 1) % count;
  if (key === "ArrowUp") return current <= 0 ? count - 1 : current - 1;
  return Math.min(Math.max(current, 0), count - 1);
}

/** The highlight on the popup's last "Browse…" row. */
export const BROWSE_HIGHLIGHT = "browse";

/**
 * The popup's highlight, by the row's identity rather than its place: an
 * item's `mentionItemKey`, `BROWSE_HIGHLIGHT`, or null for the default (the
 * first item). Rows arriving or leaving under it never move it onto another row.
 */
export type MentionHighlight = string | null;

/** A row's identity in the popup ("card:<id>", …; never "browse"). */
export function mentionItemKey(item: Pick<MentionItem, "kind" | "id">): string {
  return `${item.kind}:${item.id}`;
}

/**
 * The index of the highlighted row, whose rows are the items (`keys`, in
 * display order) and a last "Browse…" row (index `keys.length`). A
 * highlighted item that is still there stays highlighted wherever it moved;
 * one that is gone, and the default, fall back to the first item, never to
 * Browse; with no items nothing is highlighted, so Enter on a query that
 * found nothing still reaches the editor. Browse is highlighted only when the
 * user put the highlight there.
 */
export function resolveActive(highlight: MentionHighlight, keys: readonly string[]): number {
  if (highlight === BROWSE_HIGHLIGHT) return keys.length;
  const at = highlight === null ? -1 : keys.indexOf(highlight);
  if (at >= 0) return at;
  return keys.length > 0 ? 0 : -1;
}

/** The highlight after an arrow key: the rows (items, then Browse) wrap around. */
export function highlightAfterKey(highlight: MentionHighlight, keys: readonly string[], key: string): MentionHighlight {
  const next = nextIndex(resolveActive(highlight, keys), keys.length + 1, key);
  return next === keys.length ? BROWSE_HIGHLIGHT : (keys[next] ?? null);
}

/**
 * Whether the card group may be shown. Its rows must never shift once shown:
 * the document's linked cards are listed first, so nothing is shown before
 * they have answered; and on an empty query (just "@") the search page must
 * have answered for it too, so the linked cards and the page appear together.
 * With a typed query the loaded page is filtered at once, as before.
 */
export function cardRowsReady(state: {
  query: string;
  /** The query the card search last answered (null: none in this opening). */
  answeredFor: string | null;
  /** The query is still being debounced. */
  pending: boolean;
  /** The document has linked cards to list first. */
  wantLinked: boolean;
  /** They have been read (or failed). */
  linkedLoaded: boolean;
}): boolean {
  if (state.wantLinked && !state.linkedLoaded) return false;
  if (state.query.trim() !== "") return true;
  return !state.pending && state.answeredFor === state.query;
}

// --- browse ------------------------------------------------------------------

/**
 * The browse dialog's picks after one picker changed its selection to
 * `next`: the other kinds and the picks of this kind still chosen keep their
 * place, new ones are appended in `next`'s order. Insert follows this order.
 */
export function reconcilePicks(prev: MentionPick[], kind: MentionKind, next: MentionPick[]): MentionPick[] {
  const nextIds = new Set(next.map((p) => p.id));
  const kept = prev.filter((p) => p.kind !== kind || nextIds.has(p.id));
  const had = new Set(kept.filter((p) => p.kind === kind).map((p) => p.id));
  return kept.concat(next.filter((p) => !had.has(p.id)));
}

/** One pick added, or taken away when already picked. */
export function togglePick(prev: MentionPick[], pick: MentionPick): MentionPick[] {
  const has = prev.some((p) => p.kind === pick.kind && p.id === pick.id);
  return has ? prev.filter((p) => !(p.kind === pick.kind && p.id === pick.id)) : prev.concat(pick);
}

/**
 * What Insert puts at the caret: one mention node per pick, in pick order,
 * each followed by a space (as a pick in the popup is).
 */
export function mentionInsertContent(picks: MentionPick[]) {
  return picks.flatMap((p) => [
    {
      type: "mention",
      attrs: { kind: p.kind, id: p.id, label: p.label, mentionSuggestionChar: "@" },
    },
    { type: "text", text: " " },
  ]);
}

/**
 * Whether a range saved before the browse dialog opened still lies inside the
 * document (a reply may have replaced the text meanwhile).
 */
export function rangeFits(range: { from: number; to: number }, docSize: number): boolean {
  return range.from >= 0 && range.from <= range.to && range.to <= docSize;
}

/**
 * Where Insert writes: the target range, widened over the space that follows
 * it (`after`, the next character), as a pick in the popup is. Each mention
 * carries its own trailing space, so a space already there would make two.
 */
export function overFollowingSpace<R extends { from: number; to: number }>(target: R, after: string): R {
  return after === " " ? { ...target, to: target.to + 1 } : target;
}

// --- link offers -------------------------------------------------------------

/**
 * Cards mentioned in the text that are not linked to the decision: what the
 * editor offers to link in one click (a mention never links on its own).
 */
export function unlinkedMentionedCards(
  html: string,
  linkedCardIds: Iterable<string>,
): { id: string; label: string }[] {
  const linked = new Set(linkedCardIds);
  return mentionsIn(html)
    .filter((m) => m.kind === "card" && !linked.has(m.id))
    .map((m) => ({ id: m.id, label: m.label }));
}
