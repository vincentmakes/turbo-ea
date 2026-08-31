/**
 * Pure hierarchy helpers shared by the card pickers.
 *
 * `CardScopeDialog` and `CardMultiPicker` both render "pick a card and
 * everything under it" over a partially-loaded card set, and both need the
 * same four things: reduce a selection to subtree roots, index children by
 * parent, keep a match's ancestors visible while searching, and rank a branch
 * by the best match inside it. They lived in `CardScopeDialog` first; they sit
 * here so the second picker consumes them rather than growing its own copy
 * that drifts.
 *
 * No React, no MUI, no `@/api` — everything here is a function of its
 * arguments so it can be unit-tested without a DOM.
 */
import { searchRank } from "@/lib/searchRank";

/** Minimal card shape the hierarchy helpers need. */
export interface TreeCard {
  id: string;
  name: string;
  type: string;
  parent_id?: string | null;
}

/**
 * Reduce a selection to subtree *roots*.
 *
 * Scope is "these cards and everything under them", so a pick that already
 * sits inside another pick's subtree adds nothing — keeping both would render
 * the inner subtree twice. The ancestor always wins, whichever order the two
 * were picked in.
 *
 * Ids whose parent chain isn't in `parentById` (a card outside the loaded set,
 * or one deleted since the scope was saved) are kept as their own roots: the
 * caller is the one that knows whether an unresolvable id should survive.
 */
export function dedupeScopeRoots(
  ids: string[],
  parentById: Map<string, string | null | undefined>,
): string[] {
  const picked = new Set(ids);
  const out: string[] = [];
  for (const id of ids) {
    let cursor = parentById.get(id) ?? null;
    let coveredByAncestor = false;
    // Bounded by the chain length; a cycle would be a data bug upstream, so
    // guard with a visited set rather than trusting the graph.
    const seen = new Set<string>([id]);
    while (cursor && !seen.has(cursor)) {
      if (picked.has(cursor)) {
        coveredByAncestor = true;
        break;
      }
      seen.add(cursor);
      cursor = parentById.get(cursor) ?? null;
    }
    if (!coveredByAncestor) out.push(id);
  }
  return out;
}

/**
 * Children indexed by parent id, each level sorted alphabetically.
 *
 * A card whose parent is outside the loaded set is filed under `null` — i.e.
 * treated as a root — so it stays reachable rather than disappearing into a
 * branch that never loaded.
 */
export function buildChildIndex<T extends TreeCard>(byId: Map<string, T>): Map<string | null, T[]> {
  const map = new Map<string | null, T[]>();
  for (const c of byId.values()) {
    const key = c.parent_id && byId.has(c.parent_id) ? c.parent_id : null;
    const list = map.get(key) ?? [];
    list.push(c);
    map.set(key, list);
  }
  for (const list of map.values()) list.sort((a, b) => a.name.localeCompare(b.name));
  return map;
}

/**
 * Ids matching the query, plus the ancestor chain of every match — searching
 * for a deep sub-capability must not orphan it from its parents.
 *
 * Returns `null` for an empty query, meaning "everything is visible".
 */
export function visibleForQuery<T extends TreeCard>(
  byId: Map<string, T>,
  query: string,
): Set<string> | null {
  if (!query) return null;
  const ids = new Set<string>();
  for (const c of byId.values()) {
    if (searchRank(c.name, query) >= 0) ids.add(c.id);
  }
  for (const id of Array.from(ids)) {
    let cursor = byId.get(id)?.parent_id ?? null;
    while (cursor && byId.has(cursor) && !ids.has(cursor)) {
      ids.add(cursor);
      cursor = byId.get(cursor)?.parent_id ?? null;
    }
  }
  return ids;
}

/**
 * Best rank found anywhere in each node's subtree, itself included.
 *
 * Ordering tree siblings by their *own* rank gets this wrong: an ancestor
 * kept only for context scores "no match" on its own name, so the branch
 * holding the best match in the whole tree would sink to the bottom. Rolling
 * the best descendant rank up means a branch is ranked by the best thing
 * inside it, while a branch with nothing matching beneath it still sorts
 * last. One post-order pass over the loaded set.
 *
 * Returns `null` for an empty query — there is nothing to rank by.
 */
export function bestRankBySubtree<T extends TreeCard>(
  byId: Map<string, T>,
  byParent: Map<string | null, T[]>,
  query: string,
): Map<string, number> | null {
  if (!query) return null;
  const cache = new Map<string, number>();
  const NO_MATCH = Number.MAX_SAFE_INTEGER;
  const visit = (id: string, seen: Set<string>): number => {
    const cached = cache.get(id);
    if (cached !== undefined) return cached;
    // A cycle would be a data bug upstream; guard rather than trust it.
    if (seen.has(id)) return NO_MATCH;
    seen.add(id);
    const card = byId.get(id);
    const own = card ? searchRank(card.name, query) : -1;
    let best = own < 0 ? NO_MATCH : own;
    for (const child of byParent.get(id) ?? []) {
      best = Math.min(best, visit(child.id, seen));
    }
    seen.delete(id);
    cache.set(id, best);
    return best;
  };
  for (const id of byId.keys()) visit(id, new Set());
  return cache;
}

/** One row of a flattened hierarchy. */
export interface FlatTreeRow<T extends TreeCard> {
  card: T;
  depth: number;
  /** Checked in its own right — this row is a scope root. */
  selected: boolean;
  /** In scope only because an ancestor is checked. */
  implied: boolean;
}

/**
 * Depth-first flatten, so one scrolling list can render an indented tree.
 *
 * `impliedRows: false` is for a picker whose selection is a plain set rather
 * than a set of subtree roots — descendants of a pick are then ordinary,
 * independently tickable rows.
 */
export function flattenTree<T extends TreeCard>({
  byParent,
  selectedIds,
  visibleSet,
  bestRank,
  impliedRows = true,
}: {
  byParent: Map<string | null, T[]>;
  selectedIds: Set<string>;
  /** `null` = no query, everything visible. */
  visibleSet: Set<string> | null;
  /** `null` = no query, keep the alphabetical order `byParent` already holds. */
  bestRank: Map<string, number> | null;
  impliedRows?: boolean;
}): FlatTreeRow<T>[] {
  const order = (siblings: T[]) => {
    if (!bestRank) return siblings;
    return [...siblings].sort((a, b) => {
      const diff =
        (bestRank.get(a.id) ?? Number.MAX_SAFE_INTEGER) -
        (bestRank.get(b.id) ?? Number.MAX_SAFE_INTEGER);
      return diff !== 0 ? diff : a.name.localeCompare(b.name);
    });
  };

  const out: FlatTreeRow<T>[] = [];
  const walk = (parent: string | null, depth: number, impliedByAncestor: boolean) => {
    for (const card of order(byParent.get(parent) ?? [])) {
      if (visibleSet && !visibleSet.has(card.id)) continue;
      const selected = selectedIds.has(card.id);
      out.push({ card, depth, selected, implied: impliedByAncestor && !selected });
      walk(card.id, depth + 1, impliedRows && (impliedByAncestor || selected));
    }
  };
  walk(null, 0, false);
  return out;
}

/**
 * How many cards a set of subtree roots actually covers.
 *
 * Only meaningful over a *fully loaded* set — over a partial one it counts the
 * descendants that happen to have arrived, which is a smaller and arbitrary
 * number. Callers must gate on that themselves; a picker that showed this
 * figure off a half-loaded page would be quietly lying about the scope.
 */
export function closureSize<T extends TreeCard>(
  rootIds: Iterable<string>,
  byParent: Map<string | null, T[]>,
): number {
  const seen = new Set<string>();
  const stack = Array.from(rootIds);
  while (stack.length) {
    const id = stack.pop() as string;
    if (seen.has(id)) continue;
    seen.add(id);
    for (const child of byParent.get(id) ?? []) stack.push(child.id);
  }
  return seen.size;
}
