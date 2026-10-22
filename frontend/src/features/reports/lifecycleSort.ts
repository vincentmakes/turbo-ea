/**
 * Sorting for the Lifecycle report (#1305). One order drives both the timeline
 * rows and the table, and a card missing the sorted value always goes last —
 * in either direction — so a descending sort by phase-out date opens on the
 * latest phase-out rather than on every card that has none.
 */

/** The lifecycle phases, in the order a card moves through them. */
export const PHASE_KEYS = ["plan", "phaseIn", "active", "phaseOut", "endOfLife"] as const;
export type PhaseKey = (typeof PHASE_KEYS)[number];

export type SortDir = "asc" | "desc";

/** A sort on one of the type's single-select fields: `attr:<fieldKey>`. */
export const ATTR_SORT_PREFIX = "attr:";

export interface LifecycleSortItem {
  id: string;
  name: string;
  type: string;
  subtype?: string | null;
  lifecycle: Record<string, string>;
  attributes?: Record<string, unknown>;
}

export function parseDate(s: unknown): number | null {
  if (typeof s !== "string" || !s) return null;
  const d = new Date(s).getTime();
  return isNaN(d) ? null : d;
}

/** The latest phase whose date has passed; a card with none is in planning. */
export function currentPhase(lc: Record<string, string>, now: number = Date.now()): PhaseKey {
  for (let i = PHASE_KEYS.length - 1; i >= 0; i--) {
    const d = parseDate(lc[PHASE_KEYS[i]]);
    if (d !== null && d <= now) return PHASE_KEYS[i];
  }
  return "plan";
}

/** Position of a phase in the lifecycle, so phases sort plan → end of life. */
export function phaseRank(key: string): number {
  return PHASE_KEYS.indexOf(key as PhaseKey);
}

/** Which sort keys the report offers for the current view. */
export function availableSortKeys(opts: {
  customDates: boolean;
  hasSubtypes: boolean;
  /** The card type's single-select field keys, in schema order. */
  selectFieldKeys: string[];
}): string[] {
  const keys = ["name", "type"];
  if (opts.hasSubtypes) keys.push("subtype");
  if (opts.customDates) keys.push("startDate", "endDate", "status");
  else keys.push("phase", ...PHASE_KEYS);
  for (const k of opts.selectFieldKeys) keys.push(`${ATTR_SORT_PREFIX}${k}`);
  return keys;
}

/**
 * The key to sort by: a saved report's legacy `eol` reads as the End of Life
 * date, and a key the current view does not offer (another type's field, a
 * date-range key outside that mode) falls back to the name.
 */
export function normalizeSortKey(key: string, available: string[]): string {
  const k = key === "eol" ? "endOfLife" : key;
  return available.includes(k) ? k : "name";
}

/** What sorting needs from the report beyond the item itself. */
export interface LifecycleSortContext {
  typeLabel: (typeKey: string) => string;
  /** The subtype's label, or "" when the card has none. */
  subtypeLabel: (item: LifecycleSortItem) => string;
  startDateKey: string;
  endDateKey: string;
  /** The colour-by bucket's label, or null when the card has no value. */
  statusLabel: (item: LifecycleSortItem) => string | null;
  /** A single-select field's option keys in schema order. */
  optionOrder: (fieldKey: string) => string[];
  now?: number;
}

/** The value a card sorts by under `key`; null when it has none. */
export function sortValue(
  item: LifecycleSortItem,
  key: string,
  ctx: LifecycleSortContext,
): string | number | null {
  if (key === "name") return item.name;
  if (key === "type") return ctx.typeLabel(item.type);
  if (key === "subtype") return ctx.subtypeLabel(item) || null;
  if (key === "phase") return phaseRank(currentPhase(item.lifecycle, ctx.now));
  if ((PHASE_KEYS as readonly string[]).includes(key)) return parseDate(item.lifecycle[key]);
  if (key === "startDate") return parseDate(item.attributes?.[ctx.startDateKey]);
  if (key === "endDate") return parseDate(item.attributes?.[ctx.endDateKey]);
  if (key === "status") return ctx.statusLabel(item);
  if (key.startsWith(ATTR_SORT_PREFIX)) {
    const fieldKey = key.slice(ATTR_SORT_PREFIX.length);
    const raw = item.attributes?.[fieldKey];
    if (raw === undefined || raw === null || raw === "") return null;
    const order = ctx.optionOrder(fieldKey);
    const at = order.indexOf(String(raw));
    // A stored key the field no longer defines sorts after every known option.
    return at === -1 ? order.length : at;
  }
  return null;
}

/** Sort a copy of `items`; missing values last, ties broken by name. */
export function sortLifecycleItems<T extends LifecycleSortItem>(
  items: T[],
  key: string,
  dir: SortDir,
  ctx: LifecycleSortContext,
): T[] {
  const sign = dir === "asc" ? 1 : -1;
  const keyed = items.map((item) => ({ item, v: sortValue(item, key, ctx) }));
  keyed.sort((a, b) => {
    if (a.v === null || b.v === null) {
      if (a.v !== b.v) return a.v === null ? 1 : -1;
    } else {
      const c =
        typeof a.v === "number" && typeof b.v === "number"
          ? a.v - b.v
          : String(a.v).localeCompare(String(b.v));
      // Stryker disable next-line ArithmeticOperator: sign is 1 or -1, so * and / agree
      if (c !== 0) return c * sign;
    }
    return a.item.name.localeCompare(b.item.name);
  });
  return keyed.map((k) => k.item);
}
