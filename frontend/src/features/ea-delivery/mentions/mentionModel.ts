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
import { cardSearchRank, compareByRank } from "@/lib/searchRank";
import {
  asMentionKind,
  mentionsIn,
  type MentionKind,
  type MentionLabels,
} from "@/lib/mentionHtml";
import type { ArchitectureDecision } from "@/types";
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
  /** A second line (a card's type, a decision's status, a person's e-mail). */
  secondary?: string;
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

/** Cards ranked on the raw query (name and alias, as `CardPicker` ranks them). */
export function cardMentionItems(
  cards: { id: string; name: string; type: string; alias?: string | null }[],
  query: string,
): MentionItem[] {
  const q = query.trim();
  const ranked = q
    ? cards.filter((c) => cardSearchRank(c, q) >= 0).sort(compareByRank(q))
    : cards;
  return ranked
    .slice(0, MENTION_GROUP_LIMIT)
    .map((c) => ({ kind: "card", id: c.id, label: c.name, secondary: c.type }));
}

/** Decisions ranked on the raw query, labelled "ADR-012 · Rev 2 Title" as the server labels them. */
export function decisionMentionItems(
  rows: ArchitectureDecision[],
  query: string,
  t: Translate,
): MentionItem[] {
  return filterAndRankDecisions(rows, query)
    .slice(0, MENTION_GROUP_LIMIT)
    .map((row) => ({
      kind: "decision",
      id: row.id,
      label: `${decisionRefLabel(row, t)} ${row.title}`,
    }));
}

/** People ranked on the raw query, by name with the e-mail as an equal alias. */
export function userMentionItems(
  users: { id: string; display_name: string; email: string }[],
  query: string,
): MentionItem[] {
  const q = query.trim();
  const rankable = (u: { display_name: string; email: string }) => ({
    name: u.display_name,
    alias: u.email,
  });
  const cmp = compareByRank(q);
  const ranked = q
    ? users
        .filter((u) => cardSearchRank(rankable(u), q) >= 0)
        .sort((a, b) => cmp(rankable(a), rankable(b)))
    : users;
  return ranked
    .slice(0, MENTION_GROUP_LIMIT)
    .map((u) => ({ kind: "user", id: u.id, label: u.display_name, secondary: u.email }));
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
