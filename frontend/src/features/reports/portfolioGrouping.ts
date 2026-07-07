/**
 * Hierarchical (nested) grouping for the portfolio reports.
 *
 * When the Group By target is a related card type with `has_hierarchy`, the
 * "Nested groups" toggle renders groups as boxes-within-boxes following the
 * related type's parent/child hierarchy, mirroring the Capability Map's
 * tree-building and depth-limiting behaviour (`CapabilityMapReport.tsx`).
 *
 * Pure functions only — unit-tested without a DOM.
 */
import { appColorBucket } from "./portfolioHelpers";
import type { AppData, ColorLabels, ColorResolution } from "./portfolioHelpers";

/** A `groupable_types` member as returned by GET /reports/app-portfolio.
 * `ancestor_only` marks cards added by the backend's ancestor closure — they
 * have no direct relation to any portfolio card and exist purely so the
 * hierarchy chain is complete. */
export interface GroupMember {
  id: string;
  name: string;
  type: string;
  parent_id?: string | null;
  ancestor_only?: boolean;
}

/** A card placed in the tree, remembering which member it is DIRECTLY related
 * to. After roll-up (depth cut) the card may be displayed under an ancestor,
 * but per-member relation-subtype colouring must still use its own member. */
export interface GroupEntry {
  app: AppData;
  memberId: string;
}

export interface GroupNode {
  /** Member card id. */
  key: string;
  label: string;
  /** 1-based depth (roots are level 1). */
  level: number;
  children: GroupNode[];
  /** Cards with a direct (memberMatch-passing) relation to this member. */
  directApps: AppData[];
  /** Deduplicated cards of this node + all descendants, keyed by card id. */
  deepApps: Map<string, GroupEntry>;
  deepCount: number;
}

/** Sentinel depth meaning "show every level" (matches the Capability Map). */
export const ALL_LEVELS = 99;

/** Build the nested group tree for one related card type.
 *
 * - Direct membership uses the same rules as flat grouping: one bucket entry
 *   per matching relation, deduped per card, honouring `memberMatch`
 *   (relation-subtype filters).
 * - Nodes whose parent is absent from the member list become roots (e.g. the
 *   parent is archived), so the chain degrades gracefully.
 * - `deepApps` merges children bottom-up; a card directly related to the node
 *   itself wins over a descendant entry, so the visible leaf's own relation
 *   drives its colouring.
 * - Subtrees containing no cards at all are pruned (the portfolio drops empty
 *   groups, unlike the Capability Map which shows every capability).
 * - Siblings sort by deep count desc, then name asc.
 */
export function buildGroupTree(
  apps: AppData[],
  typeKey: string,
  members: GroupMember[],
  memberMatch?: (app: AppData, memberId: string) => boolean,
): GroupNode[] {
  const direct = new Map<string, AppData[]>();
  for (const m of members) direct.set(m.id, []);
  for (const app of apps) {
    const seen = new Set<string>();
    for (const rel of app.relations) {
      if (rel.related_type !== typeKey) continue;
      if (!direct.has(rel.related_id) || seen.has(rel.related_id)) continue;
      if (memberMatch && !memberMatch(app, rel.related_id)) continue;
      seen.add(rel.related_id);
      direct.get(rel.related_id)!.push(app);
    }
  }

  const nodeMap = new Map<string, GroupNode>();
  for (const m of members) {
    nodeMap.set(m.id, {
      key: m.id,
      label: m.name,
      level: 1,
      children: [],
      directApps: direct.get(m.id) || [],
      deepApps: new Map(),
      deepCount: 0,
    });
  }

  const roots: GroupNode[] = [];
  for (const m of members) {
    const node = nodeMap.get(m.id)!;
    const parent = m.parent_id ? nodeMap.get(m.parent_id) : undefined;
    if (parent) parent.children.push(node);
    else roots.push(node);
  }

  const setLevel = (node: GroupNode, level: number) => {
    node.level = level;
    for (const c of node.children) setLevel(c, level + 1);
  };
  for (const r of roots) setLevel(r, 1);

  const propagate = (node: GroupNode) => {
    for (const c of node.children) {
      propagate(c);
      for (const [id, entry] of c.deepApps) {
        if (!node.deepApps.has(id)) node.deepApps.set(id, entry);
      }
    }
    // Own direct relations overwrite descendant entries — see docstring.
    for (const app of node.directApps) {
      node.deepApps.set(app.id, { app, memberId: node.key });
    }
    node.deepCount = node.deepApps.size;
  };
  for (const r of roots) propagate(r);

  const prune = (nodes: GroupNode[]): GroupNode[] => {
    const kept = nodes.filter((n) => n.deepCount > 0);
    for (const n of kept) n.children = prune(n.children);
    kept.sort((a, b) => b.deepCount - a.deepCount || a.label.localeCompare(b.label));
    return kept;
  };
  return prune(roots);
}

/** A node renders as a leaf once its level reaches the display depth, or when
 * it simply has no children (same rule as the Capability Map). */
export function isLeafAtDepth(node: GroupNode, displayLevel: number): boolean {
  return node.level >= displayLevel || node.children.length === 0;
}

/** Cards to render inside a node at the given depth. Leaves show their whole
 * rolled-up subtree; non-leaves show only their own direct cards that don't
 * appear in any child subtree — so each card appears at exactly one visible
 * node (its deepest). */
export function getVisibleGroupApps(node: GroupNode, displayLevel: number): GroupEntry[] {
  if (isLeafAtDepth(node, displayLevel)) {
    return Array.from(node.deepApps.values());
  }
  return node.directApps
    .filter((app) => !node.children.some((c) => c.deepApps.has(app.id)))
    .map((app) => ({ app, memberId: node.key }));
}

export function getMaxGroupLevel(roots: GroupNode[]): number {
  let max = 0;
  const walk = (n: GroupNode) => {
    if (n.level > max) max = n.level;
    n.children.forEach(walk);
  };
  roots.forEach(walk);
  return max;
}

/** Stacked-bar colour segments for a set of group entries. Unlike the flat
 * `buildColorSegments`, each entry carries its own member id so per-member
 * relation-subtype colouring stays correct for rolled-up cards. */
export function buildColorSegmentsFor(
  entries: GroupEntry[],
  res: ColorResolution,
  labels: ColorLabels,
  perMember: boolean,
): { color: string; label: string; n: number }[] {
  if (res.kind === "none" || entries.length === 0) return [];
  const counts = new Map<string, { color: string; label: string; n: number }>();
  for (const e of entries) {
    const b = appColorBucket(e.app, res, labels, perMember ? e.memberId : undefined);
    if (!counts.has(b.key)) counts.set(b.key, { color: b.color, label: b.label, n: 0 });
    counts.get(b.key)!.n += 1;
  }
  return Array.from(counts.values()).filter((s) => s.n > 0);
}
