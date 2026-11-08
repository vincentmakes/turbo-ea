/**
 * Generic client-side row grouping for AG Grid Community (discussion #933).
 *
 * Community has no native row grouping, so a grouped grid is fed a flat row
 * list with synthetic full-width "group header" rows injected between groups.
 * This module owns everything about that shape that does not need React or a
 * grid instance: building the grouped row list and re-gluing headers above
 * their members after AG Grid sorts. The stateful half (collapse, selection,
 * representatives under column filters) lives in `useRowGrouping.tsx`.
 *
 * A header row is a CLONE OF ONE REAL MEMBER carrying the `__group` marker —
 * not a bare synthetic object. AG Grid's filters (column and quick filter
 * alike) run over every row with no way to exempt one; a bare object would
 * fail every active filter and all headers would vanish. A member clone
 * passes exactly when the group has at least one visible member, so an
 * orphan header (or a headerless group) is impossible by construction.
 *
 * The optional parent/child TREE layer ("Parent" in the Group by menu)
 * lives here too: `buildTreeLayout` orders one group's members depth-first
 * and describes each row's depth / ancestor crumb in a side map, and
 * `forestOrder` re-applies that order after AG Grid sorts. Leaf rows are
 * never cloned to carry tree info — a Name edit mutates the row object in
 * place without a reload, so a clone rebuilt from stale data would revert it.
 */

import { categoricalColor } from "@/lib/color";

/** Group key for rows that have no value on the grouping axis. Always the
 * first group — it is the triage bucket the feature exists for. */
export const NOT_SET_KEY = "__not_set__";

export interface GroupVocabEntry {
  key: string;
  label: string;
  /** Option/state color (hex) — the header renders the label as a colored
   * pill. Omit for a value with no color of its own (subtypes, owners, …):
   * `buildGroupedRows` then assigns one from the shared categorical palette by
   * position, so every real group reads as a pill on every axis. */
  color?: string;
}

/**
 * Pill color of one vocabulary entry: its own color when the metamodel gives
 * it one, else a positional categorical color so uncolored axes are still
 * recognisable at a glance — in the header row and, more importantly, in the
 * sticky bar that names the group you are scrolled into.
 *
 * By position rather than by hashing the key, because group headers are read
 * as a vertical column: what matters is that neighbours look different.
 */
export function resolveVocabColor(entry: GroupVocabEntry, vocabIndex: number): string {
  return entry.color ?? categoricalColor(vocabIndex);
}

/** One way a grid can be grouped: a stable axis id (persisted / in URLs), a
 * picker label, the key extractor, and the ordered known-group vocabulary. */
export interface GroupAxis<T> {
  key: string;
  label: string;
  /** Group key of a row; empty / null / undefined land in the Not set group. */
  groupKeyOf: (row: T) => string | null | undefined;
  vocab: GroupVocabEntry[];
}

export interface GroupInfo {
  /** The axis id — namespaces the header row id so switching axes can never
   * reuse a stale grid row. */
  axis: string;
  key: string;
  label: string;
  /** Pill color: the vocabulary entry's own color, or the positional
   * categorical fallback. Undefined only for the Not set bucket and for stray
   * keys — neither is a value the metamodel still knows about, and colouring
   * them would make a data-quality problem look intentional. */
  color?: string;
  /** Members before grid-level filters (column/quick filters may hide some —
   * the header renderer shows the displayed count when they do). */
  count: number;
  memberIds: string[];
  collapsed: boolean;
  /** Position in the fixed group order — postSortRows sorts groups by this. */
  index: number;
  /** Members hidden under a collapsed tree parent (only those passing the grid
   * filters). They are not grid rows, so the header adds them back to keep its
   * count truthful. Absent when the tree layer is off. */
  treeHidden?: number;
}

/** A grid row: either a real row or a member clone marked as group header. */
export type GroupedRow<T> = T & { __group?: GroupInfo };

/** Normalised group key of a row on an axis. */
export function groupKeyOn<T>(row: T, axis: GroupAxis<T>): string {
  return axis.groupKeyOf(row) || NOT_SET_KEY;
}

/**
 * Build the grouped row list: for each non-empty group, one header row (a
 * clone of `representatives.get(key)` — a member known to pass the active
 * grid filters — falling back to the first member) followed by its members,
 * unless the group is collapsed. Group order: Not set first, then the axis
 * vocabulary, then any stray keys (values whose option was deleted) in
 * first-seen order. Groups with no members are skipped entirely.
 */
export function buildGroupedRows<T extends { id: string }>(
  rows: T[],
  axis: GroupAxis<T>,
  collapsed: ReadonlySet<string>,
  representatives: ReadonlyMap<string, T> | null,
  notSetLabel: string,
  /** Tree layer: orders one expanded group's members and reports how many it
   * hid under collapsed parents. Never called for a collapsed group. */
  layout?: (members: T[]) => { emitted: T[]; hidden: number },
): GroupedRow<T>[] {
  const buckets = new Map<string, T[]>();
  for (const row of rows) {
    const key = groupKeyOn(row, axis);
    const bucket = buckets.get(key);
    if (bucket) bucket.push(row);
    else buckets.set(key, [row]);
  }

  // Not set and stray keys stay uncolored; every real vocabulary entry gets a
  // pill color, its own or the positional fallback.
  const order: GroupVocabEntry[] = [
    { key: NOT_SET_KEY, label: notSetLabel },
    ...axis.vocab.map((entry, i) => ({ ...entry, color: resolveVocabColor(entry, i) })),
  ];
  const known = new Set(order.map((e) => e.key));
  for (const key of buckets.keys()) {
    if (!known.has(key)) order.push({ key, label: key });
  }

  const out: GroupedRow<T>[] = [];
  let index = 0;
  for (const entry of order) {
    const members = buckets.get(entry.key);
    if (!members || members.length === 0) continue;
    const isCollapsed = collapsed.has(entry.key);
    const representative = representatives?.get(entry.key) ?? members[0];
    const laid = layout && !isCollapsed ? layout(members) : null;
    const header: GroupedRow<T> = {
      ...representative,
      __group: {
        axis: axis.key,
        key: entry.key,
        label: entry.label,
        color: entry.color,
        count: members.length,
        memberIds: members.map((m) => m.id),
        collapsed: isCollapsed,
        index: index++,
        ...(layout ? { treeHidden: laid ? laid.hidden : 0 } : {}),
      },
    };
    out.push(header);
    if (!isCollapsed) out.push(...(laid ? laid.emitted : members));
  }
  return out;
}

/**
 * The collapse set that focuses one group: every group key present in the
 * rows (Not set and stray keys included) except `focusKey`. Used by deep
 * links (`?group_by=…&expand_group=…`) to land with the clicked group open
 * and every other group as a collapsed header with its count.
 */
export function collapsedSetForFocus<T>(
  rows: T[],
  axis: GroupAxis<T>,
  focusKey: string,
): Set<string> {
  const keys = new Set<string>();
  for (const row of rows) keys.add(groupKeyOn(row, axis));
  keys.delete(focusKey);
  return keys;
}

/** Where one group header row sits inside the grid body: its pixel offset, its
 * height, and its displayed row index (the handle `ensureIndexVisible` needs). */
export interface GroupHeaderAnchor {
  top: number;
  height: number;
  rowIndex: number;
  group: GroupInfo;
}

/**
 * Depth-first forest order of already-sorted leaves: every root (a leaf whose
 * parent is not among `leaves`) in arrival order, each followed by its
 * subtree, children in arrival order. Arrival order is AG Grid's sort, so the
 * sort applies among siblings while a child always follows its parent. Leaves
 * left unvisited (a parent cycle) are appended. Always a permutation.
 */
export function forestOrder<L>(
  leaves: readonly L[],
  idOf: (leaf: L) => string,
  parentIdOf: (leaf: L) => string | null | undefined,
): L[] {
  const present = new Set(leaves.map(idOf));
  const children = new Map<string, L[]>();
  const roots: L[] = [];
  for (const leaf of leaves) {
    const parent = parentIdOf(leaf);
    if (parent && parent !== idOf(leaf) && present.has(parent)) {
      const kids = children.get(parent);
      if (kids) kids.push(leaf);
      else children.set(parent, [leaf]);
    } else {
      roots.push(leaf);
    }
  }
  const out: L[] = [];
  const visited = new Set<string>();
  const walk = (start: L) => {
    // Explicit stack: a deep hierarchy must not exhaust the call stack.
    const stack: L[] = [start];
    while (stack.length > 0) {
      const leaf = stack.pop() as L;
      const id = idOf(leaf);
      if (visited.has(id)) continue;
      visited.add(id);
      out.push(leaf);
      const kids = children.get(id);
      if (kids) for (let k = kids.length - 1; k >= 0; k--) stack.push(kids[k]);
    }
  };
  for (const root of roots) walk(root);
  for (const leaf of leaves) if (!visited.has(idOf(leaf))) walk(leaf);
  return out;
}

/**
 * `postSortRows` glue: AG Grid sorts headers among the leaves (a header is a
 * member clone, so it sorts wherever that member would). Reorder in place so
 * each group's header sits directly above its members, members keep the order
 * the sort just gave them, and groups follow their fixed `GroupInfo.index`
 * order regardless of sort direction.
 *
 * `axis === null` (tree without an attribute grouping) treats every leaf as
 * one bucket with no header. With `parentIdOf`, each bucket's leaves are
 * re-ordered through `forestOrder` so children stay under their parent.
 */
export function glueGroups<T extends { id: string }, N extends { data?: GroupedRow<T> }>(
  nodes: N[],
  axis: GroupAxis<T> | null,
  parentIdOf?: (row: T) => string | null | undefined,
): void {
  if (nodes.length === 0) return;
  const headers = new Map<string, N>();
  const leaves = new Map<string, N[]>();
  const others: N[] = [];
  for (const node of nodes) {
    const row = node.data;
    if (!row) {
      others.push(node);
      continue;
    }
    if (row.__group) {
      headers.set(row.__group.key, node);
    } else {
      const key = axis ? groupKeyOn(row, axis) : NOT_SET_KEY;
      const bucket = leaves.get(key);
      if (bucket) bucket.push(node);
      else leaves.set(key, [node]);
    }
  }

  const keys = new Set<string>([...headers.keys(), ...leaves.keys()]);
  const ordered = [...keys].sort((a, b) => {
    const ia = headers.get(a)?.data?.__group?.index ?? Number.MAX_SAFE_INTEGER;
    const ib = headers.get(b)?.data?.__group?.index ?? Number.MAX_SAFE_INTEGER;
    return ia - ib;
  });

  let i = 0;
  for (const node of others) nodes[i++] = node;
  for (const key of ordered) {
    const header = headers.get(key);
    if (header) nodes[i++] = header;
    const bucket = leaves.get(key) ?? [];
    const inOrder = parentIdOf
      ? forestOrder(
          bucket,
          (n) => (n.data as T).id,
          (n) => parentIdOf(n.data as T),
        )
      : bucket;
    for (const leaf of inOrder) nodes[i++] = leaf;
  }
}

/** What the tree layer needs to know about rows it did not get handed. */
export interface TreeLookup {
  name: string;
  parentId?: string | null;
}

/** How the tree layer reads the hierarchy: a row's parent id, and any loaded
 * card by id — also cards outside the group or hidden by a filter, which is
 * what lets a re-rooted child name its missing ancestors. */
export interface TreeAccess<T> {
  parentIdOf: (row: T) => string | null | undefined;
  lookup: (id: string) => TreeLookup | undefined;
}

/** One row's place in the tree, kept in a side map keyed by row id. */
export interface TreeInfo {
  /** 0 for roots. */
  depth: number;
  /** Roots only: ids of the ancestors that are not shown above this row,
   * root-most first. Names are resolved at render time (a rename does not
   * reload, so a stored name would go stale). */
  crumbIds: string[];
  /** The ancestor walk hit an id that is not loaded — render a leading "…". */
  crumbTruncated: boolean;
  /** Has at least one child in the set (passing the grid filters). */
  hasChildren: boolean;
  collapsed: boolean;
  /** Descendants hidden by this collapsed parent; 0 unless `collapsed`. */
  hiddenDescendants: number;
}

export interface TreeLayout<T> {
  info: Map<string, TreeInfo>;
  /** Members in depth-first order, minus those hidden under collapsed parents. */
  emitted: T[];
  /** How many members (passing `visibleIds`) were hidden by collapse. */
  hidden: number;
}

/**
 * Lay one group's members out as a forest. A parent link counts only when
 * the parent is itself a member, passes the grid filters (`visibleIds`, null
 * when no filter is active) and is not the row itself; otherwise the row is a
 * root and records its ancestor chain as `crumbIds`. A card therefore never
 * leaves its own group. Siblings keep their input order; members caught in a
 * parent cycle are appended as roots, each exactly once.
 */
export function buildTreeLayout<T extends { id: string }>(
  members: readonly T[],
  access: TreeAccess<T>,
  visibleIds: ReadonlySet<string> | null,
  collapsedParents: ReadonlySet<string>,
): TreeLayout<T> {
  const memberIds = new Set(members.map((m) => m.id));
  const isVisible = (id: string) => visibleIds === null || visibleIds.has(id);
  const children = new Map<string, T[]>();
  const roots: T[] = [];
  for (const m of members) {
    const parent = access.parentIdOf(m);
    if (parent && parent !== m.id && memberIds.has(parent) && isVisible(parent)) {
      const kids = children.get(parent);
      if (kids) kids.push(m);
      else children.set(parent, [m]);
    } else {
      roots.push(m);
    }
  }

  const info = new Map<string, TreeInfo>();
  const emitted: T[] = [];
  const visited = new Set<string>();
  let hidden = 0;

  const crumbOf = (row: T): { ids: string[]; truncated: boolean } => {
    const ids: string[] = [];
    const seen = new Set<string>([row.id]);
    let truncated = false;
    let cur = access.parentIdOf(row);
    while (cur && !seen.has(cur)) {
      seen.add(cur);
      const found = access.lookup(cur);
      if (!found) {
        truncated = true;
        break;
      }
      ids.push(cur);
      cur = found.parentId;
    }
    ids.reverse();
    return { ids, truncated };
  };

  // Returns the number of visible descendants under `row`.
  const visit = (row: T, depth: number, underCollapsed: boolean): number => {
    visited.add(row.id);
    const kids = children.get(row.id) ?? [];
    const hasChildren = kids.some((k) => isVisible(k.id));
    const isCollapsed = !underCollapsed && hasChildren && collapsedParents.has(row.id);
    if (!underCollapsed) emitted.push(row);
    let descendants = 0;
    for (const kid of kids) {
      if (visited.has(kid.id)) continue;
      descendants +=
        (isVisible(kid.id) ? 1 : 0) + visit(kid, depth + 1, underCollapsed || isCollapsed);
    }
    const crumb = depth === 0 ? crumbOf(row) : { ids: [], truncated: false };
    info.set(row.id, {
      depth,
      crumbIds: crumb.ids,
      crumbTruncated: crumb.truncated,
      hasChildren,
      collapsed: isCollapsed,
      hiddenDescendants: isCollapsed ? descendants : 0,
    });
    if (isCollapsed) hidden += descendants;
    return descendants;
  };

  for (const root of roots) visit(root, 0, false);
  for (const m of members) if (!visited.has(m.id)) visit(m, 0, false);
  return { info, emitted, hidden };
}

/** Where the tree stands, level-wise: `max` is how many levels the tree has
 * when fully open (deepest depth + 1; 1 with no rows), `current` how many of
 * them are open — 1 + the run of depths 0, 1, … at which every parent is
 * expanded. A depth with no parents counts as open. "Everything collapsed"
 * is level 1 and "everything open" is level `max`. */
export function treeLevelOf(info: ReadonlyMap<string, TreeInfo>): {
  current: number;
  max: number;
} {
  let deepest = 0;
  const collapsedAt = new Set<number>();
  for (const v of info.values()) {
    if (v.depth > deepest) deepest = v.depth;
    if (v.hasChildren && v.collapsed) collapsedAt.add(v.depth);
  }
  const max = deepest + 1;
  let current = 1;
  while (current < max && !collapsedAt.has(current - 1)) current++;
  return { current, max };
}

/** The collapsed-parent set that shows exactly `level` levels: every parent
 * at depth >= level - 1. `level` is clamped to [1, max], so level `max` (or
 * deeper) collapses nothing. */
export function collapsedParentsForLevel(
  info: ReadonlyMap<string, TreeInfo>,
  level: number,
): Set<string> {
  const { max } = treeLevelOf(info);
  const clamped = Math.min(Math.max(Math.floor(level), 1), max);
  const out = new Set<string>();
  for (const [id, v] of info) if (v.hasChildren && v.depth >= clamped - 1) out.add(id);
  return out;
}

/** A persisted / URL tree level, validated: a positive integer, else null
 * (fully open). Accepts the raw URL string as well as a stored number. */
export function normalizeTreeLevel(value: unknown): number | null {
  const n =
    typeof value === "number"
      ? value
      : typeof value === "string" && /^\d+$/.test(value.trim())
        ? Number(value.trim())
        : NaN;
  return Number.isInteger(n) && n >= 1 ? n : null;
}

/** Same members, regardless of order; two nulls are the same, a null and a
 * set are not. Used to skip a layout rebuild when a recomputed id set (the
 * rows passing the grid filters, the parents a level collapses) did not
 * actually change. */
export function sameIdSet(a: ReadonlySet<string> | null, b: ReadonlySet<string> | null): boolean {
  if (a === b) return true;
  if (!a || !b || a.size !== b.size) return false;
  for (const id of a) if (!b.has(id)) return false;
  return true;
}
