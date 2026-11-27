/**
 * The Lifecycle report's rows, flattened: each card, and — while it is
 * expanded — its dated relations beneath it.
 *
 * The name column, the timeline column and the table body all map the same
 * list, so a relation row sits at the same index in all three.
 */

/** One dated relation of a card, from the card's side (`GET /reports/roadmap`). */
export interface RelationLifecycleEntry {
  relation_type: string;
  direction: "outgoing" | "incoming";
  related_id: string;
  related_name: string;
  related_type: string;
  lifecycle: Record<string, string>;
}

export interface RowItem {
  id: string;
  relation_lifecycles?: RelationLifecycleEntry[];
}

export type DisplayRow<T extends RowItem> =
  | {
      kind: "card";
      key: string;
      item: T;
      /** Dated relations the card can show; 0 when it has none (or rows are off). */
      relationCount: number;
      expanded: boolean;
    }
  | {
      kind: "relation";
      key: string;
      parent: T;
      entry: RelationLifecycleEntry;
      /** The relation type's verb, read from the parent card's side. */
      verb: string;
    };

/**
 * Whether a card's relation rows are open: everything follows "expand all",
 * except the cards the person toggled the other way.
 */
export function isExpanded(id: string, expandAll: boolean, toggled: ReadonlySet<string>): boolean {
  return expandAll !== toggled.has(id);
}

/** `ids` with `id` added, or removed when it is already there. */
export function toggleId(ids: readonly string[], id: string): string[] {
  return ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id];
}

export function buildDisplayRows<T extends RowItem>(
  sorted: readonly T[],
  opts: {
    /** Relation rows are off (the date-range view): cards only. */
    enabled: boolean;
    expandAll: boolean;
    toggled: ReadonlySet<string>;
    verbOf: (entry: RelationLifecycleEntry) => string;
  },
): DisplayRow<T>[] {
  const rows: DisplayRow<T>[] = [];
  for (const item of sorted) {
    const entries = opts.enabled ? (item.relation_lifecycles ?? []) : [];
    const expanded = entries.length > 0 && isExpanded(item.id, opts.expandAll, opts.toggled);
    rows.push({ kind: "card", key: item.id, item, relationCount: entries.length, expanded });
    if (!expanded) continue;
    for (const entry of entries) {
      rows.push({
        kind: "relation",
        key: `${item.id}|${entry.relation_type}|${entry.direction}|${entry.related_id}`,
        parent: item,
        entry,
        verb: opts.verbOf(entry),
      });
    }
  }
  return rows;
}
