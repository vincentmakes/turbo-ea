/**
 * "View in inventory" deep-links from the portfolio report's group drawer
 * (discussion #933): the report stays read-only, the fix happens in the
 * inventory, this is the bridge between the two.
 *
 * Attribute-grouped reports get a MIRRORED landing: the inventory arrives
 * grouped by the same field (`group_by=attr_<fieldKey>`), with the clicked
 * group expanded and every other group collapsed (`expand_group=<key>`), and
 * the report's own filters carried over — no value filter for the clicked
 * group, so the other buckets stay visible as collapsed headers with counts.
 *
 * Relation-grouped reports cannot be mirrored (the inventory deliberately
 * has no relation axis — a card related to N members would need N rows), so
 * they fall back to filtering: `rel_<relatedTypeKey>=<card name>` (name-based,
 * matching the sidebar relation filter's value shape) plus the carried
 * filters. The "not assigned" bucket maps to `expand_group=__not_set__` in
 * attribute mode and the `__empty__` sentinel in relation mode.
 *
 * Carried filters (all as repeated URL params, parsed by InventoryPage):
 * search, attribute filters (`attr_<key>=<v>` per value), relation filters
 * (`rel_<typeKey>=<name>` per name), tag filters (`tag=<id>` per id).
 * Relation-subtype filters and the timeline date have no inventory
 * equivalent and are dropped by the caller.
 */

/** Must match EMPTY_VALUE in InventoryFilterSidebar (asserted by test) —
 * defined locally so the report bundle doesn't drag the whole sidebar in. */
export const INVENTORY_EMPTY_VALUE = "__empty__";

/** Must match NOT_SET_KEY in components/grid/rowGrouping (asserted by test). */
export const INVENTORY_NOT_SET_KEY = "__not_set__";

export type InventorySliceMode =
  | { kind: "attribute"; fieldKey: string }
  | { kind: "relation"; typeKey: string };

export interface InventorySliceGroup {
  /** Option key (attribute mode) or related card id (relation mode). */
  key: string;
  /** Display label; the related card name in relation mode. */
  label: string;
}

/** The report filters a link carries into the inventory. Relations must
 * already be name-based (the report translates member ids before calling). */
export interface InventorySliceFilters {
  search?: string;
  attributes?: Record<string, string[]>;
  relations?: Record<string, string[]>;
  tagIds?: string[];
}

export function buildInventorySliceUrl(opts: {
  cardType: string;
  mode: InventorySliceMode;
  group: InventorySliceGroup | "ungrouped";
  filters?: InventorySliceFilters;
}): string {
  const { cardType, mode, group, filters } = opts;
  const params = new URLSearchParams();
  params.set("type", cardType);

  if (filters?.search) params.set("search", filters.search);
  for (const [key, values] of Object.entries(filters?.attributes ?? {})) {
    for (const value of values) params.append(`attr_${key}`, value);
  }
  const carriedRelations = { ...(filters?.relations ?? {}) };
  if (mode.kind === "relation") {
    // The clicked group IS the filter on that relation type — it replaces
    // any carried report filter on the same type rather than unioning.
    delete carriedRelations[mode.typeKey];
  }
  for (const [typeKey, names] of Object.entries(carriedRelations)) {
    for (const name of names) params.append(`rel_${typeKey}`, name);
  }
  for (const id of filters?.tagIds ?? []) params.append("tag", id);

  if (mode.kind === "attribute") {
    params.set("group_by", `attr_${mode.fieldKey}`);
    params.set(
      "expand_group",
      group === "ungrouped" ? INVENTORY_NOT_SET_KEY : group.key,
    );
  } else {
    params.append(
      `rel_${mode.typeKey}`,
      group === "ungrouped" ? INVENTORY_EMPTY_VALUE : group.label,
    );
  }
  return `/inventory?${params.toString()}`;
}
