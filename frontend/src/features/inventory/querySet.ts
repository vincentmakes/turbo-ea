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
