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
  /** A card row: its type and subtype keys (resolved to labels at render). */
  card?: { type: string; subtype?: string | null };
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

type CardRow = { id: string; name: string; type: string; alias?: string | null; subtype?: string | null };

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
    card: { type: c.type, subtype: c.subtype ?? null },
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
  card: { type: string; subtype?: string | null },
  type: Pick<CardType, "key" | "label" | "color" | "icon" | "subtypes"> | undefined,
  typeLabel: (type: Pick<CardType, "key" | "label" | "color" | "icon" | "subtypes">) => string,
  subtypeLabel: (subtype: SubtypeDef) => string,
): { color: string | null; icon: string | null; detail: string } {
  if (!type) return { color: null, icon: null, detail: "" };
  const sub = card.subtype ? type.subtypes?.find((s) => s.key === card.subtype) : undefined;
  return {
    color: type.color,
    icon: type.icon,
    detail: [typeLabel(type), sub ? subtypeLabel(sub) : ""].filter(Boolean).join(" · "),
  };
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

/**
 * The highlighted row of the popup, whose rows are the items and a last
 * "Browse…" row (index `itemCount`). `active` -1 is the default: the first
 * item, or nothing when there is none, so Enter on a query that found nothing
 * still reaches the editor; the arrows reach Browse from there.
 */
export function resolveActive(active: number, itemCount: number): number {
  if (active < 0) return itemCount > 0 ? 0 : -1;
  return Math.min(active, itemCount);
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
