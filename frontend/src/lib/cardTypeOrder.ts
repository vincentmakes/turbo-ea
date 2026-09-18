/**
 * Canonical EA-layer order for card types, and the grouping the Inventory
 * filter sidebar renders from it.
 *
 * The `/metamodel/types` API returns types ordered by `sort_order` alone
 * (`backend/app/api/v1/metamodel.py`). That *looks* layered only because the
 * seed numbers the built-in types 0-12 in layer order; a custom type created
 * later gets `max(sort_order) + 1` and lands at the very bottom of the list
 * whatever layer it belongs to, with no UI anywhere to move it (`sort_order`
 * is not admin-editable). Layer order is therefore derived at display time,
 * here, and never trusted from the number.
 *
 * `category` is a nullable free-text `String(100)` an admin can type anything
 * into, so this handles three cases the four canonical names do not cover: a
 * category that is not one of them (kept, appended after them in the order it
 * is first seen — the same posture as `features/reports/layeredDependencyLayout.ts`,
 * deliberately *not* `MetamodelGraph`'s collapse-to-"Other", which would hide
 * the admin's own layer name), a category that is null, and one that is blank
 * or whitespace. Comparison is case-sensitive, matching the two existing
 * copies of this constant — `Application & Data` and `application & data` are
 * two layers.
 *
 * Two other copies of the canonical order exist and are intentionally left
 * alone: `features/admin/metamodel/constants.ts` (`CATEGORIES` / `LAYER_ORDER`,
 * which appends a synthetic "Other") and `features/reports/ldvLayoutShared.ts`
 * (`CATEGORY_ORDER`). Converging the three is a separate change.
 */

import { typeLabel } from "@/hooks/useResolveLabel";
import type { CardType } from "@/types";

/** The four seeded EA layers, in the order they are drawn everywhere. */
export const CARD_TYPE_CATEGORY_ORDER: readonly string[] = [
  "Strategy & Transformation",
  "Business Architecture",
  "Application & Data",
  "Technical Architecture",
];

/** React list key for the bucket holding types with no category at all. */
export const UNCATEGORIZED_GROUP_KEY = "__uncategorized__";

export interface CardTypeGroup {
  /** Stable React key — the category itself, or `UNCATEGORIZED_GROUP_KEY`. */
  key: string;
  /**
   * The category as the admin stored it (trimmed), or `null` when the types in
   * this group have none. Render it raw: layer names are database free text and
   * are never translated anywhere in the app. Only the `null` case needs a
   * translated label, and that belongs to the caller's namespace.
   */
  category: string | null;
  /** Visible types of this layer, ordered `sort_order` then label. */
  types: CardType[];
}

export interface GroupCardTypesOptions {
  /** App locale (`i18n.language`) — drives the label tie-break's collation. */
  locale?: string;
  /** Keep `is_hidden` types. Default `false`. */
  includeHidden?: boolean;
}

/**
 * Card types bucketed by category, groups in canonical layer order and types
 * ordered inside each group. Never mutates the input.
 *
 * Within a group the order is `sort_order` ascending, falling back to the
 * localized label. `sort_order` is not admin-editable (there is no reorder UI),
 * so it carries the seed's intra-layer sequence — Application before Interface
 * before Data Object — which alphabetising would destroy, and which would
 * re-shuffle on every language switch. The label only breaks ties, which the
 * API can produce because the create endpoint accepts an explicit `sort_order`.
 */
export function groupCardTypesByCategory(
  types: CardType[],
  options: GroupCardTypesOptions = {},
): CardTypeGroup[] {
  const { locale, includeHidden = false } = options;

  const buckets = new Map<string, CardType[]>();
  const categoryByKey = new Map<string, string | null>();

  for (const type of types) {
    if (!includeHidden && type.is_hidden) continue;
    const trimmed = type.category?.trim();
    const category = trimmed ? trimmed : null;
    const key = category ?? UNCATEGORIZED_GROUP_KEY;
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = [];
      buckets.set(key, bucket);
      categoryByKey.set(key, category);
    }
    bucket.push(type);
  }

  // Canonical layers first, then any layer an admin invented, in the order the
  // API handed them over (i.e. by the lowest `sort_order` in that layer), then
  // the types with no layer at all.
  const orderedKeys = [
    ...CARD_TYPE_CATEGORY_ORDER.filter((c) => buckets.has(c)),
    ...[...buckets.keys()].filter(
      (k) => k !== UNCATEGORIZED_GROUP_KEY && !CARD_TYPE_CATEGORY_ORDER.includes(k),
    ),
    ...(buckets.has(UNCATEGORIZED_GROUP_KEY) ? [UNCATEGORIZED_GROUP_KEY] : []),
  ];

  return orderedKeys.map((key) => ({
    key,
    category: categoryByKey.get(key) ?? null,
    types: [...buckets.get(key)!].sort(
      (a, b) =>
        a.sort_order - b.sort_order ||
        typeLabel(a, locale).localeCompare(typeLabel(b, locale), locale, {
          sensitivity: "base",
        }),
    ),
  }));
}
