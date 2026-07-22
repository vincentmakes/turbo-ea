/**
 * Strategy-driven scoping for Transition Planning: derive the affected
 * landscape top-down from the business objectives a change supports, instead of
 * hand-picking scope cards. Walks Objective → BusinessCapability → Application
 * via the dependency graph (`GET /reports/dependencies` at depth 2 reaches
 * applications through the capability layer), unions the per-objective
 * subgraphs, and returns a baseline ready to plan against.
 *
 * Reuses the same node/edge shape and client-side union/dedupe the editor's
 * manual "Capture baseline" already uses — this is simply seeded from strategy.
 */
import { api } from "@/api/client";
import type { GEdge, GNode } from "@/features/reports/layeredDependencyLayout";
import type { PlanBaseline } from "@/types";

export interface DerivedScope {
  baseline: PlanBaseline;
  /** Distinct card-type keys present in the derived subgraph, for a summary
   *  chip row ("3 capabilities, 7 applications"). */
  countsByType: Record<string, number>;
}

/**
 * @param objectives selected objective cards ({id, name, type}) — their ids
 *        center the BFS; their nodes are guaranteed present in the result.
 * @param depth dependency hops (2 reaches applications through capabilities).
 */
export async function deriveScopeFromObjectives(
  objectives: { id: string; name: string; type: string }[],
  depth = 2,
): Promise<DerivedScope> {
  const nodeMap = new Map<string, GNode>();
  const edgeKeys = new Set<string>();
  const edges: GEdge[] = [];

  const results = await Promise.all(
    objectives.map((o) =>
      api
        .get<{ nodes: GNode[]; edges: GEdge[] }>(
          `/reports/dependencies?center_id=${o.id}&depth=${depth}`,
        )
        .catch(() => ({ nodes: [] as GNode[], edges: [] as GEdge[] })),
    ),
  );

  for (const r of results) {
    for (const n of r.nodes) if (!nodeMap.has(n.id)) nodeMap.set(n.id, n);
    for (const e of r.edges) {
      const key = `${e.type}|${e.source}|${e.target}`;
      if (!edgeKeys.has(key)) {
        edgeKeys.add(key);
        edges.push(e);
      }
    }
  }
  // Ensure the objective cards themselves are present even if the graph query
  // returned nothing (e.g. an objective with no downstream links yet).
  for (const o of objectives) {
    if (!nodeMap.has(o.id)) nodeMap.set(o.id, { id: o.id, name: o.name, type: o.type });
  }

  const nodes = [...nodeMap.values()];
  const countsByType: Record<string, number> = {};
  for (const n of nodes) countsByType[n.type] = (countsByType[n.type] ?? 0) + 1;

  return { baseline: { nodes, edges }, countsByType };
}
