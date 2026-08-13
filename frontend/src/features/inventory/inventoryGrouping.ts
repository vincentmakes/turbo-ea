import { getCurrentPhase } from "@/components/LifecycleBadge";
import { valueIsEmpty } from "./InventoryFilterSidebar";
import type { Card } from "@/types";

/**
 * Client-side grouping for the inventory grid (discussion #933).
 *
 * AG Grid Community has no row grouping, so the grid is fed a flat row list
 * with synthetic full-width "group header" rows injected between groups. This
 * module owns everything about that shape that does not need the grid: the
 * group-by vocabulary, key extraction per card, building the grouped row list,
 * and re-gluing headers above their members after AG Grid sorts.
 *
 * A header row is a CLONE OF ONE REAL MEMBER carrying the `__group` marker —
 * not a bare synthetic object. AG Grid's column filters run over every row
 * with no way to exempt one; a bare object would fail every active filter and
 * all headers would vanish. A member clone passes exactly when the group has
 * at least one visible member, so an orphan header (or a headerless group) is
 * impossible by construction.
 */

export type GroupBySpec =
  | { kind: "subtype" }
  | { kind: "lifecycle" }
  | { kind: "approval" }
  | { kind: "attribute"; fieldKey: string };

/** Group key for cards that have no value on the grouping axis. Always the
 * first group — it is the triage bucket the feature exists for. */
export const NOT_SET_KEY = "__not_set__";

export interface GroupVocabEntry {
  key: string;
  label: string;
}

export interface GroupInfo {
  /** Wire-format axis ("subtype", "attr_x", …) — namespaces the row id so
   * switching axes can never reuse a stale grid row. */
  axis: string;
  key: string;
  label: string;
  /** Members after the sidebar filters (column filters may hide some more —
   * the header renderer shows the displayed count when they do). */
  count: number;
  memberIds: string[];
  collapsed: boolean;
  /** Position in the fixed group order — postSortRows sorts groups by this. */
  index: number;
}

/** A grid row: either a real card or a member clone marked as group header. */
export type InventoryRow = Card & { __group?: GroupInfo };

/* ---- wire format ("subtype" | "lifecycle" | "approval_status" | "attr_<key>") ---- */

export function parseGroupBy(raw: string | null | undefined): GroupBySpec | null {
  if (!raw) return null;
  if (raw === "subtype") return { kind: "subtype" };
  if (raw === "lifecycle") return { kind: "lifecycle" };
  if (raw === "approval_status") return { kind: "approval" };
  if (raw.startsWith("attr_") && raw.length > 5) {
    return { kind: "attribute", fieldKey: raw.slice(5) };
  }
  return null;
}

export function serializeGroupBy(spec: GroupBySpec | null): string | null {
  if (!spec) return null;
  switch (spec.kind) {
    case "subtype":
      return "subtype";
    case "lifecycle":
      return "lifecycle";
    case "approval":
      return "approval_status";
    case "attribute":
      return `attr_${spec.fieldKey}`;
  }
}

/** The group a card belongs to on the given axis ("" and friends → NOT_SET_KEY). */
export function groupKeyOf(card: Card, spec: GroupBySpec): string {
  switch (spec.kind) {
    case "subtype":
      return card.subtype || NOT_SET_KEY;
    case "lifecycle":
      return getCurrentPhase(card.lifecycle) || NOT_SET_KEY;
    case "approval":
      return card.approval_status || NOT_SET_KEY;
    case "attribute": {
      const value = (card.attributes || {})[spec.fieldKey];
      if (valueIsEmpty(value)) return NOT_SET_KEY;
      // single_select stores a scalar; be tolerant of a stray array value.
      if (Array.isArray(value)) return String(value[0]);
      return String(value);
    }
  }
}

/**
 * Build the grouped row list: for each non-empty group, one header row (a
 * clone of `representatives.get(key)` — a member known to pass the active
 * column filters — falling back to the first member) followed by its members,
 * unless the group is collapsed. Group order: Not set first, then `vocab`
 * order, then any stray keys (values whose option was deleted) in first-seen
 * order. Groups with no members are skipped entirely.
 */
export function buildGroupedRows(
  cards: Card[],
  spec: GroupBySpec,
  vocab: GroupVocabEntry[],
  collapsed: ReadonlySet<string>,
  representatives: ReadonlyMap<string, Card> | null,
  notSetLabel: string,
): InventoryRow[] {
  const axis = serializeGroupBy(spec)!;
  const buckets = new Map<string, Card[]>();
  for (const card of cards) {
    const key = groupKeyOf(card, spec);
    const bucket = buckets.get(key);
    if (bucket) bucket.push(card);
    else buckets.set(key, [card]);
  }

  const order: GroupVocabEntry[] = [{ key: NOT_SET_KEY, label: notSetLabel }, ...vocab];
  const known = new Set(order.map((e) => e.key));
  for (const key of buckets.keys()) {
    if (!known.has(key)) order.push({ key, label: key });
  }

  const rows: InventoryRow[] = [];
  let index = 0;
  for (const entry of order) {
    const members = buckets.get(entry.key);
    if (!members || members.length === 0) continue;
    const isCollapsed = collapsed.has(entry.key);
    const representative = representatives?.get(entry.key) ?? members[0];
    const header: InventoryRow = {
      ...representative,
      __group: {
        axis,
        key: entry.key,
        label: entry.label,
        count: members.length,
        memberIds: members.map((m) => m.id),
        collapsed: isCollapsed,
        index: index++,
      },
    };
    rows.push(header);
    if (!isCollapsed) rows.push(...members);
  }
  return rows;
}

/**
 * `postSortRows` glue: AG Grid sorts headers among the leaves (a header is a
 * member clone, so it sorts wherever that member would). Reorder in place so
 * each group's header sits directly above its members, members keep the order
 * the sort just gave them, and groups follow their fixed `GroupInfo.index`
 * order regardless of sort direction.
 */
export function glueGroups<T extends { data?: InventoryRow }>(nodes: T[], spec: GroupBySpec): void {
  if (nodes.length === 0) return;
  const headers = new Map<string, T>();
  const leaves = new Map<string, T[]>();
  const others: T[] = [];
  for (const node of nodes) {
    const row = node.data;
    if (!row) {
      others.push(node);
      continue;
    }
    if (row.__group) {
      headers.set(row.__group.key, node);
    } else {
      const key = groupKeyOf(row, spec);
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
