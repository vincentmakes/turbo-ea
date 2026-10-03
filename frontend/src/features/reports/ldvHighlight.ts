import type { Edge, Node } from "@xyflow/react";
import type { LdvClusterData, LdvEdgeData } from "./layeredDependencyLayout";
import { STATUS_COLORS, TIMELINE_COLORS } from "@/theme/tokens";

/**
 * Hover highlighting and the transition-mark spotlight of the Layered
 * Dependency View, as pure functions.
 *
 * Both effects are expressed as CSS keyed on node id rather than as flags on
 * the node objects: recreating node objects to carry a transient flag makes
 * React Flow flicker, and the spotlight has to layer over whatever border or
 * badge the card already has rather than replace it.
 */

/** Cluster id → the cards inside it, for highlighting a whole box. */
export function clusterMembersOf(nodes: Node[]): Map<string, string[]> {
  const m = new Map<string, string[]>();
  for (const n of nodes) {
    if (n.type === "ldvCluster") m.set(n.id, (n.data as LdvClusterData).memberIds ?? []);
  }
  return m;
}

/**
 * The set of nodes connected to the hovered node (everything else dims).
 *
 * Read off each line's `members` — the card-level relations behind it — not
 * off its endpoints: an aggregate connector's endpoints are boxes, so hovering
 * one card inside a box would otherwise light up every card in the box at the
 * other end rather than the ones it is actually related to.
 *
 * `null` when nothing is hovered.
 */
export function hoveredNeighborsOf(
  hoveredNode: string | null,
  edges: Edge[],
  clusterMembers: Map<string, string[]>,
  memberOf: Map<string, string> | undefined,
): Set<string> | null {
  if (!hoveredNode) return null;
  const s = new Set<string>([hoveredNode]);
  const ownMembers = clusterMembers.get(hoveredNode);
  if (ownMembers) for (const id of ownMembers) s.add(id);

  for (const e of edges) {
    const d = e.data as LdvEdgeData | undefined;
    const pairs = d?.members ?? [{ source: e.source, target: e.target }];
    // The box itself is hovered: everything it connects to lights up.
    if (e.source === hoveredNode || e.target === hoveredNode) {
      s.add(e.source === hoveredNode ? e.target : e.source);
      for (const p of pairs) {
        s.add(p.source);
        s.add(p.target);
      }
      continue;
    }
    for (const p of pairs) {
      if (p.source === hoveredNode) s.add(p.target);
      if (p.target === hoveredNode) s.add(p.source);
    }
  }

  // Keep a lit card's box lit, or the box would dim out from under it.
  if (memberOf) {
    for (const id of [...s]) {
      const box = memberOf.get(id);
      if (box) s.add(box);
    }
  }
  return s;
}

/**
 * CSS that dims every card and box except the hovered node's neighbours.
 * Empty when nothing is hovered.
 *
 * `CSS.escape`: a cluster id carries colons (`cluster:type:Application`),
 * which are selector syntax. Card ids are UUIDs and never needed it.
 */
export function hoverDimStyle(neighbors: Set<string> | null): string {
  if (!neighbors) return "";
  const keep = [...neighbors]
    .map((id) => `.react-flow__node[data-id="${CSS.escape(id)}"]`)
    .join(",");
  return [
    `.ldv-hover-active .react-flow__node-ldvNode, .ldv-hover-active .react-flow__node-ldvCluster { opacity: 0.35; transition: opacity 0.15s; }`,
    `${keep} { opacity: 1 !important; }`,
  ].join("\n");
}

/**
 * CSS spotlighting the cards a clicked transition mark changed: everything
 * fades so the changed cards read instantly even on a dense canvas, and each
 * one pulses in the colour of its change. Empty when there is nothing to pulse.
 */
export function pulseSpotlightStyle(pulseCards: Record<string, "live" | "retire"> | undefined): string {
  const entries = Object.entries(pulseCards ?? {});
  if (!entries.length) return "";
  const rules = [
    `.ldv-pulse-active .react-flow__node-ldvNode { opacity: 0.3; transition: opacity 0.2s; }`,
    `@keyframes ldv-pulse-live { 0%,100% { box-shadow: 0 0 0 0 ${TIMELINE_COLORS.goLive}00 } 50% { box-shadow: 0 0 0 8px ${TIMELINE_COLORS.goLive}66 } }`,
    `@keyframes ldv-pulse-retire { 0%,100% { box-shadow: 0 0 0 0 ${STATUS_COLORS.error}00 } 50% { box-shadow: 0 0 0 8px ${STATUS_COLORS.error}66 } }`,
  ];
  for (const [id, kind] of entries) {
    const sel = `.react-flow__node[data-id="${CSS.escape(id)}"]`;
    rules.push(
      `${sel} { opacity: 1 !important; z-index: 10 !important; }`,
      `${sel} > * { animation: ldv-pulse-${kind === "live" ? "live" : "retire"} 0.65s ease-in-out 2; border-radius: 8px; }`,
    );
  }
  return rules.join("\n");
}
