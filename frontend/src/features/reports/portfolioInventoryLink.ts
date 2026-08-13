/**
 * "View in inventory" deep-links from the portfolio report's group drawer
 * (discussion #933): the report stays read-only, the fix happens in the
 * inventory, this is the bridge between the two.
 *
 * The inventory reads these URL params at mount (InventoryPage):
 *   - attribute groups →  /inventory?type=T&attr_<fieldKey>=<option key>
 *   - relation groups  →  /inventory?type=T&rel_<relatedTypeKey>=<card name>
 *     (name-based, matching the sidebar relation filter's value shape)
 *   - the "not assigned" bucket → the `__empty__` sentinel on either param
 */

/** Must match EMPTY_VALUE in InventoryFilterSidebar (asserted by test) —
 * defined locally so the report bundle doesn't drag the whole sidebar in. */
export const INVENTORY_EMPTY_VALUE = "__empty__";

export type InventorySliceMode =
  | { kind: "attribute"; fieldKey: string }
  | { kind: "relation"; typeKey: string };

export interface InventorySliceGroup {
  /** Option key (attribute mode) or related card id (relation mode). */
  key: string;
  /** Display label; the related card name in relation mode. */
  label: string;
}

export function buildInventorySliceUrl(opts: {
  cardType: string;
  mode: InventorySliceMode;
  group: InventorySliceGroup | "ungrouped";
}): string {
  const params = new URLSearchParams();
  params.set("type", opts.cardType);
  const value =
    opts.group === "ungrouped"
      ? INVENTORY_EMPTY_VALUE
      : opts.mode.kind === "attribute"
        ? opts.group.key
        : opts.group.label;
  if (opts.mode.kind === "attribute") {
    params.set(`attr_${opts.mode.fieldKey}`, value);
  } else {
    params.set(`rel_${opts.mode.typeKey}`, value);
  }
  return `/inventory?${params.toString()}`;
}
