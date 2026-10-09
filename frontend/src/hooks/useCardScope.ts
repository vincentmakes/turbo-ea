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

/** One empty array, so an unscoped render keeps a stable identity. */
const NO_SCOPE: string[] = [];

export interface CardScopeResult {
  /** Subtree roots — the small set that gets persisted in a saved report. */
  scopeIds: string[];
  /**
   * Set the scope, together with the card type it belongs to. `forType`
   * defaults to the hook's current `typeKey`; a caller that changes the type
   * and the scope in one pass (a restored report, a transpose) names the type
   * it is about to set, so the scope is read as that type's from the render
   * the type lands on, whatever order the two state updates run in.
   */
  setScopeIds: (ids: string[], forType?: string | null) => void;
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
  /**
   * Card type being scoped. A scope belongs to the type it was set for
   * (`setScopeIds`'s `forType`), so a scope set for another type reads as
   * empty and is dropped.
   */
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
  /**
   * The scope and the type it was set for, as one value: scope ids belong to
   * one card type, so what the hook answers for `typeKey` is this scope only
   * while the two types agree. Keeping the pair — rather than clearing the
   * ids in an effect when `typeKey` changes — is what lets a caller set the
   * type and the scope in the same pass in either order (#1203).
   */
  const [scope, setScope] = useState<{ ids: string[]; typeKey: string | null }>({
    ids: [],
    typeKey: null,
  });
  const scopeIds = scope.typeKey === typeKey ? scope.ids : NO_SCOPE;

  // `setScopeIds` stays identity-stable (callers list it in dependency
  // arrays), so the default `forType` is read through a ref.
  const typeKeyRef = useRef(typeKey);
  typeKeyRef.current = typeKey;
  const setScopeIds = useCallback((ids: string[], forType?: string | null) => {
    setScope({ ids, typeKey: forType === undefined ? typeKeyRef.current : forType });
  }, []);

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
   * A scope set for another type already reads as empty (above). When the
   * type moves away from the scope's, the scope is also dropped, so that
   * switching back does not bring it back. Keyed on the type alone, and read
   * from this render's values: a scope set ahead of its type (a restore whose
   * type state lands a render later) must survive until that type arrives,
   * and a scope queued in the same pass as the type must not be judged
   * against the type of the render before it.
   */
  useEffect(() => {
    if (scope.typeKey !== typeKey && scope.ids.length > 0) setScope({ ids: [], typeKey });
  }, [typeKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const clear = useCallback(() => setScope({ ids: [], typeKey: typeKeyRef.current }), []);

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
