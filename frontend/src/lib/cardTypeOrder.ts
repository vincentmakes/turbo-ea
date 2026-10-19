/**
 * EA-layer order and naming for card types, and the grouping the Inventory
 * filter sidebar renders from it.
 *
 * A card type's `category` names a row of the category registry
 * (`/metamodel/categories`, cached by `useCardTypeCategories`): the four
 * built-in layers plus any an admin created. The registry's `sort_order` is
 * the layer order and its colour/translations are the layer's look and name,
 * on every surface — this module (the inventory sidebar), the metamodel admin
 * and graph (`features/admin/metamodel/constants.ts`) and the Layered
 * Dependency View (`features/reports/ldvLayoutShared.ts`) all order through
 * `orderCategoryKeys` below.
 *
 * The API returns types ordered by `sort_order` alone; a custom type gets
 * `max(sort_order) + 1` and would land at the very bottom whatever its layer,
 * so layer order is derived here at display time, never trusted from the
 * type's number.
 *
 * When no registry is to hand (tests, account-less portals, an older backend)
 * the four built-in names in `CARD_TYPE_CATEGORY_ORDER` are the fallback. A
 * category that the registry does not know (a value written before it existed)
 * is kept, after the known ones, in the order it is first seen — never folded
 * into "Other", which would hide the layer an admin named. A null, blank or
 * whitespace category is "uncategorized". Comparison is exact after trimming.
 */

import { categoryLabel, typeLabel } from "@/hooks/useResolveLabel";
import type { CardType, CardTypeCategory } from "@/types";

/**
 * The four seeded EA layers in their default order — the fallback when no
 * registry is available. Also the keys of the built-in registry rows.
 */
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
   * The category as stored on the types (trimmed), or `null` when the types in
   * this group have none. Display `label` instead; only the `null` case needs a
   * translated "uncategorized" label, and that belongs to the caller's namespace.
   */
  category: string | null;
  /**
   * The display name: the registry row's label in the requested locale, the
   * raw category for a value the registry does not know, `null` when
   * uncategorized.
   */
  label: string | null;
  /** The registry row's colour, when there is one. */
  color: string | null;
  /** Visible types of this layer, ordered `sort_order` then label. */
  types: CardType[];
}

export interface GroupCardTypesOptions {
  /** App locale (`i18n.language`) — drives the label tie-break's collation. */
  locale?: string;
  /** Keep `is_hidden` types. Default `false`. */
  includeHidden?: boolean;
  /**
   * The category registry (`useCardTypeCategories().categories`). Its order
   * wins; when empty or absent, `CARD_TYPE_CATEGORY_ORDER` is used.
   */
  categories?: CardTypeCategory[];
}

/** `categories` in layer order (`sort_order`, then label). Never mutates. */
export function orderCategories(categories: CardTypeCategory[]): CardTypeCategory[] {
  return [...categories].sort(
    (a, b) => a.sort_order - b.sort_order || a.label.localeCompare(b.label),
  );
}

/** The category a new card type starts in when nothing else picks one. */
export const DEFAULT_NEW_TYPE_CATEGORY = "Application & Data";

/**
 * The category the create-type dialog preselects: `DEFAULT_NEW_TYPE_CATEGORY`
 * when the registry holds it (the default before the registry existed), else
 * the registry's first layer, else none.
 */
export function defaultNewTypeCategory(categories: CardTypeCategory[]): string | null {
  if (categories.some((c) => c.key === DEFAULT_NEW_TYPE_CATEGORY)) {
    return DEFAULT_NEW_TYPE_CATEGORY;
  }
  return orderCategories(categories)[0]?.key ?? null;
}

/**
 * The layer keys in display order: the registry's when it has any rows,
 * `CARD_TYPE_CATEGORY_ORDER` otherwise.
 */
export function categoryKeyOrder(categories?: CardTypeCategory[]): string[] {
  return categories && categories.length > 0
    ? orderCategories(categories).map((c) => c.key)
    : [...CARD_TYPE_CATEGORY_ORDER];
}

/**
 * `present` (category keys, in first-seen order) arranged in layer order:
 * every key the registry (or the fallback order) knows, in that order, then
 * the unknown ones as first seen. Duplicates are dropped.
 */
export function orderCategoryKeys(
  present: Iterable<string>,
  categories?: CardTypeCategory[],
): string[] {
  const seen = [...new Set(present)];
  const order = categoryKeyOrder(categories);
  const known = new Set(order);
  return [...order.filter((k) => seen.includes(k)), ...seen.filter((k) => !known.has(k))];
}

/**
 * The display name of a stored `category`: the registry row's label in
 * `locale`, the raw (trimmed) value when the registry has no such row, `null`
 * for a null or blank category.
 */
export function categoryDisplayName(
  category: string | null | undefined,
  categories: CardTypeCategory[] | undefined,
  locale?: string,
): string | null {
  const key = category?.trim();
  if (!key) return null;
  const row = categories?.find((c) => c.key === key);
  return row ? categoryLabel(row, locale) : key;
}

/** `{category key: number of card types}` over `types` (trimmed match). */
export function usageByCategory(types: CardType[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const t of types) {
    const key = t.category?.trim();
    if (key) out[key] = (out[key] ?? 0) + 1;
  }
  return out;
}

/**
 * Card types bucketed by category, groups in layer order and types ordered
 * inside each group. Never mutates the input.
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
  const { locale, includeHidden = false, categories } = options;

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

  // Known layers in registry order, then any layer the registry does not know,
  // in the order the API handed them over (i.e. by the lowest `sort_order` in
  // that layer), then the types with no layer at all.
  const orderedKeys = [
    ...orderCategoryKeys(
      [...buckets.keys()].filter((k) => k !== UNCATEGORIZED_GROUP_KEY),
      categories,
    ),
    ...(buckets.has(UNCATEGORIZED_GROUP_KEY) ? [UNCATEGORIZED_GROUP_KEY] : []),
  ];

  return orderedKeys.map((key) => {
    const category = categoryByKey.get(key) ?? null;
    const row = category ? categories?.find((c) => c.key === category) : undefined;
    return {
      key,
      category,
      label: categoryDisplayName(category, categories, locale),
      color: row?.color ?? null,
      types: [...buckets.get(key)!].sort(
        (a, b) =>
          a.sort_order - b.sort_order ||
          typeLabel(a, locale).localeCompare(typeLabel(b, locale), locale, {
            sensitivity: "base",
          }),
      ),
    };
  });
}
