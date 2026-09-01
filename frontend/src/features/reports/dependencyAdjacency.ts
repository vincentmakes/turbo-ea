/**
 * Adjacency for the dependency tree view.
 *
 * The graph endpoint returns one edge per relation *type*: two cards may be
 * connected by several relation types (the metamodel allows any number per
 * ordered card-type pair) and each carries its own verb. The tree renders one
 * child per adjacency entry, so entries are merged per neighbouring card and
 * their verbs joined with " / " — the same convention the Layered Dependency
 * View uses for a merged edge, so the two views read alike.
 */

export interface DependencyEdge {
  source: string;
  target: string;
  type: string;
  label?: string;
  reverse_label?: string;
  description?: string;
}

export interface AdjacencyEntry {
  nodeId: string;
  relType: string;
  relLabel: string;
  relDescription?: string;
}

/** Join a verb onto an existing label, skipping one that is already there. */
export function mergeRelLabel(existing: string, incoming: string): string {
  if (!incoming) return existing;
  if (!existing) return incoming;
  if (existing.split(" / ").includes(incoming)) return existing;
  return `${existing} / ${incoming}`;
}

/**
 * Build `cardId -> neighbours`, one entry per neighbouring CARD.
 *
 * The first relation type seen for a pair supplies `relType` (and its
 * description, unless it has none and a later one does); every further type
 * contributes its verb to `relLabel`.
 */
export function buildAdjacency(edges: DependencyEdge[]): Map<string, AdjacencyEntry[]> {
  const map = new Map<string, AdjacencyEntry[]>();
  const seen = new Map<string, Map<string, number>>();

  const add = (from: string, entry: AdjacencyEntry) => {
    let list = map.get(from);
    let index = seen.get(from);
    if (!list || !index) {
      list = [];
      index = new Map<string, number>();
      map.set(from, list);
      seen.set(from, index);
    }
    const at = index.get(entry.nodeId);
    if (at === undefined) {
      index.set(entry.nodeId, list.length);
      list.push({ ...entry });
      return;
    }
    const existing = list[at];
    existing.relLabel = mergeRelLabel(existing.relLabel, entry.relLabel);
    if (!existing.relDescription && entry.relDescription) {
      existing.relDescription = entry.relDescription;
    }
  };

  for (const e of edges) {
    add(e.source, {
      nodeId: e.target,
      relType: e.type,
      relLabel: e.label || e.type,
      relDescription: e.description,
    });
    add(e.target, {
      nodeId: e.source,
      relType: e.type,
      relLabel: e.reverse_label || e.label || e.type,
      relDescription: e.description,
    });
  }
  return map;
}
