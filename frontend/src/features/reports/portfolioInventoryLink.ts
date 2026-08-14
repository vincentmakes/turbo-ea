/**
 * "View in inventory" deep-links from a report's group drawer (discussion
 * #933): the report stays read-only, the fix happens in the inventory, this is
 * the bridge between the two. Started on the portfolio report; the Data
 * Quality report's band segments now land the same way.
 *
 * Attribute-grouped reports get a MIRRORED landing: the inventory arrives
 * grouped by the same field (`group_by=attr_<fieldKey>`), with the clicked
 * group expanded and every other group collapsed (`expand_group=<key>`), and
 * the report's own filters carried over — no value filter for the clicked
 * group, so the other buckets stay visible as collapsed headers with counts.
 * Data-quality bands mirror the same way onto the fixed `data_quality` axis.
 * A `null` group means "group by the axis, expand nothing" — the landing for
 * a click on a whole type rather than one of its buckets.
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
  | { kind: "relation"; typeKey: string }
  /** Data-quality bands. Mirrors like an attribute — the inventory has a
   * matching `data_quality` group axis — but the axis key is fixed, so there
   * is nothing to carry. */
  | { kind: "quality" };

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

/**
 * Deep-link for a whole-landscape health flag (the Data Quality report's
 * Orphaned / Stale tiles). No card type and no grouping — the tiles count
 * across every type, so the landing must too.
 */
export function buildInventoryFlagUrl(flag: "orphaned" | "stale"): string {
  return `/inventory?${flag}=true`;
}

export function buildInventorySliceUrl(opts: {
  cardType: string;
  mode: InventorySliceMode;
  /** The bucket to focus. `null` groups by the axis but expands nothing —
   * the "whole type, still bucketed" landing behind a type-level click. */
  group: InventorySliceGroup | "ungrouped" | null;
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
  if (mode.kind === "relation" && group !== null) {
    // The clicked group IS the filter on that relation type — it replaces
    // any carried report filter on the same type rather than unioning.
    delete carriedRelations[mode.typeKey];
  }
  for (const [typeKey, names] of Object.entries(carriedRelations)) {
    for (const name of names) params.append(`rel_${typeKey}`, name);
  }
  for (const id of filters?.tagIds ?? []) params.append("tag", id);

  if (mode.kind === "relation") {
    // Relation mode cannot mirror, so it filters — and with nothing to focus
    // there is no filter to apply either.
    if (group !== null) {
      params.append(
        `rel_${mode.typeKey}`,
        group === "ungrouped" ? INVENTORY_EMPTY_VALUE : group.label,
      );
    }
  } else {
    params.set(
      "group_by",
      mode.kind === "quality" ? "data_quality" : `attr_${mode.fieldKey}`,
    );
    if (group !== null) {
      params.set(
        "expand_group",
        group === "ungrouped" ? INVENTORY_NOT_SET_KEY : group.key,
      );
    }
  }
  return `/inventory?${params.toString()}`;
}
