/**
 * Pure helpers over a query view's stack of lines (`CardQuerySet`). A view is
 * one or more GROUPS joined by OR (their results are added; a group may start
 * from another card type), and each group is one or more LINES joined by AND
 * (a card must match every line, so the lines of a group share the start
 * type). Each line is a plain `CardQuery`, edited with the per-line helpers of
 * `queryDraft.ts`. Every operation reads the set as its groups (`groupsOf`),
 * changes them, and writes them back normalised (`fromGroups`).
 */
import type { CardQuery, CardQueryAll, CardQueryHop, CardQuerySet } from "@/types";
import { draftProblem, pickedCardIds, sendableQuery, type DraftProblem } from "./queryDraft";

/** The most lines a view may hold over all its groups (the backend's cap). */
export const MAX_QUERY_LINES = 6;

/** The most relations (hops) a view may hold over all its lines. */
export const MAX_QUERY_HOPS = 12;

/** How a line joins the one above it: AND inside a group, OR at a new group. */
export type LineConnective = "and" | "or";

/** One line of the stack, with where it sits. */
export interface QueryLine {
  group: number;
  line: number;
  query: CardQuery;
  /** How the line joins the line above it; null on the very first line. */
  connective: LineConnective | null;
  /** An AND line: its start type is the group's, never chosen on the line. */
  fixedType: boolean;
  /** A group's first line with AND lines below it: its type cannot change. */
  typeLocked: boolean;
}

function isAll(q: CardQuery | CardQueryAll): q is CardQueryAll {
  return "all_of" in q;
}

/** The set read as its groups, each a list of lines. */
export function groupsOf(query: CardQuerySet): CardQuery[][] {
  if ("any_of" in query) return query.any_of.map((g) => (isAll(g) ? [...g.all_of] : [g]));
  if ("all_of" in query) return [[...query.all_of]];
  return [[query]];
}

/**
 * The inverse of `groupsOf`, normalised: an empty group is dropped, a group
 * of one line is that line, and one group alone is the whole set — so a
 * single line is always the plain `CardQuery`. Nothing left is an empty line.
 */
export function fromGroups(groups: CardQuery[][]): CardQuerySet {
  const kept = groups.filter((g) => g.length > 0);
  const one = (g: CardQuery[]): CardQuery | CardQueryAll => (g.length === 1 ? g[0] : { all_of: g });
  if (kept.length === 0) return { type: "" };
  if (kept.length === 1) return one(kept[0]);
  return { any_of: kept.map(one) };
}

/** Every line of the set, in reading order, with its place and connective. */
export function linesOf(query: CardQuerySet): QueryLine[] {
  return groupsOf(query).flatMap((lines, group) =>
    lines.map((q, line) => {
      let connective: LineConnective | null = null;
      if (line > 0) connective = "and";
      else if (group > 0) connective = "or";
      return {
        group,
        line,
        query: q,
        connective,
        fixedType: line > 0,
        typeLocked: line === 0 && lines.length > 1,
      };
    }),
  );
}

/** The distinct start types of the set, in reading order; an untyped line names none. */
export function startTypes(query: CardQuerySet): string[] {
  const seen: string[] = [];
  for (const { query: q } of linesOf(query)) {
    if (q.type && !seen.includes(q.type)) seen.push(q.type);
  }
  return seen;
}

/** Do two lists name the same card types, in any order? */
export function sameTypeSet(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((t) => b.includes(t));
}

/** How many lines the set holds. */
export function lineCount(query: CardQuerySet): number {
  return linesOf(query).length;
}

function hopsIn(hops: CardQueryHop[] | undefined): number {
  return (hops ?? []).reduce((n, h) => n + 1 + hopsIn(h.related), 0);
}

/** How many relations (hops) the set holds over all its lines, branch hops included. */
export function hopTotal(query: CardQuerySet): number {
  return linesOf(query).reduce((n, l) => n + hopsIn(l.query.related), 0);
}

/** May another line be added (fewer than `MAX_QUERY_LINES`)? */
export function canAddLine(query: CardQuerySet): boolean {
  return lineCount(query) < MAX_QUERY_LINES;
}

/** May another relation be added anywhere (fewer than `MAX_QUERY_HOPS`)? */
export function canAddHop(query: CardQuerySet): boolean {
  return hopTotal(query) < MAX_QUERY_HOPS;
}

/**
 * Adds a line below group `group`. AND appends a line to that group, starting
 * from the group's card type (a no-op while the group has no type yet); OR
 * inserts a new group right after it, with an empty line whose type is still
 * to be chosen. A no-op at the line cap or for a group that does not exist.
 */
export function addLine(
  query: CardQuerySet,
  group: number,
  connective: LineConnective,
): CardQuerySet {
  const groups = groupsOf(query);
  if (!canAddLine(query) || group < 0 || group >= groups.length) return query;
  if (connective === "and") {
    const type = groups[group][0].type;
    if (!type) return query;
    groups[group] = [...groups[group], { type }];
  } else {
    groups.splice(group + 1, 0, [{ type: "" }]);
  }
  return fromGroups(groups);
}

/** Removes one line; a group losing its last line goes with it. */
export function removeLine(query: CardQuerySet, group: number, line: number): CardQuerySet {
  const groups = groupsOf(query);
  if (!groups[group] || line < 0 || line >= groups[group].length) return query;
  groups[group] = groups[group].filter((_, i) => i !== line);
  return fromGroups(groups);
}

/** Replaces one line with `next`. */
export function updateLine(
  query: CardQuerySet,
  group: number,
  line: number,
  next: CardQuery,
): CardQuerySet {
  const groups = groupsOf(query);
  if (!groups[group] || line < 0 || line >= groups[group].length) return query;
  groups[group] = groups[group].map((q, i) => (i === line ? next : q));
  return fromGroups(groups);
}

/** A problem of the set as a whole: the backend refuses it whatever its lines hold. */
export type SetLevelProblem = "too_many_lines" | "too_many_hops" | "all_of_type_mismatch";

/** Why a set cannot be saved. */
export type SetProblem = DraftProblem | SetLevelProblem;

/** Is `problem` one of the set as a whole (not a line still being filled in)? */
export function isSetLevelProblem(problem: SetProblem | null): problem is SetLevelProblem {
  return problem === "too_many_lines" || problem === "too_many_hops" || problem === "all_of_type_mismatch";
}

/**
 * Why the set cannot be saved, or null. First what the set breaks as a whole
 * (an MCP-written view opened in the builder can): more than
 * `MAX_QUERY_LINES` lines, more than `MAX_QUERY_HOPS` relations, an AND group
 * whose lines start from different card types; then the first line's
 * `draftProblem`.
 */
export function setProblem(query: CardQuerySet): SetProblem | null {
  if (lineCount(query) > MAX_QUERY_LINES) return "too_many_lines";
  if (hopTotal(query) > MAX_QUERY_HOPS) return "too_many_hops";
  for (const lines of groupsOf(query)) {
    const types = new Set(lines.map((q) => q.type).filter((t) => t));
    if (types.size > 1) return "all_of_type_mismatch";
  }
  for (const { query: q } of linesOf(query)) {
    const problem = draftProblem(q);
    if (problem) return problem;
  }
  return null;
}

/**
 * The part of a set the grid can preview while it is being edited: each line
 * through `sendableQuery`, a line still without a type left out (and a group
 * left empty with it), normalised. Null when no line is left.
 */
export function sendableQuerySet(query: CardQuerySet): CardQuerySet | null {
  const groups = groupsOf(query)
    .map((lines) => lines.flatMap((q) => sendableQuery(q) ?? []))
    .filter((g) => g.length > 0);
  return groups.length > 0 ? fromGroups(groups) : null;
}

/** Every card id any line picks, deduped in reading order. */
export function pickedCardIdsOf(query: CardQuerySet): string[] {
  const seen = new Set<string>();
  for (const { query: q } of linesOf(query)) for (const id of pickedCardIds(q)) seen.add(id);
  return [...seen];
}

/**
 * Whether the start card of any line filters on end-of-life status
 * (`where.eol_status`): the grid then lists cards chosen by their status, so
 * the inventory shows its End of life column whatever the column picker says.
 * A condition on a hop is about the related card, not the rows, and does not
 * count.
 */
export function startFiltersOnEol(query: CardQuerySet | null | undefined): boolean {
  if (!query) return false;
  return linesOf(query).some(({ query: q }) => (q.where?.eol_status?.length ?? 0) > 0);
}

/** One hop on the way from a line's first card to a matched node. */
export interface MatchNodeStep {
  /** The hop's relation key (`<key>__out` / `<key>__in` on a self-reference). */
  relation: string;
  /** The card type the hop reaches. */
  type: string;
}

/**
 * A step of the query whose matched cards can be shown in a column: every
 * card of a line but its first (its cards are the rows), and none at or below
 * a "has no" hop (it stands for an absence).
 */
export interface MatchNode {
  /** `"<line>:<hop path>"`: the line's place among all lines (reading order),
   *  then the dot-joined indices into the `related` arrays down to the node. */
  key: string;
  /** Zero-based place of the line among all the query's lines. */
  line: number;
  /** The node's card type. */
  type: string;
  /** The relation of the hop that reaches the node. */
  relation: string;
  /** The card type of the line's first card (the row's type). */
  startType: string;
  /** Every hop from the line's first card down to the node, the node's own last. */
  path: MatchNodeStep[];
  /** The node's place in its line: the indices into the `related` arrays
   *  from the line's first card down to it (what the key's hop path spells). */
  indices: number[];
}

/**
 * Every step of `query` whose matched cards a column can show, in reading
 * order (line by line, each node before the hops below it). Keys are those the
 * matches endpoint expects, so compute them on exactly the query the list is
 * sent.
 */
export function matchNodes(query: CardQuerySet | null | undefined): MatchNode[] {
  if (!query) return [];
  const out: MatchNode[] = [];
  linesOf(query).forEach(({ query: q }, line) => {
    const walk = (hops: CardQueryHop[] | undefined, at: number[], path: MatchNodeStep[]) => {
      (hops ?? []).forEach((hop, i) => {
        if (hop.negate) return;
        const indices = [...at, i];
        const steps = [...path, { relation: hop.relation, type: hop.type }];
        out.push({
          key: `${line}:${indices.join(".")}`,
          line,
          type: hop.type,
          relation: hop.relation,
          startType: q.type,
          path: steps,
          indices,
        });
        walk(hop.related, indices, steps);
      });
    };
    walk(q.related, [], []);
  });
  return out;
}

/** The chain a node stands at the end of: start type, then every hop's relation and type. */
/**
 * The key `matchNodes` gives the node on line `line` at `indices` (its place,
 * as `MatchNode.indices`), or null where there is none: the line's first card
 * (no indices), a "has no" hop or any hop below one. The one numbering of
 * keys, for a renderer that walks the query itself (the path strip's pills).
 */
export function matchKeyAt(
  query: CardQuerySet | null | undefined,
): (line: number, indices: readonly number[]) => string | null {
  const byPlace = new Map(matchNodes(query).map((n) => [`${n.line}|${n.indices.join(".")}`, n.key]));
  return (line, indices) => byPlace.get(`${line}|${indices.join(".")}`) ?? null;
}

function nodeSignature(node: MatchNode): string {
  return JSON.stringify([node.startType, node.path.map((s) => [s.relation, s.type])]);
}

/**
 * The switched-on keys that still mean the same step once `prev` became
 * `next`: a key is kept while `next` holds a node at that key reached through
 * the same chain (start type, and each hop's relation and card type) as in
 * `prev`. A condition changed anywhere keeps it; a step removed, moved or
 * re-typed drops it. Order is kept, duplicates dropped.
 */
export function pruneViaKeys(
  keys: readonly string[],
  prev: CardQuerySet | null | undefined,
  next: CardQuerySet | null | undefined,
): string[] {
  if (keys.length === 0) return [];
  const before = new Map(matchNodes(prev).map((n) => [n.key, nodeSignature(n)]));
  const after = new Map(matchNodes(next).map((n) => [n.key, nodeSignature(n)]));
  const kept: string[] = [];
  for (const key of keys) {
    const sig = after.get(key);
    if (sig !== undefined && sig === before.get(key) && !kept.includes(key)) kept.push(key);
  }
  return kept;
}
