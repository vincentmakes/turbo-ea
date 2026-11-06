/**
 * How a related card's cost is attributed to the cards it links to (#1362).
 *
 * `full` puts the whole cost on every linked card — the per-tile "impact"
 * view — so a related card linked to several tiles appears on each, and a
 * total over the tiles must count it once (`distinctTotal`). `split` divides
 * the cost equally between the linked cards, so the tiles add up.
 *
 * Shared by the Cost Report and the Capability Map's Total Cost metric.
 */

export type Attribution = "full" | "split";

/** Whether a stored value is an attribution — the guard a saved config is restored through. */
export function isAttribution(v: unknown): v is Attribution {
  return v === "full" || v === "split";
}

/** The part of a cost-report item the attribution helpers read. */
export interface AttributedItem {
  id: string;
  cost: number;
  /** The related cards whose costs make up `cost` (aggregate mode only). */
  source_ids?: string[];
}

/**
 * Item id → how many of its sources also appear on another item. Items with
 * no shared source are left out of the map.
 */
export function sharedSourceCounts(items: AttributedItem[]): Map<string, number> {
  const seen = new Map<string, number>();
  for (const item of items) {
    for (const sid of new Set(item.source_ids ?? [])) seen.set(sid, (seen.get(sid) ?? 0) + 1);
  }
  const out = new Map<string, number>();
  for (const item of items) {
    let n = 0;
    for (const sid of new Set(item.source_ids ?? [])) if ((seen.get(sid) ?? 0) >= 2) n += 1;
    if (n > 0) out.set(item.id, n);
  }
  return out;
}

/**
 * The total with every related card counted once: the union of the items'
 * `source_ids`, each priced from `sourceCosts`. An item without `source_ids`
 * (direct cost) adds its own cost; a source the server did not price adds 0.
 */
export function distinctTotal(
  items: AttributedItem[],
  sourceCosts?: Record<string, number>,
): number {
  const sources = new Set<string>();
  let total = 0;
  for (const item of items) {
    if (!item.source_ids) {
      total += item.cost;
      continue;
    }
    for (const sid of item.source_ids) sources.add(sid);
  }
  for (const sid of sources) total += sourceCosts?.[sid] ?? 0;
  return total;
}

/**
 * The part of `cost` that falls inside a set when `inside` of the `total`
 * cards it is split between are in it. With no cards to split between, the
 * whole cost stays.
 */
export function splitShare(cost: number, inside: number, total: number): number {
  return total > 0 ? (cost * inside) / total : cost;
}
