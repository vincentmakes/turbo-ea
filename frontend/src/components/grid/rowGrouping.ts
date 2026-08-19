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
      },
    };
    out.push(header);
    if (!isCollapsed) out.push(...members);
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
 * `postSortRows` glue: AG Grid sorts headers among the leaves (a header is a
 * member clone, so it sorts wherever that member would). Reorder in place so
 * each group's header sits directly above its members, members keep the order
 * the sort just gave them, and groups follow their fixed `GroupInfo.index`
 * order regardless of sort direction.
 */
export function glueGroups<T, N extends { data?: GroupedRow<T> }>(
  nodes: N[],
  axis: GroupAxis<T>,
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
      const key = groupKeyOn(row, axis);
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
    for (const leaf of leaves.get(key) ?? []) nodes[i++] = leaf;
  }
}
