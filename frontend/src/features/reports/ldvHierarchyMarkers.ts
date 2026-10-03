import type { GNode } from "./layeredDependencyLayout";

/**
 * Minimalistic hierarchy markers: per card, whether it has a parent / children
 * that are NOT currently on the diagram — so the marker points to something the
 * Reveal tools can surface, and disappears once revealed.
 */
export interface HierarchyMarker {
  hiddenParent: boolean;
  hiddenChildren: boolean;
}

/**
 * Empty when `enabled` is false: the markers are affordances for the Reveal
 * tools, so the view only surfaces them where the consumer wires those tools up
 * and the display toggle is on.
 */
export function computeHierarchyMarkers(
  nodes: GNode[],
  enabled: boolean,
): Map<string, HierarchyMarker> {
  const m = new Map<string, HierarchyMarker>();
  if (!enabled) return m;
  const visibleIds = new Set(nodes.map((n) => n.id));
  const parentsWithVisibleChild = new Set<string>();
  for (const n of nodes) if (n.parent_id) parentsWithVisibleChild.add(n.parent_id);
  for (const n of nodes) {
    const hiddenParent = !!n.parent_id && !visibleIds.has(n.parent_id);
    const hiddenChildren = !!n.hasChildren && !parentsWithVisibleChild.has(n.id);
    if (hiddenParent || hiddenChildren) m.set(n.id, { hiddenParent, hiddenChildren });
  }
  return m;
}
