import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useApiQuery } from "./useApiQuery";
import type { CardListResponse } from "@/types";

/** The only shape scoping needs from a card. */
export interface ScopeNode {
  id: string;
  parent_id?: string | null;
}

/**
 * Expand scope roots to the set of ids they cover — themselves plus every
 * descendant.
 *
 * Overlapping picks need no special handling: if a parent and one of its
 * children are both picked, the child is already inside the parent's subtree,
 * so the closure is the same set either way.
 */
export function expandScopeIds(roots: string[], nodes: ScopeNode[]): Set<string> {
  const byParent = new Map<string, string[]>();
  for (const n of nodes) {
    const parent = n.parent_id ?? null;
    if (!parent) continue;
    const list = byParent.get(parent);
    if (list) list.push(n.id);
    else byParent.set(parent, [n.id]);
  }
  const out = new Set<string>();
  const stack = [...roots];
  while (stack.length > 0) {
    const id = stack.pop()!;
    // Doubles as the cycle guard: an id already in the closure is never
    // walked twice, so a malformed parent chain cannot loop.
    if (out.has(id)) continue;
    out.add(id);
    for (const child of byParent.get(id) ?? []) stack.push(child);
  }
  return out;
}

/**
 * Narrow a list to a scope. A `null` closure means "unscoped" and returns the
 * input untouched, so a caller never needs to branch on whether a scope is set.
 *
 * For a report that renders a hierarchy, filtering the flat items *before* the
 * tree is built is what makes the scoped cards become roots — their parents are
 * simply absent — which is what re-levels the tree from the scope.
 */
export function applyScope<T extends { id: string }>(
  items: T[],
  closure: Set<string> | null,
): T[] {
  if (!closure) return items;
  return items.filter((i) => closure.has(i.id));
}

export interface CardScopeResult {
  /** Subtree roots — the small set that gets persisted in a saved report. */
  scopeIds: string[];
  setScopeIds: (ids: string[]) => void;
  /**
   * `scopeIds` minus anything the hierarchy doesn't know about. This is what
   * the UI should count and label with, so a chip can never claim a scope the
   * map isn't actually applying. Deliberately *not* written back to
   * `scopeIds`: the config keeps the id, so a card restored from the archive
   * brings its scope back with it.
   */
  effectiveScopeIds: string[];
  /** Roots plus every descendant, or null when nothing is scoped. */
  closure: Set<string> | null;
  isActive: boolean;
  /** True while the hierarchy behind an active scope is still being fetched. */
  loading: boolean;
  clear: () => void;
}

/**
 * Scope a report to a set of cards and everything beneath them (#954).
 *
 * The hierarchy can come from two places, and which one applies is a property
 * of the report's endpoint, not a style choice:
 *
 *   - **`hierarchy` supplied** — the report's own payload already contains
 *     every card of the type with its `parent_id`. `/reports/matrix`,
 *     `/reports/bpm/process-map` and `/reports/capability-heatmap` all
 *     guarantee this (the matrix handler says so in its docstring, because
 *     pruning server-side would break the chains the client rebuilds).
 *   - **omitted** — the report's payload is *pruned*, so walking it would be
 *     wrong. `/reports/roadmap` drops cards with no lifecycle dates and
 *     `/reports/cost-treemap` drops zero-cost ones, so a scoped parent with a
 *     dated grandchild would leave a hole in the chain and silently
 *     under-report. The hook then fetches the type itself.
 *
 * The fetch only runs while a scope is actually set, so an unscoped report
 * costs nothing, and `GET /cards` defaults to ACTIVE — the same universe every
 * report draws from.
 */
export function useCardScope({
  typeKey,
  hierarchy,
  enabled = true,
}: {
  /** Card type being scoped. Changing it clears the scope. */
  typeKey: string | null;
  /**
   * Complete `{id, parent_id}` set, when the report already holds one. Pass
   * `null` while it is still loading; **omit the prop entirely** to have the
   * hook fetch the hierarchy itself.
   */
  hierarchy?: ScopeNode[] | null;
  /** Turns scoping off entirely (Cost does this while drilled into a level). */
  enabled?: boolean;
}): CardScopeResult {
  const [scopeIds, setScopeIds] = useState<string[]>([]);

  const active = enabled && scopeIds.length > 0 && !!typeKey;
  /**
   * `undefined` means the caller has no hierarchy and wants one fetched;
   * `null` means it has one but is still loading it. The distinction matters:
   * every report's payload is null on first render, and treating that as
   * "no hierarchy" would fire a redundant `/cards` request on mount for
   * exactly the reports that never need it.
   */
  const needsFetch = active && hierarchy === undefined;

  const { data: fetched, loading: fetching } = useApiQuery<CardListResponse, ScopeNode[]>(
    needsFetch ? `/cards?type=${encodeURIComponent(typeKey!)}&page_size=10000` : null,
    {
      select: (raw) =>
        (raw.items ?? []).map((c) => ({ id: c.id, parent_id: c.parent_id ?? null })),
    },
  );

  const nodes = hierarchy ?? fetched ?? null;

  /**
   * Ids the hierarchy doesn't know about are dropped — a saved report naming a
   * capability that has since been deleted degrades to the wider view instead
   * of rendering an empty one with no way to tell why.
   *
   * Before the hierarchy resolves there is nothing to check against, so the
   * ids pass through unjudged rather than being reported as invalid.
   */
  const effectiveScopeIds = useMemo(() => {
    if (!active) return [];
    if (!nodes) return scopeIds;
    const known = new Set(nodes.map((n) => n.id));
    return scopeIds.filter((id) => known.has(id));
  }, [active, nodes, scopeIds]);

  const closure = useMemo(() => {
    if (!active || !nodes || effectiveScopeIds.length === 0) return null;
    return expandScopeIds(effectiveScopeIds, nodes);
  }, [active, nodes, effectiveScopeIds]);

  /**
   * Scope ids belong to one card type, so a type change makes them
   * meaningless. Skipped on the first run: a saved report restores its type
   * and its scope in the same pass, and wiping it here would undo the restore.
   * Same shape as the `loadedAxes` guard in `MatrixReport`.
   */
  const lastType = useRef<string | null>(null);
  useEffect(() => {
    if (lastType.current !== null && lastType.current !== typeKey) setScopeIds([]);
    lastType.current = typeKey;
  }, [typeKey]);

  const clear = useCallback(() => setScopeIds([]), []);

  return {
    scopeIds,
    setScopeIds,
    effectiveScopeIds,
    closure,
    isActive: active,
    loading: needsFetch && (fetching || nodes === null),
    clear,
  };
}
