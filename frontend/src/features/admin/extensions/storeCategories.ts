/**
 * Groups store items into the catalogue's sections.
 *
 * Sections come in STORE_CATEGORIES order and keep the catalogue's own
 * order inside; an item whose `category` this build does not recognise —
 * missing, or a slug a newer catalogue introduced — goes to the trailing
 * "Other" section rather than disappearing. When NO item carries a known
 * category the whole list comes back as a single unlabeled group, so a
 * pre-category catalogue renders as the flat grid it always did instead of
 * under a lone "Other" heading.
 */
import { OTHER_CATEGORY, STORE_CATEGORIES, type StoreItem } from "./types";

export interface StoreGroup {
  // A STORE_CATEGORIES slug, OTHER_CATEGORY, or null for the unlabeled
  // flat fallback.
  category: string | null;
  items: StoreItem[];
}

function knownCategory(item: StoreItem): string | null {
  const slug = item.category ?? "";
  return (STORE_CATEGORIES as readonly string[]).includes(slug) ? slug : null;
}

export function groupStoreItems(items: StoreItem[]): StoreGroup[] {
  if (items.length === 0) return [];
  if (!items.some((item) => knownCategory(item) !== null)) {
    return [{ category: null, items }];
  }
  const buckets = new Map<string, StoreItem[]>();
  for (const slug of [...STORE_CATEGORIES, OTHER_CATEGORY]) buckets.set(slug, []);
  for (const item of items) {
    buckets.get(knownCategory(item) ?? OTHER_CATEGORY)!.push(item);
  }
  return [...buckets.entries()]
    .filter(([, members]) => members.length > 0)
    .map(([category, members]) => ({ category, items: members }));
}
